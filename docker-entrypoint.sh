#!/bin/sh
set -eu

if [ "${DB_CLIENT:-mysql}" = "mysql" ]; then
  DB_HOST="${MYSQL_HOST:-mysql}"
  DB_PORT="${MYSQL_PORT:-3306}"
  echo "Aguardando MySQL em ${DB_HOST}:${DB_PORT}..."

  i=0
  until nc -z "$DB_HOST" "$DB_PORT"; do
    i=$((i + 1))
    if [ "$i" -ge 60 ]; then
      echo "MySQL não ficou disponível a tempo." >&2
      exit 1
    fi
    sleep 2
  done
  echo "MySQL disponível. Iniciando aplicação..."
fi

exec "$@"
