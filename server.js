const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const db = require('./db_mysql');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ACCESS_TYPES = ['admin', 'gestor', 'operador'];
const META_PERIOD_TYPES = {
  mensal: 1,
  bimestral: 2,
  trimestral: 3,
  quadrimestral: 4,
  semestral: 6,
  anual: 12,
};
const META_PERIOD_LABELS = {
  mensal: 'Mensal',
  bimestral: 'Bimestral',
  trimestral: 'Trimestral',
  quadrimestral: 'Quadrimestral',
  semestral: 'Semestral',
  anual: 'Anual',
};
// Sessão persistente por padrão:
// - segredo estável (não muda a cada restart)
// - TTL padrão maior para evitar logout frequente
const TOKEN_TTL_HOURS = Number(process.env.AUTH_TOKEN_TTL_HOURS || (24 * 30)); // 30 dias
const TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || 'metas-auth-secret-local';

function b64urlEncode(input) {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function b64urlDecode(input) {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(base64 + padding, 'base64').toString('utf8');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  try {
    const [salt, expected] = stored.split(':');
    const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
    const a = Buffer.from(actual, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function createToken(payload) {
  const exp = Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000;
  const body = b64urlEncode(JSON.stringify({ ...payload, exp }));
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const payload = JSON.parse(b64urlDecode(body));
  if (!payload?.exp || Date.now() > Number(payload.exp)) return null;
  return payload;
}

const PERMISSION_KEYS = [
  'meta_gerar',
  'meta_excluir',
  'deducao_gerar',
  'deducao_excluir',
  'funcionario_criar',
  'funcionario_editar',
  'funcionario_excluir',
  'fechamento_gerar',
  'fechamento_excluir',
];

function defaultPermissionsByRole(role) {
  const all = Object.fromEntries(PERMISSION_KEYS.map(k => [k, true]));
  if (role === 'admin') return all;
  if (role === 'gestor') return all;
  return {
    meta_gerar: true,
    meta_excluir: true,
    deducao_gerar: true,
    deducao_excluir: true,
    funcionario_criar: true,
    funcionario_editar: true,
    funcionario_excluir: true,
    fechamento_gerar: true,
    fechamento_excluir: true,
  };
}

function normalizePermissionsInput(input, role) {
  const base = defaultPermissionsByRole(role);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return base;
  for (const k of PERMISSION_KEYS) {
    if (input[k] !== undefined) base[k] = !!input[k];
  }
  return base;
}

function parsePermissionsFromDb(value, role) {
  if (!value) return defaultPermissionsByRole(role);
  try {
    const parsed = JSON.parse(value);
    return normalizePermissionsInput(parsed, role);
  } catch {
    return defaultPermissionsByRole(role);
  }
}

function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    nome: row.nome,
    usuario: row.usuario,
    tipo_acesso: row.tipo_acesso,
    ativo: !!row.ativo,
    permissoes: parsePermissionsFromDb(row.permissoes, row.tipo_acesso),
    funcionario_id: row.funcionario_id ?? null,
    criado_em: row.criado_em
  };
}

function getMetaPeriodType() {
  const row = db.prepare("SELECT valor FROM configuracoes WHERE chave = 'tipo_meta_periodo'").get();
  const tipo = String(row?.valor || 'trimestral').toLowerCase();
  return META_PERIOD_TYPES[tipo] ? tipo : 'trimestral';
}

function getMetaPeriodMonths() {
  return META_PERIOD_TYPES[getMetaPeriodType()] || 3;
}

function getFixedApiToken() {
  const row = db.prepare("SELECT valor FROM configuracoes WHERE chave = 'api_token_fixo'").get();
  const token = String(row?.valor || '').trim();
  return token || null;
}

function isApiTokenAllowedRoute(req) {
  return req.path === '/deducoes' && req.method === 'POST';
}

function hasAnyAccess(userType, allowedTypes) {
  return allowedTypes.includes(userType);
}

function routeNeedsGestor(req) {
  const p = req.path;
  if (p.startsWith('/usuarios')) return false;
  if (p.startsWith('/funcionarios') && req.method !== 'GET') return true;
  if (p === '/metas' && req.method === 'POST') return true;
  if (p === '/metas/lote' && req.method === 'POST') return true;
  if (/^\/metas\/\d+$/.test(p) && (req.method === 'PUT' || req.method === 'DELETE')) return true;
  if (/^\/metas\/\d+\/(melhorias|variaveis)$/.test(p) && req.method === 'POST') return true;
  if (/^\/metas\/\d+\/(fechar|reabrir)$/.test(p) && req.method === 'POST') return true;
  if (/^\/deducoes\/\d+$/.test(p) && req.method === 'DELETE') return true;
  if (p === '/fechamentos' && req.method === 'POST') return true;
  if (/^\/fechamentos\/\d+$/.test(p) && req.method === 'DELETE') return true;
  return false;
}

function permissionKeyForRoute(req) {
  const p = req.path;
  if (p === '/funcionarios' && req.method === 'POST') return 'funcionario_criar';
  if (p === '/funcionarios/importar' && req.method === 'POST') return 'funcionario_criar';
  if (/^\/funcionarios\/\d+$/.test(p) && req.method === 'PUT') return 'funcionario_editar';
  if (/^\/funcionarios\/\d+$/.test(p) && req.method === 'DELETE') return 'funcionario_excluir';
  if (p === '/metas' && req.method === 'POST') return 'meta_gerar';
  if (p === '/metas/lote' && req.method === 'POST') return 'meta_gerar';
  if (/^\/metas\/\d+$/.test(p) && req.method === 'DELETE') return 'meta_excluir';
  if (/^\/metas\/\d+\/(melhorias|variaveis)$/.test(p) && req.method === 'POST') return 'meta_gerar';
  if (/^\/metas\/\d+\/deducoes$/.test(p) && req.method === 'POST') return 'deducao_gerar';
  if (p === '/deducoes/lote/preview' && req.method === 'POST') return 'deducao_gerar';
  if (p === '/deducoes/lote/aplicar' && req.method === 'POST') return 'deducao_gerar';
  if (p === '/deducoes' && req.method === 'POST') return 'deducao_gerar';
  if (/^\/deducoes\/\d+$/.test(p) && req.method === 'DELETE') return 'deducao_excluir';
  if (p === '/fechamentos' && req.method === 'POST') return 'fechamento_gerar';
  if (/^\/fechamentos\/\d+$/.test(p) && req.method === 'DELETE') return 'fechamento_excluir';
  return null;
}

app.use('/api', (req, res, next) => {
  if (req.path === '/auth/login') return next();

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload?.userId) {
    const apiTokenHeader = req.headers['x-api-key'] || req.headers['x-api-token'] || token;
    const apiToken = String(apiTokenHeader || '').trim();
    const fixed = getFixedApiToken();
    const a = Buffer.from(apiToken);
    const b = Buffer.from(fixed || '');
    const same = a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
    if (same && isApiTokenAllowedRoute(req)) {
      req.apiAuth = { fixed_token: true };
      return next();
    }
    return res.status(401).json({ error: 'Não autenticado' });
  }

  const user = db.prepare(`
    SELECT id, nome, usuario, tipo_acesso, ativo, permissoes, funcionario_id, criado_em
    FROM usuarios WHERE id = ?
  `).get(payload.userId);
  if (!user || !user.ativo) return res.status(401).json({ error: 'Sessão inválida' });

  req.user = sanitizeUser(user);

  if (req.path.startsWith('/usuarios') && req.user.tipo_acesso !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem gerenciar usuários' });
  }
  const permissionKey = permissionKeyForRoute(req);
  if (permissionKey && req.user.tipo_acesso !== 'admin' && !req.user.permissoes?.[permissionKey]) {
    return res.status(403).json({ error: 'Você não possui permissão para esta ação' });
  }
  if (routeNeedsGestor(req) && !hasAnyAccess(req.user.tipo_acesso, ['admin', 'gestor'])) {
    if (!(req.user.tipo_acesso === 'operador' && permissionKey && req.user.permissoes?.[permissionKey])) {
      return res.status(403).json({ error: 'Você não possui permissão para esta ação' });
    }
  }
  next();
});

// ----------- Helpers -----------
function addMonths(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + months);
  // Subtract 1 day so janela é de 3 meses exatos (ex: 01/01 -> 31/03)
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Primeiro dia do mês (offset em meses a partir da data informada)
function monthStart(dateStr, offset = 0) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return d.toISOString().slice(0, 10);
}

