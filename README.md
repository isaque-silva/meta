# 🎯 Sistema de Metas de Funcionários

Plataforma web completa para gestão de metas trimestrais de funcionários, com API pública para deduções automáticas.

## ✨ Funcionalidades

- **Autenticação com login** (usuário/senha) e sessão por token
- **Gestão de usuários da aplicação** (criação, edição, senha e status)
- **Tipos de acesso**: `admin`, `gestor`, `operador`
- **Cadastro de funcionários** (nome, usuário único, cargo)
- **Lançamento de metas trimestrais** — data fim calculada automaticamente (3 meses)
- **Dedução manual** de valores via UI
- **API pública** para dedução via nome de usuário (integração com outros sistemas)
- **Fechamento de meta** a cada 3 meses com avaliação automática:
  - ≥ 100% → `atingida`
  - ≥ 60%  → `parcial`
  - < 60%  → `nao_atingida`
- **Dashboard** com visão geral
- **Histórico completo** de deduções (origem: manual ou API)
- **Reabertura** de meta fechada

## 🚀 Como rodar

Defina as variáveis de conexão MySQL (exemplo):

```bash
export DB_CLIENT=mysql
export MYSQL_HOST=127.0.0.1
export MYSQL_PORT=3306
export MYSQL_DATABASE=metas_app
export MYSQL_USER=metas
export MYSQL_PASSWORD=metas123
```

```bash
npm install
npm start
```

Abra: http://localhost:3000

> Banco MySQL é inicializado automaticamente na primeira execução.
> Usuário padrão de primeiro acesso: `admin` / `admin123` (altere após entrar).

## 🐳 Docker / Dokploy

### Usando Docker Compose

```bash
docker compose up -d --build
```

A aplicação ficará em `http://localhost:3000`.

No Dokploy, ao fazer deploy via `docker-compose.yml`, serão criados **2 containers juntos**:
- `metas-app` (aplicação)
- `mysql` (banco)

### Variáveis importantes

- `DB_CLIENT` (use `mysql`)
- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_DATABASE`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `AUTH_TOKEN_SECRET` (obrigatório em produção)
- `AUTH_TOKEN_TTL_HOURS`
- `DEFAULT_ADMIN_USER`
- `DEFAULT_ADMIN_PASSWORD`

O `docker-compose.yml` já sobe um serviço MySQL com volume persistente (`metas_mysql_data`).
Para produção, sobrescreva principalmente:
- `MYSQL_ROOT_PASSWORD`
- `MYSQL_PASSWORD`
- `AUTH_TOKEN_SECRET`

## 🔐 Autenticação

- `POST /api/auth/login` — gera token
- `GET /api/auth/me` — usuário logado
- `POST /api/auth/logout` — encerra sessão no cliente
- Para as demais rotas `/api/*`, envie `Authorization: Bearer <token>`
- Integração: é possível configurar uma **chave fixa da API** na tela `Configurações` e usar em:
  - `Authorization: Bearer <chave_fixa>`
  - ou `x-api-key: <chave_fixa>`
  - (habilitado para `POST /api/deducoes`)

## 🔌 API pública — dedução por usuário

**POST** `/api/deducoes`

```json
{
  "usuario": "joao.silva",
  "valor": 50.00,
  "motivo": "Erro de lançamento no pedido #1234"
}
```

A dedução é aplicada à **meta aberta mais recente** do funcionário.

### Exemplo cURL

```bash
curl -X POST http://localhost:3000/api/deducoes \
  -H "Content-Type: application/json" \
  -d '{"usuario":"joao.silva","valor":50,"motivo":"Erro"}'
```

### Resposta

```json
{
  "ok": true,
  "funcionario": { "id": 1, "nome": "João Silva", "usuario": "joao.silva" },
  "meta": {
    "id": 10,
    "titulo": "Meta Q1",
    "valor_inicial": 10000,
    "valor_anterior": 9500,
    "valor_deduzido": 50,
    "valor_atual": 9450
  },
  "motivo": "Erro"
}
```

## 📚 Demais endpoints

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/usuarios` | Lista usuários (admin) |
| POST | `/api/usuarios` | Cria usuário (admin) |
| PUT | `/api/usuarios/:id` | Atualiza usuário (admin) |
| PUT | `/api/usuarios/:id/senha` | Troca senha (admin) |
| DELETE | `/api/usuarios/:id` | Remove usuário (admin) |
| GET | `/api/funcionarios` | Lista funcionários |
| POST | `/api/funcionarios` | Cria funcionário |
| PUT | `/api/funcionarios/:id` | Atualiza |
| DELETE | `/api/funcionarios/:id` | Remove |
| GET | `/api/metas?status=&funcionario_id=` | Lista metas |
| GET | `/api/metas/:id` | Detalhes + deduções |
| POST | `/api/metas` | Cria meta (3 meses auto) |
| PUT | `/api/metas/:id` | Atualiza (somente abertas) |
| DELETE | `/api/metas/:id` | Remove |
| POST | `/api/metas/:id/fechar` | Fecha trimestre |
| POST | `/api/metas/:id/reabrir` | Reabre |
| POST | `/api/metas/:id/deducoes` | Dedução manual |
| GET | `/api/deducoes` | Histórico (últimas 200) |
| GET | `/api/dashboard` | Totais agregados |

## 🗂 Estrutura

```
.
├── server.js        # API Express
├── db_mysql.js      # MySQL schema e bootstrap
├── package.json
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── README.md
```

## 🛡 Stack

- Node.js + Express
- MySQL
- Frontend: HTML/CSS/JS puro, UI dark moderna
