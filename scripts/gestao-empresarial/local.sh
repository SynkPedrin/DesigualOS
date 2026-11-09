#!/usr/bin/env bash
# Gestão Empresarial: ambiente 100% LOCAL (banco, redis, login falso, API e front).
#   scripts/gestao-empresarial/local.sh up | down | status | logs <auth|api|web>
#
# Nada aqui toca produção: o banco é um container próprio em 127.0.0.1:55440, o login é falso
# (auth-local.mjs) e os processos sobem com ambiente LIMPO (env -i), sem herdar nenhuma credencial
# do seu shell. Se achar um .env com credenciais neste checkout, RECUSA rodar (a API e o banco o
# carregariam por conta própria): use um worktree sem .env.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ESTADO="$RAIZ/.gestao-local"
PG_NOME=gestao-empresarial-pg
REDIS_NOME=gestao-empresarial-redis
PORTA_PG=55440 PORTA_REDIS=6391 PORTA_AUTH=4211 PORTA_API=4210 PORTA_WEB=3210
DB_URL="postgres://postgres:gestao_local_dev@127.0.0.1:${PORTA_PG}/gestao_empresarial"
ORG_ID=00000000-0000-4000-8000-0000000000c0

recusar_se_houver_env() {
  for f in "$RAIZ/.env" "$RAIZ/apps/web/.env" "$RAIZ/apps/web/.env.local" "$RAIZ/apps/api/.env"; do
    if [ -e "$f" ]; then
      echo "RECUSADO: existe $f (credenciais reais seriam carregadas pelos processos locais)." >&2
      echo "Rode a partir de um worktree sem .env (ex.: .claude/worktrees/gestao-empresarial)." >&2
      exit 1
    fi
  done
}

porta_ocupada() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
esperar_porta() { for _ in $(seq 1 90); do porta_ocupada "$1" && return 0; sleep 1; done; echo "A porta $1 não abriu; veja $ESTADO/logs." >&2; return 1; }

container() { # nome imagem porta_host porta_container [env...]
  local nome=$1 imagem=$2 ph=$3 pc=$4; shift 4
  if docker ps --format '{{.Names}}' | grep -qx "$nome"; then return; fi
  if docker ps -a --format '{{.Names}}' | grep -qx "$nome"; then docker start "$nome" >/dev/null; return; fi
  if porta_ocupada "$ph"; then echo "Porta $ph ocupada por outro processo; liberando-a ou mudando PORTA_* é com você." >&2; exit 1; fi
  docker run -d --name "$nome" "$@" -p "127.0.0.1:${ph}:${pc}" "$imagem" >/dev/null
}

subir_processo() { # nome porta comando...
  local nome=$1 porta=$2; shift 2
  if porta_ocupada "$porta"; then echo "  $nome: porta $porta já está em uso, não vou subir outro."; return; fi
  mkdir -p "$ESTADO/logs"
  nohup "$@" >"$ESTADO/logs/$nome.log" 2>&1 &
  echo $! >"$ESTADO/$nome.pid"
  echo "  $nome: subindo (log em .gestao-local/logs/$nome.log)"
}

