// ============ Sessão / Auth ============
const LS_TOKEN = 'metas:authToken';
const LS_USER = 'metas:authUser';
const LS_VIEW = 'metas:lastView';
const LS_FECH = 'metas:lastFechamentoId';
const LS_AUTO_META_FECH = 'metas:autoGerarMetaFechamento';
const ACCESS_LABEL = {
  admin: 'Administrador',
  gestor: 'Gestor',
  operador: 'Operador',
};
const USER_PERMISSION_LABELS = {
  meta_gerar: 'Gerar metas',
  meta_excluir: 'Excluir metas',
  deducao_gerar: 'Gerar deduções',
  deducao_excluir: 'Excluir deduções',
  funcionario_criar: 'Criar funcionários',
  funcionario_editar: 'Editar funcionários',
  funcionario_excluir: 'Excluir funcionários',
  fechamento_gerar: 'Gerar fechamentos',
  fechamento_excluir: 'Excluir fechamentos',
};
const USER_PERMISSION_KEYS = Object.keys(USER_PERMISSION_LABELS);
const USER_PERMISSION_GROUPS = [
  { title: 'Metas', keys: ['meta_gerar', 'meta_excluir'] },
  { title: 'Deduções', keys: ['deducao_gerar', 'deducao_excluir'] },
  { title: 'Funcionários', keys: ['funcionario_criar', 'funcionario_editar', 'funcionario_excluir'] },
  { title: 'Fechamentos', keys: ['fechamento_gerar', 'fechamento_excluir'] },
];
const ACCESS_RANK = { operador: 1, gestor: 2, admin: 3 };
const META_PERIOD_MONTHS = {
  mensal: 1,
  bimestral: 2,
  trimestral: 3,
  quadrimestral: 4,
  semestral: 6,
  anual: 12,
};
const META_PERIOD_LABEL = {
  mensal: 'Mensal',
  bimestral: 'Bimestral',
  trimestral: 'Trimestral',
  quadrimestral: 'Quadrimestral',
  semestral: 'Semestral',
  anual: 'Anual',
};
const metaConfig = {
  tipo_meta_periodo: 'trimestral',
  meses: 3,
};

const session = {
  token: localStorage.getItem(LS_TOKEN) || null,
  user: JSON.parse(localStorage.getItem(LS_USER) || 'null'),
};

function setSession(token, user) {
  session.token = token;
  session.user = user;
  localStorage.setItem(LS_TOKEN, token);
  localStorage.setItem(LS_USER, JSON.stringify(user));
}

function clearSession() {
  session.token = null;
  session.user = null;
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_USER);
}

function hasAccess(minRole) {
  if (!session.user?.tipo_acesso) return false;
  return (ACCESS_RANK[session.user.tipo_acesso] || 0) >= (ACCESS_RANK[minRole] || 0);
}
const canManageData = () => hasAccess('gestor');
const canManageUsers = () => hasAccess('admin');
const canManageConfig = () => hasAccess('admin');
const isOperador = () => session.user?.tipo_acesso === 'operador';
function hasUserPermission(key) {
  if (!session.user) return false;
  if (session.user.tipo_acesso === 'admin') return true;
  return !!session.user.permissoes?.[key];
}
const canCreateFuncionario = () => hasUserPermission('funcionario_criar');
const canEditFuncionario = () => hasUserPermission('funcionario_editar');
const canCreateMeta = () => hasUserPermission('meta_gerar');
const canDeleteDeducao = () => hasUserPermission('deducao_excluir');
const canDeleteFuncionario = () => hasUserPermission('funcionario_excluir');
const canDeleteMeta = () => hasUserPermission('meta_excluir');
const canCreateFechamento = () => hasUserPermission('fechamento_gerar');
const canDeleteFechamento = () => hasUserPermission('fechamento_excluir');

function pctOf(value, total) {
  const v = Number(value) || 0;
  const t = Number(total) || 0;
  if (t <= 0) return 0;
  return Math.max(0, (v / t) * 100);
}

function fmtPctGlobal(value, digits = 1) {
  return `${Number(value || 0).toFixed(digits)}%`;
}

function applySessionChip() {
  const u = session.user;
  document.getElementById('session-avatar').textContent = initials(u?.nome || '?');
  document.getElementById('session-nome').textContent = u?.nome || '-';
  document.getElementById('session-role').textContent = ACCESS_LABEL[u?.tipo_acesso] || '-';
}

function applyAccessUI() {
  const showDataActions = canManageData();
  const showCreateFuncionario = canCreateFuncionario();
  const showCreateMeta = canCreateMeta();
  const showUsers = canManageUsers();
  const showConfig = canManageConfig();
  document.getElementById('nav-usuarios').classList.toggle('hidden', !showUsers);
  document.getElementById('nav-configuracoes').classList.toggle('hidden', !showConfig);
  document.getElementById('btn-novo-usuario').classList.toggle('hidden', !canManageUsers());
  document.getElementById('btn-novo-func').classList.toggle('hidden', !showCreateFuncionario);
  document.getElementById('btn-import-func-csv').classList.toggle('hidden', !showCreateFuncionario);
  document.getElementById('btn-deducao-lote').classList.toggle('hidden', !hasUserPermission('deducao_gerar'));
  document.getElementById('btn-nova-meta').classList.toggle('hidden', !showCreateMeta);
  document.getElementById('btn-novo-fechamento').classList.toggle('hidden', !canCreateFechamento());
}

function currentMetaPeriodMonths() {
  return Math.max(1, Number(metaConfig.meses) || 3);
}

function showLogin(defaultHint = false) {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('login-default-hint').classList.toggle('hidden', !defaultHint);
  document.getElementById('login-senha').value = '';
  document.getElementById('login-usuario').focus();
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  applySessionChip();
  applyAccessUI();
}

// ============ API helper ============
const api = (url, opts = {}) => {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  return fetch(url, { ...opts, headers })
    .then(async r => {
      const data = await r.json().catch(() => ({}));
      if (r.status === 401 && url !== '/api/auth/login') {
        clearSession();
        showLogin();
        throw new Error('Sessão expirada. Faça login novamente.');
      }
      if (!r.ok) throw new Error(data.error || 'Erro na requisição');
      return data;
    });
};

async function loadMetaConfig() {
  try {
    const cfg = await api('/api/configuracoes/meta-periodo');
    const tipo = String(cfg?.tipo_meta_periodo || 'trimestral').toLowerCase();
    metaConfig.tipo_meta_periodo = META_PERIOD_MONTHS[tipo] ? tipo : 'trimestral';
    metaConfig.meses = META_PERIOD_MONTHS[metaConfig.tipo_meta_periodo];
  } catch {
    metaConfig.tipo_meta_periodo = 'trimestral';
    metaConfig.meses = 3;
  }
}