function quarterLabelFromDate(dateStr) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${d.getFullYear()}`;
}

function mesAnoFromDate(dateStr) {
  if (!dateStr) return null;
  const base = String(dateStr).slice(0, 10);
  const [y, m] = base.split('-');
  if (!y || !m) return null;
  return `${m}/${y}`;
}

function normalizarMesAno(input) {
  if (!input) return null;
  const raw = String(input).trim();
  // aceita "MM/YYYY", "M/YYYY" e "YYYY-MM"
  let m, y;
  if (/^\d{4}-\d{1,2}$/.test(raw)) {
    [y, m] = raw.split('-');
  } else if (/^\d{1,2}\/\d{4}$/.test(raw)) {
    [m, y] = raw.split('/');
  } else {
    return null;
  }
  const mm = String(Number(m)).padStart(2, '0');
  const yy = String(y);
  if (Number(mm) < 1 || Number(mm) > 12) return null;
  return `${mm}/${yy}`;
}

function resolverMesOffsetPorMesAno(metaId, mesAno) {
  const mesAnoNorm = normalizarMesAno(mesAno);
  if (!mesAnoNorm) return null;
  const row = db.prepare(`
    SELECT mes_offset
    FROM meta_meses
    WHERE meta_id = ? AND strftime('%m/%Y', data_mes) = ?
    LIMIT 1
  `).get(metaId, mesAnoNorm);
  return row ? Number(row.mes_offset) : null;
}

function calcularResultado(meta) {
  const pct = meta.valor_atual / meta.valor_inicial;
  if (pct >= 1) return 'atingida';
  if (pct >= 0.6) return 'parcial';
  return 'nao_atingida';
}

// Normaliza um array de N valores mensais. Retorna N posições >= 0.
function normalizarValoresMensais(valores, fallbackTotal, quantidadeMeses) {
  const n = Math.max(1, Number(quantidadeMeses) || 1);
  if (Array.isArray(valores) && valores.length === n) {
    return valores.map(v => Math.max(0, Number(v) || 0));
  }

  let total = Number(fallbackTotal) || 0;
  if ((!total || total <= 0) && Array.isArray(valores) && valores.length) {
    total = valores.reduce((s, v) => s + Math.max(0, Number(v) || 0), 0);
  }
  if (!total || total <= 0) {
    return Array.from({ length: n }, () => 0);
  }

  const base = Math.round((total / n) * 100) / 100;
  const out = Array.from({ length: n }, () => base);
  const parcial = base * (n - 1);
  out[n - 1] = Math.round((total - parcial) * 100) / 100;
  return out;
}

// Soma valor_atual e valor_inicial dos meses e atualiza a meta agregada.
function sincronizarTotaisMeta(metaId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(valor_inicial),0) AS total_ini,
           COALESCE(SUM(valor_atual),0) AS total_atual
    FROM meta_meses WHERE meta_id = ?
  `).get(metaId);
  db.prepare('UPDATE metas SET valor_inicial = ?, valor_atual = ? WHERE id = ?')
    .run(row.total_ini, row.total_atual, metaId);
}

function gerarMetasAutomaticasProximoPeriodo(dataInicioAtual) {
  const qtdMeses = getMetaPeriodMonths();
  const tipoPeriodo = getMetaPeriodType();
  const proxInicio = monthStart(dataInicioAtual, qtdMeses);
  const proxFim = addMonths(proxInicio, qtdMeses);
  const ym = proxInicio.slice(0, 7);

  const elegiveis = db.prepare(`
    SELECT * FROM funcionarios WHERE valor_meta_mensal > 0 ORDER BY nome
  `).all();

  if (!elegiveis.length) {
    return {
      periodo: { data_inicio: proxInicio, data_fim: proxFim, ym },
      total_elegiveis: 0,
      total_criadas: 0,
      total_ignoradas: 0,
      criadas: [],
      ignoradas: [],
      motivo: 'Nenhum funcionário com valor de meta mensal definido'
    };
  }

  const jaTemMeta = db.prepare(`
    SELECT 1 FROM metas WHERE funcionario_id = ? AND strftime('%Y-%m', data_inicio) = ?
  `);
  const insert = db.prepare(`
    INSERT INTO metas (funcionario_id, titulo, descricao, valor_inicial, valor_atual, data_inicio, data_fim)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insMes = db.prepare(`
    INSERT INTO meta_meses (meta_id, mes_offset, data_mes, valor_inicial, valor_atual)
    VALUES (?, ?, ?, ?, ?)
  `);

  const tituloAuto = tipoPeriodo === 'trimestral'
    ? `Meta ${quarterLabelFromDate(proxInicio)}`
    : tipoPeriodo === 'anual'
      ? `Meta anual ${new Date(proxInicio + 'T00:00:00').getFullYear()}`
      : `Meta ${String(META_PERIOD_LABELS[tipoPeriodo] || 'Período').toLowerCase()} ${proxInicio.slice(0, 7)}`;
  const descricaoAuto = `Gerada automaticamente após fechamento do período anterior (${String(META_PERIOD_LABELS[tipoPeriodo] || tipoPeriodo).toLowerCase()})`;
  const criadas = [];
  const ignoradas = [];

  const tx = db.transaction(() => {
    for (const f of elegiveis) {
      if (jaTemMeta.get(f.id, ym)) {
        ignoradas.push({ funcionario_id: f.id, nome: f.nome, motivo: 'já possui meta no período' });
        continue;
      }
      const mensal = Number(f.valor_meta_mensal);
      const total = mensal * qtdMeses;
      const info = insert.run(f.id, tituloAuto, descricaoAuto, total, total, proxInicio, proxFim);
      const metaId = info.lastInsertRowid;
      for (let i = 0; i < qtdMeses; i++) {
        insMes.run(metaId, i, monthStart(proxInicio, i), mensal, mensal);
      }
      criadas.push({ meta_id: metaId, funcionario_id: f.id, nome: f.nome, valor: total });
    }
  });
  tx();

  return {
    periodo: { data_inicio: proxInicio, data_fim: proxFim, ym },
    total_elegiveis: elegiveis.length,
    total_criadas: criadas.length,
    total_ignoradas: ignoradas.length,
    criadas,
    ignoradas
  };
}

function metaPossuiFechamentoExecutado(metaId) {
  const row = db.prepare(
    'SELECT 1 AS ok FROM fechamento_itens WHERE meta_id = ? LIMIT 1'
  ).get(metaId);
  return !!row;
}

function metaJaTeveFechamento(meta) {
  if (!meta) return false;
  // Regra de bloqueio: somente quando houver fechamento cadastrado/persistido
  // em fechamento_itens (fechamento oficial), não apenas por data_fechamento.
  return metaPossuiFechamentoExecutado(meta.id);
}

// ===================================================
// AUTENTICAÇÃO E USUÁRIOS
// ===================================================
app.post('/api/auth/login', (req, res) => {
  const { usuario, senha } = req.body || {};
  if (!usuario || !senha) {
    return res.status(400).json({ error: 'usuario e senha são obrigatórios' });
  }
  const user = db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(String(usuario).toLowerCase().trim());
  if (!user || !user.ativo || !verifyPassword(senha, user.senha_hash)) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos' });
  }
  const token = createToken({ userId: user.id, role: user.tipo_acesso });
  res.json({ token, user: sanitizeUser(user) });
});

app.get('/api/auth/me', (req, res) => {
  res.json(req.user);
});

app.post('/api/auth/logout', (req, res) => {
  res.json({ ok: true });
});

// ===================================================
// CONFIGURAÇÕES
// ===================================================
app.get('/api/configuracoes/meta-periodo', (req, res) => {
  const tipo = getMetaPeriodType();
  res.json({
    tipo_meta_periodo: tipo,
    meses: META_PERIOD_TYPES[tipo],
    opcoes: Object.keys(META_PERIOD_TYPES),
  });
});

app.put('/api/configuracoes/meta-periodo', (req, res) => {
  if (req.user?.tipo_acesso !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem alterar essa configuração' });
  }
  const tipo = String(req.body?.tipo_meta_periodo || '').toLowerCase();
  if (!META_PERIOD_TYPES[tipo]) {
    return res.status(400).json({ error: `tipo_meta_periodo inválido. Use: ${Object.keys(META_PERIOD_TYPES).join(', ')}` });
  }
  db.prepare(`
    INSERT INTO configuracoes (chave, valor, atualizado_em)
    VALUES ('tipo_meta_periodo', ?, datetime('now','localtime'))
    ON CONFLICT(chave) DO UPDATE SET
      valor=excluded.valor,
      atualizado_em=datetime('now','localtime')
  `).run(tipo);
  res.json({ ok: true, tipo_meta_periodo: tipo, meses: META_PERIOD_TYPES[tipo] });
});

app.get('/api/configuracoes/api-token', (req, res) => {
  if (req.user?.tipo_acesso !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem visualizar essa configuração' });
  }
  const token = getFixedApiToken();
  const masked = token
    ? `${token.slice(0, 4)}${'*'.repeat(Math.max(0, token.length - 8))}${token.slice(-4)}`
    : null;
  res.json({
    has_token: !!token,
    token_masked: masked,
  });
});

app.put('/api/configuracoes/api-token', (req, res) => {
  if (req.user?.tipo_acesso !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem alterar essa configuração' });
  }
  const raw = String(req.body?.api_token_fixo || '').trim();
  if (raw && raw.length < 12) {
    return res.status(400).json({ error: 'A chave fixa deve ter pelo menos 12 caracteres' });
  }

  if (!raw) {
    db.prepare('DELETE FROM configuracoes WHERE chave = ?').run('api_token_fixo');
    return res.json({ ok: true, has_token: false });
  }

  db.prepare(`
    INSERT INTO configuracoes (chave, valor, atualizado_em)
    VALUES ('api_token_fixo', ?, datetime('now','localtime'))
    ON CONFLICT(chave) DO UPDATE SET
      valor=excluded.valor,
      atualizado_em=datetime('now','localtime')
  `).run(raw);
  res.json({ ok: true, has_token: true });
});

app.get('/api/usuarios', (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.nome, u.usuario, u.tipo_acesso, u.ativo, u.permissoes, u.funcionario_id, u.criado_em,
           f.nome AS funcionario_nome
    FROM usuarios u
    LEFT JOIN funcionarios f ON f.id = u.funcionario_id
    WHERE COALESCE(u.oculto_painel, 0) = 0
    ORDER BY u.nome
  `).all();
  res.json(rows.map(r => ({ ...sanitizeUser(r), funcionario_nome: r.funcionario_nome || null })));
});

