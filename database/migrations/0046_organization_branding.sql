-- 0046_organization_branding.sql — a empresa passa a poder ter cara própria.
--
-- POR QUE ESTA MIGRAÇÃO EXISTE, medido no repositório em 30/09/2026 e não
-- suposto: `insert(schema.organizations)` não aparece UMA VEZ em todo o
-- monorepo. Nem `insert(organizationMembers)`. A tabela tinha exatamente dois
-- campos além dos de sistema — `name` e `slug`.
--
-- Ou seja: a 0045 deu ao produto a FRONTEIRA entre empresas, e ela funciona.
-- Mas não existia como CRIAR uma empresa pelo produto, nem onde guardar o que
-- a torna dela: logo, cor, nome do assistente, mensagem de boas-vindas. O
-- white-label não estava meio pronto — ele não tinha onde morar.
--
-- ADITIVA POR CONSTRUÇÃO, mesmo padrão da 0044 e da 0045: nenhuma coluna
-- existente muda de tipo, nenhuma é removida, tudo nasce NULLABLE ou com
-- default. A organização que já existe (a Desigual) continua funcionando sem
-- nenhum campo preenchido — e é assim que deve ser, porque o provedor usa a
-- marca do produto, não uma configuração de tenant.
--
-- UMA DECISÃO QUE VALE EXPLICAR: branding fica em COLUNAS, não num `jsonb`
-- solto. JSON aceitaria qualquer chave, e a primeira vez que alguém escrevesse
-- `primary_color` em vez de `cor_primaria` ninguém descobriria até a tela não
-- mudar de cor. Coluna com nome errado não compila.

ALTER TABLE organizations
  -- IDENTIDADE VISUAL. Tudo opcional: empresa sem logo usa o nome, empresa sem
  -- cor usa o token padrão do produto. Ausência aqui é um estado legítimo, não
  -- uma configuração pela metade.
  ADD COLUMN IF NOT EXISTS logo_url        text,
  ADD COLUMN IF NOT EXISTS favicon_url     text,
  ADD COLUMN IF NOT EXISTS cor_primaria    text,
  ADD COLUMN IF NOT EXISTS cor_secundaria  text,

  -- O ASSISTENTE DA EMPRESA. O produto chama de "Bento" por padrão; um cliente
  -- white-label pode chamar do que quiser, e é isso que faz a plataforma
  -- parecer dele e não nossa.
  ADD COLUMN IF NOT EXISTS nome_assistente   text,
  ADD COLUMN IF NOT EXISTS avatar_assistente text,
  ADD COLUMN IF NOT EXISTS mensagem_boas_vindas text,

  -- QUAIS MÓDULOS ESTA EMPRESA VÊ. `null` = todos os padrão. Guardado como
  -- array de texto e não como colunas booleanas porque a lista de módulos
  -- cresce, e acrescentar módulo não pode exigir migração.
  --
  -- ATENÇÃO, e está escrito aqui porque é o erro fácil: isto controla o que
  -- APARECE, nunca o que é PERMITIDO. Esconder item de menu não protege rota —
  -- a checagem continua sendo do enforcement central. Um dia alguém vai querer
  -- usar isto como permissão, e não é.
  ADD COLUMN IF NOT EXISTS modulos_visiveis text[],

  -- ESTADO DA CONTA. 'ativa' | 'suspensa'. Texto e não enum porque enum em
  -- Postgres exige migração para cada valor novo, e estado comercial é
  -- justamente o que mais ganha valores ('trial', 'inadimplente'...).
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ativa',

  -- QUEM CRIOU. Responde "de onde veio esta empresa?" sem depender de
  -- audit_log, e é `set null` de propósito: a empresa não pode sumir porque a
  -- pessoa que a criou saiu.
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- O slug é o identificador legível da empresa e já era UNIQUE. O índice abaixo
-- serve à busca por status na tela de Empresas do provedor, que passa a
-- filtrar ativas/suspensas quando houver mais de uma.
CREATE INDEX IF NOT EXISTS organizations_status_idx ON organizations (status);

-- DIAGNÓSTICO, não alteração: depois de aplicar, isto responde quantas
-- empresas existem e quantas já têm identidade própria. Com uma organização
-- (a Desigual) o esperado é 1 e 0 — o provedor não precisa de branding de
-- tenant, usa a marca do produto.
--
--   select count(*) as empresas,
--          count(*) filter (where cor_primaria is not null) as com_identidade
--   from organizations;
