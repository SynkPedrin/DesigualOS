# Desigual OS 2.0 — Step 1: inventário forense de `apps/api` e `apps/web`

**Data:** 30/09/2026 · **SHA:** 740a12d · **Autor:** sessão desigualos-61
**Escopo:** a metade acordada com a sessão desigualos-26, que cobre schema, RBAC e MCP.

Tudo aqui foi **medido no repositório e no banco**, não estimado. Onde não deu para
medir, está escrito que não deu.

---

## 1. O achado que decide a Fase A

**A fronteira de organização não existe no dado de conteúdo. Existe uma convenção
que cada consulta precisa lembrar de aplicar.**

Medido no banco: **9 de 77 tabelas têm `organization_id`**.

| Têm | Não têm — e são as de conteúdo |
|---|---|
| clients, audit_logs, mcp_tokens, mcp_sessions, operational_events, organization_members, automations, agent_tasks, ai_usage_ledger | **memories, conversations, messages, executions, agent_episodes, proactive_signals** |

Hoje o isolamento dessas seis é indireto: salta por `client_id` → `clients.organization_id`,
ou por `user_id` → `organization_members`. Funciona porque existe **uma organização só**
(confirmado pela outra sessão: `b534f65c…`, única no banco).

**Por que isso é P0 e não detalhe:** a mesma forma de defeito apareceu DUAS VEZES em
30/09, com uma organização só —

- `/memories` (API) devolvia anotação `USER_PRIVATE` de outra pessoa;
- `search_memory` (MCP) fazia o mesmo, e pior: o `get_client_context` nunca entregava
  brain nem dossiê porque perfil competia com episódio pelas mesmas 8 vagas.

Nos dois casos a regra existia — noutro arquivo. O que faltou foi a segunda porta
saber dela. Com um tenant só, o preço foi constrangimento. Com dois, é contrato.

**Decisão proposta:** `organization_id` nas seis tabelas + enforcement central
(seção 82 do prompt: "não espalhar permission checks manualmente em 40 endpoints").
Convenção que depende de memória de quem escreve já falhou duas vezes num dia.

---

## 2. `apps/api` — 29 módulos, 122 rotas

Medido por módulo: presença de recorte de organização (`organizationId`,
`tenantSharingScope`) e de checagem de papel (`requirePermission`, `roles.includes`).

### 2.1 Têm recorte de organização — 10 módulos

`automations` · `clients` · `conversations` · `episodes` · `executions` ·
`memories` · `projects` · `search` · `signals` · `tool-calls`

São a referência do que já funciona. `tenantSharingScope` (`apps/api/src/lib/access.ts`)
é o mecanismo a **generalizar**, não a substituir.

### 2.2 Só papel, sem organização — 9 módulos

`admin` · `chat` · `clickup` · `costs` · `data-quality` · `health` ·
`integrations` · `nodes` · `studio`

Checam **quem é** (master/colaborador) e não **de qual empresa**. Num mundo
multi-tenant, um TENANT_ADMIN da Cosentino com o papel certo alcança dado de outro
tenant. `clickup` é o mais grave: 9 rotas, 10 checagens de papel, zero de organização,
e é a porta para a operação inteira.

### 2.3 Nem papel nem organização — 10 módulos

`agents` · `auth` · `collaborators` · `mcp-status` · `messages` · `motion` ·
`notifications` · `panorama` · `team` · `uploads`

Alguns são legítimos (`auth`, `uploads`). Outros não:

- **`collaborators` e `team`** devolvem a lista de PESSOAS. Sem recorte, um tenant
  enxerga a equipe de outro.
- **`mcp-status`** devolve quem está conectado ao MCP, com escopos.
- **`panorama`** — **escrito por mim hoje**, e nasceu sem recorte. Registro aqui em
  vez de corrigir em silêncio: é exatamente o defeito que este documento denuncia,
  cometido por quem o está escrevendo, seis horas depois de corrigir o mesmo em
  `/memories`. É a prova prática de que convenção não sustenta a fronteira.

---

## 3. `apps/web` — a UI não sabe o que é um tenant

### 3.1 `/me` não devolve organização

`apps/web/src/lib/api/contracts.ts:70` — `MeResponse` tem `id`, `email`, `name`,
`roles`, `permissions`, `avatarUrl`, `language`, `theme`, `clickupEmail`.
**Nenhum campo de organização ou tenant.**

Consequência: não existe como o front saber em qual empresa está. Tenant switcher
(seção 61), branding por tenant (seção 20) e sidebar por tenant (seção 22) não têm
de onde ler.

