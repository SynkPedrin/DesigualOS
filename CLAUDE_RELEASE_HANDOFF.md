# CLAUDE_RELEASE_HANDOFF — OpenAI + ClickUp MCP release

Status timestamp: 2026-09-25 (in progress, Claude weekly limit low — see note at end)

## CURRENT STATUS

Started implementation of the OpenAI+ClickUp MCP architecture described in the
mission prompt. Given the size of the ask (39 sections) and a tight remaining
Claude-quota budget, work is being done in this priority order, additive-first
(new packages/files that don't require rewriting the 2000+ line
`apps/worker/src/processors/bento-action-guard.ts` or `execute-job.ts`, which
are the highest-risk, highest-read-cost files in the repo):

1. OpenAI Responses provider (new, server-side only)
2. Model router (Luna/Terra/Sol) + budget enforcement
3. Cost ledger (DB schema + accounting)
4. `/ready` endpoint
5. ClickUp MCP client (remote MCP, OAuth)
6. ConversationResourceState + cardinality protection (touches bento-action-guard.ts — deferred, highest risk)

## COMPLETED

(updated as work lands — see git log on this branch `feat/otto-motion-engine`
for the checkpoint commits, prefixed `checkpoint:`)

- **`packages/openai-provider`** (commit `9f74fa2`): new additive package.
  - `credential.ts`: `resolveOpenAICredential()` / `isOpenAICredentialConfigured()`,
    env-only (`OPENAI_API_KEY`), throws `OpenAICredentialMissingError` — no
    silent fallback. Confirmed: **no Supabase-stored OpenAI credential exists
    in this repo today** (mission text assumed one existed; only
    `otto-motion` reads `OPENAI_API_KEY` from env for an unrelated purpose).
  - `models.ts`: `OPENAI_MODELS` (luna/terra/sol → real `gpt-5.6-*` ids),
    real pricing table (confirmed live via developers.openai.com/api/docs/pricing,
    2026-09-25), `budgetTierFromUsage()` (5-tier ladder from mission §6),
    `pickModel(taskKind, budgetTier)` (never auto-escalates, only downgrades,
    never silently swaps provider at 100%+), `computeOpenAICost()` (bills
    cached tokens at cached rate), `OUTPUT_TOKEN_LIMITS`, `MAX_TOOL_STEPS=6`.
  - `responses-client.ts`: thin Responses API wrapper, stable-prefix
    `instructions` + dynamic `input` (caching-friendly per §10), one retry
    only on retryable errors (429/5xx/timeout), returns real usage
    (input/cached/output) for the cost ledger to consume.
  - `budget.ts`: `BUDGET_CONFIG` reads `MONTHLY_TOTAL_BUDGET_USD=14.05` /
    `MONTHLY_OPERATIONAL_CAP_USD=12.00` / `EMERGENCY_RESERVE_USD=2.05` /
    `DAILY_TARGET_USD=0.40` from env with those exact defaults.
  - Tests: `models.test.ts`, 6 tests, **all pure functions, zero network,
    zero OpenAI cost**. `pnpm --filter @desigual-os/openai-provider
    typecheck` and `test` both green.
  - **Not yet wired into any caller** (Bento/Otto/router don't import this
    package yet — that's the next step, and it's where the actual
    integration risk lives).

