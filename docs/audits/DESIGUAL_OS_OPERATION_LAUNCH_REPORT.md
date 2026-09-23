# DESIGUAL OS — OPERATION LAUNCH REPORT

PREVIOUS SHA: `ceea0be091ed1b2f58a83c5ed9ca0a59d960551c` (pre-mission HEAD, rollback target)
RC SHA: `afd24c3dca8b6669aff97c937083457bda34d27d`
DEPLOYED SHA (API/worker, production, this machine): `0659aa4c0b8b8d14dbd4c3ba30b6f8fb5e0b3bf4` (API) / `afd24c3dca8b6669aff97c937083457bda34d27d` (worker) — see note below on the one-commit gap.

DEPLOY TIME: 2026-09-22 ~20:01 UTC (API first restart) through 2026-09-23 ~11:46 UTC (last worker restart, after the DELETE fix)

**Web/Vercel: NOT DEPLOYED.** `git push origin main` was blocked by the Claude Code auto-mode classifier (`[Out-of-Place Publication]`) — 29 commits / 135 files / ~14.7k lines are committed locally, tested, and ready, but never reached `origin/main`, so the published front (`desigual-os.vercel.app`) is still running the OLD, pre-mission build. **I did not attempt to route around the classifier.** This is the single explicit action item left for you: run `git push origin main` (or grant permission for me to) to trigger the Vercel deploy, then re-verify `/api/version` on the published URL.

## PRODUCTION

WEB: **NOT DEPLOYED** (see above)
API: PASS — healthy, `0659aa4`, zero startup errors, zero 5xx across all traffic observed
WORKER: PASS — healthy, `afd24c3`, heartbeat fresh, zero jobs backlogged
DB: PASS — real queries succeeding throughout (conversations, executions, tenant scoping, all CRUD operations)
REDIS: PASS now — **went down mid-session** (machine/Docker Desktop restart between turns), self-healed automatically once Docker Desktop restarted, confirming the `restart: always` fix (this same session) works as designed
QUEUE: PASS — all 6 queues (`bento`/`jarbas`/`suzy`/`studio`/`otto`/`automations`) at 0 waiting/active
OLLAMA/GPU: PASS — gpu-gateway reachable, inference completing (~11-14s per turn observed)
WS: PASS — confirmed via `/ws?token=...` requests in logs, properly redacted

**Note on the SHA gap:** worker is one commit ahead of API (`afd24c3` vs `0659aa4`) because the last commit (explicit-link resolution for DELETE) only touched a worker-only file. No functional risk — API doesn't consume that code path.

**Note on Tailscale/nodes:** mid-session the machine lost its Tailscale connection (same event that took Redis down); all 5 remote agent nodes (bento/otto/jarbas/suzy/studio) briefly showed offline. I restarted Tailscale (`tailscale up`) and all 5 recovered within ~30s. Currently: 4/5 `online`, Bento node itself self-reports `degraded` (heartbeat fresh, functioned correctly through 20+ real test turns — the degraded flag is some internal metric on that node I did not chase down further; non-blocking based on observed behavior).

## RELEASE IDENTITY

Web SHA: N/A (not deployed)
API SHA: `0659aa4c0b8b8d14dbd4c3ba30b6f8fb5e0b3bf4` (provable live via `GET /health` → `release_sha`)
Worker SHA: `afd24c3dca8b6669aff97c937083457bda34d27d` (provable live via `GET /health/infrastructure` → `worker.release_sha`)
Nodes: desigual-node and otto-node both now report `release_sha` in `/health` (otto-node already had it; desigual-node gained it this session). studio-node has no HTTP server, so no equivalent endpoint exists to check.
Schema version: `0037_restrict_public_data_api` (provable live via `GET /health` → `schema_version`)

## P0

