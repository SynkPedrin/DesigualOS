# Migração do Supabase para São Paulo (sa-east-1)

Motivo e medição: `docs/deploy/supabase-sao-paulo.md`.

Tudo aqui lê as credenciais de `~/.desigualos/novo-supabase.env` (nunca do repositório):

```
NOVO_REF=<ref do projeto novo>
NOVO_DATABASE_URL=postgresql://postgres.<ref>:<senha>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
NOVO_SUPABASE_URL=https://<ref>.supabase.co
NOVO_PUBLISHABLE_KEY=...
NOVO_SECRET_KEY=...
```

e as do projeto atual do `.env` de produção (`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`).

| Passo | Script | O que faz | Toca no atual? |
|---|---|---|---|
| 1 | `copiar-banco.sh` | `pg_dump` de `public` + `drizzle` + logins (`auth.users`, `auth.identities`) e restaura no novo | só lê |
| 2 | `copiar-storage.mjs` | recria os buckets e copia cada arquivo | só lê |
| 3 | `reescrever-links.sql` | troca `<ref antigo>.supabase.co` por `<ref novo>.supabase.co` no NOVO (fora `audit_logs`) | não |
| 4 | `conferir.sh` | contagem de linhas tabela a tabela, nos dois lados | só lê |

Ensaio = passos 1–4 com o sistema no ar. Virada = parar api/worker, repetir 1–4, trocar as chaves.
