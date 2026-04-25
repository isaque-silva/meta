FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Instala dependencias primeiro para aproveitar cache de camadas
COPY package*.json ./
RUN npm ci --omit=dev

# Copia codigo da aplicacao
COPY . .

# Pasta de dados do SQLite (volume recomendado em producao)
RUN mkdir -p /app/data

EXPOSE 3000

# Permite sobrescrever porta/token/db no ambiente do Dokploy
ENV PORT=3000
ENV DB_PATH=/app/data/metas.db

CMD ["npm", "start"]