cmd_up() {
  recusar_se_houver_env
  command -v docker >/dev/null || { echo "Docker é necessário (banco e redis locais)." >&2; exit 1; }
  mkdir -p "$ESTADO"
  echo "1/4 Banco e Redis locais"
  container "$PG_NOME" postgres:17-alpine "$PORTA_PG" 5432 -e POSTGRES_PASSWORD=gestao_local_dev -e POSTGRES_DB=gestao_empresarial
  container "$REDIS_NOME" redis:7-alpine "$PORTA_REDIS" 6379
  for _ in $(seq 1 60); do docker exec "$PG_NOME" pg_isready -U postgres -d gestao_empresarial >/dev/null 2>&1 && break; sleep 1; done
  echo "2/4 Migrations, papéis e dados mínimos"
  (cd "$RAIZ" && env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$DB_URL" pnpm --filter @desigual-os/database db:migrate >/dev/null)
  (cd "$RAIZ" && env -i PATH="$PATH" HOME="$HOME" DATABASE_URL="$DB_URL" pnpm --filter @desigual-os/database db:seed >/dev/null)
  docker exec -i "$PG_NOME" psql -U postgres -d gestao_empresarial -q -v ON_ERROR_STOP=1 <"$RAIZ/scripts/gestao-empresarial/seed-local.sql"
  echo "3/4 Login falso, API e front"
  subir_processo auth "$PORTA_AUTH" env -i PATH="$PATH" HOME="$HOME" node "$RAIZ/scripts/gestao-empresarial/auth-local.mjs"
  subir_processo api "$PORTA_API" env -i PATH="$PATH" HOME="$HOME" NODE_ENV=development PORT="$PORTA_API" \
    DATABASE_URL="$DB_URL" REDIS_URL="redis://127.0.0.1:${PORTA_REDIS}" SUPABASE_URL="http://localhost:${PORTA_AUTH}" \
    MASTER_USER_EMAILS=admin@local.test PROVIDER_ORGANIZATION_ID="$ORG_ID" FRONTEND_URL="http://localhost:${PORTA_WEB}" \
    GESTAO_EMPRESARIAL_ENABLED=true pnpm --dir "$RAIZ/apps/api" exec tsx watch src/server.ts
  subir_processo web "$PORTA_WEB" env -i PATH="$PATH" HOME="$HOME" NODE_ENV=development \
    NEXT_PUBLIC_API_MODE=live NEXT_PUBLIC_API_URL="http://localhost:${PORTA_API}" \
    NEXT_PUBLIC_SUPABASE_URL="http://localhost:${PORTA_AUTH}" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dev-local-nao-e-segredo \
    pnpm --dir "$RAIZ/apps/web" exec next dev --port "$PORTA_WEB"
  echo "4/4 Aguardando"
  esperar_porta "$PORTA_AUTH"; esperar_porta "$PORTA_API"; esperar_porta "$PORTA_WEB"
  cat <<FIM

Pronto. Abra http://localhost:${PORTA_WEB}/login
  administrador:  admin@local.test        senha: gestao-local-admin
  colaborador:    colaborador@local.test  senha: gestao-local-colab   (não deve ver a Gestão Empresarial)
  testes E2E:     e2e@local.test          senha: gestao-local-e2e     (empresa separada, para os testes não sujarem os dados)
Módulo: http://localhost:${PORTA_WEB}/gestao-empresarial
Para desligar: scripts/gestao-empresarial/local.sh down
FIM
}

cmd_down() {
  for p in web api auth; do
    if [ -f "$ESTADO/$p.pid" ]; then
      pid=$(cat "$ESTADO/$p.pid"); pkill -P "$pid" 2>/dev/null || true; kill "$pid" 2>/dev/null || true; rm -f "$ESTADO/$p.pid"; echo "  $p encerrado"
    fi
  done
  echo "Os containers $PG_NOME e $REDIS_NOME continuam (os dados ficam). Para apagar tudo: docker rm -f $PG_NOME $REDIS_NOME"
}

cmd_status() {
  for par in "auth:$PORTA_AUTH" "api:$PORTA_API" "web:$PORTA_WEB" "postgres:$PORTA_PG" "redis:$PORTA_REDIS"; do
    if porta_ocupada "${par#*:}"; then echo "  ${par%%:*}: no ar (${par#*:})"; else echo "  ${par%%:*}: parado"; fi
  done
}

case "${1:-}" in
  up) cmd_up ;;
  down) cmd_down ;;
  status) cmd_status ;;
  logs) tail -n 60 "$ESTADO/logs/${2:?use: logs auth|api|web}.log" ;;
  *) echo "uso: $0 up|down|status|logs <auth|api|web>" >&2; exit 2 ;;
esac
