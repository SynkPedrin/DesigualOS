# Banco para São Paulo (Supabase sa-east-1)

Roteiro da mudança do projeto Supabase de `us-east-1` (Virgínia) para `sa-east-1` (São Paulo).
As ferramentas estão em `scripts/migrar-supabase/` e foram ensaiadas em 19/10/2026, só lendo o projeto atual.

## Por quê

Medido em 04/11/2026, da VPS de produção (Locaweb, Brasil):

| Destino | Ida e volta |
|---|---|
| Banco atual (`aws-0-us-east-1.pooler.supabase.com`) | ~135 ms |
| AWS São Paulo (`sa-east-1`) | ~15 ms |

Cada consulta com parâmetro custa duas idas pelo pooler (~270 ms). As telas do Daily fazem de 2 a 5 rodadas
de consulta; criar tarefa fazia 17. No log de produção de 03–04/11: lista de tarefas com mediana de 2,2 s, visão
geral 2,6 s, histórico 2,5 s, criar tarefa ~4 s. O código já foi enxugado (commit `b1289cd`), mas o piso de cada
rodada continua sendo a distância. Em São Paulo esse piso cai para perto de um décimo.

## Tamanho (ensaio de 19/10/2026)

- Banco: `public` + `drizzle` (107 tabelas) e logins (`auth.users`, `auth.identities`): dump em 43 s, 9,4 MB.
- Storage: 566 arquivos, 388 MB.
- Conferência linha a linha: 109 tabelas.

## O que muda para a equipe

- **Uma parada de 20 a 30 minutos**, fora do horário de trabalho.
- **Todo mundo entra de novo uma vez**, com a mesma senha. Os logins são copiados; o que muda são as chaves
  que assinam a sessão (a API valida pelo JWKS do projeto, `packages/auth/src/supabase-jwt.ts`).
- Integrações conectadas (ClickUp, Microsoft, Meta) continuam: os tokens estão em tabelas do `public`, que vão
  junto.

## Antes do dia (Pedro)

1. Criar o projeto novo no painel do Supabase: **região South America (São Paulo)**, mesmo plano e mesma versão
   do Postgres do atual (17).
2. Em **Authentication** do projeto novo, repetir o que o atual tem:
   - Site URL e Redirect URLs (`https://desigual-os.vercel.app`, `/reset-password`, `/convite`);
   - SMTP próprio e os modelos de e-mail de convite e de troca de senha;
   - o mesmo tempo de expiração de sessão.
3. Na VPS, criar `~/.desigualos/novo-supabase.env` (permissão 600, fora do repositório) com as chaves listadas
   em `scripts/migrar-supabase/README.md`.

## Ensaio (sistema no ar, só lê o atual)

Na VPS (tem Docker e rota para os dois projetos), com a pasta `scripts/migrar-supabase/` do repositório copiada
para lá e as variáveis do `.env` de produção e do arquivo novo carregadas:

```bash
ORIGEM_URL=<DATABASE_URL atual, porta 5432> DESTINO_URL=$NOVO_DATABASE_URL ./copiar-banco.sh
ORIGEM_URL=$SUPABASE_URL ORIGEM_KEY=$SUPABASE_SECRET_KEY DESTINO_URL=$NOVO_SUPABASE_URL DESTINO_KEY=$NOVO_SECRET_KEY node copiar-storage.mjs
docker run --rm -i postgres:17-alpine psql "$NOVO_DATABASE_URL" -v antigo=<ref atual> -v novo=$NOVO_REF < reescrever-links.sql
ORIGEM_URL=... DESTINO_URL=... ./conferir.sh   # tem que terminar em "IGUAL"
```

Anote o tempo de cada passo: a soma é a parada da virada.

## Virada

1. Avisar a equipe (horário e "vai pedir login de novo").
2. Parar o que escreve no banco:
   ```bash
   cd /opt/desigual-os && docker compose -f docker-compose.prod.yml stop api worker
   ```
   Fora da VPS, parar também os outros consumidores de `DATABASE_URL`: Studio node, Otto node, Bento (Mac Mini) e
   a sincronização das fichas (`infra/launchd/com.desigualos.fichas.plist`). Antes do dia, conferir a lista com
   `grep -l DATABASE_URL` no `.env` de cada máquina.
3. Repetir os quatro passos do ensaio; `conferir.sh` tem que dar **IGUAL**.
4. Trocar as chaves:
   - **VPS** `/opt/desigual-os/.env`: `DATABASE_URL` (pooler de São Paulo, **porta 6543**, modo transação),
     `SUPABASE_URL`, `SUPABASE_SECRET_KEY` e `SUPABASE_PUBLISHABLE_KEY`. Fazer cópia do `.env` antes.
   - **Vercel** (projeto `desigual-os`): `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, e
     publicar de novo.
   - **Studio node, Otto node, Bento, fichas**: as mesmas variáveis no `.env` de cada um.
5. Subir: `docker compose -f docker-compose.prod.yml --env-file .env up -d --no-deps --no-build api worker`.
6. Conferir antes de liberar:
   - `/health` e `/health/infrastructure` (100%);
   - login com a conta de QA;
   - Daily abrindo, criar e editar uma tarefa;
   - um arquivo do Studio abrindo (link reescrito);
   - escrita no ClickUp (`/work/admin/clickup-sync`, saída sem falhas).
7. Medir: tempos do log das rotas do Daily comparados aos de 03–04/11.

## Volta

O projeto antigo **não é tocado** em nenhum passo. Para voltar: restaurar a cópia do `.env`, as variáveis da
Vercel e as das outras máquinas, e subir de novo. O que foi gravado no projeto novo depois da virada fica só lá;
decidir voltar ou ficar na primeira hora limita essa perda.

## Depois

Manter o projeto antigo pausado (não apagado) por duas semanas. Apagar só com nova aprovação.
