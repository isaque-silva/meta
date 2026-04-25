FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Instala dependencias primeiro para aproveitar cache de camadas
COPY package*.json ./
RUN npm ci --omit=dev

# Copia codigo da aplicacao
COPY . .

EXPOSE 3000

# Configuração padrão (sobrescreva no Dokploy)
ENV PORT=3000
ENV DB_CLIENT=mysql
ENV MYSQL_HOST=mysql
ENV MYSQL_PORT=3306
ENV MYSQL_DATABASE=metas_app
ENV MYSQL_USER=metas
ENV MYSQL_PASSWORD=metas123

CMD ["npm", "start"]