- Repo recon done once (do NOT re-audit): key files are
  - `apps/api/src/server.ts` (Fastify bootstrap, route registration, `/health`)
  - `packages/tool-gateway/src/clickup-oauth.ts` (existing ClickUp **personal
    OAuth for API access**, NOT the same as ClickUp MCP OAuth — reuse the
    `token-crypto.ts` encrypt/decrypt pattern for any new stored credential)
  - `apps/api/src/lib/token-crypto.ts` (AES-256-GCM envelope encryption,
    key from `INTEGRATION_ENCRYPTION_KEY` or derived from `NODE_SECRET`)
  - `apps/api/src/integrations/access.ts` (`resolveClickUpAccess`: personal
    OAuth connection → fallback to shared `CLICKUP_API_KEY`/`CLICKUP_TEAM_ID`)
  - `packages/database/src/schema/integrations.ts` (`integrationConnections`
    table: userId+provider unique, encrypted token, workspace id/name, status)
  - `packages/database/src/schema/costs.ts` (`tokenUsage`, `modelUsage`,
    `costRecords`, `economyRecords` — existing cost tables; extend, don't
    duplicate)
  - `packages/token-engine/src/pricing.ts` (existing cost calc, Anthropic-only
    pricing table + generic `computeCost`/`estimateCost` — extend with
    gpt-5.6-* entries, keep the function signatures)
  - `packages/router/src/route.ts` + `local-classifier.ts` (existing
    deterministic-first routing between agents Bento/Jarbas/Suzy/Otto/Studio —
    NOT model routing; model routing (Luna/Terra/Sol) is a NEW, separate
    concern, do not conflate)
  - `packages/router/src/safe-complete.ts` (pattern to copy for
    OpenAI-without-tools text completion: **never give the model `tools` for a
    plain text-fill call** — real production incident where this was violated
    with a different provider)
  - `packages/otto/src/llm/ollama-provider.ts` + `config.ts` (Otto's current
    Ollama-only provider; migration target for section 25, not started)
  - `packages/otto-motion/src/providers/connection.ts:279-294` (already reads
    `OPENAI_API_KEY` from env for a DIFFERENT purpose — Motion Engine
    credential probe, unrelated to this mission; do not touch)
  - `packages/database/src/seed.ts` lines ~31-70: RBAC capability seeds.
    `clickup:write` capability IS granted to `jarbas` and `suzy` (confirmed
    P1-04 from audit) — needs a migration to deny, deferred (item 27 below)
  - `docs/forensic-audit-2026-09-25.md`: full audit already on disk, read
    once, do not re-read unless verifying a specific fixed item

- No `OPENAI_API_KEY` present in this environment. All OpenAI code paths must
  degrade to an explicit "not configured" error, never silently fall back.

## COMPLETED (round 2, same session continuation)

- **`/ready`** (`acfef27`): `apps/api/src/health/ready-routes.ts`, registered
  in `server.ts`. Zero-cost: DB ping, `readWorkerHealth()`, presence-only
  checks for `OPENAI_API_KEY` / ClickUp MCP OAuth config / shared ClickUp
  key, feature flags. Never calls OpenAI or ClickUp MCP.
- **RBAC P1-04** (`acfef27`): `packages/database/src/seed.ts` — `jarbas`/
  `clickup` and `suzy`/`clickup` downgraded from `write` to `read` in the
  `AGENT_TOOLS` matrix, with a backfill `UPDATE` for already-seeded DBs
  (same pattern as the existing `requiresApproval` backfill). Runtime
  behavior unchanged (neither agent writes ClickUp today) — pure permission
  correction, per explicit instruction not to touch Jarbas beyond RBAC.
- **Cost ledger** (`dbbedf9`): new table `ai_usage_ledger` in
  `packages/database/src/schema/costs.ts` (org/user/agent/conversation/
  model/provider/input+cached+output tokens/cost_usd/request_type/
  tool_steps/metadata). Migration `database/migrations/0042_add_ai_usage_ledger.sql`
  generated via `drizzle-kit generate` (offline, snapshot-based — **not
  applied to the live DB yet**, run `pnpm db:migrate` when ready).
  `packages/openai-provider/src/ledger.ts`: `recordOpenAIUsage()`,
  `dailySpendUsd()`, `monthlySpendUsd()`, `monthlySpendByModel()`,
  `monthlySpendByAgent()`, `currentBudgetTier()` (integrates real spend with
  `pickModel`/`budgetTierFromUsage`).
- **Otto → OpenAI (P0.1, partial)** (`f71d67a`): `packages/otto/src/llm/openai-provider.ts`
  implements the existing `OttoLLMProvider` interface (chat/chatJson/
  healthCheck) on top of `@desigual-os/openai-provider`, no `tools` given to
  the model (safe-complete.ts pattern). `OTTO_LLM_PROVIDER` default flipped
  from `'ollama'` to `'openai'` in `packages/otto/src/llm/config.ts`; Ollama
  is now the explicit rollback (`OTTO_LLM_PROVIDER=ollama`).
  `nodes/otto-node/src/execute.ts` `createDefaultDeps` branches on
  `config.otto.provider` — fixed at boot, never switched at runtime on
  failure. **Real behavior change**: any environment without
  `OPENAI_API_KEY` (every dev environment today) now has Otto's LLM calls
  throw `OttoLLMError` immediately instead of talking to local Ollama,
  unless `OTTO_LLM_PROVIDER=ollama` is set. This is what section 26
  ("quality degradation must be explicit") asks for, but flag it to Pedro.
  402 otto tests + 74 otto-node tests green (1 test adjusted for the new
  default), typecheck green, zero network in tests.
