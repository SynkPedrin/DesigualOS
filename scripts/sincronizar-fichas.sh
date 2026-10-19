#!/usr/bin/env bash
# sincronizar-fichas.sh — leva as fichas de cliente para a memória do Bento,
# todo dia, sem o vault sair da máquina dele.
#
# Por que existe (14/10/2026): os três importadores (brain, dossiê, nota do
# vault) só rodavam quando alguém lembrava. Entre uma rodada e outra, o Bento
# respondia com a ficha velha — e sem saber que era velha. Agora a idade de
# cada ficha aparece para ele (client-context.ts, idadeDaFonte) e este script,
# agendado pelo launchd, mantém as fichas em dia.
#
# A REGRA DE OURO CONTINUA: o vault nunca é copiado para o servidor. Este
# script roda NA MÁQUINA onde o vault mora e grava só o que os importadores
# já gravam: o registro curado em `memories`. É a via explícita que o
# CLAUDE.md descreve, só que no horário em vez de na lembrança.
#
# Uso:
#   DESIGUAL_VAULT=/caminho/brain-desigual bash scripts/sincronizar-fichas.sh            # aplica
#   DESIGUAL_VAULT=/caminho/brain-desigual SIMULAR=1 bash scripts/sincronizar-fichas.sh   # só mostra
#
# Agendamento: infra/launchd/com.desigualos.fichas.plist (todo dia às 06:30).
#
# Cada importador roda isolado: um que falhe não impede os outros, e o script
# sai com erro se qualquer um falhou, para o log do launchd mostrar.
set -uo pipefail

RAIZ_REPO="$(cd "$(dirname "$0")/.." && pwd)"
VAULT="${DESIGUAL_VAULT:-}"
APLICAR="--aplicar"
[ "${SIMULAR:-}" = "1" ] && APLICAR=""

carimbo() { date '+%Y-%m-%d %H:%M:%S'; }
falhas=0

rodar() {
  local nome="$1"; shift
  echo "[$(carimbo)] $nome: começando"
  if (cd "$RAIZ_REPO" && pnpm --filter @desigual-os/worker exec tsx "$@" $APLICAR); then
    echo "[$(carimbo)] $nome: ok"
  else
    echo "[$(carimbo)] $nome: FALHOU"
    falhas=$((falhas + 1))
  fi
}

# O brain criativo mora no repositório: sempre dá para rodar.
rodar "brains" scripts/sync-brains.mts

if [ -z "$VAULT" ]; then
  echo "[$(carimbo)] dossiês e notas do vault: PULADOS — DESIGUAL_VAULT não definido"
  falhas=$((falhas + 1))
elif [ ! -d "$VAULT/02-clientes" ]; then
  echo "[$(carimbo)] dossiês e notas do vault: PULADOS — não achei 02-clientes em $VAULT"
  falhas=$((falhas + 1))
else
  rodar "dossiês" scripts/sync-dossies.mts --raiz "$VAULT"
  rodar "notas do vault" scripts/sync-obsidian-vault.mts --raiz "$VAULT"
fi

echo "[$(carimbo)] fim: $falhas falha(s)"
[ "$falhas" -eq 0 ]