app.post('/api/usuarios', (req, res) => {
  const { nome, usuario, senha, tipo_acesso, ativo, funcionario_id, permissoes } = req.body || {};
  if (!nome || !usuario || !senha) {
    return res.status(400).json({ error: 'nome, usuario e senha são obrigatórios' });
  }
  if (!ACCESS_TYPES.includes(tipo_acesso)) {
    return res.status(400).json({ error: `tipo_acesso deve ser um de: ${ACCESS_TYPES.join(', ')}` });
  }
  if (String(senha).length < 4) {
    return res.status(400).json({ error: 'A senha deve ter pelo menos 4 caracteres' });
  }
  try {
    const info = db.prepare(`
      INSERT INTO usuarios (nome, usuario, senha_hash, tipo_acesso, ativo, funcionario_id, permissoes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      nome.trim(),
      String(usuario).toLowerCase().trim(),
      hashPassword(senha),
      tipo_acesso,
      ativo === false ? 0 : 1,
      funcionario_id || null,
      JSON.stringify(normalizePermissionsInput(permissoes, tipo_acesso))
    );
    const created = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(sanitizeUser(created));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Usuário já existe' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/usuarios/:id', (req, res) => {
  const targetId = Number(req.params.id);
  const current = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(targetId);
  if (!current) return res.status(404).json({ error: 'Usuário não encontrado' });

  const { nome, usuario, tipo_acesso, ativo, funcionario_id, permissoes } = req.body || {};
  if (tipo_acesso && !ACCESS_TYPES.includes(tipo_acesso)) {
    return res.status(400).json({ error: `tipo_acesso deve ser um de: ${ACCESS_TYPES.join(', ')}` });
  }
  if (current.id === req.user.id && ativo === false) {
    return res.status(400).json({ error: 'Você não pode desativar seu próprio usuário' });
  }

  try {
    db.prepare(`
      UPDATE usuarios SET
        nome = COALESCE(?, nome),
        usuario = COALESCE(?, usuario),
        tipo_acesso = COALESCE(?, tipo_acesso),
        ativo = COALESCE(?, ativo),
        funcionario_id = ?,
        permissoes = ?
      WHERE id = ?
    `).run(
      nome || null,
      usuario ? String(usuario).toLowerCase().trim() : null,
      tipo_acesso || null,
      ativo === undefined ? null : (ativo ? 1 : 0),
      funcionario_id === undefined ? current.funcionario_id : (funcionario_id || null),
      JSON.stringify(normalizePermissionsInput(
        permissoes === undefined ? parsePermissionsFromDb(current.permissoes, tipo_acesso || current.tipo_acesso) : permissoes,
        tipo_acesso || current.tipo_acesso
      )),
      targetId
    );

    const updated = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(targetId);
    res.json(sanitizeUser(updated));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Usuário já existe' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/usuarios/:id/senha', (req, res) => {
  const targetId = Number(req.params.id);
  const row = db.prepare('SELECT id FROM usuarios WHERE id = ?').get(targetId);
  if (!row) return res.status(404).json({ error: 'Usuário não encontrado' });
  const { senha } = req.body || {};
  if (!senha || String(senha).length < 4) {
    return res.status(400).json({ error: 'A senha deve ter pelo menos 4 caracteres' });
  }
  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashPassword(senha), targetId);
  res.json({ ok: true });
});

app.delete('/api/usuarios/:id', (req, res) => {
  const targetId = Number(req.params.id);
  const row = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(targetId);
  if (!row) return res.status(404).json({ error: 'Usuário não encontrado' });
  if (row.id === req.user.id) return res.status(400).json({ error: 'Você não pode excluir seu próprio usuário' });

  if (row.tipo_acesso === 'admin') {
    const adminsAtivos = db.prepare(`
      SELECT COUNT(*) AS c FROM usuarios WHERE tipo_acesso = 'admin' AND ativo = 1 AND id <> ?
    `).get(row.id).c;
    if (!adminsAtivos) {
      return res.status(400).json({ error: 'Não é possível remover o último administrador ativo' });
    }
  }

  db.prepare('DELETE FROM usuarios WHERE id = ?').run(targetId);
  res.json({ ok: true });
});

// ===================================================
// FUNCIONÁRIOS
// ===================================================
app.get('/api/funcionarios', (req, res) => {
  const rows = db.prepare('SELECT * FROM funcionarios ORDER BY nome').all();
  res.json(rows);
});

app.post('/api/funcionarios', (req, res) => {
  const { nome, usuario, cargo, unidade, equipe, valor_meta_mensal } = req.body || {};
  if (!nome || !usuario) return res.status(400).json({ error: 'nome e usuario são obrigatórios' });
  try {
    const info = db.prepare(
      'INSERT INTO funcionarios (nome, usuario, cargo, unidade, equipe, valor_meta_mensal) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      nome.trim(),
      usuario.trim().toLowerCase(),
      cargo || null,
      unidade || null,
      equipe || null,
      Number(valor_meta_mensal) || 0
    );
    const func = db.prepare('SELECT * FROM funcionarios WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(func);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Usuário já existe' });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/funcionarios/importar', (req, res) => {
  const itens = Array.isArray(req.body?.funcionarios) ? req.body.funcionarios : [];
  if (!itens.length) return res.status(400).json({ error: 'Nenhum funcionário informado para importação' });
  if (itens.length > 2000) return res.status(400).json({ error: 'Limite de 2000 funcionários por importação' });

  const usuarioExiste = db.prepare('SELECT 1 FROM funcionarios WHERE usuario = ? LIMIT 1');
  const inserir = db.prepare(
    'INSERT INTO funcionarios (nome, usuario, cargo, unidade, equipe, valor_meta_mensal) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const criados = [];
  const ignorados = [];
  const vistosNoArquivo = new Set();

  const tx = db.transaction(() => {
    for (const item of itens) {
      const nome = String(item?.nome || '').trim();
      const usuario = String(item?.usuario || '').trim().toLowerCase();
      const cargo = String(item?.cargo || '').trim() || null;
      const unidade = String(item?.unidade || '').trim() || null;
      const equipe = String(item?.equipe || '').trim() || null;
      const valorMetaMensal = Number(item?.valor_meta_mensal) || 0;

      if (!nome || !usuario) {
        ignorados.push({ nome: nome || '(sem nome)', usuario: usuario || '(sem usuario)', motivo: 'nome e usuario são obrigatórios' });
        continue;
      }
      if (/\s/.test(usuario)) {
        ignorados.push({ nome, usuario, motivo: 'usuario não pode conter espaços' });
        continue;
      }
      if (vistosNoArquivo.has(usuario)) {
        ignorados.push({ nome, usuario, motivo: 'usuario duplicado no arquivo' });
        continue;
      }
      vistosNoArquivo.add(usuario);

      if (usuarioExiste.get(usuario)) {
        ignorados.push({ nome, usuario, motivo: 'usuário já cadastrado' });
        continue;
      }
      const info = inserir.run(nome, usuario, cargo, unidade, equipe, Math.max(0, valorMetaMensal));
      criados.push({
        id: info.lastInsertRowid,
        nome,
        usuario,
        cargo,
        unidade,
        equipe,
        valor_meta_mensal: Math.max(0, valorMetaMensal),
      });
    }
  });

  try {
    tx();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  res.status(201).json({
    ok: true,
    total_recebidos: itens.length,
    total_criados: criados.length,
    total_ignorados: ignorados.length,
    criados,
    ignorados,
  });
});

app.put('/api/funcionarios/:id', (req, res) => {
  const { nome, usuario, cargo, unidade, equipe, valor_meta_mensal } = req.body || {};
  const vmm = (valor_meta_mensal === undefined || valor_meta_mensal === null || valor_meta_mensal === '')
    ? null : Number(valor_meta_mensal);
  const info = db.prepare(
    `UPDATE funcionarios SET
       nome = COALESCE(?, nome),
       usuario = COALESCE(?, usuario),
       cargo = COALESCE(?, cargo),
       unidade = COALESCE(?, unidade),
       equipe = COALESCE(?, equipe),
       valor_meta_mensal = COALESCE(?, valor_meta_mensal)
     WHERE id = ?`
  ).run(
    nome || null,
    usuario ? usuario.toLowerCase() : null,
    cargo || null,
    unidade || null,
    equipe || null,
    vmm,
    req.params.id
  );
  if (!info.changes) return res.status(404).json({ error: 'Funcionário não encontrado' });
  res.json(db.prepare('SELECT * FROM funcionarios WHERE id = ?').get(req.params.id));
});

app.delete('/api/funcionarios/:id', (req, res) => {
  const info = db.prepare('DELETE FROM funcionarios WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Funcionário não encontrado' });
  res.json({ ok: true });
});

// ===================================================
// METAS
// ===================================================
app.get('/api/metas', (req, res) => {
  const { funcionario_id, status } = req.query;
  let sql = `
    SELECT m.*, f.nome AS funcionario_nome, f.usuario AS funcionario_usuario
    FROM metas m JOIN funcionarios f ON f.id = m.funcionario_id
    WHERE 1=1
  `;
  const params = [];
  if (funcionario_id) { sql += ' AND m.funcionario_id = ?'; params.push(funcionario_id); }
  if (status) { sql += ' AND m.status = ?'; params.push(status); }
  sql += ' ORDER BY m.criado_em DESC';
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/metas/:id', (req, res) => {
  const meta = db.prepare(`
    SELECT m.*, f.nome AS funcionario_nome, f.usuario AS funcionario_usuario
    FROM metas m JOIN funcionarios f ON f.id = m.funcionario_id
    WHERE m.id = ?
  `).get(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Meta não encontrada' });

  const deducoes = db.prepare(`
    SELECT d.*,
           mm.data_mes AS data_mes_deducao,
           strftime('%m/%Y', mm.data_mes) AS mes_ano_deducao
    FROM deducoes d
    LEFT JOIN meta_meses mm
      ON mm.meta_id = d.meta_id
     AND mm.mes_offset = d.mes_offset
    WHERE d.meta_id = ?
    ORDER BY d.criado_em DESC
  `).all(req.params.id);

  const variaveis = db.prepare(`
    SELECT mm.*,
           mmes.data_mes AS data_mes_variavel,
           strftime('%m/%Y', mmes.data_mes) AS mes_ano_variavel
    FROM meta_melhorias mm
    LEFT JOIN meta_meses mmes
      ON mmes.meta_id = mm.meta_id
     AND mmes.mes_offset = mm.mes_offset
    WHERE mm.meta_id = ?
    ORDER BY mm.criado_em DESC
  `).all(req.params.id);

  // Breakdown por mês com total deduzido por mês
  const mesesRows = db.prepare(`
    SELECT mm.*,
      (SELECT COALESCE(SUM(valor),0) FROM deducoes d WHERE d.meta_id = mm.meta_id AND d.mes_offset = mm.mes_offset) AS valor_deduzido,
      (SELECT COUNT(*)             FROM deducoes d WHERE d.meta_id = mm.meta_id AND d.mes_offset = mm.mes_offset) AS total_deducoes,
      (SELECT COALESCE(SUM(valor_total),0) FROM meta_melhorias mx WHERE mx.meta_id = mm.meta_id AND mx.mes_offset = mm.mes_offset) AS valor_variaveis,
      (SELECT COALESCE(SUM(quantidade),0)  FROM meta_melhorias mx WHERE mx.meta_id = mm.meta_id AND mx.mes_offset = mm.mes_offset) AS total_variaveis,
      (SELECT COALESCE(SUM(valor_total),0) FROM meta_melhorias mx WHERE mx.meta_id = mm.meta_id AND mx.mes_offset = mm.mes_offset) AS valor_melhorias,
      (SELECT COALESCE(SUM(quantidade),0)  FROM meta_melhorias mx WHERE mx.meta_id = mm.meta_id AND mx.mes_offset = mm.mes_offset) AS total_melhorias
    FROM meta_meses mm
    WHERE mm.meta_id = ?
    ORDER BY mm.mes_offset
  `).all(req.params.id);

  const totalVariavel = variaveis.reduce((s, x) => s + (Number(x.valor_total) || 0), 0);
  const totalVariaveis = variaveis.reduce((s, x) => s + (Number(x.quantidade) || 0), 0);

  res.json({
    ...meta,
    deducoes,
    variaveis,
    melhorias: variaveis,
    total_variavel: totalVariavel,
    total_variaveis: totalVariaveis,
    total_melhorias: totalVariaveis,
    meses: mesesRows
  });
});

app.post('/api/metas', (req, res) => {
  const { funcionario_id, titulo, descricao, valor_inicial, valores_mensais, data_inicio } = req.body || {};
  if (!funcionario_id || !titulo || !data_inicio) {
    return res.status(400).json({ error: 'funcionario_id, titulo e data_inicio são obrigatórios' });
  }
  const qtdMeses = getMetaPeriodMonths();
  const valores = normalizarValoresMensais(valores_mensais, valor_inicial, qtdMeses);
  const totalInicial = valores.reduce((a, b) => a + b, 0);
  if (totalInicial <= 0) {
    return res.status(400).json({ error: `Informe valores_mensais (${qtdMeses} valores) ou valor_inicial` });
  }
  const func = db.prepare('SELECT id FROM funcionarios WHERE id = ?').get(funcionario_id);
  if (!func) return res.status(404).json({ error: 'Funcionário não encontrado' });

  const ym = String(data_inicio).slice(0, 7);
  const jaTemMetaNoPeriodo = db.prepare(`
    SELECT 1
    FROM metas
    WHERE funcionario_id = ?
      AND strftime('%Y-%m', data_inicio) = ?
    LIMIT 1
  `).get(funcionario_id, ym);
  if (jaTemMetaNoPeriodo) {
    return res.status(409).json({
      error: 'Já existe uma meta para este funcionário no período selecionado.'
    });
  }

  const data_fim = addMonths(data_inicio, qtdMeses);

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO metas (funcionario_id, titulo, descricao, valor_inicial, valor_atual, data_inicio, data_fim)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(funcionario_id, titulo, descricao || null, totalInicial, totalInicial, data_inicio, data_fim);
    const metaId = info.lastInsertRowid;
    const insMes = db.prepare(`
      INSERT INTO meta_meses (meta_id, mes_offset, data_mes, valor_inicial, valor_atual)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (let i = 0; i < qtdMeses; i++) {
      insMes.run(metaId, i, monthStart(data_inicio, i), valores[i], valores[i]);
    }
    return metaId;
  });
  const id = tx();
  res.status(201).json(db.prepare('SELECT * FROM metas WHERE id = ?').get(id));
});

