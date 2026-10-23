# Publicar a Gestão Empresarial (ordem importa)

Estado em 23/10/2026: tudo pronto e testado na branch `feature/gestao-empresarial-local`, já rebaseada sobre
`origin/main` (`f2f8ab2`). 154 testes de API, 14 de banco, 45 de front e 10 E2E passando; o checkout limpo compila.

O módulo fica **invisível** até o passo 3: sem as variáveis no servidor, toda rota responde 404 e o menu não mostra o item.
Por isso publicar o código antes (passo 1) não expõe nada.

1. **Código na `main`:** `git push origin feature/gestao-empresarial-local:main` (fast-forward, sem merge).
2. **Migrações (só criam tabelas; nenhuma altera ou apaga tabela existente):**
   `pnpm --filter @desigual-os/database db:migrate` com a `DATABASE_URL` de produção.
   Aplica `0085_gestao_empresarial` (21 tabelas `ge_*` e 37 CHECKs) e `0086_gestao_empresarial_pagamento_desconhecido`.
   Conferido em 23/10/2026: produção está em `1792696695349` (0084) e não tem nenhuma tabela `ge_*`, então só essas
   duas entram. Conferir de novo antes: se a última migration de produção for outra, parar e olhar.
3. **API (VPS):**
   - `free -m` antes (com menos de ~2 GB disponíveis não buildar lá) e
     `ps -eo args | grep -E "^docker (compose|build)"` (outra sessão publicando = esperar).
   - Em `/opt/desigual-os/.env`, acrescentar:
     ```
     GESTAO_EMPRESARIAL_ENABLED=true
     GESTAO_EMPRESARIAL_ALLOW_PRODUCTION=sim
     ```
     As duas são necessárias: em `NODE_ENV=production` a primeira sozinha não liga o módulo (trava de propósito).
   - `git pull` em `/opt/desigual-os` e `docker compose -f docker-compose.prod.yml up -d --build api`.
     O lockfile mudou (a API ganhou `jszip`, que já estava no monorepo), então há `pnpm install` no build. O worker não muda.
4. **Front (Vercel):** o push do passo 1 dispara o build. Se ficar `BLOCKED`/`UNKNOWN` (autor do commit não reconhecido),
   publicar do commit exato: `git archive <sha> | tar -x -C <dir>`, copiar `.vercel`, `vercel deploy --prod --yes --archive=tgz`.
   Antes: `git fetch && git log origin/main -3` e `vercel ls desigual-os` (outra sessão pode ter publicado).
5. **Verificar:**
   - `curl -s -o /dev/null -w '%{http_code}' https://<api>/gestao-empresarial/cadastros/pessoas` → **401** (antes era 404:
     o 401 prova que o módulo está ligado e exige login).
   - Logado como administrador: menu mostra **Gestão Empresarial**; `GET /gestao-empresarial/access` → `{ "allowed": true }`.
   - Logado como colaborador: o item não aparece e a rota responde 403.
6. **Dados:** produção começa vazia. Os arquivos do Operand entram pela tela Gestão Empresarial → Configurações →
   Importação (em revisão até aplicar; repetidos ligados pelo documento; cedentes de lançamento por decisão humana).

Para desligar sem desfazer nada: tirar `GESTAO_EMPRESARIAL_ENABLED` do `.env` da VPS e recriar o container da API. As tabelas
ficam, vazias ou não, e voltam a ser usadas quando religar.
