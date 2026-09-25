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

## NEXT EXACT STEP

Implement `packages/openai-provider` (Responses API wrapper +
`resolveOpenAICredential`) and the model router with budget enforcement,
since these are additive, low-risk, and unblock the cost-ledger work. Then
typecheck that package only (`pnpm --filter <pkg> typecheck`), commit
`checkpoint: openai provider`, and move to `/ready`.

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
