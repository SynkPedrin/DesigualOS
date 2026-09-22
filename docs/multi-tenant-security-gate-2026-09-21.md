# DESIGUAL OS — MULTI-TENANT SECURITY GATE

Data: 2026-09-21. **Gate NÃO aprovado. Fase 2 incompleta.**

## Migration

Executadas no PostgreSQL real configurado em DATABASE_URL, PostgreSQL 17.6:

- 0035: organizations, organization_members e backfill de clients/automations.
- 0036: bloqueio do acesso público às tabelas de organização/membership, incluindo RLS e revogação de privilégios.
- 0037: revogação de privilégios de PUBLIC, anon e authenticated nas 68 tabelas da aplicação enumeradas explicitamente no SQL. Auth e Storage não foram modificados. Backend usa conexão confiável.

Antes: 9 usuários, 57 clientes, 1 automação; organizations inexistente. Depois: 1 organização, 9 memberships, 0 clientes sem organização, 0 automações sem organização, 0 usuários sem membership.

A execução de 0035 foi transacional, com lock_timeout de 5s, statement_timeout de 30s, bloqueio temporário das tabelas afetadas, snapshot privado e comparação integral dos campos anteriores. IDs e dados anteriores preservados. Reexecução pelo journal não duplicou organização nem memberships.

Backups privados: /Users/pedro/.desigual-os-backups/tenant-0035-1789993905693.json e tenant-0035-1789994301531.json. Contêm dados pessoais e não devem ser versionados. São snapshots das tabelas afetadas, não backups completos da instância.

Reprodução da verificação, em packages/database: `pnpm exec tsx src/tenant-migration-proof.mts` (somente leitura); `--apply` aplica 0035 somente se ausente do journal e valida preservação/backfill.

## Resources migrated

Clients e automations possuem organization_id. Organizations/memberships persistidos e preenchidos. Demais recursos ainda não receberam a propagação completa pedida nesta fase.

## Tenant Context

Novo requireTenant em apps/api/src/lib/tenant-context.ts. Resolve usuário autenticado, conta ativa/não excluída e membership diretamente no banco. Entrega userId, organizationId, membershipId, role e permissions. Com uma membership, seleciona a única organização. Com várias, exige x-organization-id e verifica membership; não escolhe a primeira linha. Ausência/ambiguidade nega acesso.

Integrado aos grupos de rotas clients e automations. Os demais grupos ainda precisam ser integrados. Master não ignora membership nos helpers hasClientAccess/hasOrganizationAccess.

## Automations / Clients

Listagem e métricas de automações filtradas no SQL. Criação deriva organization_id do contexto. Edição rejeita cliente de outra organização, inclusive quando o usuário pertence a ambas. Run/delete/histórico verificam a organização selecionada antes de efeitos externos. A política ainda utiliza chat:write para várias operações; granularidade de autorização e ownership de automações não está completa.

Clients: listagem filtrada, criação grava organização, preHandler verifica recursos :id no tenant selecionado. Concessão de client_users só encontra usuários com membership na organização atual.

Worker de automações: revalida criador ativo, membership, chat:write, escopo do cliente e vínculo da conversa antes de criar mensagem/disparar agente. Falhas registram automation_run failed. Isto não substitui propagação de tenant até cada tool nem testes completos de revogação durante execução.

## Tool Gateway

PENDENTE: contexto confiável por execução, autorização de todas as tools, integração ClickUp por organização, resolução de responsáveis e auditoria de ações. Não foi provado AGENT CANNOT ESCAPE TENANT.

## Studio / Memory / WebSocket

PENDENTES: propagação completa e testes cruzados. O WebSocket existente ainda possui eventos em broadcast sem fronteira comprovada por organização. Leitura de memória e acesso a assets/uploads/vaults ainda não possuem gate completo. A restrição à API pública do Supabase não restringe consultas efetuadas pelo backend privilegiado.

## Cross-Tenant Attack Suite

apps/api/src/automations/tenant-postgres.test.ts: 3 testes passaram usando PostgreSQL real isolado. Fastify usa rotas reais, Drizzle executa SQL real. Autenticação é substituída por principal de teste com master; operações de fila são spies para verificar ausência de efeitos. Portanto não é E2E de JWT/Redis/LLM.

Nos dois sentidos A→B e B→A: PATCH, DELETE, EXECUTE e histórico negados; LIST retorna somente a organização do ator; métricas isoladas; header de organização sem membership negado; POST com cliente externo negado; hasClientAccess rejeita master externo. Membership múltipla exige seleção explícita. Não houve chamada de fila nos ataques.

O container `desigual-tenant-security-qa-20260921` foi parado após os testes, preservando os dados locais de QA. Para reproduzir, iniciar esse container e consultar a porta com `docker port desigual-tenant-security-qa-20260921 5432/tcp` (porta original 52216).

Reprodução em apps/api: `TENANT_TEST_DATABASE_URL=postgres://postgres:tenant-qa-local-only@127.0.0.1:52216/postgres pnpm exec vitest run src/automations/tenant-postgres.test.ts`. URL exclusivamente de QA local; o teste rejeita hosts diferentes de 127.0.0.1. Sem a variável, a suíte é explicitamente skipped. Fixtures ficam no banco isolado, nunca na operação real.

## PostgreSQL

- Instância real: migração, backfill, preservação de dados e privilégios verificados.
- PostgreSQL 16 local vazio: todas as 38 migrations passaram; segunda execução não duplicou journal.
- Simulação das permissões padrão Supabase no PostgreSQL local: após migrations, anon não pode ler tabelas públicas.
- Banco real após 0037: zero tabelas públicas legíveis por anon e zero por authenticated.
- Health check da API local: status ok após migrations. Não houve reinicialização/deploy explícito dos serviços; o código foi validado no checkout.

## Regression

- typecheck: PASS, 18 pacotes; API revalidada após ajustes finais.
- lint: PASS sem erros; warnings preexistentes permanecem. A contagem anterior de 16 corresponde apenas ao worker, não ao repositório inteiro.
- test: PASS, 14 pacotes; suíte PostgreSQL executada separadamente e passou.
- build: PASS, 6 tarefas.
- Agent Loop: não ativado. AGENT_LOOP_V2 ausente no .env consultado; default de código é desligado. Ambiente herdado dos processos em execução não foi certificado.

## Remaining Risks

1. Isolamento de projetos, conversas, mensagens, execuções, memória, Studio, Canvas, WebSocket e tools incompleto. Não habilitar segundo tenant operacional nem autonomia usando este trabalho como certificação.
2. Provisionamento/convites de novos usuários precisam criar membership por fluxo confiável; migration cobre usuários existentes. Clientes criados por importadores/background legados ainda podem nascer sem organization_id.
3. Organization_id continua nullable em clients/automations; constraints compostas entre organização e referências ainda pendentes.
4. Membership role e permissões globais de usuário ainda não foram consolidados em autorização granular por tenant.
5. Snapshots de geração Drizzle posteriores ao 0034 precisam ser reconciliados antes de gerar a próxima migration automaticamente; migrations SQL/journal passaram no PostgreSQL.
6. Novas tabelas futuras precisam incluir restrição explícita à API pública; 0037 protege a lista atual, não altera default privileges globais.
7. Não executados: ataques via tools/LLM, testes realtime com dois usuários, isolamento semântico, carga, EXPLAIN ANALYZE, revogação em execução e E2E completo.

O resultado entregue comprova a migration real e controles específicos de clients/automations; não comprova o gate completo solicitado.