// Geração em lote: cria meta para todos os funcionários com valor_meta_mensal > 0
// Pula funcionários que já têm meta no mesmo período (mesmo ano-mês de data_inicio)
app.post('/api/metas/lote', (req, res) => {
  const { titulo, descricao, data_inicio } = req.body || {};
  if (!titulo || !data_inicio) {
    return res.status(400).json({ error: 'titulo e data_inicio são obrigatórios' });
  }
  const qtdMeses = getMetaPeriodMonths();
  const data_fim = addMonths(data_inicio, qtdMeses);
  const ym = data_inicio.slice(0, 7);

  const elegiveis = db.prepare(`
    SELECT * FROM funcionarios WHERE valor_meta_mensal > 0 ORDER BY nome
  `).all();

  if (!elegiveis.length) {
    return res.status(400).json({ error: 'Nenhum funcionário com valor de meta mensal definido' });
  }

  const jaTemMeta = db.prepare(`
    SELECT 1 FROM metas WHERE funcionario_id = ? AND strftime('%Y-%m', data_inicio) = ?
  `);
  const insert = db.prepare(`
    INSERT INTO metas (funcionario_id, titulo, descricao, valor_inicial, valor_atual, data_inicio, data_fim)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insMes = db.prepare(`
    INSERT INTO meta_meses (meta_id, mes_offset, data_mes, valor_inicial, valor_atual)
    VALUES (?, ?, ?, ?, ?)
  `);

  const criadas = [];
  const ignoradas = [];
  const tx = db.transaction(() => {
    for (const f of elegiveis) {
      if (jaTemMeta.get(f.id, ym)) {
        ignoradas.push({ funcionario_id: f.id, nome: f.nome, motivo: 'já possui meta no período' });
        continue;
      }
      const mensal = Number(f.valor_meta_mensal);
      const total = mensal * qtdMeses;
      const info = insert.run(f.id, titulo, descricao || null, total, total, data_inicio, data_fim);
      const metaId = info.lastInsertRowid;
      for (let i = 0; i < qtdMeses; i++) {
        insMes.run(metaId, i, monthStart(data_inicio, i), mensal, mensal);
      }
      criadas.push({ meta_id: metaId, funcionario_id: f.id, nome: f.nome, valor: total });
    }
  });
  tx();

  res.status(201).json({
    ok: true,
    total_elegiveis: elegiveis.length,
    total_criadas: criadas.length,
    total_ignoradas: ignoradas.length,
    criadas,
    ignoradas
  });
});

app.put('/api/metas/:id', (req, res) => {
  const meta = db.prepare('SELECT * FROM metas WHERE id = ?').get(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Meta não encontrada' });
  if (metaJaTeveFechamento(meta)) {
    return res.status(400).json({
      error: 'Esta meta já possui fechamento executado. Remova o fechamento atual para poder editar ou reabrir a meta.'
    });
  }
  if (meta.status === 'fechada') return res.status(400).json({ error: 'Meta já fechada não pode ser editada' });

  const { titulo, descricao, valores_mensais, data_inicio } = req.body || {};
  const novoInicio = data_inicio || meta.data_inicio;
  const qtdMeses = getMetaPeriodMonths();
  const data_fim = addMonths(novoInicio, qtdMeses);

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE metas SET titulo=?, descricao=?, data_inicio=?, data_fim=? WHERE id=?
    `).run(titulo || meta.titulo, descricao ?? meta.descricao, novoInicio, data_fim, req.params.id);

    // Atualiza meses: data_mes (caso o período tenha mudado) e valores se informados
    const mesesAtuais = db.prepare(
      'SELECT * FROM meta_meses WHERE meta_id = ? ORDER BY mes_offset'
    ).all(req.params.id);

    db.prepare('DELETE FROM meta_meses WHERE meta_id = ? AND mes_offset >= ?').run(req.params.id, qtdMeses);
    for (let i = 0; i < qtdMeses; i++) {
      const antigo = mesesAtuais[i];
      const novaData = monthStart(novoInicio, i);
      let novoIni = antigo ? antigo.valor_inicial : 0;
      let novoAtual = antigo ? antigo.valor_atual : 0;
      if (Array.isArray(valores_mensais) && valores_mensais[i] != null) {
        const deduzido = antigo ? (antigo.valor_inicial - antigo.valor_atual) : 0;
        novoIni = Math.max(0, Number(valores_mensais[i]) || 0);
        novoAtual = Math.max(0, novoIni - deduzido);
      }
      if (antigo) {
        db.prepare('UPDATE meta_meses SET data_mes=?, valor_inicial=?, valor_atual=? WHERE id=?')
          .run(novaData, novoIni, novoAtual, antigo.id);
      } else {
        db.prepare(`
          INSERT INTO meta_meses (meta_id, mes_offset, data_mes, valor_inicial, valor_atual)
          VALUES (?, ?, ?, ?, ?)
        `).run(req.params.id, i, novaData, novoIni, novoAtual);
      }
    }
    sincronizarTotaisMeta(req.params.id);
  });
  tx();

  res.json(db.prepare('SELECT * FROM metas WHERE id = ?').get(req.params.id));
});