const fmtBRL = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = s => {
  if (!s) return '-';
  // Aceita "YYYY-MM-DD", "YYYY-MM-DDTHH:mm:ss" e "YYYY-MM-DD HH:mm:ss"
  const iso = s.length <= 10 ? s + 'T00:00:00' : s.replace(' ', 'T');
  const d = new Date(iso);
  return isNaN(d) ? '-' : d.toLocaleDateString('pt-BR');
};
const fmtDateTime = s => {
  if (!s) return '-';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
  return isNaN(d) ? '-' : d.toLocaleString('pt-BR');
};
const initials = name => (name || '?').split(' ').filter(Boolean).slice(0,2).map(s=>s[0].toUpperCase()).join('');
const escapeHtml = s => (s ?? '').toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function currentQuarter() {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return { label: `Q${q} ${d.getFullYear()}`, q, year: d.getFullYear() };
}
function quarterOf(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00');
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${d.getFullYear()}`;
}

// status derived for OPEN goals — baseado no saldo atual vs. valor-alvo
// Alinhado com a regra de fechamento: 100% atingida / ≥60% parcial / <60% não atingida
function deriveStatus(meta) {
  if (meta.status === 'fechada') return { key: 'fechada', label: 'Fechada', chip: 'chip-fechada' };
  const pct = meta.valor_inicial > 0 ? (meta.valor_atual / meta.valor_inicial) : 1;
  if (pct >= 0.9) return { key: 'ontrack', label: 'No ritmo', chip: 'chip-ontrack' };
  if (pct >= 0.6) return { key: 'atrisk', label: 'Em risco', chip: 'chip-atrisk' };
  return { key: 'offtrack', label: 'Fora do ritmo', chip: 'chip-offtrack' };
}
function progressBarClass(pct) {
  if (pct >= 70) return '';       // success (default)
  if (pct >= 40) return 'warn';
  return 'danger';
}

// ============ Confirm Modal ============
const CONFIRM_ICONS = {
  danger: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  warn: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  info: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  success: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
};

function confirmDialog(opts = {}) {
  // Aceita string (mensagem) ou objeto { title, message, okText, cancelText, variant }
  if (typeof opts === 'string') opts = { message: opts };
  const {
    title = 'Confirmar ação',
    message = '',
    okText = 'Confirmar',
    cancelText = 'Cancelar',
    variant = 'danger', // danger | warn | info | success
  } = opts;

  return new Promise(resolve => {
    const overlay = document.getElementById('confirm-overlay');
    const iconEl = document.getElementById('confirm-icon');
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');

    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-msg').textContent = message;
    okBtn.textContent = okText;
    cancelBtn.textContent = cancelText;

    iconEl.className = `confirm-icon ${variant}`;
    iconEl.innerHTML = CONFIRM_ICONS[variant] || CONFIRM_ICONS.danger;

    okBtn.className = 'btn ' + (
      variant === 'danger' ? 'btn-danger' :
      variant === 'success' ? 'btn-success' : 'btn-primary'
    );

    overlay.classList.remove('hidden');

    const cleanup = (value) => {
      overlay.classList.add('hidden');
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      overlay.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = e => {
      if (e.key === 'Escape') cleanup(false);
      else if (e.key === 'Enter') cleanup(true);
    };
    okBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
    overlay.onclick = e => { if (e.target === overlay) cleanup(false); };
    document.addEventListener('keydown', onKey);
    setTimeout(() => okBtn.focus(), 50);
  });
}

// ============ Toast ============
function toast(msg, type = 'success', opts = {}) {
  // Por padrão, toast fecha automaticamente em 20s.
  const { autoCloseMs = 15000 } = opts || {};
  const t = document.getElementById('toast');
  t.innerHTML = `
    <span class="toast-msg">${escapeHtml(msg)}</span>
    <button class="toast-close" id="toast-close-btn" aria-label="Fechar aviso" title="Fechar">×</button>
  `;
  t.className = `toast ${type}`;
  clearTimeout(toast._t);
  const closeBtn = document.getElementById('toast-close-btn');
  if (closeBtn) {
    closeBtn.onclick = () => {
      clearTimeout(toast._t);
      t.classList.add('hidden');
    };
  }
  if (autoCloseMs && Number(autoCloseMs) > 0) {
    toast._t = setTimeout(() => t.classList.add('hidden'), Number(autoCloseMs));
  }
}

// ============ Navigation ============
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => { localStorage.removeItem(LS_FECH); goto(btn.dataset.view); });
});
document.querySelectorAll('[data-goto]').forEach(el => {
  el.addEventListener('click', () => goto(el.dataset.goto));
});
function goto(view) {
  if (view === 'usuarios' && !canManageUsers()) view = 'dashboard';
  if (view === 'configuracoes' && !canManageConfig()) view = 'dashboard';
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(`view-${view}`).classList.remove('hidden');
  localStorage.setItem(LS_VIEW, view);
  loaders[view]?.();
}

// ============ Drawer ============
const drawer = document.getElementById('drawer');
const drawerOverlay = document.getElementById('drawer-overlay');
const drawerBody = document.getElementById('drawer-body');
const drawerTitle = document.getElementById('drawer-title');
function openDrawer(title, html) {
  drawerTitle.textContent = title;
  drawerBody.innerHTML = html;
  drawer.classList.remove('hidden');
  drawerOverlay.classList.remove('hidden');
}
function closeDrawer() {
  drawer.classList.add('hidden');
  drawerOverlay.classList.add('hidden');
}
document.getElementById('drawer-close').onclick = closeDrawer;
drawerOverlay.onclick = closeDrawer;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

// ============ Topbar ============
document.getElementById('current-period').textContent = currentQuarter().label;
document.getElementById('btn-logout').onclick = async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  clearSession();
  showLogin();
};

document.getElementById('btn-login').onclick = async () => {
  const usuario = document.getElementById('login-usuario').value.trim().toLowerCase();
  const senha = document.getElementById('login-senha').value;
  if (!usuario || !senha) return toast('Informe usuário e senha', 'error');
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ usuario, senha })
    });
    setSession(data.token, data.user);
    await loadMetaConfig();
    showApp();
    toast('Login realizado com sucesso');
    const lastView = localStorage.getItem(LS_VIEW);
    const blocked = (lastView === 'usuarios' && !canManageUsers()) || (lastView === 'configuracoes' && !canManageConfig());
    const view = (lastView && loaders[lastView] && !blocked) ? lastView : 'dashboard';
    goto(view);
  } catch (e) {
    toast(e.message, 'error');
  }
};

document.getElementById('login-senha').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-login').click();
});

// global search
document.getElementById('global-search').addEventListener('input', e => {
  const term = e.target.value.toLowerCase();
  document.querySelectorAll('.table tbody tr').forEach(tr => {
    if (tr.classList.contains('empty-row')) return;
    tr.style.display = tr.textContent.toLowerCase().includes(term) ? '' : 'none';
  });
});

// ===================================================
// DASHBOARD
// ===================================================
async function loadDashboard() {
  const d = await api('/api/dashboard');
  const kpis = [
    { label: 'Funcionários', value: d.totalFunc, icon: 'users', color: 'info' },
    { label: 'Metas em andamento', value: d.metasAbertas, icon: 'target', color: '' },
    { label: 'Metas fechadas', value: d.metasFechadas, icon: 'check', color: 'success' },
    { label: 'Valor-alvo ativo', value: fmtBRL(d.total_inicial), icon: 'money', color: 'info' },
    { label: 'Saldo atual', value: fmtBRL(d.total_atual), icon: 'trending', color: 'success' },
    { label: 'Total deduzido', value: fmtBRL(d.totalDeduzidoAbertas), icon: 'alert', color: 'warn' },
  ];
  const ic = {
    users: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>',
    target: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    money: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    trending: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
    alert: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>',
  };
  document.getElementById('kpis').innerHTML = kpis.map(k => `
    <div class="kpi">
      <div class="kpi-head">
        <span class="kpi-label">${k.label}</span>
        <span class="kpi-icon ${k.color}">${ic[k.icon]}</span>
      </div>
      <div class="kpi-value">${k.value}</div>
    </div>
  `).join('');

  const metas = await api('/api/metas?status=aberta');
  const el = document.getElementById('dash-metas');
  el.innerHTML = metas.length ? metas.slice(0, 5).map(m => {
    const pct = m.valor_inicial > 0 ? (m.valor_atual / m.valor_inicial) * 100 : 0;
    const st = deriveStatus(m);
    return `
      <div class="stack-item" style="cursor:pointer" onclick="verMeta(${m.id})">
        <div class="avatar sm">${initials(m.funcionario_nome)}</div>
        <div class="body">
          <div class="title">${escapeHtml(m.titulo)}</div>
          <div class="sub">${escapeHtml(m.funcionario_nome)} · ${quarterOf(m.data_inicio)}</div>
          <div class="progress" style="margin-top:8px"><div class="progress-bar ${progressBarClass(pct)}" style="width:${Math.min(100,pct)}%"></div></div>
        </div>
        <span class="chip ${st.chip}">${st.label}</span>
      </div>`;
  }).join('') : emptyState('Nenhuma meta em andamento');

  const deds = await api('/api/deducoes');
  const del = document.getElementById('dash-deducoes');
  del.innerHTML = deds.length ? deds.slice(0, 5).map(d => `
    <div class="stack-item">
      <div class="avatar sm">${initials(d.funcionario_nome)}</div>
      <div class="body">
        <div class="title">${
          isOperador()
            ? `${d.percentual != null ? `${Number(d.percentual).toFixed(d.percentual % 1 === 0 ? 0 : 2)}%` : 'Dedução sem percentual'}`
            : fmtBRL(d.valor)
        } · <span style="font-weight:400;color:var(--muted)">${escapeHtml(d.motivo || 'Sem motivo')}</span></div>
        <div class="sub">${escapeHtml(d.funcionario_nome)} · ${fmtDateTime(d.criado_em)}</div>
      </div>
      <span class="tag tag-${d.origem}">${d.origem}</span>
    </div>
  `).join('') : emptyState('Nenhuma dedução registrada');
}

function emptyState(msg) {
  return `<div style="padding:32px 12px;text-align:center;color:var(--muted);font-size:13px">${msg}</div>`;
}

// ===================================================
// FUNCIONÁRIOS
// ===================================================
async function loadFuncionarios() {
  const [funcs, metas] = await Promise.all([api('/api/funcionarios'), api('/api/metas?status=aberta')]);
  const countByFunc = {};
  metas.forEach(m => countByFunc[m.funcionario_id] = (countByFunc[m.funcionario_id] || 0) + 1);

  const tbody = document.getElementById('tbl-funcionarios');
  tbody.innerHTML = funcs.length ? funcs.map(f => `
    <tr>
      <td>
        <div class="cell-user">
          <div class="avatar">${initials(f.nome)}</div>
          <div>
            <div class="name">${escapeHtml(f.nome)}</div>
            <div class="u">${escapeHtml(f.cargo || 'Sem cargo')}</div>
          </div>
        </div>
      </td>
      <td><code style="font-size:12.5px;color:var(--text-soft)">@${escapeHtml(f.usuario)}</code></td>
      <td>${escapeHtml(f.cargo || '-')}</td>
      <td>${escapeHtml(f.unidade || '-')}</td>
      <td>${escapeHtml(f.equipe || '-')}</td>
      <td style="text-align:right">${f.valor_meta_mensal > 0 ? `<b>${fmtBRL(f.valor_meta_mensal)}</b>` : '<span class="muted">—</span>'}</td>
      <td>${countByFunc[f.id] ? `<span class="tag tag-quarter">${countByFunc[f.id]} ativa(s)</span>` : '<span class="muted">—</span>'}</td>
      <td><span class="muted">${fmtDate(f.criado_em)}</span></td>
      <td style="text-align:right;white-space:nowrap">
        ${canEditFuncionario() ? `<button class="btn btn-ghost btn-sm" onclick="editFunc(${f.id})">Editar</button>` : ''}
        ${canDeleteFuncionario() ? `<button class="btn btn-danger btn-sm" onclick="delFunc(${f.id})">Excluir</button>` : ''}
        ${(!canEditFuncionario() && !canDeleteFuncionario()) ? '<span class="muted">Somente leitura</span>' : ''}
      </td>
    </tr>
  `).join('') : `<tr class="empty-row"><td colspan="9">Nenhum funcionário cadastrado. Clique em "Novo funcionário" para começar.</td></tr>`;
}

function funcFormBody(f = {}) {
  return `
    <div class="field"><label>Nome completo</label><input id="f-nome" placeholder="Ex: João Silva" value="${escapeHtml(f.nome || '')}"/></div>
    <div class="form-grid-2">
      <div class="field"><label>Usuário (único, sem espaços)</label><input id="f-usuario" placeholder="joao.silva" value="${escapeHtml(f.usuario || '')}"/></div>
      <div class="field"><label>Cargo</label><input id="f-cargo" placeholder="Ex: Analista" value="${escapeHtml(f.cargo || '')}"/></div>
    </div>
    <div class="form-grid-2">
      <div class="field"><label>Unidade</label><input id="f-unidade" placeholder="Ex: Matriz" value="${escapeHtml(f.unidade || '')}"/></div>
      <div class="field"><label>Equipe</label><input id="f-equipe" placeholder="Ex: Equipe A" value="${escapeHtml(f.equipe || '')}"/></div>
    </div>
    <div class="field">
      <label>Valor base da meta mensal (R$)</label>
      <input id="f-valor-mensal" type="number" step="0.01" min="0" placeholder="0,00" value="${f.valor_meta_mensal || ''}"/>
      <small class="muted" style="display:block;margin-top:4px;font-size:12px">
        Usado para pré-calcular o valor-alvo ao criar uma nova meta (valor × 3 meses).
      </small>
    </div>
  `;
}

function parseCsvLine(line, delimiter) {
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch === delimiter) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

function parseFuncionariosCsv(csvText) {
  const rawLines = String(csvText || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  if (rawLines.length < 2) throw new Error('CSV sem dados. Inclua cabeçalho e ao menos 1 linha.');

  const firstLine = rawLines[0];
  const delimiter = (firstLine.split(';').length >= firstLine.split(',').length) ? ';' : ',';
  const headers = parseCsvLine(firstLine, delimiter).map(h =>
    h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  );

  const idxNome = headers.findIndex(h => h === 'nome' || h === 'nome completo');
  const idxUsuario = headers.findIndex(h => h === 'usuario' || h === 'login');
  const idxCargo = headers.findIndex(h => h === 'cargo' || h === 'funcao');
  const idxUnidade = headers.findIndex(h => h === 'unidade' || h === 'filial');
  const idxEquipe = headers.findIndex(h => h === 'equipe' || h === 'time');
  const idxMeta = headers.findIndex(h =>
    h === 'valor_meta_mensal' || h === 'valor meta mensal' || h === 'meta_mensal' || h === 'meta mensal'
  );

  if (idxNome < 0 || idxUsuario < 0) {
    throw new Error('Cabeçalho inválido. Use pelo menos as colunas: nome, usuario.');
  }

  const rows = [];
  for (let i = 1; i < rawLines.length; i++) {
    const cols = parseCsvLine(rawLines[i], delimiter);
    const nome = String(cols[idxNome] || '').trim();
    const usuario = String(cols[idxUsuario] || '').trim().toLowerCase();
    const cargo = idxCargo >= 0 ? String(cols[idxCargo] || '').trim() : '';
    const unidade = idxUnidade >= 0 ? String(cols[idxUnidade] || '').trim() : '';
    const equipe = idxEquipe >= 0 ? String(cols[idxEquipe] || '').trim() : '';
    const brutoMeta = idxMeta >= 0 ? String(cols[idxMeta] || '').trim() : '';
    const valorMeta = brutoMeta
      ? Number(brutoMeta.replace(/\./g, '').replace(',', '.'))
      : 0;
    rows.push({
      nome,
      usuario,
      cargo,
      unidade,
      equipe,
      valor_meta_mensal: Number.isFinite(valorMeta) ? Math.max(0, valorMeta) : 0,
    });
  }
  return rows.filter(r => r.nome || r.usuario);
}

document.getElementById('btn-novo-func').onclick = () => {
  if (!canCreateFuncionario()) return toast('Sem permissão para criar funcionário', 'error');
  openDrawer('Novo funcionário', `
    ${funcFormBody()}
    <div class="drawer-actions">
      <button class="btn btn-primary" id="f-save">Salvar funcionário</button>
      <button class="btn btn-ghost" onclick="closeDrawer()">Cancelar</button>
    </div>
  `);
  document.getElementById('f-save').onclick = async () => {
    try {
      await api('/api/funcionarios', { method: 'POST', body: JSON.stringify({
        nome: document.getElementById('f-nome').value,
        usuario: document.getElementById('f-usuario').value,
        cargo: document.getElementById('f-cargo').value,
        unidade: document.getElementById('f-unidade').value,
        equipe: document.getElementById('f-equipe').value,
        valor_meta_mensal: Number(document.getElementById('f-valor-mensal').value) || 0,
      })});
      closeDrawer(); toast('Funcionário cadastrado');
      loadFuncionarios(); loadFuncSelects();
    } catch (e) { toast(e.message, 'error'); }
  };
};

function downloadFuncionariosCsvTemplate() {
  const csv = [
    'nome;usuario;cargo;unidade;equipe;valor_meta_mensal',
    'Joao Silva;joao.silva;Analista;Matriz;Equipe A;1500,00',
    'Maria Souza;maria.souza;Supervisora;Filial Sul;Equipe B;2200,00',
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'modelo-funcionarios.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

document.getElementById('btn-import-func-csv').onclick = () => {
  if (!canCreateFuncionario()) return toast('Sem permissão para importar funcionários', 'error');
  openDrawer('Importar funcionários via CSV', `
    <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;margin-bottom:14px">
      <div style="font-weight:600;margin-bottom:6px">Instruções do arquivo CSV</div>
      <ul style="margin:0;padding-left:18px;color:var(--muted);font-size:13px;line-height:1.55">
        <li>Use as colunas: <b>nome</b> e <b>usuario</b> (obrigatórias).</li>
        <li>Colunas opcionais: <b>cargo</b>, <b>unidade</b>, <b>equipe</b> e <b>valor_meta_mensal</b>.</li>
        <li>Separador aceito: <b>;</b> ou <b>,</b>.</li>
        <li>O campo <b>usuario</b> deve ser único e sem espaços.</li>
      </ul>
    </div>

    <div style="background:#0f172a;color:#e2e8f0;border-radius:10px;padding:10px 12px;font-family:ui-monospace, SFMono-Regular, Menlo, monospace;font-size:12px;margin-bottom:14px;overflow:auto">
nome;usuario;cargo;unidade;equipe;valor_meta_mensal
Joao Silva;joao.silva;Analista;Matriz;Equipe A;1500,00
Maria Souza;maria.souza;Supervisora;Filial Sul;Equipe B;2200,00
    </div>

    <div class="drawer-actions">
      <button class="btn btn-ghost" id="btn-download-modelo-csv">Baixar arquivo modelo</button>
      <button class="btn btn-primary" id="btn-selecionar-csv">Selecionar arquivo CSV</button>
      <button class="btn btn-ghost" onclick="closeDrawer()">Cancelar</button>
    </div>
  `);

  document.getElementById('btn-download-modelo-csv').onclick = () => {
    downloadFuncionariosCsvTemplate();
    toast('Modelo CSV baixado');
  };
  document.getElementById('btn-selecionar-csv').onclick = () => {
    const input = document.getElementById('input-func-csv');
    if (!input) return;
    input.value = '';
    input.click();
  };
};

document.getElementById('input-func-csv').addEventListener('change', async (ev) => {
  if (!canCreateFuncionario()) return toast('Sem permissão para importar funcionários', 'error');
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const funcionarios = parseFuncionariosCsv(text);
    if (!funcionarios.length) return toast('Nenhum funcionário válido encontrado no CSV', 'error');

    const r = await api('/api/funcionarios/importar', {
      method: 'POST',
      body: JSON.stringify({ funcionarios }),
    });

    let msg = `${r.total_criados} funcionário(s) importado(s).`;
    if (r.total_ignorados) {
      const nomes = (r.ignorados || []).map(x => x.nome || x.usuario).filter(Boolean);
      const prev = nomes.slice(0, 4).join(', ');
      const resto = Math.max(0, nomes.length - 4);
      msg += ` ${r.total_ignorados} ignorado(s): ${prev}${resto ? ` e mais ${resto}` : ''}.`;
    }
    toast(msg, r.total_criados ? 'success' : 'warn');
    closeDrawer();
    loadFuncionarios();
    loadFuncSelects();
  } catch (e) {
    toast(`Falha ao importar CSV: ${e.message}`, 'error');
  } finally {
    ev.target.value = '';
  }
});

window.editFunc = async id => {
  if (!canEditFuncionario()) return toast('Sem permissão para editar funcionário', 'error');
  const all = await api('/api/funcionarios');
  const f = all.find(x => x.id === id);
  openDrawer('Editar funcionário', `
    ${funcFormBody(f)}
    <div class="drawer-actions">
      <button class="btn btn-primary" id="f-save">Salvar alterações</button>
      <button class="btn btn-ghost" onclick="closeDrawer()">Cancelar</button>
    </div>
  `);
  document.getElementById('f-save').onclick = async () => {
    try {
      await api(`/api/funcionarios/${id}`, { method: 'PUT', body: JSON.stringify({
        nome: document.getElementById('f-nome').value,
        usuario: document.getElementById('f-usuario').value,
        cargo: document.getElementById('f-cargo').value,
        unidade: document.getElementById('f-unidade').value,
        equipe: document.getElementById('f-equipe').value,
        valor_meta_mensal: Number(document.getElementById('f-valor-mensal').value) || 0,
      })});
      closeDrawer(); toast('Atualizado'); loadFuncionarios(); loadFuncSelects();
    } catch (e) { toast(e.message, 'error'); }
  };
};

window.delFunc = async id => {
  if (!canDeleteFuncionario()) return toast('Sem permissão para excluir funcionário', 'error');
  if (!await confirmDialog({ title: 'Excluir funcionário?', message: 'Todas as metas e deduções associadas também serão removidas. Esta ação não pode ser desfeita.', okText: 'Excluir', variant: 'danger' })) return;
  try { await api(`/api/funcionarios/${id}`, { method: 'DELETE' }); toast('Excluído'); loadFuncionarios(); }
  catch (e) { toast(e.message, 'error'); }
};

// ===================================================
// METAS
// ===================================================
let filterStatus = 'aberta';
let filterFunc = '';

document.querySelectorAll('#filter-status .seg').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#filter-status .seg').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    filterStatus = b.dataset.val;
    loadMetas();
  });
});
document.getElementById('filter-func').addEventListener('change', e => {
  filterFunc = e.target.value; loadMetas();
});

async function loadFuncSelects() {
  const funcs = await api('/api/funcionarios');
  const sel = document.getElementById('filter-func');
  sel.innerHTML = `<option value="">Todos os funcionários</option>` + funcs.map(f => `<option value="${f.id}">${escapeHtml(f.nome)}</option>`).join('');
}

async function loadMetas() {
  const params = new URLSearchParams();
  if (filterStatus) params.set('status', filterStatus);
  if (filterFunc) params.set('funcionario_id', filterFunc);
  const rows = await api('/api/metas?' + params);

  const tbody = document.getElementById('tbl-metas');
  tbody.innerHTML = rows.length ? rows.map(m => {
    const pct = m.valor_inicial > 0 ? (m.valor_atual / m.valor_inicial) * 100 : 0;
    const deduzido = Math.max(0, m.valor_inicial - m.valor_atual);
    const dedPct = m.valor_inicial > 0 ? (deduzido / m.valor_inicial) * 100 : 0;
    const st = deriveStatus(m);
    const resultChip = m.resultado ? `<span class="chip chip-${m.resultado}">${m.resultado.replace('_',' ')}</span>` : '';
    return `
      <tr style="cursor:pointer" onclick="verMeta(${m.id})">
        <td>
          <div class="name" style="font-weight:600">${escapeHtml(m.titulo)}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">
            <span class="tag tag-quarter">${quarterOf(m.data_inicio)}</span>
            ${m.descricao ? ' · ' + escapeHtml(m.descricao).slice(0, 60) : ''}
          </div>
        </td>
        <td>
          <div class="cell-user">
            <div class="avatar sm">${initials(m.funcionario_nome)}</div>
            <div>
              <div class="name" style="font-size:13px">${escapeHtml(m.funcionario_nome)}</div>
              <div class="u">@${escapeHtml(m.funcionario_usuario)}</div>
            </div>
          </div>
        </td>
        <td><span class="muted">${fmtDate(m.data_inicio)} → ${fmtDate(m.data_fim)}</span></td>
        <td>
          <div class="progress-wrap">
            <div class="progress"><div class="progress-bar ${progressBarClass(pct)}" style="width:${Math.min(100, Math.max(0,pct))}%"></div></div>
            <div class="progress-meta">
              <b>${isOperador() ? fmtPctGlobal(pct) : fmtBRL(m.valor_atual)}</b>
              <span>${isOperador() ? '100%' : fmtBRL(m.valor_inicial)}</span>
            </div>
          </div>
        </td>
        <td style="text-align:right;white-space:nowrap">
          ${deduzido > 0
            ? `<b style="color:var(--danger)">${isOperador() ? fmtPctGlobal(dedPct) : '−' + fmtBRL(deduzido)}</b>`
            : '<span class="muted">—</span>'}
        </td>
        <td>${m.status === 'fechada' ? resultChip || `<span class="chip chip-fechada">Fechada</span>` : `<span class="chip ${st.chip}">${st.label}</span>`}</td>
        <td style="text-align:right" onclick="event.stopPropagation()">
          ${m.status === 'aberta' ? `
            <button class="btn btn-ghost btn-sm" onclick="deduzirMeta(${m.id})">Deduzir</button>
            ${canManageData() ? `<button class="btn btn-success btn-sm" onclick="fecharMeta(${m.id})">Fechar</button>` : ''}
          ` : `
            ${canManageData() ? `<button class="btn btn-ghost btn-sm" onclick="reabrirMeta(${m.id})">Reabrir</button>` : '<span class="muted">Fechada</span>'}
          `}
        </td>
      </tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="7">Nenhuma meta encontrada com os filtros atuais.</td></tr>`;
}

const MONTHS_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const QUARTERS = [
  { q: 1, label: 'Q1 · Jan – Mar', startMonth: 0 },
  { q: 2, label: 'Q2 · Abr – Jun', startMonth: 3 },
  { q: 3, label: 'Q3 · Jul – Set', startMonth: 6 },
  { q: 4, label: 'Q4 · Out – Dez', startMonth: 9 },
];

document.getElementById('btn-nova-meta').onclick = async () => {
  if (!canCreateMeta()) return toast('Sem permissão para criar meta', 'error');
  const funcs = await api('/api/funcionarios');
  if (!funcs.length) return toast('Cadastre um funcionário primeiro', 'error');
  const metaMonths = currentMetaPeriodMonths();
  const periodLabel = META_PERIOD_LABEL[metaConfig.tipo_meta_periodo] || 'Trimestral';

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentQ = Math.floor(today.getMonth() / 3) + 1;
  const years = [currentYear - 1, currentYear, currentYear + 1];
  const elegiveis = funcs.filter(f => Number(f.valor_meta_mensal) > 0);

  openDrawer('Nova meta', `
    <div class="segmented" style="margin-bottom:16px">
      <button class="seg-btn active" data-mode="individual">Individual</button>
      <button class="seg-btn" data-mode="geral">Geral (todos)</button>
    </div>

    <!-- MODO INDIVIDUAL -->
    <div id="m-mode-individual">
      <div class="field"><label>Responsável</label>
        <select id="m-func" class="select" style="width:100%">
          ${funcs.map(f => `<option value="${f.id}" data-mensal="${f.valor_meta_mensal || 0}">${escapeHtml(f.nome)} (@${escapeHtml(f.usuario)})${f.valor_meta_mensal > 0 ? ' · ' + fmtBRL(f.valor_meta_mensal) + '/mês' : ''}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Título da meta</label><input id="m-titulo" placeholder="Ex: Meta de vendas"/></div>
      <div class="field"><label>Descrição</label><textarea id="m-desc" rows="3" placeholder="Contexto e critérios de sucesso..."></textarea></div>

      <div class="field">
        <label>Valor-alvo total do período (R$)</label>
        <input id="m-valor-total" type="number" step="0.01" min="0.01" placeholder="0,00"/>
      </div>
      <small class="muted" id="m-valor-hint" style="display:block;margin-bottom:14px;font-size:12px"></small>
    </div>

    <!-- MODO GERAL -->
    <div id="m-mode-geral" class="hidden">
      <div class="field"><label>Título da meta</label><input id="mg-titulo" placeholder="Ex: Meta ${periodLabel.toLowerCase()}"/></div>
      <div class="field"><label>Descrição</label><textarea id="mg-desc" rows="2" placeholder="Aplicada a todos os funcionários elegíveis..."></textarea></div>

      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;margin-bottom:14px;font-size:13px">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <b>Funcionários elegíveis</b>
          <span class="tag">${elegiveis.length} de ${funcs.length}</span>
        </div>
        ${elegiveis.length ? `
          <div style="max-height:180px;overflow:auto;display:flex;flex-direction:column;gap:6px">
            ${elegiveis.map(f => `
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:12.5px">
                <span>${escapeHtml(f.nome)} <span class="muted">@${escapeHtml(f.usuario)}</span></span>
                <span><b>${fmtBRL(f.valor_meta_mensal * metaMonths)}</b> <span class="muted" style="font-size:11px">(${fmtBRL(f.valor_meta_mensal)}/mês)</span></span>
              </div>
            `).join('')}
          </div>
          <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);display:flex;justify-content:space-between">
            <b>Total a ser gerado</b>
            <b style="color:var(--success)">${fmtBRL(elegiveis.reduce((s, f) => s + f.valor_meta_mensal * metaMonths, 0))}</b>
          </div>
        ` : `<div class="muted">Nenhum funcionário tem valor de meta mensal definido. Cadastre o valor mensal na tela de Funcionários.</div>`}
      </div>
      <p class="muted" style="font-size:12px;margin-top:-6px;margin-bottom:14px">
        Funcionários que já possuírem meta no período selecionado serão automaticamente ignorados.
      </p>
    </div>

    <!-- PERÍODO (compartilhado) -->
    <label>Período da meta (${metaMonths} ${metaMonths === 1 ? 'mês' : 'meses'} · ${periodLabel})</label>
    <div class="form-grid-2" style="margin-bottom:10px">
      <select id="m-ano" class="select" style="width:100%">
        ${years.map(y => `<option value="${y}" ${y===currentYear?'selected':''}>${y}</option>`).join('')}
      </select>
      <select id="m-trimestre" class="select" style="width:100%">
        ${QUARTERS.map(q => `<option value="${q.startMonth}" ${q.q===currentQ?'selected':''}>${q.label}</option>`).join('')}
        <option value="custom">Personalizado…</option>
      </select>
    </div>
    <div class="field hidden" id="m-custom-wrap">
      <label>Mês inicial</label>
      <select id="m-mes-inicial" class="select" style="width:100%">
        ${MONTHS_PT.map((m,i) => `<option value="${i}">${m}</option>`).join('')}
      </select>
    </div>

    <div id="m-preview" style="background:var(--primary-50);border:1px solid #c7d2fe;color:var(--primary-600);padding:10px 14px;border-radius:var(--radius-sm);font-size:13px;font-weight:600;margin-bottom:14px"></div>

    <div class="drawer-actions">
      <button class="btn btn-primary" id="m-save">Criar meta</button>
      <button class="btn btn-ghost" onclick="closeDrawer()">Cancelar</button>
    </div>
  `);

  let mode = 'individual';
  const indivWrap = document.getElementById('m-mode-individual');
  const geralWrap = document.getElementById('m-mode-geral');
  const saveBtn = document.getElementById('m-save');

  document.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      mode = btn.dataset.mode;
      document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
      indivWrap.classList.toggle('hidden', mode !== 'individual');
      geralWrap.classList.toggle('hidden', mode !== 'geral');
      saveBtn.textContent = mode === 'geral' ? `Gerar ${elegiveis.length} meta(s)` : 'Criar meta';
      if (mode === 'geral' && !elegiveis.length) saveBtn.disabled = true;
      else saveBtn.disabled = false;
    });
  });

  const anoEl = document.getElementById('m-ano');
  const triEl = document.getElementById('m-trimestre');
  const customWrap = document.getElementById('m-custom-wrap');
  const mesEl = document.getElementById('m-mes-inicial');
  const preview = document.getElementById('m-preview');
  const funcEl = document.getElementById('m-func');
  const hintEl = document.getElementById('m-valor-hint');
  const valorTotalEl = document.getElementById('m-valor-total');
  let valorTotalEditado = false;
  valorTotalEl?.addEventListener('input', () => { valorTotalEditado = true; });

  function resolveStartMonth() {
    if (triEl.value === 'custom') return Number(mesEl.value);
    return Number(triEl.value);
  }
  function autoCalcValor() {
    const opt = funcEl.options[funcEl.selectedIndex];
    const mensal = Number(opt?.dataset.mensal || 0);
    if (mensal > 0) {
      const total = mensal * metaMonths;
      hintEl.textContent = `Sugerido: ${fmtBRL(mensal)} × ${metaMonths} ${metaMonths === 1 ? 'mês' : 'meses'} = ${fmtBRL(total)}`;
      if (!valorTotalEditado) {
        valorTotalEl.value = total.toFixed(2);
      }
    } else {
      hintEl.textContent = 'Defina um valor mensal no cadastro do funcionário para pré-calcular automaticamente.';
    }
  }
  function updatePreview() {
    customWrap.classList.toggle('hidden', triEl.value !== 'custom');
    const ano = Number(anoEl.value);
    const start = resolveStartMonth();
    const months = Array.from({ length: metaMonths }, (_, i) => {
      const m = (start + i) % 12;
      const y = ano + Math.floor((start + i) / 12);
      return `${MONTHS_PT[m]}${y !== ano ? '/' + y : ''}`;
    });
    preview.innerHTML = `📅 ${months.join(' · ')} de ${ano}`;
  }
  [anoEl, triEl, mesEl].forEach(el => el.addEventListener('change', updatePreview));
  funcEl.addEventListener('change', autoCalcValor);
  updatePreview();
  autoCalcValor();

  saveBtn.onclick = async () => {
    const ano = Number(anoEl.value);
    const start = resolveStartMonth();
    const data_inicio = `${ano}-${String(start + 1).padStart(2, '0')}-01`;

    if (mode === 'individual') {
      try {
        const valor_inicial = Number(valorTotalEl?.value);
        if (!(valor_inicial > 0)) return toast('Informe o valor-alvo total da meta', 'error');
        await api('/api/metas', { method: 'POST', body: JSON.stringify({
          funcionario_id: Number(funcEl.value),
          titulo: document.getElementById('m-titulo').value,
          descricao: document.getElementById('m-desc').value,
          valor_inicial,
          data_inicio,
        })});
        closeDrawer(); toast('Meta criada'); loadMetas();
      } catch (e) { toast(e.message, 'error'); }
      return;
    }

    // modo geral
    const titulo = document.getElementById('mg-titulo').value.trim();
    if (!titulo) return toast('Informe o título da meta', 'error');
    if (!await confirmDialog({ title: 'Gerar metas em lote?', message: `Serão criadas metas para ${elegiveis.length} funcionário(s) no período de ${periodLabelLong(ano, start + 1)}.`, okText: 'Gerar metas', variant: 'info' })) return;
    try {
      const r = await api('/api/metas/lote', { method: 'POST', body: JSON.stringify({
        titulo,
        descricao: document.getElementById('mg-desc').value,
        data_inicio,
        meses: metaMonths,
      })});
      closeDrawer();
      let msg = `${r.total_criadas} meta(s) criada(s)`;
      if (r.total_ignoradas) {
        const nomesIgnorados = (r.ignoradas || []).map(x => x.nome).filter(Boolean);
        const preview = nomesIgnorados.slice(0, 4).join(', ');
        const resto = Math.max(0, nomesIgnorados.length - 4);
        const sufixo = resto > 0 ? ` e mais ${resto}` : '';
        msg = `${msg}. Não criada(s) por já existir meta no período: ${preview}${sufixo}.`;
      }
      toast(msg);
      loadMetas();
    } catch (e) { toast(e.message, 'error'); }
  };
};

