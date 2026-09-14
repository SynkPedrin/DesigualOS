#!/bin/bash
#
# supervisor.sh — mantém API e worker do orquestrador vivos.
#
# POR QUE EXISTE
# --------------
# Incidente medido em 10/09/2026: o worker morreu (o watcher do tsx force-killou o processo no
# meio de um job e o substituto nunca subiu) e ficou 10 minutos fora. A API seguia aceitando
# mensagens, os jobs empilhavam no Redis, o usuário via "Não consegui concluir essa resposta" e
# o painel dizia "Todos os sistemas online". Nada reiniciava nada, porque nada supervisionava.
#
# RELAÇÃO COM O launchd
# ---------------------
# Em produção quem supervisiona é o launchd (infra/launchd/com.desigualos.{api,worker}.plist),
# porque ele sobrevive a reboot e a logout — este script não. O script existia como único
# recurso enquanto o repositório morava em ~/Downloads, pasta protegida pelo TCC do macOS, onde
# um agente do launchd recebe "Operation not permitted" ao ler qualquer arquivo. Em 11/09/2026 o
# repositório foi movido pra ~/DesigualOS justamente pra destravar isso.
#
# O script segue útil e mantido para: rodar a stack sem instalar agente no sistema (máquina de
# dev, sessão de teste) e como plano B se o launchd for desativado. Não rode os dois ao mesmo
# tempo: os dois tentariam subir o mesmo processo e brigariam pela porta 3001.
#
# GARANTIAS DESTE SCRIPT
# ----------------------
# - reinicia em até CHECK_INTERVAL segundos qualquer um dos dois que morra;
# - backoff progressivo: se um serviço morre repetidas vezes seguidas, espera mais entre as
#   tentativas em vez de entrar em loop de restart queimando CPU e poluindo log;
# - NUNCA roda duas cópias de si mesmo (lockfile com checagem de pid vivo);
# - SIGTERM/SIGINT param os filhos com sinal limpo, dando tempo de drenar o job em execução
#   (o worker drena em até 55s, ver apps/worker/src/index.ts).
#
# USO
#   ./infra/supervisor.sh start     # sobe em background e devolve o terminal
#   ./infra/supervisor.sh stop
#   ./infra/supervisor.sh status
#   ./infra/supervisor.sh foreground  # roda preso ao terminal (para depurar)

set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR_ESTADO="${TMPDIR:-/tmp}/desigualos-supervisor"
LOCK="$DIR_ESTADO/supervisor.pid"
LOG_SUPERVISOR="$HOME/Library/Logs/desigualos-supervisor.log"
LOG_API="/tmp/desigual-api.log"
LOG_WORKER="/tmp/desigual-worker.log"

CHECK_INTERVAL=5
BACKOFF_BASE=2
BACKOFF_MAX=60
# Mortes seguidas dentro desta janela contam como "crashloop" e levam backoff máximo.
JANELA_CRASHLOOP=120

mkdir -p "$DIR_ESTADO" "$(dirname "$LOG_SUPERVISOR")"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_SUPERVISOR"
}

# --- definição dos serviços -------------------------------------------------
# nome | diretório | comando
servico_dir() {
  case "$1" in
    api) echo "$RAIZ/apps/api" ;;
    worker) echo "$RAIZ/apps/worker" ;;
  esac
}
servico_entrada() {
  case "$1" in
    api) echo "src/server.ts" ;;
    worker) echo "src/index.ts" ;;
  esac
}
servico_log() {
  case "$1" in
    api) echo "$LOG_API" ;;
    worker) echo "$LOG_WORKER" ;;
  esac
}

pidfile() { echo "$DIR_ESTADO/$1.pid"; }

