# Gestão Empresarial: andamento da implementação

Branch: `feature/gestao-empresarial-local` (worktree `.claude/worktrees/gestao-empresarial`, base `origin/main` f8fcf6c).
Escopo: **somente local**. Sem deploy, sem push, sem migration em produção, sem banco de produção.

Este arquivo só marca como feito o que roda e tem teste. "Simulado" nunca conta como pronto.
A coluna "Prova" diz como cada item foi verificado; o que não foi verificado está em §E.

## Status das fases

| # | Fase | Status | Prova |
|---|---|---|---|
| 1 | Auditoria (repositório e dados Operand) | Concluída | `DATA_AUDIT.md`; números reproduzidos por duas implementações independentes |
| 2 | Arquitetura | Concluída | §B |
| 3 | Banco de dados | Concluída | migrations 0085 e 0086, 21 tabelas `ge_*`, 38 CHECKs em SQL, 14 testes contra Postgres real |
| 4 | Layout e navegação interna | Concluída | 1 item no menu, 7 seções, gate no servidor; capturas com login real local |
| 5 | Cadastros | API concluída; tela em construção | testes de integração na API |
| 6 | Financeiro | API concluída; telas em construção | 40 testes de integração (razão, estorno, parcelas, conciliação) |
| 7 | Comercial | API concluída; telas em construção | 29 testes de integração (inclui faturamento) |
| 8 | Produção | API concluída; telas em construção | idem |
| 9 | Importador | API e tela concluídas | 27 testes unitários e 17 de integração, incluindo os arquivos reais |
| 10 | Integrações | Concluída dentro do módulo | pedido de venda gera contas a receber; custo de produção gera despesa |
| 11 | Relatórios | API concluída; telas em construção | visão geral, atraso, resultado, rentabilidade, funil, CSV seguro |
| 12 | QA e E2E | Em andamento | §D |

## A. Auditoria do repositório

Monorepo pnpm + turbo. O que o módulo respeita:

- **API** `apps/api`: Fastify + Zod, `requireAuth` + `requireTenant`; auditoria por `auditarAcao`.
- **Papéis** (`packages/auth`): `master` e `colaborador`. O módulo exige `master` **na API**.
- **Banco** `packages/database`: Drizzle, migrations em `database/migrations`. Não existia código financeiro.
- **Web** `apps/web` (Next.js 16): navegação em `nav-items.ts`; filtro puro em `nav-visibility.ts`.
- **Colisão de nome:** `/gestao` já é "Gestão da equipe". O módulo usa `/gestao-empresarial`.

## B. Arquitetura

- **Portão em três camadas, todas no servidor** (`acesso.ts`): módulo ligado (`GESTAO_EMPRESARIAL_ENABLED=true`,
  desligado por padrão: sem ela a rota é 404); em `NODE_ENV=production` continua desligado sem o segundo aceite
  `GESTAO_EMPRESARIAL_ALLOW_PRODUCTION=sim`; e papel `master`. O item do menu só aparece se `/access` disser sim.
- **Dinheiro** é inteiro em centavos (`bigint`). Nenhum float no banco, na API nem no navegador.
- **Razão só de inserção** (`ge_ledger`): estorno é uma linha nova que aponta para a original; lançamento confirmado
  nunca é apagado. Saldo = saldo inicial (se conhecido) + soma do razão.
- **Vencido não é status guardado**: é "aberto com vencimento no passado", calculado na leitura.
- **Entidade com papéis**: cliente, fornecedor, veículo de mídia, prestador e colaborador são papéis do mesmo
  cadastro (7 documentos aparecem como cliente e fornecedor).
- **Importação em staging**: nada vira registro final sem aplicar; mesmo arquivo (sha256) não entra duas vezes;
  chave de origem torna a reimportação idempotente; nome igual nunca junta cadastros.
- **Isolamento por organização** em toda consulta e em toda referência recebida (id de outra empresa vale 404).
- **Paginação no servidor** em toda lista (teto de 100 por página).

## C. Decisões e achados

1. "Veículos" são **veículos de mídia** (confirmado por Pedro em 22/10/2026).
2. 22 dos 31 cedentes dos lançamentos casam com **fornecedor**, só 8 com cliente: vínculo sempre manual.
3. O bruto de R$ 319.451,59 inclui R$ 192.095,10 cancelados; receita importável R$ 127.356,49. Cancelado nunca entra
   em receita nem despesa.
4. O export não traz a data real do pagamento: os 122 quitados entram com `paid_at_unknown` (nunca o vencimento no
   lugar) e **não geram movimento no razão** (a conta é desconhecida).
5. Histórico só de receita: indicadores consolidados carregam o aviso de histórico parcial.
6. Defeito real achado e corrigido: subconsulta correlacionada na lista de propostas e de pedidos de produção
   devolvia total 0 e margem 100% (o Drizzle omite o nome da tabela na lista de colunas do SELECT).
7. `drizzle-orm 0.33` ignora `check()` em silêncio; as constraints estão em SQL na migration, com teste.

## D. Como verificar

```bash
scripts/gestao-empresarial/local.sh up      # banco, redis, login falso, API e front, tudo local
# http://localhost:3210/login   admin@local.test / gestao-local-admin
GESTAO_TEST_DATABASE_URL=postgres://postgres:gestao_local_dev@127.0.0.1:55440/gestao_empresarial \
GESTAO_DADOS_OPERAND_DIR="<pasta DADOS OPERAND>" \
  pnpm --filter @desigual-os/api exec vitest run src/gestao-empresarial
```

O ambiente recusa rodar se houver `.env` no checkout e sobe os processos com `env -i`.

## E. O que NÃO foi verificado ou não existe

- Telas de Financeiro, Comercial, Produção, Cadastros e Relatórios: em construção; só valem como prontas depois da
  verificação no navegador descrita em cada entrega.
- Nenhum teste rodou contra Supabase de produção, nem deve rodar.
- Despesas, propostas, produção, anexos, prestadores e dados bancários **não existem** nos arquivos do Operand: o
  módulo tem as telas e o banco para eles, sem dado histórico.
- Pagamentos reais, conciliação com banco real e qualquer ação financeira externa estão fora do escopo.
