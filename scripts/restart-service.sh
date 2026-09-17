#!/usr/bin/env bash
# restart-service.sh — parar, ESPERAR MORRER, garantir a porta, subir, conferir
# que quem atende é o processo SUPERVISIONADO. Nessa ordem.
#
# Dois incidentes, no mesmo dia, escreveram este arquivo:
#
# 1. `bootout` seguido direto de `bootstrap` falhou com "Input/output error 5":
#    launchctl é assíncrono e não bloqueia até o job sumir do domínio. Como o
#    bootout TINHA funcionado, API e worker ficaram no chão sem aviso.
#
# 2. Pior, e mais silencioso: uma instância ÓRFÃ da API continuou segurando a
#    porta 3001. O job do launchd subia, batia em EADDRINUSE, morria — e o
#    health check respondia 200, porque quem respondia era o órfão. Resultado:
#    o script dizia "no ar", o serviço supervisionado estava morto, e a API
#    rodava com configuração velha. Foi assim que um segredo de webhook
#    atualizado no .env não chegou a lugar nenhum.
#
# A lição das duas: "responde 200" não é o mesmo que "o serviço certo está no
# ar". Por isso aqui a checagem final é de DONO da porta, não de resposta.
#
#   bash scripts/restart-service.sh <label> <porta> [url-de-health]
set -euo pipefail

LABEL="${1:?uso: restart-service.sh <label> <porta> [url-de-health]}"
PORTA="${2:?informe a porta que o serviço escuta}"
HEALTH="${3:-}"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
DOMINIO="gui/$(id -u)"
ESPERA_MAX=60

[ -f "$PLIST" ] || { echo "plist não encontrado: $PLIST"; exit 1; }

carregado() { launchctl print "${DOMINIO}/${LABEL}" >/dev/null 2>&1; }
pid_do_job() { launchctl list "$LABEL" 2>/dev/null | sed -n 's/.*"PID" = \([0-9]*\).*/\1/p' || true; }
# `|| true` obrigatório: com `pipefail`, lsof sem resultado devolve 1 e o
# `set -e` derrubava o script justamente no caso bom (porta livre).
dono_da_porta() { lsof -nP -iTCP:"${PORTA}" -sTCP:LISTEN -t 2>/dev/null | head -1 || true; }
eh_nosso() { ps -ww -p "$1" -o command= 2>/dev/null | grep -q 'DesigualOS'; }

echo "[${LABEL}] parando (pid $(pid_do_job))"
launchctl bootout "${DOMINIO}/${LABEL}" 2>/dev/null || true

# ESPERA a saída ser confirmada. Sem isto o bootstrap corre contra o bootout.
for i in $(seq 1 "$ESPERA_MAX"); do
  carregado || break
  sleep 1
  if [ "$i" -eq "$ESPERA_MAX" ]; then
    echo "[${LABEL}] ainda carregado após ${ESPERA_MAX}s; NÃO vou subir por cima"
    exit 1
  fi
done
echo "[${LABEL}] saída confirmada"

# A PORTA precisa estar livre ANTES de subir. Órfão nosso segurando a porta é
# o que transforma um restart em "serviço morto que parece vivo".
OCUPANTE="$(dono_da_porta)"
if [ -n "$OCUPANTE" ]; then
  if eh_nosso "$OCUPANTE"; then
    echo "[${LABEL}] órfão do projeto ainda na porta ${PORTA} (pid ${OCUPANTE}); encerrando"
    kill -TERM "$OCUPANTE" 2>/dev/null || true
    for i in $(seq 1 20); do
      if [ -z "$(dono_da_porta)" ]; then break; fi
      sleep 1
    done
  fi
  RESTANTE="$(dono_da_porta)"
  if [ -n "$RESTANTE" ]; then
    echo "[${LABEL}] porta ${PORTA} ocupada pelo pid ${RESTANTE}, que NÃO é deste projeto. Abortando em vez de matar processo alheio."
    exit 1
  fi
fi

launchctl bootstrap "$DOMINIO" "$PLIST"

for i in $(seq 1 30); do
  if [ -n "$(pid_do_job)" ]; then break; fi
  sleep 1
done
PID_JOB="$(pid_do_job)"
[ -n "$PID_JOB" ] || { echo "[${LABEL}] subiu sem PID — falhou"; exit 1; }

# QUEM atende a porta tem que descender do job. É esta linha que teria evitado
# o incidente 2: o órfão respondia 200 e o supervisionado estava morto.
for i in $(seq 1 30); do
  DONO="$(dono_da_porta)"
  if [ -n "$DONO" ]; then
    PAI="$(ps -o ppid= -p "$DONO" 2>/dev/null | tr -d ' ')"
    if [ "$DONO" = "$PID_JOB" ] || [ "$PAI" = "$PID_JOB" ]; then
      echo "[${LABEL}] no ar (job ${PID_JOB}, ouvindo ${DONO})"
      break
    fi
  fi
  sleep 2
  if [ "$i" -eq 30 ]; then
    echo "[${LABEL}] a porta ${PORTA} não é atendida pelo job ${PID_JOB}"
    exit 1
  fi
done

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