app.delete('/api/metas/:id', (req, res) => {
  const meta = db.prepare('SELECT * FROM metas WHERE id = ?').get(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Meta não encontrada' });
  if (metaJaTeveFechamento(meta)) {
    return res.status(400).json({
      error: 'Esta meta já possui fechamento executado. Remova o fechamento atual para poder excluir a meta.'
    });
  }
  const info = db.prepare('DELETE FROM metas WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Meta não encontrada' });
  res.json({ ok: true });
});

// Fechamento da meta (a cada 3 meses)
app.post('/api/metas/:id/fechar', (req, res) => {
  const meta = db.prepare('SELECT * FROM metas WHERE id = ?').get(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Meta não encontrada' });
  if (metaJaTeveFechamento(meta)) {
    return res.status(400).json({
      error: 'Esta meta já possui fechamento executado. Remova o fechamento atual para poder editar ou reabrir a meta.'
    });
  }
  if (meta.status === 'fechada') return res.status(400).json({ error: 'Meta já está fechada' });

  const { observacao } = req.body || {};
  const resultado = calcularResultado(meta);
  db.prepare(`
    UPDATE metas SET status='fechada', resultado=?, data_fechamento=datetime('now','localtime'), observacao_fechamento=?
    WHERE id=?
  `).run(resultado, observacao || null, req.params.id);
  res.json(db.prepare('SELECT * FROM metas WHERE id = ?').get(req.params.id));
});

// Reabrir meta
app.post('/api/metas/:id/reabrir', (req, res) => {
  const meta = db.prepare('SELECT * FROM metas WHERE id = ?').get(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Meta não encontrada' });
  if (metaJaTeveFechamento(meta)) {
    return res.status(400).json({
      error: 'Esta meta já possui fechamento executado. Remova o fechamento atual para poder editar ou reabrir a meta.'
    });
  }
  const info = db.prepare(`
    UPDATE metas SET status='aberta', resultado=NULL, data_fechamento=NULL, observacao_fechamento=NULL
    WHERE id=? AND status='fechada'
  `).run(req.params.id);
  if (!info.changes) return res.status(400).json({ error: 'Meta não está fechada para reabertura' });
  res.json(db.prepare('SELECT * FROM metas WHERE id = ?').get(req.params.id));
});

// ===================================================
// DEDUÇÕES (via UI)
// ===================================================
// Escolhe automaticamente um mes_offset adequado dentro da meta:
// 1. Mês atual se estiver dentro do período da meta
// 2. Primeiro mês com saldo > 0
// 3. Último mês (fallback)
function escolherMesOffset(metaId, dataInicioMeta) {
  const meses = db.prepare(
    'SELECT * FROM meta_meses WHERE meta_id = ? ORDER BY mes_offset'
  ).all(metaId);
  if (!meses.length) return 0;
  const hoje = new Date();
  const ymHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const porYm = meses.find(m => m.data_mes.slice(0, 7) === ymHoje);
  if (porYm) return porYm.mes_offset;
  const comSaldo = meses.find(m => m.valor_atual > 0);
  if (comSaldo) return comSaldo.mes_offset;
  return meses[meses.length - 1].mes_offset;
}

function normalizarFiltroTexto(input) {
  const v = String(input || '').trim();
  return v || null;
}

function montarPlanoDeducaoLote({ cargo, unidade, equipe, periodo, mes_ano, percentual }) {
  const pct = Number(percentual);
  if (!pct || Number.isNaN(pct) || pct <= 0) {
    throw new Error('percentual é obrigatório e deve ser > 0');
  }

  const periodoNorm = periodo ? normalizarMesAno(periodo) : null;
  if (periodo && !periodoNorm) {
    throw new Error('período inválido. Use MM/YYYY ou YYYY-MM');
  }
  const mesAnoNorm = normalizarMesAno(mes_ano || periodoNorm);
  if (!mesAnoNorm) {
    throw new Error('mes_ano é obrigatório e deve estar no formato MM/YYYY ou YYYY-MM');
  }

  let sql = `
    SELECT
      m.id AS meta_id,
      m.titulo AS meta_titulo,
      m.data_inicio,
      m.data_fim,
      f.id AS funcionario_id,
      f.nome AS funcionario_nome,
      f.usuario AS funcionario_usuario,
      f.cargo AS funcionario_cargo,
      f.unidade AS funcionario_unidade,
      f.equipe AS funcionario_equipe
    FROM metas m
    JOIN funcionarios f ON f.id = m.funcionario_id
    WHERE m.status = 'aberta'
  `;
  const params = [];

  const cargoNorm = normalizarFiltroTexto(cargo);
  const unidadeNorm = normalizarFiltroTexto(unidade);
  const equipeNorm = normalizarFiltroTexto(equipe);

  if (cargoNorm) { sql += " AND lower(COALESCE(f.cargo, '')) = lower(?)"; params.push(cargoNorm); }
  if (unidadeNorm) { sql += " AND lower(COALESCE(f.unidade, '')) = lower(?)"; params.push(unidadeNorm); }
  if (equipeNorm) { sql += " AND lower(COALESCE(f.equipe, '')) = lower(?)"; params.push(equipeNorm); }
  if (periodoNorm) { sql += " AND strftime('%m/%Y', m.data_inicio) = ?"; params.push(periodoNorm); }
  sql += ' ORDER BY f.nome';

  const metas = db.prepare(sql).all(...params);
  const aplicar = [];
  const ignoradas = [];

  for (const m of metas) {
    const offset = resolverMesOffsetPorMesAno(m.meta_id, mesAnoNorm);
    if (offset == null) {
      ignoradas.push({
        funcionario_id: m.funcionario_id,
        funcionario_nome: m.funcionario_nome,
        meta_id: m.meta_id,
        meta_titulo: m.meta_titulo,
        motivo: `Mês ${mesAnoNorm} não pertence ao período da meta`,
      });
      continue;
    }
    const mes = db.prepare(
      'SELECT * FROM meta_meses WHERE meta_id = ? AND mes_offset = ?'
    ).get(m.meta_id, offset);
    if (!mes) {
      ignoradas.push({
        funcionario_id: m.funcionario_id,
        funcionario_nome: m.funcionario_nome,
        meta_id: m.meta_id,
        meta_titulo: m.meta_titulo,
        motivo: 'Mês não encontrado na distribuição da meta',
      });
      continue;
    }
    if (Number(mes.valor_atual) <= 0) {
      ignoradas.push({
        funcionario_id: m.funcionario_id,
        funcionario_nome: m.funcionario_nome,
        meta_id: m.meta_id,
        meta_titulo: m.meta_titulo,
        motivo: `Saldo do mês ${mesAnoNorm} já está zerado`,
      });
      continue;
    }

    const valor = Math.round((Number(mes.valor_inicial) * pct / 100) * 100) / 100;
    const valorAnterior = Number(mes.valor_atual);
    const valorAtual = Math.max(0, valorAnterior - valor);
    aplicar.push({
      funcionario_id: m.funcionario_id,
      funcionario_nome: m.funcionario_nome,
      funcionario_usuario: m.funcionario_usuario,
      funcionario_cargo: m.funcionario_cargo,
      funcionario_unidade: m.funcionario_unidade,
      funcionario_equipe: m.funcionario_equipe,
      meta_id: m.meta_id,
      meta_titulo: m.meta_titulo,
      mes_offset: offset,
      data_mes: mes.data_mes,
      mes_ano: mesAnoNorm,
      valor_mes_inicial: Number(mes.valor_inicial),
      valor_mes_anterior: valorAnterior,
      valor_deducao: valor,
      valor_mes_resultante: valorAtual,
      percentual: pct,
    });
  }

  return {
    filtros: {
      cargo: cargoNorm,
      unidade: unidadeNorm,
      equipe: equipeNorm,
      periodo: periodoNorm,
      mes_ano: mesAnoNorm,
    },
    total_metas_filtradas: metas.length,
    total_aplicaveis: aplicar.length,
    total_ignoradas: ignoradas.length,
    total_valor_deducao: aplicar.reduce((s, x) => s + x.valor_deducao, 0),
    aplicar,
    ignoradas,
  };
}

app.post('/api/metas/:id/deducoes', (req, res) => {
  const { percentual, motivo, mes_offset, mes_ano } = req.body || {};
  const pct = Number(percentual);
  if (!pct || isNaN(pct) || pct <= 0) {
    return res.status(400).json({ error: 'percentual é obrigatório e deve ser > 0' });
  }
  const meta = db.prepare('SELECT * FROM metas WHERE id = ?').get(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Meta não encontrada' });
  if (meta.status === 'fechada') return res.status(400).json({ error: 'Meta fechada não aceita deduções' });

  let offset;
  if (mes_ano) {
    offset = resolverMesOffsetPorMesAno(meta.id, mes_ano);
    if (offset == null) {
      return res.status(400).json({ error: 'mes_ano inválido para esta meta. Use MM/YYYY dentro do período da meta.' });
    }
  } else {
    offset = (mes_offset === undefined || mes_offset === null || mes_offset === '')
      ? escolherMesOffset(meta.id, meta.data_inicio)
      : Number(mes_offset);
  }

  const mes = db.prepare(
    'SELECT * FROM meta_meses WHERE meta_id = ? AND mes_offset = ?'
  ).get(meta.id, offset);
  if (!mes) return res.status(400).json({ error: 'Mês inválido para esta meta' });
  if (Number(mes.valor_atual) <= 0) {
    return res.status(400).json({
      error: 'O mês selecionado já está zerado. Selecione outro mês do período com saldo disponível.'
    });
  }

  const v = Math.round((mes.valor_inicial * pct / 100) * 100) / 100;
  const novoMes = Math.max(0, mes.valor_atual - v);

  const tx = db.transaction(() => {
    db.prepare('UPDATE meta_meses SET valor_atual = ? WHERE id = ?').run(novoMes, mes.id);
    db.prepare(`
      INSERT INTO deducoes (meta_id, funcionario_id, valor, motivo, origem, mes_offset, percentual)
      VALUES (?, ?, ?, ?, 'manual', ?, ?)
    `).run(meta.id, meta.funcionario_id, v, motivo || null, offset, pct);
    sincronizarTotaisMeta(meta.id);
  });
  tx();

  res.status(201).json({
    meta: db.prepare('SELECT * FROM metas WHERE id = ?').get(meta.id),
    mes: db.prepare('SELECT * FROM meta_meses WHERE id = ?').get(mes.id),
    deducao: (() => {
      const d = db.prepare('SELECT * FROM deducoes WHERE meta_id = ? ORDER BY id DESC LIMIT 1').get(meta.id);
      return d ? { ...d, mes_ano_deducao: mesAnoFromDate(mes.data_mes) } : null;
    })()
  });
});

app.post('/api/deducoes/lote/preview', (req, res) => {
  try {
    const plano = montarPlanoDeducaoLote(req.body || {});
    res.json(plano);
  } catch (e) {
    const msg = String(e.message || '');
    if (msg.includes('no such column')) {
      return res.status(400).json({ error: 'Não foi possível gerar a prévia com os filtros informados. Revise os filtros e tente novamente.' });
    }
    res.status(400).json({ error: msg || 'Não foi possível gerar a prévia de dedução em lote.' });
  }
});

app.post('/api/deducoes/lote/aplicar', (req, res) => {
  const { motivo } = req.body || {};
  let plano;
  try {
    plano = montarPlanoDeducaoLote(req.body || {});
  } catch (e) {
    const msg = String(e.message || '');
    if (msg.includes('no such column')) {
      return res.status(400).json({ error: 'Não foi possível preparar a dedução em lote com os filtros informados. Revise os dados e tente novamente.' });
    }
    return res.status(400).json({ error: msg || 'Não foi possível preparar a dedução em lote.' });
  }
  if (!plano.aplicar.length) {
    return res.status(400).json({ error: 'Nenhuma dedução aplicável com os filtros informados' });
  }

  const updateMes = db.prepare('UPDATE meta_meses SET valor_atual = ? WHERE meta_id = ? AND mes_offset = ?');
  const insertDed = db.prepare(`
    INSERT INTO deducoes (meta_id, funcionario_id, valor, motivo, origem, mes_offset, percentual)
    VALUES (?, ?, ?, ?, 'manual_lote', ?, ?)
  `);
  const tx = db.transaction(() => {
    for (const item of plano.aplicar) {
      const mesAtual = db.prepare(
        'SELECT valor_atual FROM meta_meses WHERE meta_id = ? AND mes_offset = ?'
      ).get(item.meta_id, item.mes_offset);
      if (!mesAtual) continue;
      const novoValor = Math.max(0, Number(mesAtual.valor_atual) - Number(item.valor_deducao));
      updateMes.run(novoValor, item.meta_id, item.mes_offset);
      insertDed.run(
        item.meta_id,
        item.funcionario_id,
        item.valor_deducao,
        motivo || null,
        item.mes_offset,
        item.percentual
      );
      sincronizarTotaisMeta(item.meta_id);
    }
  });
  tx();

  res.status(201).json({
    ok: true,
    filtros: plano.filtros,
    total_metas_filtradas: plano.total_metas_filtradas,
    total_aplicadas: plano.aplicar.length,
    total_ignoradas: plano.total_ignoradas,
    total_valor_deducao: plano.total_valor_deducao,
    aplicadas: plano.aplicar,
    ignoradas: plano.ignoradas,
  });
});

// ===================================================
// API PÚBLICA — deduzir valor informando usuário
// ===================================================
// POST /api/deducoes  { usuario, valor, motivo }
// Deduz o valor da meta ABERTA mais recente do funcionário (por usuário)
app.post('/api/deducoes', (req, res) => {
  const { usuario, percentual, motivo, mes_offset, mes_ano } = req.body || {};
  if (!usuario || percentual == null) {
    return res.status(400).json({ error: 'usuario e percentual são obrigatórios' });
  }
  const pct = Number(percentual);
  if (isNaN(pct) || pct <= 0) return res.status(400).json({ error: 'percentual inválido' });

  const func = db.prepare('SELECT * FROM funcionarios WHERE usuario = ?').get(String(usuario).toLowerCase().trim());
  if (!func) return res.status(404).json({ error: 'Usuário não encontrado' });

  const meta = db.prepare(`
    SELECT * FROM metas
    WHERE funcionario_id = ? AND status = 'aberta'
    ORDER BY data_inicio DESC LIMIT 1
  `).get(func.id);
  if (!meta) return res.status(404).json({ error: 'Nenhuma meta aberta para este funcionário' });

  let offset;
  if (mes_ano) {
    offset = resolverMesOffsetPorMesAno(meta.id, mes_ano);
    if (offset == null) {
      return res.status(400).json({ error: 'mes_ano inválido para a meta aberta do usuário. Use MM/YYYY dentro do período da meta.' });
    }
  } else {
    offset = (mes_offset === undefined || mes_offset === null || mes_offset === '')
      ? escolherMesOffset(meta.id, meta.data_inicio)
      : Number(mes_offset);
  }
  const mes = db.prepare(
    'SELECT * FROM meta_meses WHERE meta_id = ? AND mes_offset = ?'
  ).get(meta.id, offset);
  if (!mes) return res.status(400).json({ error: 'Mês inválido para esta meta' });
  if (Number(mes.valor_atual) <= 0) {
    return res.status(400).json({
      error: 'O mês selecionado já está zerado. Selecione outro mês do período com saldo disponível.'
    });
  }

  const v = Math.round((mes.valor_inicial * pct / 100) * 100) / 100;
  const valorAnteriorMes = mes.valor_atual;
  const novoMes = Math.max(0, mes.valor_atual - v);

  const tx = db.transaction(() => {
    db.prepare('UPDATE meta_meses SET valor_atual = ? WHERE id = ?').run(novoMes, mes.id);
    db.prepare(`
      INSERT INTO deducoes (meta_id, funcionario_id, valor, motivo, origem, mes_offset, percentual)
      VALUES (?, ?, ?, ?, 'api', ?, ?)
    `).run(meta.id, func.id, v, motivo || null, offset, pct);
    sincronizarTotaisMeta(meta.id);
  });
  tx();

  const metaAtualizada = db.prepare('SELECT * FROM metas WHERE id = ?').get(meta.id);
  res.status(201).json({
    ok: true,
    funcionario: { id: func.id, nome: func.nome, usuario: func.usuario },
    meta: {
      id: meta.id,
      titulo: meta.titulo,
      valor_inicial: metaAtualizada.valor_inicial,
      valor_anterior: meta.valor_atual,
      valor_deduzido: v,
      valor_atual: metaAtualizada.valor_atual
    },
    mes: {
      mes_offset: offset,
      data_mes: mes.data_mes,
      mes_ano: mesAnoFromDate(mes.data_mes),
      valor_inicial: mes.valor_inicial,
      valor_anterior: valorAnteriorMes,
      valor_atual: novoMes
    },
    motivo: motivo || null
  });
});

// Excluir dedução — restaura valor no mês específico (somente se meta ainda estiver aberta)
app.delete('/api/deducoes/:id', (req, res) => {
  const ded = db.prepare('SELECT * FROM deducoes WHERE id = ?').get(req.params.id);
  if (!ded) return res.status(404).json({ error: 'Dedução não encontrada' });
  const meta = db.prepare('SELECT * FROM metas WHERE id = ?').get(ded.meta_id);
  if (!meta) return res.status(404).json({ error: 'Meta relacionada não encontrada' });
  if (meta.status === 'fechada') {
    return res.status(400).json({ error: 'Não é possível excluir dedução de meta já fechada. Reabra a meta primeiro.' });
  }

  const tx = db.transaction(() => {
    // Se a dedução tinha um mes_offset, restaura nele. Senão (legado), restaura no primeiro mês.
    const offset = ded.mes_offset != null ? ded.mes_offset : 0;
    const mes = db.prepare(
      'SELECT * FROM meta_meses WHERE meta_id = ? AND mes_offset = ?'
    ).get(meta.id, offset);
    if (mes) {
      const novoMes = Math.min(mes.valor_inicial, mes.valor_atual + ded.valor);
      db.prepare('UPDATE meta_meses SET valor_atual = ? WHERE id = ?').run(novoMes, mes.id);
    }
    db.prepare('DELETE FROM deducoes WHERE id = ?').run(ded.id);
    sincronizarTotaisMeta(meta.id);
  });
  tx();

  res.json({
    ok: true,
    removida: ded,
    meta: db.prepare('SELECT * FROM metas WHERE id = ?').get(meta.id)
  });
});

function registrarVariavelMeta(req, res) {
  const meta = db.prepare('SELECT * FROM metas WHERE id = ?').get(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Meta não encontrada' });
  if (meta.status !== 'aberta') {
    return res.status(400).json({ error: 'Só é possível lançar variável em metas abertas' });
  }
  if (metaJaTeveFechamento(meta)) {
    return res.status(400).json({
      error: 'Esta meta já possui fechamento executado. Remova o fechamento atual para poder editar ou reabrir a meta.'
    });
  }

  const quantidade = Math.max(1, Math.floor(Number(req.body?.quantidade) || 1));
  const valorUnitario = Number(req.body?.valor_unitario ?? 80);
  if (!(valorUnitario > 0)) {
    return res.status(400).json({ error: 'Informe um valor unitário válido para a variável' });
  }

  let mesOffset = Number.isFinite(Number(req.body?.mes_offset)) ? Number(req.body?.mes_offset) : null;
  if (mesOffset == null && req.body?.mes_ano) {
    mesOffset = resolverMesOffsetPorMesAno(meta.id, req.body.mes_ano);
  }
  if (mesOffset == null) {
    const hoje = new Date();
    const ym = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    const mRef = db.prepare(`
      SELECT mes_offset
      FROM meta_meses
      WHERE meta_id = ? AND strftime('%Y-%m', data_mes) = ?
      LIMIT 1
    `).get(meta.id, ym);
    mesOffset = mRef ? Number(mRef.mes_offset) : 0;
  }

  const mes = db.prepare('SELECT * FROM meta_meses WHERE meta_id = ? AND mes_offset = ?').get(meta.id, mesOffset);
  if (!mes) {
    return res.status(400).json({ error: 'Mês da variável inválido para esta meta' });
  }

  const valorTotal = Math.round((quantidade * valorUnitario) * 100) / 100;
  const motivo = String(req.body?.motivo || '').trim() || null;

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO meta_melhorias (meta_id, funcionario_id, mes_offset, quantidade, valor_unitario, valor_total, motivo)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(meta.id, meta.funcionario_id, mesOffset, quantidade, valorUnitario, valorTotal, motivo);

    const novoInicialMes = Math.round((Number(mes.valor_inicial) + valorTotal) * 100) / 100;
    const novoAtualMes = Math.round((Number(mes.valor_atual) + valorTotal) * 100) / 100;
    db.prepare('UPDATE meta_meses SET valor_inicial = ?, valor_atual = ? WHERE id = ?')
      .run(novoInicialMes, novoAtualMes, mes.id);

    sincronizarTotaisMeta(meta.id);
  });
  tx();

  const metaAtualizada = db.prepare('SELECT * FROM metas WHERE id = ?').get(meta.id);
  const mesAtualizado = db.prepare('SELECT * FROM meta_meses WHERE id = ?').get(mes.id);
  res.json({
    ok: true,
    meta: metaAtualizada,
    mes: mesAtualizado,
    variavel: {
      quantidade,
      valor_unitario: valorUnitario,
      valor_total: valorTotal,
      mes_offset: mesOffset,
      motivo
    },
    melhoria: {
      quantidade,
      valor_unitario: valorUnitario,
      valor_total: valorTotal,
      mes_offset: mesOffset,
      motivo
    },
  });
}

app.post('/api/metas/:id/variaveis', registrarVariavelMeta);
app.post('/api/metas/:id/melhorias', registrarVariavelMeta);

// Listar todas deduções
app.get('/api/deducoes', (req, res) => {
  const rows = db.prepare(`
    SELECT d.*, f.nome AS funcionario_nome, f.usuario AS funcionario_usuario, m.titulo AS meta_titulo, m.status AS meta_status,
           mm.data_mes AS data_mes_deducao,
           strftime('%m/%Y', mm.data_mes) AS mes_ano_deducao
    FROM deducoes d
    JOIN funcionarios f ON f.id = d.funcionario_id
    JOIN metas m ON m.id = d.meta_id
    LEFT JOIN meta_meses mm
      ON mm.meta_id = d.meta_id
     AND mm.mes_offset = d.mes_offset
    ORDER BY d.criado_em DESC
    LIMIT 200
  `).all();
  res.json(rows);
});

// ===================================================
// FECHAMENTOS (persistidos)
// ===================================================

// Prévia: consolidado do período SEM persistir
// GET /api/fechamentos/preview?ano=2026&mes_inicial=1
app.get('/api/fechamentos/preview', (req, res) => {
  const ano = Number(req.query.ano);
  const mesInicial = Number(req.query.mes_inicial);
  if (!ano || !mesInicial || mesInicial < 1 || mesInicial > 12) {
    return res.status(400).json({ error: 'ano e mes_inicial (1-12) são obrigatórios' });
  }
  const ym = `${ano}-${String(mesInicial).padStart(2, '0')}`;
  const dataInicio = `${ym}-01`;

  // Compara por ano-mês para incluir metas criadas em qualquer dia do mês.
  // Só considera metas ainda não cobertas por fechamentos anteriores.
  const metas = db.prepare(`
    SELECT m.*, f.nome AS funcionario_nome, f.usuario AS funcionario_usuario, f.cargo AS funcionario_cargo
    FROM metas m JOIN funcionarios f ON f.id = m.funcionario_id
    WHERE strftime('%Y-%m', m.data_inicio) = ?
      AND NOT EXISTS (
        SELECT 1 FROM fechamento_itens fi WHERE fi.meta_id = m.id
      )
    ORDER BY f.nome
  `).all(ym);

  // Agregar por funcionário
  const porFunc = {};
  for (const m of metas) {
    if (!porFunc[m.funcionario_id]) {
      porFunc[m.funcionario_id] = {
        funcionario_id: m.funcionario_id,
        nome: m.funcionario_nome,
        usuario: m.funcionario_usuario,
        cargo: m.funcionario_cargo,
        metas: [],
        total_alvo: 0,
        total_deduzido: 0,
        total_a_receber: 0,
        metas_abertas: 0,
        metas_fechadas: 0,
      };
    }
    const f = porFunc[m.funcionario_id];
    f.metas.push(m);
    f.total_alvo += m.valor_inicial;
    f.total_deduzido += (m.valor_inicial - m.valor_atual);
    f.total_a_receber += m.valor_atual;
    if (m.status === 'aberta') f.metas_abertas++; else f.metas_fechadas++;
  }
  const funcionarios = Object.values(porFunc);

  const totais = funcionarios.reduce((a, f) => ({
    total_alvo: a.total_alvo + f.total_alvo,
    total_deduzido: a.total_deduzido + f.total_deduzido,
    total_a_receber: a.total_a_receber + f.total_a_receber,
  }), { total_alvo: 0, total_deduzido: 0, total_a_receber: 0 });

  res.json({
    periodo: {
      ano,
      mes_inicial: mesInicial,
      data_inicio: dataInicio,
      data_fim: addMonths(dataInicio, 3),
    },
    criterio: 'somente_metas_pendentes_sem_fechamento',
    total_funcionarios: funcionarios.length,
    total_metas: metas.length,
    metas_abertas: metas.filter(m => m.status === 'aberta').length,
    metas_fechadas: metas.filter(m => m.status === 'fechada').length,
    ...totais,
    funcionarios,
  });
});

// Lista todos os fechamentos executados
app.get('/api/fechamentos', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM fechamentos ORDER BY criado_em DESC
  `).all();
  res.json(rows);
});

// Detalhes de um fechamento + itens (snapshot)
app.get('/api/fechamentos/:id', (req, res) => {
  const fech = db.prepare('SELECT * FROM fechamentos WHERE id = ?').get(req.params.id);
  if (!fech) return res.status(404).json({ error: 'Fechamento não encontrado' });
  const itens = db.prepare(`
    SELECT * FROM fechamento_itens WHERE fechamento_id = ?
    ORDER BY funcionario_nome, meta_titulo
  `).all(req.params.id);
  res.json({ ...fech, itens });
});

// Executa um novo fechamento: fecha metas abertas e persiste snapshot
app.post('/api/fechamentos', (req, res) => {
  const { ano, mes_inicial, observacao, gerar_proximo_trimestre } = req.body || {};
  const a = Number(ano);
  const m = Number(mes_inicial);
  if (!a || !m || m < 1 || m > 12) {
    return res.status(400).json({ error: 'ano e mes_inicial (1-12) são obrigatórios' });
  }
  const ym = `${a}-${String(m).padStart(2, '0')}`;
  const dataInicio = `${ym}-01`;
  const dataFim = addMonths(dataInicio, 3);

  // Gera fechamento apenas para metas do período que ainda não foram
  // incluídas em fechamentos anteriores.
  const metas = db.prepare(`
    SELECT m.*, f.nome AS funcionario_nome, f.usuario AS funcionario_usuario, f.cargo AS funcionario_cargo
    FROM metas m JOIN funcionarios f ON f.id = m.funcionario_id
    WHERE strftime('%Y-%m', m.data_inicio) = ?
      AND NOT EXISTS (
        SELECT 1 FROM fechamento_itens fi WHERE fi.meta_id = m.id
      )
    ORDER BY f.nome, m.titulo
  `).all(ym);

  if (!metas.length) {
    return res.status(400).json({
      error: 'Todas as metas deste período já foram fechadas. Só é possível gerar novo fechamento se houver metas que ficaram de fora.'
    });
  }

  const total_alvo = metas.reduce((s, x) => s + x.valor_inicial, 0);
  const total_a_receber = metas.reduce((s, x) => s + x.valor_atual, 0);
  const total_deduzido = total_alvo - total_a_receber;
  const funcUnicos = new Set(metas.map(x => x.funcionario_id));

  const tx = db.transaction(() => {
    // 1. Fecha todas as metas ainda abertas
    for (const x of metas) {
      if (x.status === 'aberta') {
        const resultado = calcularResultado(x);
        db.prepare(`
          UPDATE metas SET status='fechada', resultado=?, data_fechamento=datetime('now','localtime'), observacao_fechamento=?
          WHERE id=?
        `).run(resultado, observacao || 'Fechamento em lote do trimestre', x.id);
        x.status = 'fechada';
        x.resultado = resultado;
      }
    }

    // 2. Cria o registro de fechamento
    const info = db.prepare(`
      INSERT INTO fechamentos
        (ano, mes_inicial, data_inicio, data_fim, total_funcionarios, total_metas,
         total_alvo, total_deduzido, total_a_receber, observacao)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(a, m, dataInicio, dataFim, funcUnicos.size, metas.length,
           total_alvo, total_deduzido, total_a_receber, observacao || null);
    const fechamentoId = info.lastInsertRowid;

    // 3. Snapshot dos itens
    const countDed = db.prepare('SELECT COUNT(*) c FROM deducoes WHERE meta_id = ?');
    const insertItem = db.prepare(`
      INSERT INTO fechamento_itens
        (fechamento_id, meta_id, funcionario_id, funcionario_nome, funcionario_usuario, funcionario_cargo,
         meta_titulo, meta_descricao, data_inicio, data_fim,
         valor_inicial, valor_atual, valor_deduzido, total_deducoes, resultado)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const x of metas) {
      const nDed = countDed.get(x.id).c;
      insertItem.run(
        fechamentoId, x.id, x.funcionario_id, x.funcionario_nome, x.funcionario_usuario, x.funcionario_cargo,
        x.titulo, x.descricao, x.data_inicio, x.data_fim,
        x.valor_inicial, x.valor_atual, x.valor_inicial - x.valor_atual, nDed, x.resultado
      );
    }
    return fechamentoId;
  });

  const id = tx();
  const fech = db.prepare('SELECT * FROM fechamentos WHERE id = ?').get(id);

  let auto_metas = null;
  if (gerar_proximo_trimestre !== false) {
    try {
      auto_metas = gerarMetasAutomaticasProximoPeriodo(dataInicio);
    } catch (e) {
      auto_metas = { erro: e.message };
    }
  }

  res.status(201).json({ ...fech, auto_metas });
});

// Excluir um fechamento (não reabre metas — apenas remove o registro)
app.delete('/api/fechamentos/:id', (req, res) => {
  const fechamentoId = Number(req.params.id);
  const fech = db.prepare('SELECT * FROM fechamentos WHERE id = ?').get(fechamentoId);
  if (!fech) return res.status(404).json({ error: 'Fechamento não encontrado' });

  const metaIds = db.prepare(`
    SELECT DISTINCT meta_id
    FROM fechamento_itens
    WHERE fechamento_id = ? AND meta_id IS NOT NULL
  `).all(fechamentoId).map(r => Number(r.meta_id));

  const temOutroFechamentoParaMeta = db.prepare(`
    SELECT 1 AS ok
    FROM fechamento_itens
    WHERE meta_id = ? AND fechamento_id <> ?
    LIMIT 1
  `);
  const reabrirMeta = db.prepare(`
    UPDATE metas
    SET status='aberta', resultado=NULL, data_fechamento=NULL, observacao_fechamento=NULL
    WHERE id=?
  `);

  const tx = db.transaction(() => {
    const info = db.prepare('DELETE FROM fechamentos WHERE id = ?').run(fechamentoId);
    if (!info.changes) return false;

    for (const metaId of metaIds) {
      if (!temOutroFechamentoParaMeta.get(metaId, fechamentoId)) {
        reabrirMeta.run(metaId);
      }
    }
    return true;
  });

  const ok = tx();
  if (!ok) return res.status(404).json({ error: 'Fechamento não encontrado' });
  res.json({ ok: true, metas_reabertas: metaIds.length });
});

// ===================================================
// DASHBOARD
// ===================================================
app.get('/api/dashboard', (req, res) => {
  const totalFunc = db.prepare('SELECT COUNT(*) c FROM funcionarios').get().c;
  const metasAbertas = db.prepare("SELECT COUNT(*) c FROM metas WHERE status='aberta'").get().c;
  const metasFechadas = db.prepare("SELECT COUNT(*) c FROM metas WHERE status='fechada'").get().c;
  const totais = db.prepare(`
    SELECT
      COALESCE(SUM(valor_inicial),0) AS total_inicial,
      COALESCE(SUM(valor_atual),0) AS total_atual
    FROM metas WHERE status='aberta'
  `).get();
  const totalDeduzidoAbertas = totais.total_inicial - totais.total_atual;
  res.json({ totalFunc, metasAbertas, metasFechadas, ...totais, totalDeduzidoAbertas });
});

app.listen(PORT, () => {
  console.log(`\n🎯 Sistema de Metas rodando em http://localhost:${PORT}`);
  console.log(`   API pública de dedução: POST http://localhost:${PORT}/api/deducoes`);
});
