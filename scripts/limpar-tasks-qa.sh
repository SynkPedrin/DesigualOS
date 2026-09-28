#!/usr/bin/env bash
# limpar-tasks-qa.sh — apaga o lixo de teste do ClickUp. 28/09/2026.
#
# Os 45 ids abaixo foram conferidos UM A UM. Ficaram DE FORA, de propósito,
# três tasks que parecem teste pelo nome mas são trabalho real de cliente:
#   86bbtdwh2  3Net - Editar vídeo ("Teste de estresse" é o nome da campanha)
#   86bbtdw61  3Net - Criação Layout (idem)
#   86bb4vqcv  Elite - Aniversário 70 anos - Teste de luz (etapa de produção)
#
# Uso:  bash scripts/limpar-tasks-qa.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

# 30 da Lista QA (space QA DESIGUAL OS) — tudo ali é fixture
LISTA_QA=(86bc8xnwr 86bc8xefq 86bc8xdtr 86bc7zt1c 86bc7zp5p 86bc7jcvy 86bc7jcv5
  86bc7j4ur 86bc7j4tu 86bc7j4rt 86bc7j4py 86bc7j1qc 86bc7hh9u 86bc7hd4d
  86bc6buu7 86bc6bt48 86bc52ytd 86bc52t9v 86bc508xd 86bc504g0 86bc4jum3
  86bc4jtj5 86bc4gd33 86bc4exnr 86bc4ewdq 86bc4eq3f 86bc4enmd 86bc4ejk9
  86bc4eb34 86bc4ae64)

# 15 fora da Lista QA, cada uma identificada pelo criador e pelo conteúdo
FORA_DA_LISTA=(
  86bc4ebqm 86bc4eapd 86bc4e83q   # "Cliente Teste 7 PEDIDO:" criadas pelo Bento Desigual
  86bc3n42j 86bc3aygd 86bc3532a 86bc31qm2 86bc31j8x 86bc30rfu  # lista "QA — Desigual OS Agentic"
  86bbvt0dm                        # [QA] Teste automatizado do Orchestrator
  86bbuk847                        # "Teste Desigual OS - mencoes de agentes (pode apagar)"
  86bbhjqwy                        # [TESTE B1] Bento responde pergunta no ClickUp
  86bbgw2zf                        # [SPIKE TESTE] pode apagar
  86bb7ja27 86bb7j3y0              # [TESTE F3.0]
)

ok=0; falha=0
for id in "${LISTA_QA[@]}" "${FORA_DA_LISTA[@]}"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
    "https://api.clickup.com/api/v2/task/$id" -H "Authorization: $CLICKUP_API_KEY")
  if [ "$code" = "204" ] || [ "$code" = "200" ]; then ok=$((ok+1)); else falha=$((falha+1)); echo "  falhou $id -> HTTP $code"; fi
done
echo "apagadas: $ok | falhas: $falha"
