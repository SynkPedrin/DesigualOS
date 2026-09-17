#!/usr/bin/env bash
# restart-service.sh — parar, ESPERAR MORRER, subir, conferir. Nessa ordem.
#
# Em 16/09/2026 eu derrubei API e worker ao mesmo tempo rodando `bootout` e
# `bootstrap` em sequência direta: o bootout ainda estava em andamento quando o
# bootstrap chegou, que falhou com "Input/output error 5" — e como o bootout
# TINHA funcionado, os dois serviços ficaram no chão sem que nada avisasse.
#
# O erro não foi de comando, foi de sequenciamento: launchctl é assíncrono e não
# bloqueia até o job sumir do domínio. Disciplina não resolve isso; espera
# explícita resolve.
#
#   bash scripts/restart-service.sh com.desigualos.worker [url-de-health]
set -euo pipefail

LABEL="${1:?uso: restart-service.sh <label> [url-de-health]}"
HEALTH="${2:-}"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
DOMINIO="gui/$(id -u)"
ESPERA_MAX=60

[ -f "$PLIST" ] || { echo "plist não encontrado: $PLIST"; exit 1; }

carregado() { launchctl print "${DOMINIO}/${LABEL}" >/dev/null 2>&1; }
pid_de() { launchctl list "$LABEL" 2>/dev/null | sed -n 's/.*"PID" = \([0-9]*\).*/\1/p'; }

echo "[${LABEL}] parando (pid $(pid_de))"
launchctl bootout "${DOMINIO}/${LABEL}" 2>/dev/null || true

# A ESPERA que faltava. Sem ela o bootstrap corre contra o bootout e perde.
for i in $(seq 1 "$ESPERA_MAX"); do
  if ! carregado; then break; fi
  sleep 1
  if [ "$i" -eq "$ESPERA_MAX" ]; then
    echo "[${LABEL}] ainda carregado após ${ESPERA_MAX}s; NÃO vou subir por cima"
    exit 1
  fi
done
echo "[${LABEL}] saída confirmada"

launchctl bootstrap "$DOMINIO" "$PLIST"

for i in $(seq 1 30); do
  PID="$(pid_de)"
  [ -n "$PID" ] && break
  sleep 1
done
PID="$(pid_de)"
[ -n "$PID" ] || { echo "[${LABEL}] subiu sem PID — falhou"; exit 1; }
echo "[${LABEL}] no ar (pid ${PID})"

# Health é o que separa "processo existe" de "serviço funciona". Foi a diferença
# entre o painel dizer online e a fila não ser consumida.
if [ -n "$HEALTH" ]; then
  for i in $(seq 1 30); do
    CODIGO="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH" || echo 000)"
    if [ "$CODIGO" = "200" ]; then
      echo "[${LABEL}] health 200"
      exit 0
    fi
    sleep 2
  done
  echo "[${LABEL}] health NÃO respondeu 200 em 60s"
  exit 1
fi
