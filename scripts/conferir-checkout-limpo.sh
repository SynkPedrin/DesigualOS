#!/usr/bin/env bash
# conferir-checkout-limpo.sh — o código COMMITADO compila sozinho?
#
# A pergunta que nenhuma ferramenta do repositório fazia, e que por isso
# ficou sem resposta errada por dias.
#
# `pnpm turbo run typecheck` compila a ÁRVORE DE TRABALHO. Arquivo novo que
# ainda não entrou em commit está lá, então o import resolve e o typecheck
# passa. O deploy do front, publicado por upload de diretório, também o
# enviava. Os dois mecanismos concordavam — e os dois olhavam para o mesmo
# lugar errado.
#
# Medido em 08/10/2026, em HEAD, com este procedimento:
#   apps/web 41 erros (9 "Cannot find module") · apps/api 6 · apps/worker 1
# Páginas COMMITADAS importavam nove módulos que nunca entraram em commit
# nenhum. A tela de detalhe do cliente — 16KB, a que renderiza a conexão de
# BM por cliente — não existia em commit nenhum.
#
# Uso:
#   bash scripts/conferir-checkout-limpo.sh            # HEAD, node_modules ligados (rápido)
#   bash scripts/conferir-checkout-limpo.sh <ref>      # outro commit/branch
#   INSTALAR=1 bash scripts/conferir-checkout-limpo.sh # install de verdade (lento, mais fiel)
#
# Sai com código != 0 se qualquer app não compilar: serve em portão de release.
set -uo pipefail
cd "$(dirname "$0")/.."
RAIZ="$(pwd)"
REF="${1:-HEAD}"
ARVORE="$(mktemp -d)/checkout-${REF//\//-}"

limpar() { git worktree remove --force "$ARVORE" >/dev/null 2>&1; rm -rf "$ARVORE"; git worktree prune >/dev/null 2>&1; }
trap limpar EXIT

printf '\033[1;36m=== checkout limpo de %s ===\033[0m\n' "$(git rev-parse --short "$REF")"
git worktree add -q --detach "$ARVORE" "$REF" || { echo "não consegui criar a árvore"; exit 1; }

if [ "${INSTALAR:-0}" = "1" ]; then
  echo "instalando dependências (--frozen-lockfile)..."
  (cd "$ARVORE" && pnpm install --frozen-lockfile >/dev/null 2>&1) || { echo "install falhou"; exit 1; }
else
  # Ligar o node_modules da árvore principal é uma APROXIMAÇÃO: pega import
  # quebrado e prop que não existe, que é o que este script existe pra pegar.
  # NÃO pega dependência declarada a menos no package.json — pra isso,
  # INSTALAR=1. Três defeitos desse tipo já passaram por aqui, então a opção
  # existe e o portão de release deveria usá-la.
  while read -r d; do
    [ -e "$ARVORE/$d" ] || ln -sfn "$RAIZ/$d" "$ARVORE/$d" 2>/dev/null
  done < <(find . -maxdepth 3 -name node_modules -type d -not -path "*/node_modules/*" 2>/dev/null | sed 's|^\./||')
  echo "node_modules ligados da árvore principal (use INSTALAR=1 pra install real)"
fi

TSC="$ARVORE/node_modules/.bin/tsc"
[ -x "$TSC" ] || TSC="$RAIZ/node_modules/.bin/tsc"
falhou=0
echo
for app in apps/web apps/api apps/worker apps/mcp; do
  [ -f "$ARVORE/$app/tsconfig.json" ] || continue
  saida="$(cd "$ARVORE/$app" && "$TSC" --noEmit 2>&1)"
  n="$(printf '%s' "$saida" | grep -c 'error TS' || true)"
  if [ "$n" -eq 0 ]; then
    printf '  \033[1;32m%-14s ok\033[0m\n' "$app"
  else
    falhou=1
    printf '  \033[1;31m%-14s %s erro(s)\033[0m\n' "$app" "$n"
    printf '%s\n' "$saida" | grep 'error TS' | head -5 | sed 's/^/      /'
    [ "$n" -gt 5 ] && echo "      ... e mais $((n - 5))"
  fi
done

echo
if [ "$falhou" -eq 0 ]; then
  printf '\033[1;32mO código commitado compila sozinho.\033[0m\n'
else
  printf '\033[1;31mO código commitado NÃO compila. Falta arquivo em commit, ou um arquivo\n'
  printf 'commitado está numa versão mais velha do que quem o importa espera.\033[0m\n'
fi
exit "$falhou"
