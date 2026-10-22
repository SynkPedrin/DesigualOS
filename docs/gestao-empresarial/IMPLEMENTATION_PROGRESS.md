# Gestão Empresarial: andamento da implementação

Branch: `feature/gestao-empresarial-local` (worktree `.claude/worktrees/gestao-empresarial`, base `origin/main` f8fcf6c).
Escopo: **somente local**. Sem deploy, sem push, sem migration em produção, sem banco de produção.

Este arquivo só marca como feito o que roda e tem teste. "Simulado" nunca conta como pronto.

## Status das fases

| # | Fase | Status |
|---|---|---|
| 1 | Auditoria (repositório e dados Operand) | **Concluída** (ver `DATA_AUDIT.md` e §A abaixo) |
| 2 | Arquitetura | Pendente |
| 3 | Banco de dados (Postgres local isolado, migrations) | Pendente |
| 4 | Layout e navegação interna | Pendente |
| 5 | Cadastros | Pendente |
| 6 | Financeiro | Pendente |
| 7 | Comercial | Pendente |
| 8 | Produção | Pendente |
| 9 | Importador (staging) | Pendente |
| 10 | Integrações | Pendente |
| 11 | Relatórios | Pendente |
| 12 | QA e testes E2E | Pendente |

## A. Auditoria do repositório

Monorepo pnpm + turbo. O que o módulo precisa respeitar:

- **API** `apps/api`: Fastify + Zod. Cada rota usa `requireAuth`, `requireTenant` e
  `requirePermission(resource, action)`. Gate por módulo em `requireModule`. Padrão de acesso
  restrito já existe no Daily Tasks (`/work/access`: flag da organização + papel).
- **Papéis** (`packages/auth`): `master` e `colaborador`. `master` dentro da provedora é
  escopo de plataforma. O módulo financeiro exige `master`, aplicado **na API**, não só no menu.
- **Banco** `packages/database`: Drizzle. Esquemas em `src/schema/*.ts`, migrations em
  `database/migrations` (86 arquivos, última 0084). Convenções: `idColumn` (uuid),
  `timestampColumns` (`updatedAt` com `$onUpdate`), `softDeleteColumn`, `organizationId` para
  isolamento por empresa. **Não existe nenhum código financeiro hoje**: o `costs` do
  repositório é custo de LLM, outra coisa.
- **Web** `apps/web` (Next.js 16): navegação em `components/shell/nav-items.ts`, filtro puro
  em `nav-visibility.ts` (a sidebar e o ⌘K usam o mesmo filtro, por causa de vazamento
  anterior). Rotas em `app/(shell)/<modulo>`. O Daily Tasks é o modelo de módulo com
  navegação interna (`layout.tsx` + subrotas).
- **Colisão de nome:** `/gestao` já é "Gestão da equipe" (`masterOnly`). O novo módulo usa
  **`/gestao-empresarial`**.
- **Testes:** vitest em api/web/database, playwright em `apps/web` (`test:e2e`).

## B. Ambiente local

- Portas em uso por outros processos (não tocar): 55433 (`chat-qa-pg`), 55521/55522/55524
  (Supabase local de outro projeto), 6380 (redis), 8080, 3001/3010/3011/3100/11500.
- Postgres do módulo: container **novo e próprio**, a definir na Fase 3, em porta livre,
  nunca apontando para o `DATABASE_URL` do `.env`.

## C. Decisões e achados que afetam o desenho

1. "Veículos" provavelmente são **veículos de mídia**, não frota (hipótese, `DATA_AUDIT.md` §4).
2. Cliente e fornecedor podem ser a mesma empresa (7 documentos em comum): um cadastro de
   entidade com papéis, não duas tabelas sem ligação.
3. 22 dos 31 cedentes dos lançamentos casam com **fornecedor**, só 8 com cliente: vínculo
   sempre manual e confirmado.
4. O total bruto de R$ 319.451,59 inclui R$ 192.095,10 cancelados. Receita real importada:
   R$ 127.356,49.
5. Histórico é só receita: indicadores consolidados carregam o aviso de histórico parcial.

## D. Fora do escopo deste ciclo (sem arquivo de origem)

Despesas e contas a pagar importadas, propostas, produção, anexos, prestadores, dados
bancários. O módulo terá o cadastro e as telas para eles, mas **sem dado histórico**: nada
será inventado para preencher.
