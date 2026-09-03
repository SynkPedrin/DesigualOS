# ADR 0001: Usar Supabase completo (Postgres, Auth e Storage)

## Contexto

O prompt mestre (seção 4) definia Postgres self-hosted via Docker, Auth/JWT custom (seção 6.8) e MinIO/S3 como storage de assets do Studio (seção 4). O usuário forneceu um projeto Supabase já criado (`dddchncdrgbhdirytdsp`) com chaves de API (`sb_publishable_...`, `sb_secret_...`) e escolheu explicitamente usar a plataforma completa do Supabase em vez de hospedar essas peças por conta própria.

## Decisão

- **Postgres:** o banco do Orchestrator passa a ser o Postgres gerenciado pelo Supabase, acessado via connection string direta (`DATABASE_URL`) pelo Drizzle ORM, exatamente como o restante do prompt mestre especifica (migrations versionadas, schema em `packages/database`). Nada muda no modelo de dados da seção 8.
- **Auth:** a autenticação de usuários (login, sessão) passa a ser feita pelo Supabase Auth, em vez de um JWT emitido pelo próprio Orchestrator. A tabela `users` (seção 8) vira um perfil de aplicação, com uma coluna `auth_user_id` que referencia o usuário correspondente no Supabase Auth. RBAC (roles, permissions, user_roles) continua modelado e aplicado pelo Orchestrator; o Supabase só resolve "quem é o usuário", não "o que ele pode fazer". Wiring completo entra na Fase 13.
- **Storage:** os assets do Studio (seção 7.3) passam a ser armazenados no Supabase Storage em vez de MinIO/S3 self-hosted. `docker-compose.yml` não sobe mais serviço de storage local; só Redis (para BullMQ) continua rodando via Docker em dev.
- **Node Agents e chaves de API** (Anthropic, OpenAI, ClickUp, Meta, Instagram) continuam fora do Supabase, geridas como segredos do Orchestrator conforme a seção 10, sem mudança.

## Consequência

- `docker-compose.yml` fica mais simples (só Redis); Postgres, Auth e Storage são serviços gerenciados externos, o que reduz a operação em dev mas cria uma dependência de rede externa mesmo em ambiente local.
- A cadeia de verificação de acesso da seção 6.8 (`Usuário -> Role -> Permission -> Client Access -> Agent Access -> Tool Access -> Execution`) muda o primeiro passo: em vez de validar um JWT próprio, o Orchestrator valida o JWT emitido pelo Supabase Auth e então aplica o RBAC próprio a partir do `auth_user_id`.
- A secret key do Supabase (`sb_secret_...`) tem acesso administrativo total ao projeto (bypassa RLS). Fica só no `.env` do servidor, nunca no frontend nem versionada, conforme a regra de ouro 6.
- Regra de ouro 1 (nunca sincronizar os Obsidian Vaults dos agentes para o servidor) não é afetada: o Supabase Storage guarda apenas assets do Studio, não conhecimento dos agentes.

## Addendum: Session Pooler em vez de Direct Connection

O host de conexão direta (`db.<ref>.supabase.co`) só tem registro DNS IPv6 (AAAA), sem IPv4, que é o padrão atual do Supabase a menos que o add-on de IPv4 seja contratado. Para não depender da rede de quem roda a API ter suporte IPv6, `DATABASE_URL` usa o Session Pooler (`aws-0-us-east-1.pooler.supabase.com:5432`, usuário `postgres.<project-ref>`), que roda sobre IPv4 e é compatível com DDL (diferente do Transaction Pooler, que pode ter problemas com prepared statements e alguns comandos DDL). Conexão validada manualmente em 2026-09-01.
