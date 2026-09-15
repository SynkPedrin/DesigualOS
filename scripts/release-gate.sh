#!/usr/bin/env bash
# release-gate.sh — portão de release do Desigual OS (Agentic V2).
# NÃO esconde erro: qualquer etapa que falhar derruba o script (set -e).
# NÃO aplica migration por padrão: migração é etapa PROTEGIDA (ver MIGRATE).
#
# Uso:
#   bash scripts/release-gate.sh              # valida tudo, SEM migration nem build
#   RUN_BUILD=1 bash scripts/release-gate.sh  # inclui build de produção
#   MIGRATE=1  bash scripts/release-gate.sh   # aplica migration (pede confirmação)
#
# Requer: pnpm instalado (corepack enable), DATABASE_URL no .env para db:*.
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1;36m=== %s ===\033[0m\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

PNPM="pnpm"; have pnpm || PNPM="corepack pnpm"

step "0. Ambiente"
node -v
$PNPM -v
[ -f .env ] && echo ".env presente" || echo "AVISO: .env ausente (db:* vai falhar)"

step "1. Typecheck (todos os pacotes)"
$PNPM typecheck

step "2. Lint"
$PNPM lint

step "3. Testes"
$PNPM test

step "4. Migration (schema -> banco)"
if [ "${MIGRATE:-0}" = "1" ]; then
  echo "Gerando migration a partir do schema..."
  $PNPM --filter @desigual-os/database db:generate
  echo
  echo "ATENÇÃO: prestes a APLICAR migration em: ${DATABASE_URL:-<DATABASE_URL não lido aqui>}"
  echo "Confirme que NÃO é produção sem querer. Digite EXATAMENTE 'aplicar' para seguir:"
  read -r CONFIRM
  if [ "$CONFIRM" = "aplicar" ]; then
    $PNPM --filter @desigual-os/database db:migrate
  else
    echo "Migration ABORTADA pelo operador."; exit 1
  fi
else
  echo "PULADO (migration é protegida). Rode com MIGRATE=1 para gerar+aplicar."
  echo "Só GERAR sem aplicar: pnpm --filter @desigual-os/database db:generate"
fi

step "5. Build de produção"
if [ "${RUN_BUILD:-0}" = "1" ]; then
  $PNPM build
else
  echo "PULADO. Rode com RUN_BUILD=1 para o build de produção (web/api/worker)."
fi

step "6. Smoke tests ao vivo"
echo "NÃO automatizados aqui (precisam de ClickUp/LLM/Supabase reais e ações que"
echo "podem escrever em produção). Siga docs/agentic-architecture/release-smoke-tests.md"
echo "num workspace de TESTE, com AGENT_LOOP_V2=bento (e otto)."

printf '\n\033[1;32mPortão automatizado concluído. Itens ao vivo continuam manuais (ver acima).\033[0m\n'