**P0-01 (update virou create):** CLOSED + evidence. DELETE primitive added (didn't exist before); the exact original regression phrase ("altere essa task para o status 'pronto'") re-verified live against a real ClickUp list this session — correctly updates the same task, zero new task. A **second**, previously-unknown instance of the same bug class was found live in this session's own E2E (`"atualiza aquela task"` with zero conversation history creating a real task) and fixed (`EXPLICIT_TASK_REFERENCE` check in `decideFallbackIntent`).

**P0-02 (fronteira de organização):** CLOSED + evidence. All originally-cited routes (conversations, executions, search, tool-calls, projects, WS `message.delta`, Bento's own CREATE client-resolution) now organization-scoped, each with tenant-isolation tests. Both previously-deferred sub-items resolved this session with explicit reasoning (E21 asset-guessability mitigated via `randomUUID()` in upload paths; Studio canvas-document master-delete explicitly documented as the same pre-existing "master is global" decision applied everywhere else, zero blast radius in today's single-organization production).

**P0-03 (tokens em log):** CLOSED + evidence. `redactTokenFromUrl` live-confirmed in production logs (`"url":"/ws?token=[REDACTED]"`) both before and after every restart this session.

OPEN P0: **0**

## P1 CRITICAL

| ID | Status |
|---|---|
| P1-01 (idempotência por busca de título) | CLOSED — duplicate-check failure now fails closed/retryable instead of silently creating |
| P1-02 (Jarbas dataset/ranking) | Not addressed — explicitly deferred per mission scope (external service, BETA/read-only stance preserved) |
| P1-03 (grounding aceita número errado) | CLOSED — shared word no longer substitutes for correct value |
| P1-04 (release não rastreável) | CLOSED — `release_sha`/`build_time`/`schema_version`/`environment` now live on API, worker, both HTTP-serving nodes, and a new `/api/version` on web (untested live — web isn't deployed yet) |
| P1-05 (Redis sem AOF / outbox) | Substantially mitigated — reconciliation watchdogs added for orphaned agent executions and stuck Studio jobs (polling, not a new outbox architecture); formal Redis AOF/backup/restore still an infra-level item, not code |
| P1-06 (aprovação sem claim atômico) | CLOSED — atomic DB claim (`WHERE approved_at IS NULL`) + read-back verification added to the approval executors |
| P1-07 (QA/produção compartilham canal WS) | CLOSED — channel now namespaced by Redis DB number |
| P1-08 (Jarbas/Suzy tool sem capability gate) | Not directly addressed for Jarbas/Suzy (external services, explicitly deferred) — but the **exact same class of bug was found live in Bento's own create-task tool this session** (see CRITICAL FINDING below) and fixed there |
| P1-09 (SSRF em anexo) | CLOSED — origin-locked to own Storage, no-redirect, size cap |
| P1-10 (Otto versionamento) | Not addressed — explicitly out of scope this session (owned by the parallel `otto-elite-quality` workstream) |

P1 CRITICAL OPEN (in this session's scope): **0**

## BENTO CRUD

All of the following were run **for real**, through the actual chat pipeline (`POST /chat` → worker → guard → real ClickUp), against **Cliente Teste 7** only, assignee **Pedro Gabriel**, with every mutation independently re-verified via a separate ClickUp connection (not just the app's own read-back).

CREATE: PASS — exactly one task, correct client, correct assignee, briefing attached, read-back verified
READ: PASS *with explicit task reference*. Pronoun reference ("essa task") works for every WRITE operation (guard tracks it internally) but does **not** yet work for a pure READ question routed to the remote agent — documented below as a known, non-blocking gap (safe failure mode: asks for clarification, never guesses)
UPDATE TITLE: PASS (after 2 real bugs found+fixed this session — see below)
UPDATE BRIEF: PASS
UPDATE STATUS: PASS — **the exact original P0-01 regression phrase, re-verified live** (after fixing a real English/Portuguese status-vocabulary gap found in this same test)
UPDATE DUE: PASS
UPDATE PRIORITY: PASS (after fixing a critical schema bug found in this session — see below; write correct, confirmed independently, in-app read-back hit one transient hiccup and correctly reported uncertainty rather than false success)
ASSIGN: PASS (covered as part of CREATE)
COMMENT: PASS
COMPLETE: PASS (covered via UPDATE STATUS → "complete")
DELETE: PASS (after fixing 2 real bugs found in this session — see below)
IDEMPOTENCY: PASS — identical CREATE request repeated; second attempt correctly recognized as duplicate, zero second task created (verified via ClickUp: exactly one task with that name existed)
AMBIGUITY: PASS (after fixing a real P0-01-class regression found in this session — see below)
NEGATION: PASS (after fixing a **severe** real bug found in this session — see below)
NO FAKE SUCCESS: PASS — every verified claim was independently re-confirmed; every case of genuine uncertainty (transient errors) now reports honestly instead of guessing

qa-bot tenant fence: **proven, not assumed** — qa-bot + Cliente Teste 7 = write allowed; qa-bot + a different real client = write hard-blocked (`WriteScopeError`, zero task created), confirmed live before running any further mutation.

## REAL BUGS FOUND AND FIXED DURING THIS E2E (all committed, tested, independently verified)

This is the part of the mission ("simule o caminho dela antes de chamar a Tammy") that mattered most. Seven distinct, real, previously-unknown defects surfaced by actually running the CRUD gate against a live system — not hypothetical:

1. **Quoted value mistaken for a quoted command.** `"troca o título dessa task pra 'Nome Novo Longo'"` — when the new value in quotes was longer than half the sentence, the message classifier read it as reported speech ("someone else's command," never actionable) instead of a value being set. Blocked UPDATE_TITLE and COMMENT entirely.
2. **Operational command mistaken for "teach me a fact."** The same messages, once past bug #1, were intercepted by a separate "the user is teaching me a durable fact" fast-path and answered with "Registrado: ..." — never reaching the real guard.
3. **English ClickUp status vocabulary not recognized.** The exact original P0-01 regression phrase ("altere essa task para o status pronto") failed again against a list whose real statuses are in English ("to do"/"complete") — the status-mapping regex only recognized Portuguese variants.
4. **"Aquela task" with zero conversation history still created a task.** The literal P0-01 bug class, reproduced fresh: an ambiguous reference to an assumed-existing task, with no task ever mentioned in that conversation, silently created a new one instead of asking for clarification.
5. **CRITICAL — explicit negation did not stop the remote agent from writing.** `"Analisa a Cliente Teste 7, mas não cria nem altera nenhuma task."` — the deterministic guard correctly refused to write and handed off to the remote agent "for analysis," but the remote agent has its own autonomous create-task tool and created a real task anyway, in a real (non-QA) agency list, ignoring the explicit negation in the same message. This is the same class of gap the original audit flagged for Jarbas/Suzy (P1-08: prompt compliance is not a capability gate), now confirmed to also affect Bento's own tool. Fixed structurally: negated turns are now answered by the guard directly, never dispatched to the tool-capable remote agent.
6. **DELETE confused "can't verify" with "confirmed gone."** A transient ClickUp read error during the pre-delete existence check produced "already deleted" on a task that was still fully intact; the same collapsing-of-uncertainty pattern on the post-delete check would have been worse (a transient error there reads as "confirmed success"). Both now distinguish a real 404 from any other error and never guess.
7. **CRITICAL — reading any task with a priority set crashed the read entirely.** Introduced by this session's own P1 priority-support addition: the schema assumed ClickUp's `priority.priority` field was a digit; the real API returns a text label ("high"), the actual digit lives in `priority.id`. This silently broke `getTask` — and therefore every UPDATE, DELETE, and read-back — for any task with a priority set. Retroactively explains an earlier "couldn't confirm" read-back seen in this same test run.

Plus a smaller, non-blocking finding, documented but not fixed under time pressure: DELETE/UPDATE only resolve a task mentioned by URL/ID in the **current** message now (fixed this session); a bare numeric-looking ID with no URL still isn't recognized, and pure READ questions using a pronoun ("essa task") don't yet reach the remote agent's context the same way writes do.

## STUDIO

Front smoke: **NOT RUN.** No browser automation was executed against Studio this session — all time went into the Bento CRUD gate and the bugs it surfaced. This is a real gap against the mission's checklist, stated plainly rather than assumed passing.
Canvas / Fonts / Images / Layers / Undo-redo / Persistence / PNG / JPEG / PDF: **NOT RUN**, same reason.
Backend: unchanged this session apart from the Studio-job-orphan-recovery fix (P1-05) and the existing correction pipeline consolidated into git earlier in this session — both covered by their own unit/integration tests, not by a live Studio front smoke.

## SECURITY

Tenant: PASS (see P0-02)
Cross-tenant: PASS (organization-scoped everywhere the audit named, plus WS)
WebSocket: PASS
Logs: PASS
Assets: PASS (mitigated — see P0-02 note on E21)
Permissions: PASS
qa-bot write fence: PASS, **proven live** (see above)

## REGRESSION

Unit + integration (`pnpm test`, all 18 packages): **PASS**, 100% green at final HEAD
Typecheck (`pnpm typecheck`, all 18 packages): **PASS**
Lint (`pnpm lint`, all 18 packages): **PASS**, 0 errors (only pre-existing warnings, none new)
Build (`pnpm build`, all 6 buildable packages including web): **PASS**
E2E (Playwright, published front): **NOT RUN** this session (web isn't deployed with the RC yet; existing specs — `final-acceptance.spec.ts`, `gates-release.spec.ts`, `tammy-acceptance.spec.ts` — are committed and ready to run once the web deploy lands)

## PRODUCTION OBSERVATION

5xx after deploy: **0** across every restart and every real request observed
Critical logs: **0** unexpected errors; the Redis/Tailscale outage was infrastructure (machine-level), self-healed by fixes already in this RC, and is documented above, not hidden
Queue backlog: **0** waiting/active across all 6 queues at last check

## REMAINING LIMITATIONS

**BLOCKING (for "READY FOR AGENCY OPERATION"; not blocking for Bento core validation):**
1. Web/Vercel never deployed — `git push origin main` blocked by the auto-mode classifier, needs your explicit action.
2. Studio front E2E never run this session.
3. Otto Elite (branch `otto-elite-quality`) has not reported `READY FOR MASTER INTEGRATION` — Otto remains on its pre-Elite implementation, confirmed compatible with this RC (245+39 tests green, zero files touched), but not upgraded.

**NON-BLOCKING (known, documented, deliberately not fixed under time pressure):**
1. Bare task ID without a full ClickUp URL isn't recognized as an explicit target for DELETE/UPDATE.
2. Pure READ questions using a pronoun ("essa task") don't resolve through the remote agent's own context the way writes do through the guard.
3. Jarbas/Suzy's own autonomous-tool-vs-negation gap (P1-08) — same class of bug as finding #5 above, fixed for Bento's create-task tool, not chased into Jarbas/Suzy this session (external services, explicitly out of scope).
4. Redis AOF / formal backup-restore drill — infra-level, not code.
5. `apps/api/src/scripts/trace-3-blockers.mts` unused-var lint warning and one `agent-runtime` warning — pre-existing, cosmetic.

## ROLLBACK

Previous known-good release: `ceea0be091ed1b2f58a83c5ed9ca0a59d960551c`
Rollback procedure: `git checkout ceea0be091ed1b2f58a83c5ed9ca0a59d960551c -- .` in this same checkout (no separate worktree needed — this checkout has been clean and dedicated to the RC all session), then `launchctl kickstart -k gui/$(id -u)/com.desigualos.api` and the same for `.worker`. No migrations in this RC need reverting (all additive/idempotent). Not exercised this session — stated as a known, ready procedure, not verified live (verifying it would mean actually rolling back a working RC, which the mission's own "no blind restart" spirit argues against doing just to test the rollback path).

## FINAL VERDICT

**NOT READY — for "READY FOR AGENCY OPERATION" or the full "READY FOR CORE OPERATION" bar as originally scoped.**

What genuinely changed today, and is provably solid: **P0 = 0, P1-critical (in scope) = 0, Bento CRUD is now real, verified, and correct end-to-end including DELETE with confirmation** — with seven previously-unknown, real defects (one of them severe: negation not stopping an autonomous write) found by actually exercising the system the way Tammy would, not by rereading code. That is the core, hard part of this mission, and it is done and independently verified.

What is not done, stated plainly rather than assumed: the web front carrying this RC was never deployed (blocked by the tool-permission classifier, not by any code or test failure), so nothing about the *published front* — Studio's UI, the browser-based Bento chat flow, Otto's UI — has been re-verified this session. Declaring readiness for Tammy or for daily operation without that step would be exactly the "code compiled, tests passed, therefore READY" shortcut this mission explicitly forbids.

BLOCKERS:
1. `git push origin main` (or equivalent authorization) to actually deploy the web front carrying this RC — everything else is ready to build on top of that the moment it lands.
2. Studio front E2E smoke, once the web deploy above lands.
3. Otto Elite integration decision — either wait for its `READY FOR MASTER INTEGRATION` handoff, or explicitly ship this release as Otto-beta (current Otto, confirmed compatible, not creative-quality-certified this session).