- **Bento → OpenAI: NOT DONE.** Bento's runtime does not go through an
  `OttoLLMProvider`-shaped abstraction — it talks to a remote node/service
  via `packages/tool-gateway/src/bento-qa-client.ts` /
  `agent-ask-client.ts` and structured guard code
  (`apps/worker/src/processors/bento-action-guard.ts`, 2185 lines). Wiring
  OpenAI as Bento's brain is a materially bigger change (new agent loop per
  section 20, not a provider swap) and was not attempted this round —
  budget was spent on the lower-risk, additive pieces first. This is the
  single biggest remaining gap for "OpenAI is the principal provider" to be
  true end-to-end.

## COMPLETED (round 3, same session continuation)

- **ClickUp MCP tool wiring + OAuth** (`362adc5`): confirmed real endpoint
  metadata live from `https://mcp.clickup.com/.well-known/oauth-authorization-server`
  (zero-cost, unauthenticated, not OpenAI/ClickUp API — just reading public
  discovery JSON): `/oauth/authorize`, `/oauth/token`, `/oauth/register`
  (RFC 7591 dynamic client registration), public client (`token_endpoint_auth_methods_supported: ["none"]`),
  PKCE S256 required. Implemented:
  - `packages/tool-gateway/src/clickup-mcp-oauth.ts`: PKCE pair, dynamic
    client registration, authorize URL builder, code exchange. **Distinct**
    from `clickup-oauth.ts` (personal ClickUp API OAuth, fixed client
    secret) per explicit mission instruction — do not merge them.
  - `packages/openai-provider/src/responses-client.ts`: `ResponsesToolDefinition`
    is now a real `function | mcp` union, type-checked against the
    **actual installed SDK** (`openai@4.104.0`) `Tool` type — no
    `as never`/unsafe cast hiding a mismatch (there was one: `strict` was
    missing on the function tool shape; fixed for real, not cast away).
  - `packages/openai-provider/src/clickup-mcp-tool.ts`: `buildClickUpMcpTool(token)`
    — the actual "OpenAI Responses → remote MCP tool → ClickUp MCP" wiring
    the mission asks for. Tool discovery/selection is native to the
    Responses API; **no regex-to-tool mapping was written**.
  - `apps/api/src/integrations/clickup-mcp-routes.ts`: `/integrations/clickup-mcp/authorize`
    + `/callback`. Token stored in the existing `integration_connections`
    table with `provider: 'clickup_mcp'` (distinct row from personal
    ClickUp OAuth). `getClickUpMcpAccessToken(userId)` returns the
    decrypted token or `null`.
  - **NOT DONE / NOT CALLABLE YET**: nothing actually calls
    `buildClickUpMcpTool` + `callResponses` together against a real
    conversation — that's the missing last wire (Bento still doesn't run
    through the Responses API at all, see below). No live network call was
    made to `mcp.clickup.com`'s OAuth endpoints (register/authorize/token)
    from this session — only the public `.well-known` read.

## CLICKUP MCP AUTH REQUIRED

Once this is deployed (API reachable at a real `API_PUBLIC_URL`, `FRONTEND_URL`,
`NODE_SECRET` set): an authenticated user opens
`GET /integrations/clickup-mcp/authorize`, follows the returned
`authorize_url`, logs into ClickUp, and authorizes the workspace. That's
the exact human action — nothing else blocks it structurally. Until that
happens, `getClickUpMcpAccessToken` returns `null` for everyone and no MCP
tool call can be built.

## COMPLETED (round 4 — BENTO CORE CUTOVER)

**The release blocker from the round-3 report is closed, behind a flag.**
Bento now has a real path: USER MESSAGE → `ConversationResourceState` →
OpenAI Responses (planner, no tools) → structured action → deterministic
policy → single write provider → existing verified executor (create/
update/comment, each with real read-back) → persisted resource state.