vivo() {
  local arquivo pid
  arquivo="$(pidfile "$1")"
  [[ -f "$arquivo" ]] || return 1
  pid="$(cat "$arquivo" 2>/dev/null)"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

subir() {
  local nome dir entrada logfile pid
  nome="$1"
  dir="$(servico_dir "$nome")"
  entrada="$(servico_entrada "$nome")"
  logfile="$(servico_log "$nome")"

  # `tsx` sem `watch` de propósito: recarregar código é trabalho de deploy. Foi exatamente o
  # watch que derrubou os dois processos no meio da bateria de testes de 10/09/2026.
  (
    cd "$dir" || exit 1
    exec node_modules/.bin/tsx "$entrada" >>"$logfile" 2>&1
  ) &
  pid=$!
  echo "$pid" >"$(pidfile "$nome")"
  log "[$nome] subiu (pid $pid)"
}

parar_servico() {
  local nome arquivo pid
  nome="$1"
  arquivo="$(pidfile "$nome")"
  [[ -f "$arquivo" ]] || return 0
  pid="$(cat "$arquivo" 2>/dev/null)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    log "[$nome] mandando SIGTERM (pid $pid) e aguardando dreno"
    kill -TERM "$pid" 2>/dev/null
    # 60s: acima do teto de dreno do worker (55s). Matar antes disso corta job pela metade.
    for _ in $(seq 1 60); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then
      log "[$nome] não saiu no prazo; SIGKILL"
      kill -KILL "$pid" 2>/dev/null
    fi
  fi
  rm -f "$arquivo"
}

# --- laço principal ---------------------------------------------------------
# Sem array associativo de propósito: o macOS vem com bash 3.2, onde `local -A` não existe
# (erro real ao subir: "local: -A: invalid option"). São dois serviços; contadores em arquivo
# são mais simples de ler e sobrevivem inclusive a um restart do próprio supervisor.
contador() { echo "$DIR_ESTADO/$1.falhas"; }
marca_morte() { echo "$DIR_ESTADO/$1.ultima-morte"; }

ler_num() {
  local arquivo="$1"
  if [[ -f "$arquivo" ]]; then cat "$arquivo" 2>/dev/null || echo 0; else echo 0; fi
}

loop() {
  local nome agora espera falhas ultima

  for nome in api worker; do
    echo 0 >"$(contador "$nome")"
    echo 0 >"$(marca_morte "$nome")"
    vivo "$nome" || subir "$nome"
  done

  trap 'log "supervisor recebeu sinal; parando serviços"; parar_servico worker; parar_servico api; rm -f "$LOCK"; exit 0' TERM INT

  while true; do
    for nome in api worker; do
      agora=$(date +%s)
      ultima=$(ler_num "$(marca_morte "$nome")")

      if vivo "$nome"; then
        # Ficou de pé tempo suficiente: zera o contador, senão uma falha isolada por dia
        # acabaria somando até o backoff máximo depois de uma semana.
        if (( agora - ultima > JANELA_CRASHLOOP )); then
          echo 0 >"$(contador "$nome")"
        fi
        continue
      fi

      falhas=$(( $(ler_num "$(contador "$nome")") + 1 ))
      echo "$falhas" >"$(contador "$nome")"
      echo "$agora" >"$(marca_morte "$nome")"

      if (( falhas > 5 )); then
        espera=$BACKOFF_MAX
      else
        espera=$(( BACKOFF_BASE ** falhas ))
        (( espera > BACKOFF_MAX )) && espera=$BACKOFF_MAX
      fi

      log "[$nome] MORREU (falha $falhas seguida). Subindo de novo em ${espera}s."
      if (( falhas >= 5 )); then
        log "[$nome] CRASHLOOP: 5 mortes seguidas em pouco tempo. Isso é bug, não instabilidade — olhe $(servico_log "$nome")."
      fi
      sleep "$espera"
      subir "$nome"
    done
    sleep "$CHECK_INTERVAL"
  done
}

supervisor_vivo() {
  [[ -f "$LOCK" ]] || return 1
  local pid
  pid="$(cat "$LOCK" 2>/dev/null)"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

case "${1:-start}" in
  start)
    if supervisor_vivo; then
      log "supervisor já está rodando (pid $(cat "$LOCK")); nada a fazer"
      exit 0
    fi
    # Saída pro /dev/null de propósito: `log` já escreve no arquivo via tee. Redirecionar o
    # foreground pro MESMO arquivo gravava cada linha duas vezes.
    nohup "$0" foreground >/dev/null 2>&1 &
    echo $! >"$LOCK"
    sleep 1
    log "supervisor iniciado (pid $(cat "$LOCK"))"
    ;;
  foreground)
    echo $$ >"$LOCK"
    log "supervisor no comando (pid $$) — raiz: $RAIZ"
    loop
    ;;
  stop)
    if supervisor_vivo; then
      kill -TERM "$(cat "$LOCK")" 2>/dev/null
      log "SIGTERM enviado ao supervisor"
    else
      log "supervisor não estava rodando"
    fi
    parar_servico worker
    parar_servico api
    rm -f "$LOCK"
    ;;
  status)
    supervisor_vivo && echo "supervisor: ATIVO (pid $(cat "$LOCK"))" || echo "supervisor: parado"
    for nome in api worker; do
      if vivo "$nome"; then echo "$nome: ATIVO (pid $(cat "$(pidfile "$nome")"))"; else echo "$nome: PARADO"; fi
    done
    ;;
  *)
    echo "uso: $0 {start|stop|status|foreground}" >&2
    exit 2
    ;;
esac
