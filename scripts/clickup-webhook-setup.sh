#!/usr/bin/env bash
#
# clickup-webhook-setup.sh — sobe o túnel público pra API e (re)registra o
# webhook de comentários do ClickUp apontando pra ela.
#
# Por que existe: o endpoint POST /clickup/webhook da API precisa de uma URL
# pública pro ClickUp entregar os eventos taskCommentPosted (é o que faz
# @Bento/@Jarbas/@Suzy responderem em comentários de task). Em dev a API roda
# em localhost, então usamos um quick tunnel do cloudflared — que é EFÊMERO:
# se o túnel cair ou a máquina reiniciar, a URL muda e o webhook precisa ser
# registrado de novo. É pra isso que este script serve. A solução definitiva
# é o deploy da API na VPS com URL fixa (ver brain/99 - Pendencias.md).
#
# Uso:  ./scripts/clickup-webhook-setup.sh
#
# O que ele faz:
#   1. Sobe (ou reusa) um túnel cloudflared pra http://localhost:3001
#   2. Apaga webhooks antigos que apontam pra URLs trycloudflare mortas
#   3. Registra webhook novo (evento taskCommentPosted) na URL do túnel
#   4. Grava o secret novo em CLICKUP_WEBHOOK_SECRET no .env da raiz
#   5. Força reload da API (tsx watch) e valida a assinatura HMAC ponta a ponta

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
TUNNEL_LOG=/tmp/cloudflared-desigual.log
API_PORT=3001

log() { printf '\033[1;35m[clickup-webhook]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[clickup-webhook] ERRO:\033[0m %s\n' "$*" >&2; exit 1; }

env_value() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"; }

[ -f "$ENV_FILE" ] || fail ".env não encontrado em $ENV_FILE"
CLICKUP_API_KEY="$(env_value CLICKUP_API_KEY)"
CLICKUP_TEAM_ID="$(env_value CLICKUP_TEAM_ID)"
[ -n "$CLICKUP_API_KEY" ] || fail "CLICKUP_API_KEY vazio no .env"
[ -n "$CLICKUP_TEAM_ID" ] || fail "CLICKUP_TEAM_ID vazio no .env"

CLOUDFLARED="$(command -v cloudflared || true)"
[ -n "$CLOUDFLARED" ] || CLOUDFLARED="$HOME/.orvyn/bin/cloudflared"
[ -x "$CLOUDFLARED" ] || fail "cloudflared não encontrado (nem no PATH nem em ~/.orvyn/bin)"

# 1. API local no ar?
curl -s -m 5 -o /dev/null "http://localhost:${API_PORT}/health" \
  || fail "API não responde em localhost:${API_PORT}/health — suba com: pnpm --filter @desigual-os/api dev"

# 2. Túnel: reusa se já existe um saudável, senão sobe um novo.
TUNNEL_URL=""
if pgrep -f "cloudflared tunnel --url http://localhost:${API_PORT}" >/dev/null; then
  TUNNEL_URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1 || true)"
  if [ -n "$TUNNEL_URL" ] && curl -s -m 8 -o /dev/null "${TUNNEL_URL}/health"; then
    log "Túnel existente saudável: $TUNNEL_URL"
  else
    log "Túnel existente morreu; subindo um novo."
    pkill -f "cloudflared tunnel --url http://localhost:${API_PORT}" || true
    TUNNEL_URL=""
  fi
fi

if [ -z "$TUNNEL_URL" ]; then
  : > "$TUNNEL_LOG"
  nohup "$CLOUDFLARED" tunnel --url "http://localhost:${API_PORT}" > "$TUNNEL_LOG" 2>&1 &
  disown
  for _ in $(seq 1 15); do
    sleep 1
    TUNNEL_URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1 || true)"
    [ -n "$TUNNEL_URL" ] && break
  done
  [ -n "$TUNNEL_URL" ] || fail "cloudflared não devolveu URL; veja $TUNNEL_LOG"
  healthy=""
  for _ in $(seq 1 20); do
    curl -s -m 8 -o /dev/null "${TUNNEL_URL}/health" && { healthy=1; break; }
    sleep 2
  done
  [ -n "$healthy" ] || fail "Túnel subiu mas $TUNNEL_URL/health não responde; veja $TUNNEL_LOG"
  log "Túnel novo no ar: $TUNNEL_URL"
