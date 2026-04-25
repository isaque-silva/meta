FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Ferramenta para esperar o MySQL ficar disponível
RUN apt-get update \
  && apt-get install -y --no-install-recommends netcat-openbsd \
  && rm -rf /var/lib/apt/lists/*

# Instala dependencias primeiro para aproveitar cache de camadas
COPY package*.json ./
RUN npm ci --omit=dev

# Copia codigo da aplicacao
COPY . .
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

# Configuração padrão (sobrescreva no Dokploy)
ENV PORT=3000
ENV DB_CLIENT=mysql
ENV MYSQL_HOST=mysql
ENV MYSQL_PORT=3306
ENV MYSQL_DATABASE=metas_app
ENV MYSQL_USER=metas

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "start"]