window.verMeta = async id => {
  const m = await api(`/api/metas/${id}`);
  const pct = m.valor_inicial > 0 ? (m.valor_atual / m.valor_inicial) * 100 : 0;
  const dedPctTotal = 100 - pct;
  const st = m.status === 'fechada'
    ? { chip: `chip-${m.resultado || 'fechada'}`, label: m.resultado ? m.resultado.replace('_',' ') : 'Fechada' }
    : deriveStatus(m);

  const fmtPct = p => Number(p).toFixed(p % 1 === 0 ? 0 : 2);
  const parseDataMes = (dataMes) => {
    if (!dataMes) return null;
    const d = new Date(String(dataMes).slice(0, 10) + 'T00:00:00');
    return isNaN(d) ? null : d;
  };
  const mesTitulo = (dataMes) => {
    const d = parseDataMes(dataMes);
    if (!d) return '—';
    return `${MONTHS_PT[d.getMonth()]} de ${d.getFullYear()}`;
  };
  const mesDataCurta = (dataMes) => {
    const d = parseDataMes(dataMes);
    if (!d) return '';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const meses = Array.isArray(m.meses) ? m.meses : [];
  const mesesHtml = meses.length
    ? `
      <p class="section-hint">Cada bloco é um mês do período gerado: meta mensal, deduções aplicadas nesse mês e saldo restante.</p>
      <div class="meta-meses">
            ${meses.map(mm => {
              const alvo = Number(mm.valor_inicial) || 0;
              const saldo = Number(mm.valor_atual) || 0;
              const ded = Math.max(0, Number(mm.valor_deduzido || 0));
              const ganhoVar = Math.max(0, Number(mm.valor_melhorias || 0));
              const qtdMelhMes = Math.max(0, Number(mm.total_melhorias || 0));
              const nDed = Number(mm.total_deducoes || 0);
              const idx = Number(mm.mes_offset);
              const ordem = Number.isFinite(idx) ? idx + 1 : null;
              const pctMes = alvo > 0 ? Math.min(100, Math.max(0, (saldo / alvo) * 100)) : 0;
              const chipMes = ded > 0
                ? `<span class="tag" style="background:var(--danger-50);color:var(--danger);border:1px solid #fecaca">Com dedução</span>`
                : `<span class="tag" style="background:var(--success-50);color:var(--success);border:1px solid #a7f3d0">Saldo integral</span>`;
              const footDed = nDed > 0
                ? `<span><strong>${nDed}</strong> dedução(ões) neste mês</span>`
                : '<span>Nenhuma dedução neste mês</span>';
              return `
                <article class="meta-mes-card">
                  <div class="meta-mes-head">
                    <div class="meta-mes-title-wrap">
                      ${ordem != null ? `<span class="meta-mes-ord">Mês ${ordem} do período</span>` : ''}
                      <div class="meta-mes-name">${mesTitulo(mm.data_mes)}</div>
                      <div class="meta-mes-date">${mesDataCurta(mm.data_mes)} · referência ${escapeHtml(String(mm.data_mes || '').slice(0, 10))}</div>
                    </div>
                    <div class="meta-mes-badges">${chipMes}</div>
                  </div>
                  <div class="meta-mes-progress">
                    <div class="progress"><div class="progress-bar ${progressBarClass(pctMes)}" style="width:${pctMes}%"></div></div>
                    <div class="progress-meta">
                      <b>${pctMes.toFixed(1)}%</b> do alvo mensal ainda disponível
                    </div>
                  </div>
                  <div class="meta-mes-stats">
                    <div class="meta-mes-stat">
                      <span class="lbl">Meta do mês</span>
                      <span class="val">${isOperador() ? '100%' : fmtBRL(alvo)}</span>
                    </div>
                    <div class="meta-mes-stat" style="border-left:3px solid var(--success)">
                      <span class="lbl">Variável</span>
                      <span class="val">${ganhoVar > 0 ? (isOperador() ? `${qtdMelhMes} melhoria(s)` : `+${fmtBRL(ganhoVar)}`) : '—'}</span>
                    </div>
                    <div class="meta-mes-stat ded">
                      <span class="lbl">Deduzido</span>
                      <span class="val">${ded > 0 ? (isOperador() ? fmtPctGlobal(alvo > 0 ? (ded / alvo) * 100 : 0) : '−' + fmtBRL(ded)) : '—'}</span>
                    </div>
                    <div class="meta-mes-stat saldo">
                      <span class="lbl">Saldo</span>
                      <span class="val">${isOperador() ? fmtPctGlobal(pctMes) : fmtBRL(saldo)}</span>
                    </div>
                  </div>
                  <div class="meta-mes-foot">
                    ${footDed}
                    <span>${isOperador() ? `Saldo ${fmtPctGlobal(pctMes)} do mês` : `Alvo ${fmtBRL(alvo)} → restam ${fmtBRL(saldo)}`}</span>
                  </div>
                </article>`;
            }).join('')}
      </div>
    `
    : emptyState('Sem detalhamento mensal para esta meta');
  const dedsHtml = m.deducoes.length
    ? m.deducoes.map(d => {
        const pctBadge = d.percentual != null
          ? `<span class="tag" style="background:#eef2ff;color:var(--primary-600)">${fmtPct(d.percentual)}%</span>`
          : '';
        const dedTitulo = isOperador()
          ? (d.percentual != null ? `${pctBadge} Dedução aplicada` : 'Dedução aplicada')
          : `${pctBadge} ${fmtBRL(d.valor)}`;
        return `
      <div class="stack-item">
        <div class="body">
          <div class="title">${dedTitulo}</div>
          <div class="sub">${escapeHtml(d.motivo || 'Sem motivo')} · ${fmtDateTime(d.criado_em)}</div>
        </div>
        <span class="tag tag-${d.origem}">${d.origem}</span>
        ${m.status === 'aberta' && canDeleteDeducao() ? `<button class="icon-btn" title="Excluir dedução e restaurar saldo" onclick="delDeducao(${d.id}, ${m.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg></button>` : ''}
      </div>`;
      }).join('')
    : emptyState('Nenhuma dedução até o momento');

  const melhorias = Array.isArray(m.melhorias) ? m.melhorias : [];
  const melhoriasHtml = melhorias.length
    ? melhorias.map(mx => {
        const valorTxt = isOperador() ? `${mx.quantidade || 0} melhoria(s)` : `+${fmtBRL(mx.valor_total || 0)}`;
        const subMes = mx.mes_ano_melhoria ? ` · ${mx.mes_ano_melhoria}` : '';
        return `
      <div class="stack-item">
        <div class="body">
          <div class="title"><span class="tag" style="background:var(--success-50);color:var(--success);border:1px solid #a7f3d0">Melhoria</span> ${valorTxt}</div>
          <div class="sub">${escapeHtml(mx.motivo || 'Sem descrição')}${subMes} · ${fmtDateTime(mx.criado_em)}</div>
        </div>
      </div>`;
      }).join('')
    : emptyState('Nenhuma melhoria variável registrada até o momento');

  openDrawer(m.titulo, `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      <div class="avatar lg">${initials(m.funcionario_nome)}</div>
      <div>
        <div style="font-weight:600">${escapeHtml(m.funcionario_nome)}</div>
        <div class="muted" style="font-size:12px">@${escapeHtml(m.funcionario_usuario)}</div>
      </div>
      <div style="margin-left:auto"><span class="chip ${st.chip}">${st.label}</span></div>
    </div>

    ${m.descricao ? `<p style="margin:14px 0;color:var(--text-soft);font-size:13px">${escapeHtml(m.descricao)}</p>` : ''}

    <div class="progress" style="margin-top:14px"><div class="progress-bar ${progressBarClass(pct)}" style="width:${Math.min(100,Math.max(0,pct))}%"></div></div>
    <div class="progress-meta" style="margin-top:6px">
      <b>${isOperador() ? fmtPctGlobal(pct) : fmtBRL(m.valor_atual)}</b>
      <span>${isOperador() ? 'Saldo restante da meta' : `Alvo: ${fmtBRL(m.valor_inicial)} · ${pct.toFixed(1)}%`}</span>
    </div>

    <div class="drawer-section">
      <h4>Detalhes</h4>
      <div class="detail-row"><span class="k">Período</span><span class="v">${fmtDate(m.data_inicio)} → ${fmtDate(m.data_fim)}</span></div>
      <div class="detail-row"><span class="k">Trimestre</span><span class="v">${quarterOf(m.data_inicio)}</span></div>
      <div class="detail-row"><span class="k">Valor-alvo</span><span class="v">${isOperador() ? '100%' : fmtBRL(m.valor_inicial)}</span></div>
      <div class="detail-row"><span class="k">Saldo atual</span><span class="v">${isOperador() ? fmtPctGlobal(pct) : fmtBRL(m.valor_atual)}</span></div>
      <div class="detail-row"><span class="k">Total deduzido</span><span class="v" style="color:var(--danger)">${isOperador() ? fmtPctGlobal(dedPctTotal) : fmtBRL(m.valor_inicial - m.valor_atual)}</span></div>
      <div class="detail-row"><span class="k">Ganho variável no período</span><span class="v" style="color:var(--success)">${isOperador() ? `${Number(m.total_melhorias || 0)} melhoria(s)` : `+${fmtBRL(Number(m.total_variavel || 0))}`}</span></div>
      ${m.data_fechamento ? `<div class="detail-row"><span class="k">Fechada em</span><span class="v">${fmtDateTime(m.data_fechamento)}</span></div>` : ''}
      ${m.observacao_fechamento ? `<div class="detail-row"><span class="k">Observação</span><span class="v">${escapeHtml(m.observacao_fechamento)}</span></div>` : ''}
    </div>

    <div class="drawer-section">
      <h4>Metas por mês</h4>
      ${mesesHtml}
    </div>

    <div class="drawer-section">
      <h4>Ganhos variáveis (${melhorias.length})</h4>
      <div class="stack">${melhoriasHtml}</div>
    </div>

    <div class="drawer-section">
      <h4>Deduções (${m.deducoes.length})</h4>
      <div class="stack">${dedsHtml}</div>
    </div>

    <div class="drawer-actions">
      ${m.status === 'aberta' ? `
        ${canCreateMeta() ? `<button class="btn btn-success" onclick="registrarMelhoriaMeta(${m.id})">Registrar melhoria</button>` : ''}
        <button class="btn btn-primary" onclick="deduzirMeta(${m.id})">Registrar dedução</button>
        ${canManageData() ? `<button class="btn btn-success" onclick="fecharMeta(${m.id})">Fechar trimestre</button>` : ''}
      ` : `
        ${canManageData() ? `<button class="btn btn-ghost" onclick="reabrirMeta(${m.id})">Reabrir meta</button>` : ''}
      `}
      ${canDeleteMeta() ? `<button class="btn btn-danger" onclick="delMeta(${m.id})">Excluir</button>` : ''}
    </div>
  `);
};

window.registrarMelhoriaMeta = async id => {
  if (!canCreateMeta()) return toast('Sem permissão para registrar melhoria', 'error');
  const m = await api(`/api/metas/${id}`);
  if (m.status !== 'aberta') return toast('Só é possível lançar melhoria em metas abertas', 'error');

  const meses = Array.isArray(m.meses) ? m.meses : [];
  if (!meses.length) return toast('Esta meta não possui meses configurados', 'error');

  const hoje = new Date();
  const ymHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const mesAtual = meses.find(mm => String(mm.data_mes || '').slice(0, 7) === ymHoje) || meses[0];
  const defaultOffset = Number(mesAtual?.mes_offset ?? 0);

  const mesLabelCurto = data => {
    const d = new Date(String(data).slice(0, 10) + 'T00:00:00');
    if (isNaN(d)) return '—';
    return `${MONTHS_PT[d.getMonth()]}/${d.getFullYear()}`;
  };

  const opcoesMes = meses.map(mm => {
    const off = Number(mm.mes_offset);
    const sel = off === defaultOffset ? ' selected' : '';
    return `<option value="${off}"${sel}>Mês ${off + 1} · ${mesLabelCurto(mm.data_mes)}</option>`;
  }).join('');

  openDrawer('Registrar melhoria variável', `
    <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:14px;font-size:12.5px">
      <b>${escapeHtml(m.titulo)}</b> <span class="muted">· ${escapeHtml(m.funcionario_nome)}</span>
    </div>
    <div class="field">
      <label>Mês da melhoria</label>
      <select id="mx-mes" class="select" style="width:100%">${opcoesMes}</select>
    </div>
    <div class="form-grid-2">
      <div class="field">
        <label>Quantidade de melhorias</label>
        <input id="mx-qtd" type="number" min="1" step="1" value="1"/>
      </div>
      <div class="field">
        <label>Valor por melhoria (R$)</label>
        <input id="mx-unit" type="number" min="0.01" step="0.01" value="80"/>
      </div>
    </div>
    <div class="field">
      <small class="muted" id="mx-preview" style="display:block;margin-top:2px"></small>
    </div>
    <div class="field">
      <label>Descrição / motivo</label>
      <input id="mx-motivo" placeholder="Ex: Nova automação criada no sistema"/>
    </div>
    <div class="drawer-actions">
      <button class="btn btn-success" id="mx-save">Confirmar ganho variável</button>
      <button class="btn btn-ghost" onclick="closeDrawer()">Cancelar</button>
    </div>
  `);

  const qtdEl = document.getElementById('mx-qtd');
  const unitEl = document.getElementById('mx-unit');
  const prevEl = document.getElementById('mx-preview');
  const updatePreview = () => {
    const qtd = Math.max(1, Math.floor(Number(qtdEl.value) || 1));
    const unit = Math.max(0, Number(unitEl.value) || 0);
    const total = qtd * unit;
    prevEl.innerHTML = `Ganho variável calculado: <b style="color:var(--success)">+${fmtBRL(total)}</b> (${qtd} × ${fmtBRL(unit)})`;
  };
  qtdEl.addEventListener('input', updatePreview);
  unitEl.addEventListener('input', updatePreview);
  updatePreview();

  document.getElementById('mx-save').onclick = async () => {
    const quantidade = Math.max(1, Math.floor(Number(qtdEl.value) || 1));
    const valor_unitario = Number(unitEl.value);
    if (!(valor_unitario > 0)) return toast('Informe um valor unitário válido', 'error');
    const mes_offset = Number(document.getElementById('mx-mes').value);
    try {
      await api(`/api/metas/${id}/melhorias`, {
        method: 'POST',
        body: JSON.stringify({
          quantidade,
          valor_unitario,
          mes_offset,
          motivo: document.getElementById('mx-motivo').value
        })
      });
      toast('Melhoria variável registrada');
      await loadMetas();
      await loadDashboard();
      await verMeta(id);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
};

window.deduzirMeta = async id => {
  const m = await api(`/api/metas/${id}`);
  const meses = m.meses || [];
  const mesLabelCurto = data => {
    const d = new Date(String(data).slice(0, 10) + 'T00:00:00');
    if (isNaN(d)) return '—';
    return `${MONTHS_PT[d.getMonth()]}/${d.getFullYear()}`;
  };
  // Sugestão inicial (mesma regra do backend quando mes_offset não é enviado)
  const hoje = new Date();
  const ymHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const mesRef = meses.find(mm => mm.data_mes.slice(0, 7) === ymHoje)
              || meses.find(mm => mm.valor_atual > 0)
              || meses[meses.length - 1]
              || null;
  const defaultOffset = mesRef ? Number(mesRef.mes_offset) : (meses[0] != null ? Number(meses[0].mes_offset) : 0);

  const opcoesMes = meses.length
    ? meses.map(mm => {
        const off = Number(mm.mes_offset);
        const sel = off === defaultOffset ? ' selected' : '';
        const saldoZero = Number(mm.valor_atual) <= 0;
        const aviso = saldoZero ? ' (saldo zerado)' : '';
        const pctSaldo = Number(mm.valor_inicial) > 0 ? (Number(mm.valor_atual) / Number(mm.valor_inicial)) * 100 : 0;
        return `<option value="${off}"${sel}>Mês ${off + 1} · ${mesLabelCurto(mm.data_mes)} — ${isOperador() ? `saldo ${fmtPctGlobal(pctSaldo)}` : `meta ${fmtBRL(mm.valor_inicial)} · saldo ${fmtBRL(mm.valor_atual)}`}${aviso}</option>`;
      }).join('')
    : '';

  openDrawer('Registrar dedução', `
    <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:14px;font-size:12.5px">
      <b>${escapeHtml(m.titulo)}</b> <span class="muted">· ${escapeHtml(m.funcionario_nome)}</span>
    </div>
    ${meses.length ? `
    <div class="field">
      <label>Aplicar dedução no mês</label>
      <select id="d-mes" class="select" style="width:100%">${opcoesMes}</select>
      <small class="muted" id="d-mes-hint" style="display:block;margin-top:6px;font-size:12px;line-height:1.4"></small>
    </div>
    ` : '<p class="muted" style="font-size:13px;margin-bottom:14px">Esta meta não tem meses cadastrados; não é possível deduzir por mês.</p>'}
    <div class="field">
      <label>Percentual a deduzir (%)</label>
      <input id="d-pct" type="number" step="0.01" min="0.01" max="100" placeholder="Ex: 10" ${meses.length ? '' : 'disabled'}/>
      <small class="muted" id="d-pct-calc" style="display:block;margin-top:4px;font-size:12px;line-height:1.4">
        O percentual incide sobre o <b>valor-alvo (meta)</b> do mês escolhido.
      </small>
    </div>
    <div class="field"><label>Motivo</label><input id="d-motivo" placeholder="Ex: Erro operacional no pedido #1234"/></div>
    <div class="drawer-actions">
      <button class="btn btn-primary" id="d-save" ${meses.length ? '' : 'disabled'}>Confirmar dedução</button>
      <button class="btn btn-ghost" onclick="closeDrawer()">Cancelar</button>
    </div>
  `);

  const pctInput = document.getElementById('d-pct');
  const calcEl = document.getElementById('d-pct-calc');
  const mesSelect = document.getElementById('d-mes');
  const mesHintEl = document.getElementById('d-mes-hint');

  function mesSelecionado() {
    if (!mesSelect) return null;
    const off = Number(mesSelect.value);
    return meses.find(x => Number(x.mes_offset) === off) || null;
  }

  function atualizarPreview() {
    const mm = mesSelecionado();
    if (!mm) {
      if (mesHintEl) mesHintEl.textContent = '';
      calcEl.textContent = 'Escolha um mês com meta cadastrada.';
      return;
    }
    const alvoMes = Number(mm.valor_inicial) || 0;
    const saldoMes = Number(mm.valor_atual) || 0;
    if (mesHintEl) {
      mesHintEl.innerHTML = saldoMes <= 0
        ? '<span style="color:var(--warn)">Saldo deste mês já está zerado; a dedução não reduzirá mais o saldo.</span>'
        : (isOperador()
          ? `Alvo do mês: <b>100%</b> · Saldo atual: <b>${fmtPctGlobal(alvoMes > 0 ? (saldoMes / alvoMes) * 100 : 0)}</b>`
          : `Alvo do mês: <b>${fmtBRL(alvoMes)}</b> · Saldo atual: <b>${fmtBRL(saldoMes)}</b>`);
    }
    const p = Number(pctInput.value);
    if (alvoMes > 0 && p > 0) {
      const saldoPct = alvoMes > 0 ? (saldoMes / alvoMes) * 100 : 0;
      const saldoApos = Math.max(0, saldoPct - p);
      const extra = p > saldoPct && saldoPct > 0
        ? ' <span class="muted">(aplica até zerar o saldo do mês)</span>'
        : '';
      calcEl.innerHTML = isOperador()
        ? `Aplicando <b>${fmtPctGlobal(p, 2)}</b> · saldo estimado: <b style="color:var(--danger)">${fmtPctGlobal(saldoApos, 2)}</b>${extra}`
        : (() => {
            const v = Math.round(alvoMes * p / 100 * 100) / 100;
            const cap = Math.min(v, saldoMes);
            const ex = v > saldoMes && saldoMes > 0
              ? ` <span class="muted">(no máx. −${fmtBRL(cap)} até zerar o saldo)</span>`
              : '';
            return `<b>${p}%</b> de ${fmtBRL(alvoMes)} = <b style="color:var(--danger)">−${fmtBRL(v)}</b>${ex}`;
          })();
    } else if (alvoMes > 0) {
      calcEl.innerHTML = isOperador()
        ? 'Alvo do mês selecionado: <b>100%</b>. Informe o percentual acima.'
        : `Alvo do mês selecionado: <b>${fmtBRL(alvoMes)}</b>. Informe o percentual acima.`;
    } else {
      calcEl.textContent = 'Este mês não tem valor-alvo definido.';
    }
  }

  if (mesSelect) mesSelect.addEventListener('change', atualizarPreview);
  pctInput.addEventListener('input', atualizarPreview);
  atualizarPreview();

  document.getElementById('d-save').onclick = async () => {
    if (!meses.length) return;
    const mm = mesSelecionado();
    if (!mm) return toast('Selecione um mês válido', 'error');
    const p = Number(pctInput.value);
    if (!p || p <= 0) return toast('Informe um percentual válido', 'error');

    const alvoMes = Number(mm.valor_inicial) || 0;
    const saldoMes = Number(mm.valor_atual) || 0;
    const saldoPctDisponivel = alvoMes > 0 ? (saldoMes / alvoMes) * 100 : 0;
    if (saldoMes <= 0 || saldoPctDisponivel <= 0) {
      return toast('Este mês está zerado. Selecione outro mês com saldo disponível.', 'error');
    }
    if (p > saldoPctDisponivel) {
      const pendentePct = p - saldoPctDisponivel;
      const pendenteValor = alvoMes > 0 ? (alvoMes * pendentePct / 100) : 0;
      const disponivelTxt = isOperador()
        ? `${fmtPctGlobal(saldoPctDisponivel, 2)}`
        : `${fmtPctGlobal(saldoPctDisponivel, 2)} (${fmtBRL(saldoMes)})`;
      const pendenteTxt = isOperador()
        ? `${fmtPctGlobal(pendentePct, 2)}`
        : `${fmtPctGlobal(pendentePct, 2)} (${fmtBRL(pendenteValor)})`;

      const ok = await confirmDialog({
        title: 'Saldo insuficiente no mês selecionado',
        message: `Este mês tem disponível apenas ${disponivelTxt} para dedução.\nSe continuar, ficará pendente sem dedução: ${pendenteTxt}.\n\nDeseja deduzir apenas o saldo disponível deste mês?`,
        okText: 'Deduzir saldo disponível',
        cancelText: 'Escolher outro mês',
        variant: 'warn'
      });
      if (!ok) return;
    }

    try {
      await api(`/api/metas/${id}/deducoes`, { method: 'POST', body: JSON.stringify({
        percentual: p,
        motivo: document.getElementById('d-motivo').value,
        mes_offset: Number(mm.mes_offset),
      })});
      closeDrawer(); toast('Dedução registrada'); loadMetas(); loadDashboard();
    } catch (e) { toast(e.message, 'error'); }
  };
};

window.fecharMeta = id => {
  if (!canManageData()) return toast('Sem permissão para fechar meta', 'error');
  openDrawer('Fechamento de trimestre', `
    <p class="muted" style="margin-bottom:14px">
      O sistema avalia automaticamente o resultado com base no saldo final:
      <b style="color:var(--success)">Atingida</b> (≥100%),
      <b style="color:var(--warn)">Parcial</b> (≥60%),
      <b style="color:var(--danger)">Não atingida</b> (&lt;60%).
    </p>
    <div class="field"><label>Observação (opcional)</label><textarea id="c-obs" rows="4" placeholder="Justificativas, aprendizados, próximos passos..."></textarea></div>
    <div class="drawer-actions">
      <button class="btn btn-success" id="c-save">Confirmar fechamento</button>
      <button class="btn btn-ghost" onclick="closeDrawer()">Cancelar</button>
    </div>
  `);
  document.getElementById('c-save').onclick = async () => {
    try {
      await api(`/api/metas/${id}/fechar`, { method: 'POST', body: JSON.stringify({
        observacao: document.getElementById('c-obs').value,
      })});
      closeDrawer(); toast('Meta fechada'); loadMetas(); loadDashboard();
    } catch (e) { toast(e.message, 'error'); }
  };
};

window.reabrirMeta = async id => {
  if (!canManageData()) return toast('Sem permissão para reabrir meta', 'error');
  if (!await confirmDialog({ title: 'Reabrir meta?', message: 'A meta voltará ao status "aberta" e poderá receber novas deduções.', okText: 'Reabrir', variant: 'warn' })) return;
  try { await api(`/api/metas/${id}/reabrir`, { method: 'POST' }); toast('Reaberta'); closeDrawer(); loadMetas(); }
  catch (e) { toast(e.message, 'error'); }
};

window.delMeta = async id => {
  if (!canDeleteMeta()) return toast('Sem permissão para excluir meta', 'error');
  if (!await confirmDialog({ title: 'Excluir meta?', message: 'A meta e todas as suas deduções serão removidas permanentemente.', okText: 'Excluir', variant: 'danger' })) return;
  try { await api(`/api/metas/${id}`, { method: 'DELETE' }); toast('Excluída'); closeDrawer(); loadMetas(); }
  catch (e) { toast(e.message, 'error'); }
};

// ===================================================
// DEDUÇÕES
// ===================================================
function uniqueSortedValues(items, key) {
  const set = new Set(
    (items || [])
      .map(x => String(x?.[key] || '').trim())
      .filter(Boolean)
  );
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function monthInputToMesAno(value) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return null;
  return `${value.slice(5, 7)}/${value.slice(0, 4)}`;
}

document.getElementById('btn-deducao-lote').onclick = async () => {
  if (!hasUserPermission('deducao_gerar')) return toast('Sem permissão para dedução em lote', 'error');
  const funcs = await api('/api/funcionarios');
  const cargos = uniqueSortedValues(funcs, 'cargo');
  const unidades = uniqueSortedValues(funcs, 'unidade');
  const equipes = uniqueSortedValues(funcs, 'equipe');
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  openDrawer('Dedução em lote inteligente', `
    <div class="form-grid-2">
      <div class="field">
        <label>Cargo</label>
        <select id="dl-cargo" class="select" style="width:100%">
          <option value="">Todos</option>
          ${cargos.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Unidade</label>
        <select id="dl-unidade" class="select" style="width:100%">
          <option value="">Todas</option>
          ${unidades.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-grid-2">
      <div class="field">
        <label>Equipe</label>
        <select id="dl-equipe" class="select" style="width:100%">
          <option value="">Todas</option>
          ${equipes.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Período da meta (mês/ano)</label>
        <input id="dl-periodo" type="month" value="${ym}"/>
      </div>
    </div>
    <div class="form-grid-2">
      <div class="field">
        <label>Mês de dedução</label>
        <input id="dl-mes-ano" type="month" value="${ym}"/>
      </div>
      <div class="field">
        <label>Percentual da dedução (%)</label>
        <input id="dl-percentual" type="number" min="0.01" step="0.01" placeholder="Ex: 10"/>
      </div>
    </div>
    <div class="field">
      <label>Ocorrência / motivo (aplicado a todos)</label>
      <textarea id="dl-motivo" rows="2" placeholder="Ex: Erro recorrente de processo no período"></textarea>
    </div>

    <div id="dl-preview" style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;margin-bottom:14px">
      <div class="muted">Gere a pré-visualização para revisar metas aplicáveis antes de confirmar.</div>
    </div>

    <div class="drawer-actions">
      <button class="btn btn-ghost" id="dl-preview-btn">Gerar prévia</button>
      <button class="btn btn-success" id="dl-apply-btn" disabled>Aplicar dedução em lote</button>
      <button class="btn btn-ghost" onclick="closeDrawer()">Cancelar</button>
    </div>
  `);

  let ultimoPayload = null;
  let ultimaPrevia = null;

  const buildPayload = () => ({
    cargo: document.getElementById('dl-cargo').value || undefined,
    unidade: document.getElementById('dl-unidade').value || undefined,
    equipe: document.getElementById('dl-equipe').value || undefined,
    periodo: monthInputToMesAno(document.getElementById('dl-periodo').value),
    mes_ano: monthInputToMesAno(document.getElementById('dl-mes-ano').value),
    percentual: Number(document.getElementById('dl-percentual').value),
    motivo: document.getElementById('dl-motivo').value || null,
  });

  const previewEl = document.getElementById('dl-preview');
  const applyBtn = document.getElementById('dl-apply-btn');

  document.getElementById('dl-preview-btn').onclick = async () => {
    try {
      const payload = buildPayload();
      if (!(payload.percentual > 0)) return toast('Informe o percentual da dedução', 'error');
      if (!payload.periodo) return toast('Informe o período da meta', 'error');
      if (!payload.mes_ano) return toast('Informe o mês de dedução', 'error');

      const prev = await api('/api/deducoes/lote/preview', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      ultimoPayload = payload;
      ultimaPrevia = prev;
      applyBtn.disabled = !prev.total_aplicaveis;

      const amostra = (prev.aplicar || []).slice(0, 6);
      const ignorados = (prev.ignoradas || []).slice(0, 4);
      previewEl.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:10px">
          <div><b>${prev.total_metas_filtradas}</b> meta(s) filtrada(s)</div>
          <div><b style="color:var(--success)">${prev.total_aplicaveis}</b> aplicável(is)</div>
          <div><b style="color:var(--danger)">${prev.total_ignoradas}</b> ignorada(s)</div>
          <div>Total estimado: <b>${isOperador() ? fmtPctGlobal(prev.total_aplicaveis * payload.percentual, 0) : fmtBRL(prev.total_valor_deducao)}</b></div>
        </div>
        ${amostra.length ? `
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">Amostra das metas que receberão dedução:</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${amostra.map(x => `
              <div style="display:flex;justify-content:space-between;gap:8px;font-size:12.5px">
                <span>${escapeHtml(x.funcionario_nome)} <span class="muted">@${escapeHtml(x.funcionario_usuario)}</span></span>
                <span style="color:var(--danger)">${isOperador() ? `${Number(x.percentual).toFixed(x.percentual % 1 === 0 ? 0 : 2)}%` : '−' + fmtBRL(x.valor_deducao)}</span>
              </div>
            `).join('')}
          </div>
        ` : `<div class="muted">Nenhuma meta aplicável com os filtros informados.</div>`}
        ${ignorados.length ? `
          <div style="margin-top:10px;font-size:12px;color:var(--muted)">
            Ignorados: ${ignorados.map(x => `${escapeHtml(x.funcionario_nome)} (${escapeHtml(x.motivo)})`).join(' · ')}
          </div>
        ` : ''}
      `;
    } catch (e) {
      applyBtn.disabled = true;
      previewEl.innerHTML = `<div style="color:var(--danger)">${escapeHtml(e.message)}</div>`;
    }
  };

  applyBtn.onclick = async () => {
    if (!ultimoPayload || !ultimaPrevia?.total_aplicaveis) return;
    if (!await confirmDialog({
      title: 'Aplicar dedução em lote?',
      message: `Serão aplicadas ${ultimaPrevia.total_aplicaveis} dedução(ões) com ${ultimoPayload.percentual}% para o mês ${ultimoPayload.mes_ano}.`,
      okText: 'Aplicar',
      variant: 'warn',
    })) return;
    try {
      const resp = await api('/api/deducoes/lote/aplicar', {
        method: 'POST',
        body: JSON.stringify(ultimoPayload),
      });
      toast(`${resp.total_aplicadas} dedução(ões) aplicadas em lote`);
      closeDrawer();
      loadDeducoes();
      loadMetas();
      loadDashboard();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
};

async function loadDeducoes() {
  const thValor = document.querySelector('#view-deducoes .table thead th:nth-child(4)');
  if (thValor) thValor.textContent = isOperador() ? 'Percentual' : 'Valor';

  const rows = await api('/api/deducoes');
  const tbody = document.getElementById('tbl-deducoes');
  tbody.innerHTML = rows.length ? rows.map(d => `
    <tr>
      <td><span class="muted">${fmtDateTime(d.criado_em)}</span></td>
      <td>
        <div class="cell-user">
          <div class="avatar sm">${initials(d.funcionario_nome)}</div>
          <div><div class="name" style="font-size:13px">${escapeHtml(d.funcionario_nome)}</div><div class="u">@${escapeHtml(d.funcionario_usuario)}</div></div>
        </div>
      </td>
      <td>${escapeHtml(d.meta_titulo)}</td>
      <td>
        ${isOperador()
          ? (d.percentual != null
            ? `<b style="color:var(--danger)">${Number(d.percentual).toFixed(d.percentual % 1 === 0 ? 0 : 2)}%</b>`
            : '<span class="muted">Sem percentual</span>')
          : `${d.percentual != null ? `<span class="tag" style="background:#eef2ff;color:var(--primary-600);margin-right:6px">${Number(d.percentual).toFixed(d.percentual % 1 === 0 ? 0 : 2)}%</span>` : ''}
             <b style="color:var(--danger)">−${fmtBRL(d.valor)}</b>`}
      </td>
      <td><span class="muted">${escapeHtml(d.motivo || '-')}</span></td>
      <td><span class="tag tag-${d.origem}">${d.origem}</span></td>
      <td style="text-align:right">
        ${d.meta_status === 'fechada' || !canDeleteDeducao()
          ? '<span class="muted" title="Reabra a meta para excluir" style="font-size:12px">—</span>'
          : `<button class="btn btn-danger btn-sm" onclick="delDeducao(${d.id})">Excluir</button>`}
      </td>
    </tr>
  `).join('') : `<tr class="empty-row"><td colspan="7">Nenhuma dedução registrada ainda.</td></tr>`;
}

window.delDeducao = async (id, reopenMetaId) => {
  if (!canDeleteDeducao()) return toast('Sem permissão para excluir dedução', 'error');
  if (!await confirmDialog({ title: 'Excluir dedução?', message: 'O valor será restaurado no saldo da meta correspondente.', okText: 'Excluir', variant: 'warn' })) return;
  try {
    const res = await api(`/api/deducoes/${id}`, { method: 'DELETE' });
    toast('Dedução excluída · saldo restaurado');
    if (reopenMetaId) {
      // refresh drawer
      await verMeta(reopenMetaId);
    }
    loadDeducoes();
    loadMetas();
    loadDashboard();
  } catch (e) { toast(e.message, 'error'); }
};

// ===================================================
// API TESTER
// ===================================================
document.getElementById('btn-api-test').onclick = async () => {
  const resp = document.getElementById('api-resp');
  try {
    const mesAnoRaw = document.getElementById('api-mes-ano').value; // YYYY-MM
    const mesAno = mesAnoRaw ? `${mesAnoRaw.slice(5, 7)}/${mesAnoRaw.slice(0, 4)}` : undefined;
    const data = await api('/api/deducoes', { method: 'POST', body: JSON.stringify({
      usuario: document.getElementById('api-usuario').value,
      percentual: Number(document.getElementById('api-percentual').value),
      mes_ano: mesAno,
      motivo: document.getElementById('api-motivo').value,
    })});
    resp.textContent = JSON.stringify(data, null, 2);
    toast('Dedução aplicada via API');
  } catch (e) {
    resp.textContent = 'Erro: ' + e.message;
    toast(e.message, 'error');
  }
};

// ===================================================
// USUÁRIOS (somente admin)
// ===================================================
function permissionsFromUser(u = {}) {
  const allTrue = Object.fromEntries(USER_PERMISSION_KEYS.map(k => [k, true]));
  const fromUser = (u && typeof u.permissoes === 'object' && u.permissoes) ? u.permissoes : {};
  const merged = { ...allTrue, ...fromUser };
  return merged;
}

function usuarioFormBody(u = {}, funcionarios = []) {
  const perms = permissionsFromUser(u);
  const permsHtml = USER_PERMISSION_GROUPS.map(group => `
    <div class="perm-group">
      <div class="perm-group-title">${group.title}</div>
      <div class="perm-items">
        ${group.keys.map(k => `
          <label class="perm-item">
            <input type="checkbox" id="u-perm-${k}" ${perms[k] ? 'checked' : ''}/>
            <span>${USER_PERMISSION_LABELS[k]}</span>
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');
  return `
    <div class="field"><label>Nome</label><input id="u-nome" value="${escapeHtml(u.nome || '')}" placeholder="Nome completo"/></div>
    <div class="form-grid-2">
      <div class="field"><label>Usuário</label><input id="u-usuario" value="${escapeHtml(u.usuario || '')}" placeholder="usuario"/></div>
      <div class="field">
        <label>Tipo de acesso</label>
        <select id="u-tipo" class="select" style="width:100%">
          <option value="admin" ${u.tipo_acesso === 'admin' ? 'selected' : ''}>Administrador</option>
          <option value="gestor" ${u.tipo_acesso === 'gestor' ? 'selected' : ''}>Gestor</option>
          <option value="operador" ${u.tipo_acesso === 'operador' || !u.tipo_acesso ? 'selected' : ''}>Operador</option>
        </select>
      </div>
    </div>
    <div class="field">
      <label>Funcionário vinculado (opcional)</label>
      <select id="u-funcionario" class="select" style="width:100%">
        <option value="">Nenhum</option>
        ${funcionarios.map(f => `<option value="${f.id}" ${Number(u.funcionario_id) === Number(f.id) ? 'selected' : ''}>${escapeHtml(f.nome)} (@${escapeHtml(f.usuario)})</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>Status</label>
      <select id="u-ativo" class="select" style="width:100%">
        <option value="1" ${u.ativo !== false ? 'selected' : ''}>Ativo</option>
        <option value="0" ${u.ativo === false ? 'selected' : ''}>Inativo</option>
      </select>
    </div>
    <div class="field">
      <label>Permissões funcionais</label>
      <div class="perm-panel-actions">
        <button type="button" class="btn btn-ghost btn-sm" id="u-perm-all">Marcar todas</button>
        <button type="button" class="btn btn-ghost btn-sm" id="u-perm-none">Limpar</button>
      </div>
      <div class="perm-panel">
        ${permsHtml}
      </div>
      <small class="muted" style="display:block;margin-top:6px;font-size:12px">Use para habilitar/limitar ações no sistema para este usuário.</small>
    </div>
    ${u.id ? '' : `
      <div class="field">
        <label>Senha inicial</label>
        <input id="u-senha" type="password" placeholder="Mínimo 4 caracteres"/>
      </div>
    `}
  `;
}

function bindUserPermissionQuickActions() {
  const allBtn = document.getElementById('u-perm-all');
  const noneBtn = document.getElementById('u-perm-none');
  if (allBtn) {
    allBtn.onclick = () => {
      USER_PERMISSION_KEYS.forEach(k => {
        const el = document.getElementById(`u-perm-${k}`);
        if (el) el.checked = true;
      });
    };
  }
  if (noneBtn) {
    noneBtn.onclick = () => {
      USER_PERMISSION_KEYS.forEach(k => {
        const el = document.getElementById(`u-perm-${k}`);
        if (el) el.checked = false;
      });
    };
  }
}

function collectUserPermissionsFromForm() {
  const out = {};
  USER_PERMISSION_KEYS.forEach(k => {
    const el = document.getElementById(`u-perm-${k}`);
    out[k] = !!el?.checked;
  });
  return out;
}

async function loadUsuarios() {
  if (!canManageUsers()) {
    goto('dashboard');
    return toast('Somente administradores podem acessar usuários', 'error');
  }
  const rows = await api('/api/usuarios');
  const tbody = document.getElementById('tbl-usuarios');
  tbody.innerHTML = rows.length ? rows.map(u => `
    <tr>
      <td><b>${escapeHtml(u.nome)}</b></td>
      <td><code>@${escapeHtml(u.usuario)}</code></td>
      <td><span class="tag">${ACCESS_LABEL[u.tipo_acesso] || u.tipo_acesso}</span></td>
      <td>${u.ativo ? '<span class="tag" style="background:var(--success-50);color:var(--success)">Ativo</span>' : '<span class="tag" style="background:var(--danger-50);color:var(--danger)">Inativo</span>'}</td>
      <td>${u.funcionario_nome ? escapeHtml(u.funcionario_nome) : '<span class="muted">—</span>'}</td>
      <td><span class="muted">${fmtDate(u.criado_em)}</span></td>
      <td style="text-align:right;white-space:nowrap">
        ${canManageUsers() ? `<button class="btn btn-ghost btn-sm" onclick="editUsuario(${u.id})">Editar</button>` : ''}
        ${canManageUsers() ? `<button class="btn btn-ghost btn-sm" onclick="trocarSenhaUsuario(${u.id})">Senha</button>` : ''}
        ${canManageUsers() && session.user?.id !== u.id ? `<button class="btn btn-danger btn-sm" onclick="delUsuario(${u.id})">Excluir</button>` : ''}
      </td>
    </tr>
  `).join('') : `<tr class="empty-row"><td colspan="7">Nenhum usuário cadastrado.</td></tr>`;
}

document.getElementById('btn-novo-usuario').onclick = async () => {
  if (!canManageUsers()) return toast('Sem permissão para criar usuário', 'error');
  const funcs = await api('/api/funcionarios');
  openDrawer('Novo usuário', `
    ${usuarioFormBody({}, funcs)}
    <div class="drawer-actions">
      <button class="btn btn-primary" id="u-save">Salvar usuário</button>
      <button class="btn btn-ghost" onclick="closeDrawer()">Cancelar</button>
    </div>
  `);
  bindUserPermissionQuickActions();
  document.getElementById('u-save').onclick = async () => {
    try {
      await api('/api/usuarios', {
        method: 'POST',
        body: JSON.stringify({
          nome: document.getElementById('u-nome').value,
          usuario: document.getElementById('u-usuario').value,
          senha: document.getElementById('u-senha').value,
          tipo_acesso: document.getElementById('u-tipo').value,
          ativo: document.getElementById('u-ativo').value === '1',
          funcionario_id: Number(document.getElementById('u-funcionario').value) || null,
          permissoes: collectUserPermissionsFromForm(),
        })
      });
      closeDrawer();
      toast('Usuário criado');
      loadUsuarios();
    } catch (e) { toast(e.message, 'error'); }
  };
};

window.editUsuario = async id => {
  if (!canManageUsers()) return toast('Sem permissão para editar usuário', 'error');
  const [users, funcs] = await Promise.all([api('/api/usuarios'), api('/api/funcionarios')]);
  const u = users.find(x => x.id === id);
  if (!u) return toast('Usuário não encontrado', 'error');
  openDrawer('Editar usuário', `
    ${usuarioFormBody(u, funcs)}
    <div class="drawer-actions">
      <button class="btn btn-primary" id="u-save">Salvar alterações</button>
      <button class="btn btn-ghost" onclick="closeDrawer()">Cancelar</button>
    </div>
  `);
  bindUserPermissionQuickActions();
  document.getElementById('u-save').onclick = async () => {
    try {
      await api(`/api/usuarios/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          nome: document.getElementById('u-nome').value,
          usuario: document.getElementById('u-usuario').value,
          tipo_acesso: document.getElementById('u-tipo').value,
          ativo: document.getElementById('u-ativo').value === '1',
          funcionario_id: Number(document.getElementById('u-funcionario').value) || null,
          permissoes: collectUserPermissionsFromForm(),
        })
      });
      closeDrawer();
      toast('Usuário atualizado');
      loadUsuarios();
    } catch (e) { toast(e.message, 'error'); }
  };
};

window.trocarSenhaUsuario = async id => {
  if (!canManageUsers()) return toast('Sem permissão para alterar senha', 'error');
  openDrawer('Alterar senha', `
    <div class="field"><label>Nova senha</label><input id="u-new-pass" type="password" placeholder="Mínimo 4 caracteres"/></div>
    <div class="drawer-actions">
      <button class="btn btn-primary" id="u-save-pass">Salvar senha</button>
      <button class="btn btn-ghost" onclick="closeDrawer()">Cancelar</button>
    </div>
  `);
  document.getElementById('u-save-pass').onclick = async () => {
    try {
      await api(`/api/usuarios/${id}/senha`, {
        method: 'PUT',
        body: JSON.stringify({ senha: document.getElementById('u-new-pass').value })
      });
      closeDrawer();
      toast('Senha atualizada');
    } catch (e) { toast(e.message, 'error'); }
  };
};

window.delUsuario = async id => {
  if (!canManageUsers()) return toast('Sem permissão para excluir usuário', 'error');
  if (!await confirmDialog({ title: 'Excluir usuário?', message: 'Esta ação remove o acesso desse usuário ao sistema.', okText: 'Excluir', variant: 'danger' })) return;
  try {
    await api(`/api/usuarios/${id}`, { method: 'DELETE' });
    toast('Usuário excluído');
    loadUsuarios();
  } catch (e) { toast(e.message, 'error'); }
};

async function loadConfiguracoes() {
  if (!canManageConfig()) {
    goto('dashboard');
    return toast('Somente administradores podem acessar configurações', 'error');
  }
  await Promise.all([loadMetaConfig(), loadApiTokenConfig()]);
  const el = document.getElementById('cfg-meta-periodo');
  if (el) el.value = metaConfig.tipo_meta_periodo;
}

async function loadApiTokenConfig() {
  const statusEl = document.getElementById('cfg-api-token-status');
  const inputEl = document.getElementById('cfg-api-token');
  try {
    const cfg = await api('/api/configuracoes/api-token');
    if (statusEl) {
      statusEl.textContent = cfg.has_token
        ? `Status: configurado (${cfg.token_masked || 'chave ativa'})`
        : 'Status: não configurado';
    }
    if (inputEl) inputEl.value = '';
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Status: não foi possível carregar';
    throw e;
  }
}

document.getElementById('btn-salvar-config-meta').onclick = async () => {
  if (!canManageConfig()) return toast('Sem permissão para alterar configurações', 'error');
  const el = document.getElementById('cfg-meta-periodo');
  const tipo = String(el?.value || '').toLowerCase();
  try {
    await api('/api/configuracoes/meta-periodo', {
      method: 'PUT',
      body: JSON.stringify({ tipo_meta_periodo: tipo }),
    });
    await loadMetaConfig();
    toast(`Configuração salva: metas ${META_PERIOD_LABEL[metaConfig.tipo_meta_periodo]?.toLowerCase() || metaConfig.tipo_meta_periodo}`);
  } catch (e) {
    toast(e.message, 'error');
  }
};

document.getElementById('btn-salvar-config-api-token').onclick = async () => {
  if (!canManageConfig()) return toast('Sem permissão para alterar configurações', 'error');
  const token = String(document.getElementById('cfg-api-token')?.value || '').trim();
  if (token.length < 12) return toast('A chave fixa deve ter pelo menos 12 caracteres', 'error');
  try {
    await api('/api/configuracoes/api-token', {
      method: 'PUT',
      body: JSON.stringify({ api_token_fixo: token }),
    });
    await loadApiTokenConfig();
    toast('Chave fixa da API salva com sucesso');
  } catch (e) {
    toast(e.message, 'error');
  }
};

document.getElementById('btn-limpar-config-api-token').onclick = async () => {
  if (!canManageConfig()) return toast('Sem permissão para alterar configurações', 'error');
  if (!await confirmDialog({
    title: 'Remover chave fixa da API?',
    message: 'Integrações que usam essa chave deixarão de funcionar até configurar uma nova.',
    okText: 'Remover',
    variant: 'warn',
  })) return;
  try {
    await api('/api/configuracoes/api-token', {
      method: 'PUT',
      body: JSON.stringify({ api_token_fixo: '' }),
    });
    await loadApiTokenConfig();
    toast('Chave fixa removida');
  } catch (e) {
    toast(e.message, 'error');
  }
};

// ============ Loaders ============
// ===================================================
// FECHAMENTO (listagem + detalhes)
// ===================================================
function periodLabel(ano, mesInicial) {
  const startIdx = mesInicial - 1;
  const months = [0,1,2].map(i => {
    const m = (startIdx + i) % 12;
    const y = ano + Math.floor((startIdx + i) / 12);
    return `${MONTHS_PT[m].slice(0,3)}${y !== ano ? '/' + y : ''}`;
  });
  return `${months.join(' – ')} ${ano}`;
}

function periodLabelLong(ano, mesInicial) {
  const startIdx = mesInicial - 1;
  const months = [0,1,2].map(i => {
    const m = (startIdx + i) % 12;
    const y = ano + Math.floor((startIdx + i) / 12);
    return `${MONTHS_PT[m]}${y !== ano ? '/' + y : ''}`;
  });
  return `${months.join(' · ')} de ${ano}`;
}

// LISTA
async function loadFechamento() {
  showFcListMode();
  const thAlvo = document.querySelector('#fc-list-mode .table thead th:nth-child(5)');
  const thDed = document.querySelector('#fc-list-mode .table thead th:nth-child(6)');
  const thRec = document.querySelector('#fc-list-mode .table thead th:nth-child(7)');
  if (thAlvo) thAlvo.textContent = isOperador() ? 'Base' : 'Valor-alvo';
  if (thDed) thDed.textContent = isOperador() ? 'Dedução (%)' : 'Deduções';
  if (thRec) thRec.textContent = isOperador() ? 'Saldo (%)' : 'Total a pagar';

  const rows = await api('/api/fechamentos');
  const tbody = document.getElementById('fc-list-tbody');
  tbody.innerHTML = rows.length ? rows.map(f => `
    <tr style="cursor:pointer" onclick="verFechamento(${f.id})">
      <td><b>${periodLabel(f.ano, f.mes_inicial)}</b></td>
      <td><span class="muted">${fmtDateTime(f.criado_em)}</span></td>
      <td>${f.total_funcionarios}</td>
      <td>${f.total_metas}</td>
      <td style="text-align:right">${isOperador() ? '100%' : fmtBRL(f.total_alvo)}</td>
      <td style="text-align:right;color:var(--danger)">${isOperador() ? fmtPctGlobal(pctOf(f.total_deduzido, f.total_alvo)) : '−' + fmtBRL(f.total_deduzido)}</td>
      <td style="text-align:right;font-weight:700;color:var(--success)">${isOperador() ? fmtPctGlobal(pctOf(f.total_a_receber, f.total_alvo)) : fmtBRL(f.total_a_receber)}</td>
      <td style="text-align:right" onclick="event.stopPropagation()">
        <button class="btn btn-ghost btn-sm" onclick="verFechamento(${f.id})">Ver</button>
      </td>
    </tr>
  `).join('') : `<tr class="empty-row"><td colspan="8">Nenhum fechamento executado. Clique em "Novo fechamento" para começar.</td></tr>`;
}

function showFcListMode() {
  document.getElementById('fc-list-mode').classList.remove('hidden');
  document.getElementById('fc-detail-mode').classList.add('hidden');
}
function showFcDetailMode() {
  document.getElementById('fc-list-mode').classList.add('hidden');
  document.getElementById('fc-detail-mode').classList.remove('hidden');
}

document.getElementById('btn-fc-back').onclick = () => { localStorage.removeItem(LS_FECH); loadFechamento(); };

// DRAWER: Novo fechamento
document.getElementById('btn-novo-fechamento').onclick = () => {
  if (!canCreateFechamento()) return toast('Sem permissão para executar fechamento', 'error');
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentQ = Math.floor(today.getMonth() / 3) + 1;
  const years = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1];
  const autoGerarMetaPref = localStorage.getItem(LS_AUTO_META_FECH) !== '0';

  openDrawer('Novo fechamento', `
    <div class="form-grid-2">
      <div class="field"><label>Ano</label>
        <select id="nf-ano" class="select" style="width:100%">
          ${years.map(y => `<option value="${y}" ${y===currentYear?'selected':''}>${y}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Trimestre</label>
        <select id="nf-trimestre" class="select" style="width:100%">
          ${QUARTERS.map(q => `<option value="${q.startMonth}" ${q.q===currentQ?'selected':''}>${q.label}</option>`).join('')}
          <option value="custom">Personalizado…</option>
        </select>
      </div>
    </div>
    <div class="field hidden" id="nf-custom-wrap">
      <label>Mês inicial</label>
      <select id="nf-mes" class="select" style="width:100%">
        ${MONTHS_PT.map((m,i) => `<option value="${i}">${m}</option>`).join('')}
      </select>
    </div>

    <div class="field"><label>Observação (opcional)</label>
      <textarea id="nf-obs" rows="2" placeholder="Notas internas deste fechamento..."></textarea>
    </div>
    <div class="field">
      <label>Automação do próximo ciclo</label>
      <label class="auto-meta-card" for="nf-auto-meta">
        <input type="checkbox" id="nf-auto-meta" ${autoGerarMetaPref ? 'checked' : ''}/>
        <div class="auto-meta-text">
          <div class="auto-meta-title">Gerar metas automaticamente no próximo período</div>
          <div class="auto-meta-sub">Ao concluir este fechamento, o sistema cria metas conforme a periodicidade configurada para o próximo ciclo.</div>
        </div>
      </label>
    </div>

    <div id="nf-preview" style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;margin-bottom:14px;font-size:13px"></div>

    <div class="drawer-actions">
      <button class="btn btn-success" id="nf-save">Executar fechamento</button>
      <button class="btn btn-ghost" onclick="closeDrawer()">Cancelar</button>
    </div>
  `);

  const anoEl = document.getElementById('nf-ano');
  const triEl = document.getElementById('nf-trimestre');
  const customWrap = document.getElementById('nf-custom-wrap');
  const mesEl = document.getElementById('nf-mes');
  const preview = document.getElementById('nf-preview');
  const autoMetaEl = document.getElementById('nf-auto-meta');
  autoMetaEl?.addEventListener('change', () => {
    localStorage.setItem(LS_AUTO_META_FECH, autoMetaEl.checked ? '1' : '0');
  });

  function resolveStart() {
    if (triEl.value === 'custom') return Number(mesEl.value);
    return Number(triEl.value);
  }
  async function refreshPreview() {
    customWrap.classList.toggle('hidden', triEl.value !== 'custom');
    const ano = Number(anoEl.value);
    const startIdx = resolveStart();
    const mesInicial = startIdx + 1;
    preview.innerHTML = `<div class="muted">📅 ${periodLabelLong(ano, mesInicial)}</div><div style="margin-top:6px">Carregando prévia...</div>`;
    try {
      const data = await api(`/api/fechamentos/preview?ano=${ano}&mes_inicial=${mesInicial}`);
      if (!data.total_metas) {
        preview.innerHTML = `<div class="muted">📅 ${periodLabelLong(ano, mesInicial)}</div>
          <div style="margin-top:8px;color:var(--warn)">⚠ Nenhuma meta encontrada neste período</div>`;
        document.getElementById('nf-save').disabled = true;
        return;
      }
      document.getElementById('nf-save').disabled = false;
      preview.innerHTML = `
        <div class="muted" style="margin-bottom:8px">📅 ${periodLabelLong(ano, mesInicial)}</div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px">
          <div><b>${data.total_funcionarios}</b> funcionário(s)</div>
          <div><b>${data.total_metas}</b> meta(s) · ${data.metas_abertas} aberta(s)</div>
          <div>Alvo: <b>${fmtBRL(data.total_alvo)}</b></div>
          <div>Deduções: <b style="color:var(--danger)">${fmtBRL(data.total_deduzido)}</b></div>
          <div style="grid-column:span 2;padding-top:6px;border-top:1px solid var(--border);margin-top:4px">
            <b>Total a pagar: <span style="color:var(--success)">${fmtBRL(data.total_a_receber)}</span></b>
          </div>
        </div>`;
    } catch (e) {
      preview.innerHTML = `<div style="color:var(--danger)">Erro: ${e.message}</div>`;
    }
  }
  [anoEl, triEl, mesEl].forEach(el => el.addEventListener('change', refreshPreview));
  refreshPreview();

  document.getElementById('nf-save').onclick = async () => {
    const ano = Number(anoEl.value);
    const mesInicial = resolveStart() + 1;
    if (!await confirmDialog({ title: 'Executar fechamento?', message: `Período: ${periodLabelLong(ano, mesInicial)}\n\nTodas as metas abertas do período serão fechadas automaticamente.`, okText: 'Executar', variant: 'success' })) return;
    try {
      const fech = await api('/api/fechamentos', {
        method: 'POST',
        body: JSON.stringify({
          ano,
          mes_inicial: mesInicial,
          observacao: document.getElementById('nf-obs').value,
          gerar_proximo_trimestre: !!autoMetaEl?.checked
        })
      });
      closeDrawer();
      if (fech.auto_metas?.erro) {
        toast(`Fechamento executado. Auto-geração de metas falhou: ${fech.auto_metas.erro}`, 'error');
      } else if (fech.auto_metas) {
        const a = fech.auto_metas;
        const msg = a.total_criadas
          ? `Fechamento executado. Próximo período: ${a.total_criadas} meta(s) gerada(s).`
          : 'Fechamento executado. Nenhuma nova meta automática foi gerada para o próximo período.';
        toast(msg);
      } else {
        toast('Fechamento executado');
      }
      verFechamento(fech.id);
      loadDashboard();
    } catch (e) { toast(e.message, 'error'); }
  };
};

// DETALHES do fechamento
window.verFechamento = async id => {
  let f;
  try { f = await api(`/api/fechamentos/${id}`); }
  catch (e) { localStorage.removeItem(LS_FECH); return loadFechamento(); }
  localStorage.setItem(LS_FECH, id);
  showFcDetailMode();

  document.getElementById('fc-detail-title').textContent = `Fechamento · ${periodLabel(f.ano, f.mes_inicial)}`;
  document.getElementById('fc-detail-sub').textContent = `Executado em ${fmtDateTime(f.criado_em)}`;
  document.getElementById('print-period').textContent = `Período: ${periodLabelLong(f.ano, f.mes_inicial)}`;
  document.getElementById('print-emitted').textContent = fmtDateTime(f.criado_em);

  const thAlvo = document.querySelector('#fc-detail-table thead th:nth-child(4)');
  const thDed = document.querySelector('#fc-detail-table thead th:nth-child(5)');
  const thRec = document.querySelector('#fc-detail-table thead th:nth-child(6)');
  if (thAlvo) thAlvo.textContent = isOperador() ? 'Base' : 'Valor-alvo';
  if (thDed) thDed.textContent = isOperador() ? 'Deduzido (%)' : 'Deduzido';
  if (thRec) thRec.textContent = isOperador() ? 'Saldo (%)' : 'A receber';

  document.getElementById('fc-detail-kpis').innerHTML = `
    <div class="kpi">
      <div class="kpi-head"><span class="kpi-label">Funcionários</span></div>
      <div class="kpi-value">${f.total_funcionarios}</div>
    </div>
    <div class="kpi">
      <div class="kpi-head"><span class="kpi-label">Metas</span></div>
      <div class="kpi-value">${f.total_metas}</div>
    </div>
    <div class="kpi">
      <div class="kpi-head"><span class="kpi-label">Valor-alvo</span></div>
      <div class="kpi-value">${isOperador() ? '100%' : fmtBRL(f.total_alvo)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-head"><span class="kpi-label">Deduções</span></div>
      <div class="kpi-value" style="color:var(--danger)">${isOperador() ? fmtPctGlobal(pctOf(f.total_deduzido, f.total_alvo)) : fmtBRL(f.total_deduzido)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-head"><span class="kpi-label">Total pago</span></div>
      <div class="kpi-value" style="color:var(--success)">${isOperador() ? fmtPctGlobal(pctOf(f.total_a_receber, f.total_alvo)) : fmtBRL(f.total_a_receber)}</div>
    </div>
  `;

  const tbody = document.getElementById('fc-detail-tbody');
  if (!f.itens.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Sem itens registrados.</td></tr>`;
    document.getElementById('fc-detail-tfoot').innerHTML = '';
  } else {
    tbody.innerHTML = f.itens.map(it => `
      <tr>
        <td>
          <div class="cell-user">
            <div class="avatar sm">${initials(it.funcionario_nome)}</div>
            <div>
              <div class="name">${escapeHtml(it.funcionario_nome)}</div>
              <div class="u">@${escapeHtml(it.funcionario_usuario)}${it.funcionario_cargo ? ' · ' + escapeHtml(it.funcionario_cargo) : ''}</div>
            </div>
          </div>
        </td>
        <td>
          <div style="font-weight:600">${escapeHtml(it.meta_titulo)}</div>
          <div class="muted" style="font-size:12px">${fmtDate(it.data_inicio)} → ${fmtDate(it.data_fim)}</div>
        </td>
        <td style="text-align:center">${it.total_deducoes}</td>
        <td style="text-align:right">${isOperador() ? '100%' : fmtBRL(it.valor_inicial)}</td>
        <td style="text-align:right;color:var(--danger)">${isOperador() ? fmtPctGlobal(pctOf(it.valor_deduzido, it.valor_inicial)) : '−' + fmtBRL(it.valor_deduzido)}</td>
        <td style="text-align:right;font-weight:700;color:var(--success)">${isOperador() ? fmtPctGlobal(pctOf(it.valor_atual, it.valor_inicial)) : fmtBRL(it.valor_atual)}</td>
        <td>${it.resultado ? `<span class="chip chip-${it.resultado}">${it.resultado.replace('_',' ')}</span>` : '<span class="muted">-</span>'}</td>
      </tr>
    `).join('');

    document.getElementById('fc-detail-tfoot').innerHTML = `
      <tr class="fc-total-row">
        <td colspan="3" style="text-align:right">TOTAL GERAL</td>
        <td style="text-align:right">${isOperador() ? '100%' : fmtBRL(f.total_alvo)}</td>
        <td style="text-align:right;color:var(--danger)">${isOperador() ? fmtPctGlobal(pctOf(f.total_deduzido, f.total_alvo)) : '−' + fmtBRL(f.total_deduzido)}</td>
        <td style="text-align:right;color:var(--success)">${isOperador() ? fmtPctGlobal(pctOf(f.total_a_receber, f.total_alvo)) : fmtBRL(f.total_a_receber)}</td>
        <td></td>
      </tr>`;
  }

  document.getElementById('btn-print').onclick = () => window.print();
  document.getElementById('btn-fc-delete').classList.toggle('hidden', !canDeleteFechamento());
  document.getElementById('btn-fc-delete').onclick = async () => {
    if (!canDeleteFechamento()) return toast('Sem permissão para excluir fechamento', 'error');
    if (!await confirmDialog({ title: 'Excluir fechamento?', message: 'O registro será removido, mas as metas permanecerão fechadas.', okText: 'Excluir', variant: 'danger' })) return;
    try {
      await api(`/api/fechamentos/${id}`, { method: 'DELETE' });
      toast('Fechamento excluído');
      loadFechamento();
    } catch (e) { toast(e.message, 'error'); }
  };
};

const loaders = {
  dashboard: loadDashboard,
  funcionarios: loadFuncionarios,
  metas: () => { loadFuncSelects(); loadMetas(); },
  deducoes: loadDeducoes,
  fechamento: loadFechamento,
  usuarios: loadUsuarios,
  configuracoes: loadConfiguracoes,
  api: () => {},
};

// boot — valida sessão e restaura última tela
(async function boot() {
  if (!session.token) {
    showLogin(true);
    return;
  }
  try {
    const me = await api('/api/auth/me');
    session.user = me;
    localStorage.setItem(LS_USER, JSON.stringify(me));
    await loadMetaConfig();
    showApp();
    const lastView = localStorage.getItem(LS_VIEW);
    const valid = lastView && loaders[lastView];
    const blocked = (lastView === 'usuarios' && !canManageUsers()) || (lastView === 'configuracoes' && !canManageConfig());
    const safeView = (valid && !blocked) ? lastView : 'dashboard';
    goto(safeView);
    if (safeView === 'fechamento') {
      const lastFech = localStorage.getItem(LS_FECH);
      if (lastFech) verFechamento(Number(lastFech));
    }
  } catch {
    clearSession();
    showLogin();
  }
})();
