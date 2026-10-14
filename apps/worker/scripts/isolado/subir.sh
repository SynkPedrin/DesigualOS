#!/usr/bin/env bash
# subir.sh — (re)sobe simuladores, API e worker do ambiente isolado do Bento 3.1.
#
#   bash apps/worker/scripts/isolado/subir.sh            # caminho com loop (como o .env local)
#   ISOLADO_AGENT_LOOP_BENTO_V2=false bash .../subir.sh  # caminho direto
#
# Pré-requisito, uma vez: containers bento31-pg (55433) e bento31-redis (6391),
# migrações e seed oficial aplicados — ver docs/bento-3.1-progress.md.
set -euo pipefail
raiz="$(cd "$(dirname "$0")/../../../.." && pwd)"
logs="${ISOLADO_LOGS:-/tmp/bento31-logs}"
mkdir -p "$logs"

pkill -f "isolado/simuladores.mjs" 2>/dev/null || true
pkill -f "tsx src/server.ts" 2>/dev/null || true
pkill -f "tsx src/index.ts" 2>/dev/null || true
sleep 2

# Fila limpa entre rodadas: job velho de outra configuração não pode ser
# processado pelo worker novo.
docker exec bento31-redis redis-cli FLUSHALL >/dev/null

nohup node "$raiz/apps/worker/scripts/isolado/simuladores.mjs" >"$logs/sim.log" 2>&1 &
sleep 1
(cd "$raiz/apps/api" && nohup node ../worker/scripts/isolado/ambiente.mjs -- pnpm exec tsx src/server.ts >"$logs/api.log" 2>&1 &)
(cd "$raiz/apps/worker" && nohup node scripts/isolado/ambiente.mjs -- pnpm exec tsx src/index.ts >"$logs/worker.log" 2>&1 &)

for _ in $(seq 1 40); do
  if curl -fs http://127.0.0.1:4791/health >/dev/null 2>&1 && grep -q "Worker started" "$logs/worker.log" 2>/dev/null; then break; fi
  sleep 1
done
(cd "$raiz/apps/worker" && node scripts/isolado/ambiente.mjs -- pnpm exec tsx scripts/isolado/semear.mts | tail -1)
echo "isolado no ar (loop=${ISOLADO_AGENT_LOOP_BENTO_V2:-do .env}); logs em $logs"