**Decisão:** `/me` passa a devolver a organização ativa e as organizações
acessíveis. É a mudança que destrava as seções 20, 22, 59, 61 e 62 de uma vez.

### 3.2 O shell não conhece tenant

`apps/web/src/components/shell/` — zero ocorrências de `organization` ou `tenant`.
Existe **um** shell (`app/(shell)/layout.tsx`), o que é bom: a seção 32 pede para
não duplicar aplicação. O caminho é o shell ler o tenant do contexto, não nascerem
dois.

### 3.3 Os tokens nomeiam a COR, não o papel

`apps/web/src/styles/tokens.css:13-37`:

```css
--color-roxo-eletrico: #9333ea;
--color-ametista:      #6b21a8;
--color-branco-cru:    #fafaf7;
--color-carbono:       #0f0f0f;
--color-grafite:       #1c1c1e;
```

A camada de token existe — o que a seção 21 pede como fundação. Mas ela é a
**identidade da Desigual escrita no nome da variável**. Um tenant de marca verde
teria um token chamado *roxo elétrico* contendo verde, e todo componente do produto
lendo `text-roxo-eletrico`.

**Decisão:** camada semântica (`brand.primary`, `brand.surface`, `brand.text`) que
por padrão aponta para os tokens atuais. A Desigual não muda de cara, e o tenant
ganha onde sobrescrever. Renomear os 200+ usos de uma vez seria rewrite; apontar é
evolução (seção 41).

### 3.4 Marca espalhada e cor fora do token

- **23 arquivos `.tsx`** citam "Desigual" ou "Bento" literalmente.
- Hex fora dos tokens, os mais frequentes: `#ffffff` (17), `#8b8b93` (5),
  `#1c1c1e` (5), `#a78bfa` (4), `#7b2eff` (4).

Parte desses hex é **minha, de hoje**, no `painel-do-dono.tsx` — recharts não lê
variável CSS direto e eu passei a cor na mão. É dívida que eu criei e que precisa
entrar na camada semântica junto com o resto.

---

## 4. Matriz de reuso — a minha metade

| Capacidade | Existe | Estado | Decisão |
|---|---|---|---|
| Shell único | sim | `app/(shell)/layout.tsx` | **reutilizar**, injetar tenant |
| Navegação por seção | sim | `nav-items.ts`, reescrito hoje | **adaptar**: filtrar por tenant/feature |
| Design tokens | sim | nomeia cor, não papel | **generalizar**: camada semântica por cima |
| Primitivos de UI | sim | `components/control/primitives.tsx` | **reutilizar** |
| Gráficos | sim | recharts, no painel novo | **reutilizar**, tirar hex da mão |
| Recorte por organização | parcial | `lib/access.ts`, em 10 de 29 módulos | **generalizar**: enforcement central |
| Papéis | sim | master/colaborador | **estender**: PROVIDER_* / TENANT_* |
| `/me` | sim | sem organização | **adaptar** |
| Branding configurável | **não** | — | **criar** |
| Tenant switcher | **não** | — | **criar** |
| Tela de Empresas (seção 60) | **não** | — | **criar** |
| Consentimento (seção 19) | **não** | — | **criar** |

Nada na minha metade pede rewrite. O shell, os primitivos e a navegação de hoje
sustentam Master e Tenant; o que falta é **contexto de tenant e uma camada semântica
de marca**.

---

## 5. O que este inventário NÃO cobre

Honestidade de escopo: `packages/*`, `apps/worker`, `apps/mcp`, schema e migrations
são da outra sessão. Não os inventariei e não devo palpitar sobre eles aqui.

Também não medi: quantas das 122 rotas quebram sob um segundo tenant. Isso exige
teste de isolamento (seção 44), que é entregável da Fase H e não de um inventário.

---

## 6. Próximo passo que eu recomendo

A seção 78 propõe Fase A = foundation. Pela medição acima, dentro da Fase A a
ordem que reduz risco é:

1. `organization_id` nas seis tabelas de conteúdo + backfill a partir do vínculo
   que já existe (`client_id` / `user_id`) — **com validação de contagem antes e
   depois** (seção 42);
2. enforcement central, para a fronteira deixar de depender de quem escreve a
   consulta;
3. `/me` com organização;
4. camada semântica de marca.

Fazer 3 e 4 antes de 1 e 2 entrega uma UI multiempresa por cima de um banco que
não separa empresas. Seria a versão bonita do vazamento.
