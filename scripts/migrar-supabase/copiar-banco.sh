#!/usr/bin/env bash
# Copia o banco do projeto atual para o novo. Roda na VPS (tem Docker e rota até os dois).
# Uso: ORIGEM_URL=... DESTINO_URL=... ./copiar-banco.sh
# Só LÊ a origem. No destino, recria o schema public do zero (o projeto novo está vazio).
set -euo pipefail
: "${ORIGEM_URL:?ORIGEM_URL (DATABASE_URL atual, session pooler 5432)}"
: "${DESTINO_URL:?DESTINO_URL (banco novo, session pooler 5432)}"
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT
PG=postgres:17-alpine

echo "== dump da origem (public, drizzle)"
docker run --rm -v "$DIR:/d" -e U="$ORIGEM_URL" $PG sh -c \
  'pg_dump "$U" --schema=public --schema=drizzle --no-owner --no-privileges --no-publications --no-subscriptions -Fc -f /d/app.dump'
echo "== dump dos logins (auth.users, auth.identities — só dados)"
docker run --rm -v "$DIR:/d" -e U="$ORIGEM_URL" $PG sh -c \
  'pg_dump "$U" --data-only --table=auth.users --table=auth.identities --no-owner --no-privileges -Fc -f /d/auth.dump'
ls -la "$DIR"

echo "== extensões usadas pelo app no destino"
docker run --rm $PG psql "$DESTINO_URL" -X -v ON_ERROR_STOP=1 -c \
  'create extension if not exists pg_trgm with schema extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists "uuid-ossp" with schema extensions;'

echo "== restaura app no destino (schema public recriado)"
docker run --rm $PG psql "$DESTINO_URL" -X -v ON_ERROR_STOP=1 -c \
  'drop schema if exists drizzle cascade; drop schema if exists public cascade; create schema public; grant usage on schema public to postgres, anon, authenticated, service_role; grant all on schema public to postgres, service_role;'
docker run --rm -v "$DIR:/d" -e U="$DESTINO_URL" $PG sh -c \
  'pg_restore -d "$U" --no-owner --no-privileges --exit-on-error /d/app.dump'

echo "== restaura logins no destino (limpa os de teste do projeto novo antes)"
docker run --rm $PG psql "$DESTINO_URL" -X -v ON_ERROR_STOP=1 -c 'delete from auth.identities; delete from auth.users;'
docker run --rm -v "$DIR:/d" -e U="$DESTINO_URL" $PG sh -c \
  'pg_restore -d "$U" --data-only --no-owner --no-privileges --exit-on-error /d/auth.dump'
echo "== ok"
