const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const dbFile = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, 'metas.db');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  tipo_acesso TEXT NOT NULL DEFAULT 'operador', -- admin | gestor | operador
  ativo INTEGER NOT NULL DEFAULT 1,
  permissoes TEXT,
  funcionario_id INTEGER,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS configuracoes (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS funcionarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE,
  cargo TEXT,
  unidade TEXT,
  equipe TEXT,
  valor_meta_mensal REAL NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS metas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  funcionario_id INTEGER NOT NULL,
  titulo TEXT NOT NULL,
  descricao TEXT,
  valor_inicial REAL NOT NULL,
  valor_atual REAL NOT NULL,
  data_inicio TEXT NOT NULL,
  data_fim TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'aberta', -- aberta | fechada
  resultado TEXT,                        -- atingida | parcial | nao_atingida
  data_fechamento TEXT,
  observacao_fechamento TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS deducoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meta_id INTEGER NOT NULL,
  funcionario_id INTEGER NOT NULL,
  valor REAL NOT NULL,
  motivo TEXT,
  origem TEXT DEFAULT 'api',
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (meta_id) REFERENCES metas(id) ON DELETE CASCADE,
  FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fechamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ano INTEGER NOT NULL,
  mes_inicial INTEGER NOT NULL,      -- 1..12
  data_inicio TEXT NOT NULL,
  data_fim TEXT NOT NULL,
  total_funcionarios INTEGER NOT NULL,
  total_metas INTEGER NOT NULL,
  total_alvo REAL NOT NULL,
  total_deduzido REAL NOT NULL,
  total_a_receber REAL NOT NULL,
  observacao TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fechamento_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fechamento_id INTEGER NOT NULL,
  meta_id INTEGER,
  funcionario_id INTEGER,
  funcionario_nome TEXT NOT NULL,
  funcionario_usuario TEXT NOT NULL,
  funcionario_cargo TEXT,
  meta_titulo TEXT NOT NULL,
  meta_descricao TEXT,
  data_inicio TEXT NOT NULL,
  data_fim TEXT NOT NULL,
  valor_inicial REAL NOT NULL,
  valor_atual REAL NOT NULL,
  valor_deduzido REAL NOT NULL,
  total_deducoes INTEGER NOT NULL DEFAULT 0,
  resultado TEXT,
  FOREIGN KEY (fechamento_id) REFERENCES fechamentos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS meta_meses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meta_id INTEGER NOT NULL,
  mes_offset INTEGER NOT NULL,   -- 0, 1 ou 2
  data_mes TEXT NOT NULL,        -- YYYY-MM-01
  valor_inicial REAL NOT NULL,
  valor_atual REAL NOT NULL,
  UNIQUE(meta_id, mes_offset),
  FOREIGN KEY (meta_id) REFERENCES metas(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_metas_func ON metas(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_metas_status ON metas(status);
CREATE INDEX IF NOT EXISTS idx_ded_meta ON deducoes(meta_id);
CREATE INDEX IF NOT EXISTS idx_fi_fech ON fechamento_itens(fechamento_id);
CREATE INDEX IF NOT EXISTS idx_mm_meta ON meta_meses(meta_id);
CREATE INDEX IF NOT EXISTS idx_users_usuario ON usuarios(usuario);
`);

// Configuração padrão de periodicidade das metas
try {
  db.prepare(`
    INSERT OR IGNORE INTO configuracoes (chave, valor)
    VALUES ('tipo_meta_periodo', 'trimestral')
  `).run();
} catch (e) { console.warn('Seed configuracoes.tipo_meta_periodo:', e.message); }

// Migrações leves para bancos já existentes
try {
  const cols = db.prepare("PRAGMA table_info(funcionarios)").all().map(c => c.name);
  if (!cols.includes('valor_meta_mensal')) {
    db.exec("ALTER TABLE funcionarios ADD COLUMN valor_meta_mensal REAL NOT NULL DEFAULT 0");
  }
  if (!cols.includes('unidade')) {
    db.exec("ALTER TABLE funcionarios ADD COLUMN unidade TEXT");
  }
  if (!cols.includes('equipe')) {
    db.exec("ALTER TABLE funcionarios ADD COLUMN equipe TEXT");
  }
} catch (e) { console.warn('Migração funcionarios.valor_meta_mensal:', e.message); }

// Colunas mes_offset e percentual em deducoes (NULL para legados)
try {
  const cols = db.prepare("PRAGMA table_info(deducoes)").all().map(c => c.name);
  if (!cols.includes('mes_offset')) {
    db.exec("ALTER TABLE deducoes ADD COLUMN mes_offset INTEGER");
  }
  if (!cols.includes('percentual')) {
    db.exec("ALTER TABLE deducoes ADD COLUMN percentual REAL");
  }
} catch (e) { console.warn('Migração deducoes (mes_offset/percentual):', e.message); }

// Migrações de usuarios para bancos legados
try {
  const cols = db.prepare("PRAGMA table_info(usuarios)").all().map(c => c.name);
  if (!cols.includes('ativo')) {
    db.exec("ALTER TABLE usuarios ADD COLUMN ativo INTEGER NOT NULL DEFAULT 1");
  }
  if (!cols.includes('tipo_acesso')) {
    db.exec("ALTER TABLE usuarios ADD COLUMN tipo_acesso TEXT NOT NULL DEFAULT 'operador'");
  }
  if (!cols.includes('funcionario_id')) {
    db.exec("ALTER TABLE usuarios ADD COLUMN funcionario_id INTEGER");
  }
  if (!cols.includes('permissoes')) {
    db.exec("ALTER TABLE usuarios ADD COLUMN permissoes TEXT");
  }
} catch (e) { console.warn('Migração usuarios:', e.message); }

// Backfill de meta_meses para metas que ainda não tenham distribuição mensal
try {
  const metasSemMeses = db.prepare(`
    SELECT m.id, m.data_inicio, m.valor_inicial, m.valor_atual
    FROM metas m
    LEFT JOIN meta_meses mm ON mm.meta_id = m.id
    WHERE mm.id IS NULL
  `).all();

  if (metasSemMeses.length) {
    const addMonthsStart = (dateStr, months) => {
      const d = new Date(dateStr + 'T00:00:00');
      d.setMonth(d.getMonth() + months);
      d.setDate(1);
      return d.toISOString().slice(0, 10);
    };
    const insert = db.prepare(`
      INSERT INTO meta_meses (meta_id, mes_offset, data_mes, valor_inicial, valor_atual)
      VALUES (?, ?, ?, ?, ?)
    `);
    const tx = db.transaction(() => {
      for (const m of metasSemMeses) {
        const vIniMes = Math.round((m.valor_inicial / 3) * 100) / 100;
        const vAtualMes = Math.round((m.valor_atual / 3) * 100) / 100;
        for (let i = 0; i < 3; i++) {
          const dataMes = addMonthsStart(m.data_inicio, i);
          insert.run(m.id, i, dataMes, vIniMes, vAtualMes);
        }
      }
    });
    tx();
    console.log(`📦 Backfill meta_meses: ${metasSemMeses.length} meta(s) distribuídas em 3 meses`);
  }
} catch (e) { console.warn('Backfill meta_meses:', e.message); }

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

// Seed de usuário padrão para primeiro acesso
try {
  const totalUsers = db.prepare('SELECT COUNT(*) AS c FROM usuarios').get().c;
  if (!totalUsers) {
    const defaultUsuario = process.env.DEFAULT_ADMIN_USER || 'admin';
    const defaultSenha = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
    db.prepare(`
      INSERT INTO usuarios (nome, usuario, senha_hash, tipo_acesso, ativo)
      VALUES (?, ?, ?, 'admin', 1)
    `).run('Administrador', defaultUsuario.toLowerCase().trim(), hashPassword(defaultSenha));
    console.log(`🔐 Usuário padrão criado: ${defaultUsuario} / ${defaultSenha}`);
  }
} catch (e) {
  console.warn('Seed usuário padrão:', e.message);
}

module.exports = db;