- **`packages/bento-core`** (`5221a55`): new additive package —
  `StructuredAction` (zod schema: intent/target/changes/requestedCardinality/
  reasoning), `ConversationResourceState`, `WriteEnvelope`,
  `evaluateCardinality` (P0-01 fix: `planned > requested` without explicit
  confirmation = blocked), `proposeBentoAction()` (Responses call with
  **zero tools** — same rule as `safe-complete.ts`/Otto's provider, the
  model cannot mutate anything from this call even if the input text
  contains an imperative), `validateBentoAction()` +
  `resolveTargetResourceId()` (100% deterministic, resolution priority
  exactly per spec: explicit id → focused → single selection → last
  execution → **null = ask for clarification, never global search**).
  12 tests, all mocked, zero network.
- **`apps/worker/src/processors/bento-resource-state.ts`** (`05bb498`):
  persists `ConversationResourceState` in the existing (previously unused)
  `conversation_context` table — no new migration. Append-only, same
  pattern as `execution-record.ts`/`selection.ts`.
- **`apps/worker/src/processors/bento-openai-core.ts`** (`05bb498`): the
  actual orchestration, **reusing already-verified production primitives**
  instead of duplicating logic: `loadSeniorRuntimeContext` (RBAC/authority),
  `resolveWriteTarget` (client/list resolution), `createVerifiedSeniorTask`
  (create, has read-back), `executeTaskUpdate` (update, has per-field
  read-back), `createTaskComment`+`getTaskComments` (comment + verify),
  `loadLatestExecutionState`+`sameExecutionAlreadyDone` (idempotency,
  P0.14). `provider` is **always `'LEGACY_GATEWAY'` in this delivery** —
  the MCP tool (`buildClickUpMcpTool`) is wired and ready, but real
  provider selection waits for ClickUp MCP OAuth to actually be authorized
  (round 3) and a live-verified round trip, which cannot happen in this
  session (zero paid calls). Scope: `create_task`/`update_task`/
  `comment_task` only — `read_tasks`/`get_task`/`analyze_tasks` return
  `null` on purpose (the pre-existing continuity fixes from round 1
  already cover reads/analysis well; rebuilding them here was out of
  scope for this specific blocker).
- **`apps/worker/src/processors/execute-job.ts`**: **one** isolated
  conditional insertion, `if (!guardedResult && agent === 'bento' &&
  bentoOpenAiCoreEnabled() && conversationId)`, placed immediately before
  the existing `tryBentoActionGuard` call. Verified byte-for-byte
  unchanged behavior with the flag off: **all 790 worker tests pass
  unmodified**, including the 34 `execute-job.test.ts` and 207
  `bento-action-guard`/`bento-action-execution` tests.

### Why the flag (`BENTO_OPENAI_CORE_ENABLED`) stays OFF in this delivery

There is no `OPENAI_API_KEY` in this environment, and the only way to
verify the new path end-to-end would be a real paid OpenAI call — forbidden
by the mission. Flipping the default to ON for the agent that runs the
agency's real day-to-day operation, with zero live verification possible,
would be irresponsible — this is the same reasoning already applied to
Otto, but the stakes here are materially higher (Bento is the
revenue-critical agent). **Turning the flag on is a deliberate, separate
operational decision** — not a blocker in the code. When `OPENAI_API_KEY`
exists, the recommended sequence is: enable the flag for one internal
test conversation first (not the shared Tammy line), watch the ledger, then
open it up. That first flagged conversation is the real canary for this
specific piece, on top of the mission's own "first real message" canary.

## SUPER-AGENT ADDENDUM — what's covered now vs. explicitly deferred

Per the addendum ("Bento = agency operations super-agent, don't build a
dead-end ClickUp chatbot, but don't expand scope past the release
blocker"), here's the honest split:

**Already present, load-bearing for the super-agent shape:**
- `ConversationResourceState` (short-term/working memory: focus, selection,
  recent create/update, last execution) — `bento-resource-state.ts`.
- Structured planning + policy separation (§2/§5 of the core spec) means
  the "reasoning core" is already decoupled from ClickUp specifically —
  `StructuredAction`'s `intent` enum is the seam where new intents (people,
  projects, other tools) get added without rearchitecting.
- Episodic execution memory already exists independently
  (`execution-record.ts`, pre-dates this session) and idempotency reuses it.
- Cost-aware model invocation exists (`pickModel`/`budgetTierFromUsage`) —
  the planner already asks for the cheaper tier by default for this
  request kind (`clickup_write` → Terra), so the super-agent's "don't burn
  credits on everything" requirement has its foundation.