fi

# 3. Limpa webhooks antigos que apontam pra trycloudflare (URLs mortas).
EXISTING="$(curl -s -m 20 "https://api.clickup.com/api/v2/team/${CLICKUP_TEAM_ID}/webhook" -H "Authorization: ${CLICKUP_API_KEY}")"
echo "$EXISTING" | python3 -c "
import json, sys
for w in json.load(sys.stdin).get('webhooks', []):
    ep = w.get('endpoint', '')
    if 'trycloudflare.com' in ep and not ep.startswith('$TUNNEL_URL'):
        print(w['id'])
" | while read -r old_id; do
  curl -s -m 15 -o /dev/null -X DELETE "https://api.clickup.com/api/v2/webhook/${old_id}" -H "Authorization: ${CLICKUP_API_KEY}" \
    && log "Webhook antigo removido: $old_id"
done

# 4. Já existe webhook apontando pra ESTA URL? Reusa. Senão registra.
CURRENT_SECRET=""
if echo "$EXISTING" | python3 -c "
import json, sys
sys.exit(0 if any(w.get('endpoint','').startswith('$TUNNEL_URL') for w in json.load(sys.stdin).get('webhooks', [])) else 1)
"; then
  log "Webhook já registrado pra essa URL; mantendo (o secret do .env continua valendo)."
else
  RESP="$(curl -s -m 20 "https://api.clickup.com/api/v2/team/${CLICKUP_TEAM_ID}/webhook" \
    -H "Authorization: ${CLICKUP_API_KEY}" -H 'Content-Type: application/json' \
    -d "{\"endpoint\":\"${TUNNEL_URL}/clickup/webhook\",\"events\":[\"taskCommentPosted\"]}")"
  CURRENT_SECRET="$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('webhook',{}).get('secret',''))")"
  [ -n "$CURRENT_SECRET" ] || fail "ClickUp recusou o registro: $RESP"
  log "Webhook registrado: $(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['webhook']['id'])")"

  # 5. Secret novo no .env (a API só enxerga depois de recarregar).
  if grep -q '^CLICKUP_WEBHOOK_SECRET=' "$ENV_FILE"; then
    sed -i '' "s|^CLICKUP_WEBHOOK_SECRET=.*|CLICKUP_WEBHOOK_SECRET=${CURRENT_SECRET}|" "$ENV_FILE"
  else
    echo "CLICKUP_WEBHOOK_SECRET=${CURRENT_SECRET}" >> "$ENV_FILE"
  fi
  log "CLICKUP_WEBHOOK_SECRET atualizado no .env"

  # tsx watch não vigia .env — um touch reinicia o processo e recarrega o env.
  touch "$ROOT/apps/api/src/server.ts"
  sleep 8
fi

# 6. Validação HMAC ponta a ponta (payload sem menção: não dispara agente).
(cd "$ROOT/apps/api" && node -e "
const { createHmac } = require('node:crypto');
const { config } = require('dotenv');
config({ path: '../../.env' });
const body = JSON.stringify({ event: 'taskCommentPosted', task_id: 'setup-check', history_items: [{ after: 'x', comment: { id: 'x', text_content: 'setup check' } }] });
const sig = createHmac('sha256', process.env.CLICKUP_WEBHOOK_SECRET || '').update(body).digest('hex');
fetch('${TUNNEL_URL}/clickup/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': sig }, body })
  .then(async (r) => { console.log('[clickup-webhook] validação HMAC:', r.status, await r.text()); process.exit(r.status === 200 ? 0 : 1); })
  .catch((e) => { console.error(e); process.exit(1); });
")

log "Pronto. @Bento/@Jarbas/@Suzy em comentários do ClickUp agora chegam na API."
log "Lembrete: quick tunnel é temporário — se a máquina reiniciar ou o túnel cair, rode este script de novo."