**Explicitly NOT built this round (per addendum §23, "do not expand scope
past the core cutover"):** operational world model beyond resource state,
memory layers beyond short-term+episodic (no semantic/people-profile
memory), proactivity/event-driven reasoning, fact/inference/recommendation
labeling, commitments/follow-up tracking, daily-operations view. These are
real, correctly identified as the actual product vision, and the seams
above (`StructuredAction.intent`, the tool-plug point in
`bento-openai-core.ts`) were deliberately kept open for them — but building
them now would be scope creep on top of an already-large, unverified
change to the agency's primary operational agent. Recommend tackling them
as follow-up work items, one at a time, each independently flaggable, after
the core cutover has run as a real canary.

## FILES CHANGED

(fill in as commits land — check `git log --oneline` and `git diff main...HEAD --stat`
on this branch instead of trusting this list if it looks stale)

## WHAT WORKS

(nothing shippable yet as of this checkpoint — see NEXT EXACT STEP)

## WHAT REMAINS

All 39 mission sections. Concretely, in priority order:

- [ ] `packages/openai-provider` (new pkg): Responses API client,
      `resolveOpenAICredential()` (server env var `OPENAI_API_KEY` only, never
      logged/exposed — reuse the "fail loud, never silent fallback" pattern
      from `apps/api/src/server.ts` FRONTEND_URL check), bounded tool-loop
      (`MAX_TOOL_STEPS=6`), structured usage return (input/cached/output
      tokens) per call.
- [ ] Model router: `pickModel(taskKind, budgetState) -> 'gpt-5.6-luna' |
      'gpt-5.6-terra' | 'gpt-5.6-sol'`, escalation ladder per section 6,
      budget-tier awareness (0-70/70-85/85-95/>=95/>=100%).
- [ ] Budget/cost ledger: new table `ai_usage_ledger` (org/user/agent/model/
      conversation/input/cached/output tokens/cost_usd/request_type/
      tool_steps/timestamp) in `packages/database/src/schema/costs.ts` +
      migration; monthly/daily aggregation queries; env vars
      `MONTHLY_TOTAL_BUDGET_USD=14.05`, `MONTHLY_OPERATIONAL_CAP_USD=12.00`,
      `EMERGENCY_RESERVE_USD=2.05`.
      Real OpenAI pricing confirmed 2026-09-25 (developers.openai.com/api/docs/pricing):
      luna $0.20/$0.02 cached/$1.20 per 1M, terra $2/$0.20/$12, sol $4/$0.40/$20
      (long-context ~2x above a threshold not published in the pricing page).
- [ ] `/ready` route in `apps/api/src/health/routes.ts` (zero-cost: DB ping,
      queue ping, worker heartbeat row, `OPENAI_API_KEY` presence bool,
      ClickUp MCP OAuth token presence bool, key feature flags). Must NOT
      call OpenAI.
- [ ] ClickUp MCP: remote MCP client against `https://mcp.clickup.com/mcp`,
      OAuth (separate from the existing personal ClickUp API-key OAuth in
      `clickup-oauth.ts` — MCP OAuth is a distinct grant), token storage
      reusing `integration_connections` table with `provider: 'clickup_mcp'`
      or a new table, connect/callback routes, tool discovery at runtime (no
      hardcoded tool names).
- [ ] Policy layer: validate a structured proposed action (tenant/org/client/
      resource id/permission/mutation budget/duplicate/destructive scope)
      BEFORE any MCP or legacy write — this is new code, not a rewrite of
      `bento-action-guard.ts`.
- [ ] `ConversationResourceState` (new table/module): persists
      focusedResource/selectedResources/recentCreated/recentUpdated per
      conversation; resolve "essa task"/"ela" against it. This is the
      P0-02 fix from the audit. Integration point is
      `apps/worker/src/processors/bento-action-guard.ts` (2185 lines) —
      **read only the relevant section before touching it**, do not re-read
      the whole file.
- [ ] Cardinality protection (P0-01): one requested entity → one mutation.
      Likely fix site: `apps/worker/src/processors/multi-create-executor.ts`
      (391 lines, not yet read) and `bento-action-guard.ts`'s action-plan
      builder. **Not started — needs a targeted read of multi-create-executor.ts
      only.**
- [ ] Unified write result envelope (`success/verified/provider/resourceIds/
      operation/changes/error/retryable/sources`) — check
      `apps/worker/src/processors/execution-record.ts` (369 lines, exists
      already, may already be close to this shape — read before building new).
- [ ] Idempotency key (org+conversation+operation+resource+normalized
      mutation) — check existing idempotency in
      `packages/tool-gateway/src/senior-operation.ts` /
      `apps/worker/src/processors/execute-job.ts` before adding new.
- [ ] Otto → OpenAI migration (section 25) — separate package, do after
      Bento path is solid.
- [ ] RBAC cleanup: migration to remove `clickup:write` from `jarbas`/`suzy`
      seed rows in `packages/database/src/seed.ts` (~line 52, 57) + deny test.
      Explicitly allowed to touch (mission: "align RBAC with intended
      architecture", "do not modify Jarbas/Suzy behavior beyond the
      permission correction").

## NEXT EXACT STEP (as of round 3)

The single biggest remaining gap: **Bento does not run through the OpenAI
Responses API at all.** Everything built so far (provider, model router,
cost ledger, MCP tool, MCP OAuth) is real and typechecked but unwired from
Bento's actual request path. Bento today is
`apps/worker/src/processors/execute-job.ts` → `bento-action-guard.ts`
(2185 lines) → remote node/service via `tool-gateway/bento-qa-client.ts` /
`agent-ask-client.ts` — NOT an LLM-provider abstraction like Otto has. This
is a new agent loop (section 20), not a provider swap, and is the correct
next step but is materially riskier (biggest, most load-bearing files in
the repo). Concretely, in order:

1. Read (narrowly — do not re-read the whole file) how
   `bento-action-guard.ts` currently decides `write_authorized` and what it
   passes to the executor, to find the seam where a `callResponses` +
   `buildClickUpMcpTool` call could replace/augment the remote-node call
   without breaking `createManyTasks`/read-back/execution-record.
2. Build the structured-action contract (P0.9): model receives
   {user message, focused resource, selected resources, client, last
   execution, available MCP tools} and returns a structured proposal
   (operation/resourceId/changes) — this is new code, additive, can be
   built and unit-tested BEFORE wiring it into the guard.
3. Build the policy layer (P0.10) that validates that structured proposal
   (tenant/org/client/permission/mutation budget/duplicate/destructive
   scope) — also additive, testable in isolation.
4. Only then wire steps 2+3 into `bento-action-guard.ts`, behind a feature
   flag (same pattern as `BENTO_MULTI_ACTION_WRITE`/`OTTO_MOTION_ENABLED`),
   so the existing verified path keeps working if the flag is off.
5. Single-write-provider guarantee (P0.11), unified envelope (P0.12,
   `execution-record.ts` may already be close — check before building),
   read-back (P0.13, likely already covered by existing `createManyTasks`
   read-back — verify, don't rebuild), idempotency (P0.14), sources
   (P0.16) — these mostly fall out of steps 2-4 once the new loop exists;
   they are not separately buildable without it.

Do NOT attempt step 4 (the actual `bento-action-guard.ts` edit) without a
clear, narrow plan for exactly which lines change — that file is the one
most likely to break production Bento if edited carelessly.

## KNOWN BLOCKERS

- No `OPENAI_API_KEY` in this environment → OpenAI provider code can be
  written and typechecked but not exercised live. Per mission rule, this is
  correct: zero paid OpenAI calls during this mission regardless.
- ClickUp MCP requires OAuth authorization by Pedro in a browser. Cannot be
  completed by the agent. When the OAuth connect/callback routes exist,
  report back: **CLICKUP MCP AUTH REQUIRED** with the exact authorize URL,
  then stop only at that step.
- `bento-action-guard.ts` (2185 lines) and `execute-job.ts` (2371 lines) are
  the biggest, riskiest files to touch (cardinality fix, resource state
  integration). Budget reading time carefully — read only the function(s)
  needed, not the whole file.

## COMMANDS TO CONTINUE

```bash
cd /Users/pedro/DesigualOS
git log --oneline -20                     # see checkpoint commits so far
git diff main...HEAD --stat                # see all files touched on this branch
cat docs/forensic-audit-2026-09-25.md      # full audit, read once
pnpm --filter @desigual-os/api typecheck
pnpm --filter @desigual-os/worker typecheck
pnpm turbo run typecheck                   # full repo, slower
```

Do NOT run any script that calls a live OpenAI or ClickUp MCP endpoint
(no paid inference during this mission per explicit instruction).
