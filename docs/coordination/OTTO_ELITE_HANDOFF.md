# OTTO ELITE CREATIVE HANDOFF

Branch: `otto-elite-quality`
Base SHA: `53f0804` (main, at worktree creation — a separate master session had
substantial uncommitted work on `main` at the same time; this worktree never
touched that checkout)
Phase 1 commit: `93055e1aa68f92be27d211ffbbfc4feed2e4315c`
Phase 2 (live baseline + 3 live-found fixes) commit: `375f7ba39678aa102f809744f1363051ab3097e4`
Phase 2 (handoff) commit: `6e82362`
Phase 2 (Otto Elite 101% — critic/rewrite) commit: `94c6a44`

**Update (Phase 2, live baseline session):** the Phase 1 section below said
"no benchmarking was run... whether qwen3.5:4b reliably produces good
`spoken_line` content on the first pass is untested and should be the first
thing the next session checks against a live Ollama instance." This session
did exactly that. See "PHASE 2 — LIVE BASELINE" below for what actually
happened — it found 3 additional real bugs the mocked tests could never
catch, fixed all three, and produced an honest, non-inflated quality score
for the real Cosentino case. The rest of this document (Phase 1) is kept
as-is below for the record; skip to Phase 2, then "PHASE 2 — OTTO ELITE
101%" at the very bottom for the current state.

## Scope note (read this first)

The mission brief (40 phases: architecture rework, model benchmark, angle
engine, multi-specialist critic, golden set of 10-20 briefs, blind
evaluation vs. senior baseline) describes a multi-week program. This pass
did **Phase 0 (trace) → Phase 2 (root cause) → two scoped, tested,
committable fixes** that directly explain and close the named real
regression (Jardim Europa V / Cosentino). It did **not** attempt model
benchmarking, the angle/hook engine, the multi-specialist critic, or a
golden-set eval harness — those remain open and are listed under "Shared
changes needed" / next steps, not silently skipped.

I chose depth over breadth: two root-cause-verified fixes with real tests
beat a wide pass of prompt rewrites with no way to confirm they moved the
needle.

## Files changed

- `nodes/otto-node/src/execute.ts` — chat-path output-contract wiring
  (`numPredict` scaling), production-path answer formatting
  (`formatPlanAnswer`, new `formatVideoScript`).
- `nodes/otto-node/src/execute.test.ts` — new regression tests for both
  fixes below.
- `packages/otto/src/creative/output-contract.ts` — multi-deliverable
  detection (`artefatosAdicionais`, `ContratoDeSaida.adicionais`).
- `packages/otto/src/creative/output-contract.test.ts` — new tests.
- `packages/otto/src/creative/schemas.ts` — `videoSceneSchema` gained two
  optional fields: `spoken_line`, `on_screen_text`.
- `packages/otto/src/creative/planner.ts` — `planVideo` system prompt now
  asks for `spoken_line`/`on_screen_text` when the briefing is an
  informational (spoken) video, not just AI-generated b-roll.
- `docs/coordination/OTTO_CURRENT_PIPELINE.md` — Phase 0 trace (new).
- `docs/coordination/OTTO_ELITE_HANDOFF.md` — this file.

No files outside `packages/otto` / `nodes/otto-node` / `docs/coordination`
were touched — Bento, tenant, API security, Studio, Jarbas, Suzy untouched.

## Root cause analysis (Phase 2)

Traced end-to-end in `OTTO_CURRENT_PIPELINE.md`. Two independent,
verified defects, both structural (not model quality, not prompt
"needs to be bigger"):

**1. Multi-deliverable requests on the chat path lose all but one
deliverable.** `contratoDeSaida()` (packages/otto/src/creative/output-contract.ts)
matched the FIRST named artefato in a message and told the model
"entregue X, e só isso" (deliver X, and only that) — even when the
message named a second deliverable explicitly ("... e uma legenda...").
This directive is declared to "vale sobre qualquer regra de formato
acima" (override any formatting rule above it), so it silently
overrode `CHAT_SYSTEM_PROMPT`'s own rule 2 ("if more than one
deliverable is requested, deliver ALL of them"). Only reachable when
the message has no production verb+asset-keyword combo (routes to
chat, not the creative-plan pipeline).

**2. `reels`/`video` production-path answers never showed the actual
script to the human.** `detectProductionIntent()` classifies any
message with a production verb + "reels"/"vídeo" as `StudioJobType`
`reels`/`video`, which runs `createCreativePlan` → `planVideo`. But:
  - `videoSceneSchema` (the JSON contract for each scene) was built
    exclusively for **AI-generated motion video** — camera movement,
    lighting, image_prompt in English for FLUX.2 — with **no field for
    spoken narration**. `planVideo`'s own prompt explicitly says
    "locução... exige finalização separada" (voiceover needs separate
    finishing). For an informational/announcement Reels script (someone
    explaining a date, a process — exactly the Jardim Europa V case),
    there was structurally nowhere for the model to put the actual
    words to be said.
  - Even the parts that WERE generated (full scene list, cta,
    text_overlays) never reached the user: `formatPlanAnswer()` returned
    only `"Conceito: X / Copy: Y / Spec anexada"` for every production
    job type, on the (correct, for *image* jobs) assumption that the
    human doesn't need to read raw `image_prompt`/`art_direction` — the
    Studio queue renders the image. That assumption is wrong for
    video/reels: there is no downstream step that turns a script into a
    finished video a human didn't already read. The full plan sat in
    `metadata.video_plan`, visible only to the Orchestrator/Studio
    queue consumer, never to whoever asked for the script in chat.

This matches the documented old-failure symptom exactly: response
came back as a short concept/copy fragment ("Direto." "Ágil." "Sem
burocracia."), with no real script, no shot list, no full caption.

## Architecture changes

None at the pipeline-topology level (Phase 3's REQUEST → CLASSIFICATION
→ ... → QUALITY GATE → DELIVERABLE chain was traced, not rebuilt). The
existing two-path split (chat vs. production/creative-pipeline) and the
existing anti-generic revision loop on the production path were left in
place — they're real and working (see `creative-pipeline.ts`,
`anti-generic.ts`, both covered by existing tests). What changed is
narrower: the chat path's output contract now represents "more than one
deliverable" correctly, and the video schema/prompt/formatter chain now
has a place to put — and a way to surface — spoken narration.

## Prompt/context changes

- `packages/otto/src/creative/output-contract.ts`: `diretivaDoContrato`
  now emits a "MAIS DE UM entregável" block listing every requested
  artefato with its own `FORMA_FINAL`, instead of locking to one and
  forbidding the rest.
- `packages/otto/src/creative/planner.ts`: `planVideo`'s system prompt
  gained two bullet points instructing the model to fill `spoken_line`
  per scene for informational videos, and to leave it out for pure
  b-roll (no invented narration).

## Model changes

None. No benchmarking was run in this session — Ollama/qwen3.5:4b was
not invoked live; all pipeline fixes are verified against mocked LLM
providers in the existing test harness (`makeDeps` in `execute.test.ts`).
**This is a real gap**: the `spoken_line` prompt change is a structural
enabler, not a proof the local model reliably fills it well in
production. See "Shared changes needed" below.

## Benchmarks

Not run — no golden set exists yet (confirmed in the Phase 0 trace: no
"golden"/"benchmark"/"regression" creative-quality fixtures anywhere in
the repo before this pass). Building one (Phase 34) is real, scoped
future work, not something to fake here.

## Real Tammy Case (Jardim Europa V)

Before: `formatPlanAnswer` returned "Conceito: X / Copy: Y / Spec
anexada" for a `reels` job — no script, no shot list, no full caption
visible in the chat answer, matching the documented failure.

After (verified structurally, via
`nodes/otto-node/src/execute.test.ts`, test *"roteiro de reels FALADO
devolve o roteiro completo na resposta, não só conceito+copy"*, which
replays the real Jardim Europa V wording against the actual
`executeTask` code path with a mocked LLM): when the video plan
contains `spoken_line` per scene, the chat-visible `answer` now
contains the full scene-by-scene script (visual + spoken line +
on-screen text), the CTA, and the caption — not a two-line stub.

I am not reporting a before/after creative-quality score for this case:
doing so honestly requires a live model run, which this session did not
execute. What's verified is that the **pipeline is no longer
structurally incapable of surfacing a real script** — closing off the
literal mechanism of the old failure. Whether qwen3.5:4b reliably
produces good `spoken_line` content on the first pass is untested and
should be the first thing the next session checks against a live
Ollama instance.

## Golden Set

Not created this session (Phase 34 — real scoped future work, ~10-20
briefs across the categories the brief lists).

## Regression

- `pnpm --filter @desigual-os/otto test`: 249/249 passed (17 files),
  including 4 new tests for the multi-deliverable contract fix.
- `pnpm --filter @desigual-os/otto-node test`: 40/40 passed (3 files),
  including 1 new test replaying the real Jardim Europa V wording.
- `pnpm --filter @desigual-os/otto typecheck`: clean.
- `pnpm --filter @desigual-os/otto-node typecheck`: clean.
- `pnpm --filter @desigual-os/otto lint` / `otto-node lint`: clean.
- No other package touched; no monorepo-wide build/test run attempted
  (out of scope — would pull in the master mission's in-flight,
  uncommitted changes on `main`, which this worktree deliberately did
  not touch).

## Shared changes needed

None required — both fixes are contained inside `packages/otto` and
`nodes/otto-node`, which this workstream owns outright per the mission
brief. Nothing here needs the master mission to change shared
infrastructure.

One thing worth the master mission's awareness, not action: this
worktree ran `pnpm install` to get `vitest` linked (it wasn't present
after `git worktree add`); the resulting `pnpm-lock.yaml` drift
(unrelated `postgres`/`vitest` specifier lines disappearing — an
artifact of installing from inside a fresh worktree, not a real
dependency change) was reverted before commit. If the master mission
sees similar lockfile noise from its own worktree, same cause.

## Integration instructions for Master Agent

Clean cherry-pick candidate — six files, all inside `packages/otto` and
`nodes/otto-node`, zero overlap with the files the master mission's
`git status` showed in flight (api/routes, worker/processors,
studio-node, migrations, docker-compose):

```
git cherry-pick <commit-sha-from-otto-elite-quality>
```

or, if `main` has moved:

```
git diff 53f0804 otto-elite-quality -- packages/otto nodes/otto-node | git apply
```

Both are additive/backward-compatible: `videoSceneSchema`'s new fields
are optional, `ContratoDeSaida.adicionais` is optional and only
populated in the new multi-deliverable case, and `formatPlanAnswer`'s
new parameters are optional with the old two-line format still the
fallback for carousel/image/upscale jobs (untouched) and for video/reels
plans with no `spoken_line` anywhere (pure b-roll, unchanged behavior).

## Risk

Low. Both changes are localized, fully covered by new tests alongside
the full pre-existing suite (289 tests total across both packages, all
passing), and additive to existing schemas/types (no field removed or
narrowed, no existing test touched except one pre-existing quirk
documented inline — `quantidadeDe` picks up a loose "uma" from earlier
in a sentence, unrelated to this fix, noted rather than silently
patched).

The real remaining risk is unverified: whether qwen3.5:4b, running live,
reliably fills `spoken_line` well and keeps within the 120s/16k-context
budget for a 2-scene+ spoken script. Recommend a live smoke test against
Ollama before calling the Jardim Europa V case closed end-to-end.

## Status (Phase 1, superseded — see Phase 2 below for current status)

CREATIVE QUALITY BLOCKER (partial). Superseded by the Phase 2 gate
verdict at the bottom of this document.

---

# PHASE 2 — LIVE BASELINE (real model, real data)

## What changed from Phase 1

Phase 1 shipped two structural fixes verified only against a mocked LLM.
Phase 2's mandate was explicit: "completude != qualidade," prove it live.
Ollama was confirmed reachable on this machine (`localhost:11434`,
models `qwen3.5:4b`, `qwen3.5:9b`, `kairo:latest` (a 9b finetune),
`moondream`). The production Otto node itself (port 4002) is **not**
running locally — it runs on a separate Mac mini reached via Tailscale,
and this session never touched it. Instead, `executeTask()` — the exact
production code path — was invoked directly against local Ollama via a
new harness (`nodes/otto-node/scripts/live-run.ts`), bypassing only the
Fastify HTTP layer and the DB-backed client-context lookup (which lives
upstream in `apps/worker`, not in the node).

## Three real bugs found live, fixed, regression-tested

None of these were visible to Phase 1's mocked-LLM tests — that's the
whole point of running the real model.

1. **Optional scene fields failed on empty string, not just missing
   value.** `videoSceneSchema`'s `spoken_line`/`on_screen_text`/
   `continuity`/`image_prompt` are `z.string().min(1).optional()`.
   qwen3.5:4b, told "leave the field out when it doesn't apply," instead
   emitted `"spoken_line": ""`. Zod treats `""` as *present and invalid*,
   not *absent*. `chatJson`'s single correction retry also failed the
   same way, so the **entire turn threw** after 252s — worse than the
   pre-Phase-1 stub, which at least returned something. Fixed via a
   `z.preprocess` that maps blank strings to `undefined` before
   validation (`optionalString()` helper, applied to all four fields).
2. **`duration` was validated against a sum the model reliably got
   wrong.** `videoPlanSchema` rejected the whole plan if
   `sum(scene.duration_seconds) !== duration` by more than 0.05s.
   qwen3.5:4b consistently produced internally-plausible per-scene
   durations whose sum was off by 1-2s from its own `duration` field —
   redundant arithmetic the model doesn't reliably self-check. Fixed by
   **deriving** `duration` from the scene sum via `.transform()` instead
   of validating the model's guess.
3. **The production path never received the output contract or the
   emoji instruction.** `contratoDeSaida`/`diretivaDoContrato` (the
   module that tells the model exactly what "legenda" must contain —
   hashtags, CTA block — and enforces multi-deliverable completeness)
   was wired into the chat path only (Phase 1 fix). `createCreativePlan`
   has its own prompt (`CREATIVE_DIRECTOR_PREAMBLE`, image-generation-
   oriented) and never saw it. Live-observed effect: the generated
   caption for "pode usar emojis na legenda" had **zero hashtags** and,
   on the first (context-free) run, no emoji in the caption body at all.
   Fixed by threading `diretivaDoContrato(...)` and an emoji-authorization
   line into `createCreativePlan`'s `clientContext` on the production
   path too.

All three are covered by new tests (`schemas.test.ts`,
`execute.test.ts`) that assert the *mechanism*, not a live call —
251→252 and 40→41 total tests, still 100% passing, typecheck/lint clean.
Full commit: `375f7ba`.

## Live baseline: the real Jardim Europa V case, scored honestly

Four live runs against qwen3.5:4b, in order, each feeding into the next
fix:

| Run | Client context | Fixes in place | Result |
|---|---|---|---|
| 1 | none | Phase 1 only | Failed after 252s (bug #1) |
| 2 | none | + bug #1 fix | Failed after 190s (timeout, bug #2 masked it) |
| 3 | none | + bug #2 fix | **Completed**, 325s. Wrong strategy (see below) |
| 4 (`ctx4`) | synthetic Cosentino dossier | + bug #3 fix | **Completed**, 352s. Best run — scored below |

**Run 3 (no client context) revealed a 4th finding, not fixed this
session:** with zero grounding, the model invented a **B2B "developer/
architect" framing** ("a alavancagem que esse projeto dá... ao
arquiteto (prazos cumpridos)") for a brief that is unambiguously a
consumer sales-opening announcement. Two of four scene visuals were
also garbled (`"Visual: None, static object with slight natural sway of
light."`). This is not a bug in the fixed sense — it's evidence that
**client grounding materially changes strategic quality**, confirming
Phase 20's premise. It also shows the production path's prompt
(`CREATIVE_DIRECTOR_PREAMBLE`) has none of the chat path's "don't
invent, mark gaps as [CONFIRMAR]" discipline — it never says "if you
don't know the audience, don't guess," it just guesses. **Not fixed
this session — flagged for the next one.**

**Run 4 (`ctx4`), the best real output, scored against the mission's own
rubric — no inflation, the actual failure question asked each time is
"would a senior need to rewrite this almost entirely?":**

| Dimension | /10 | Why |
|---|---|---|
| Strategy | 7 | Correct consumer/family audience once context present; solid but not sharp funnel logic |
| Concept | 6 | "Tranquilidade na complexidade" is a real one-liner, not distinctive |
| Hook | 5 | Soft question-hook, not a scroll-stopper |
| Specificity | 6 | Real date/no-registration fact grounded; scene visuals specific and coherent (no garbage this run) |
| Originality | 4 | Swap the building name, ~70-80% still reads the same — fails the mission's own genericity test |
| Brand fit | 6 | Matches the synthetic tone brief; not verified against a real BRAIN.md |
| Script | 7 | Full scene-by-scene, natural spoken lines, timing marked; no editing/transition beats specified |
| Copy/Caption | 6 | Real paragraph structure, one emoji on the CTA line; **zero hashtags despite the system's own contract requiring them** |
| Retention | 5 | No named pattern-interrupt/retention device |
| Visual direction | 6 | Coherent, specific, no garbled fields |
| Executability | 6 | An editor could work from it; missing explicit editing/music direction |
| Platform fit | 6 | 9:16, ~26s across 6 scenes — reasonable Reels length |
| Overall usefulness | 6 | Needs real editing (hashtags, sharper hook, more originality) but is a genuine draft, not a rewrite-from-scratch |

**Sum 82/140 → 59/100, normalized.** Estimated (not measured — no
baseline capture exists from before this session) pre-session state was
~15-25/100 per the documented failure description (fragments only, no
real script). Run 3 (fixes but no context) is ~35-40/100 by the same
rubric (wrong strategy, garbled visuals). This is real, honestly-scored
progress — roughly 2.5x the documented failure state — and it is **still
well short of the mission's ≥90 gate.** The two things holding it back
most are (a) no critic/rewrite pass exists on this path at all — the
first draft ships as final, so the missing hashtags and soft hook never
get caught before the user sees them, and (b) small-model instruction-
following: the hashtag requirement was explicitly present in the prompt
(verified — this session's own fix put it there) and the model still
didn't comply.

## Model benchmark (partial — real data, not complete)

- **qwen3.5:4b**: works, see above. 203-352s per full reels turn on this
  CPU-only Mac. High latency variance.
- **qwen3.5:9b**: tested once, same context-grounded Cosentino brief.
  **Timed out at 240s** (`OTTO_LLM_TIMEOUT_MS=240000`, raised from the
  120s default specifically to give it room) without completing even the
  first `createCreativePlan` call. Not viable on this hardware within any
  latency budget a chat product could accept, at least not without
  infrastructure changes (GPU inference, a smaller/simpler schema per
  call, or splitting the heavy multi-field JSON generation into smaller
  calls).
- **kairo:latest** (a 9b finetune, same base size as qwen3.5:9b): **not
  tested**. Given 9b already failed to complete within 240s, testing a
  same-size finetune wasn't a responsible use of remaining session time;
  expected to have the same latency profile. Worth testing only after
  the CPU-latency ceiling is addressed some other way.
- **Sampling matrix (temperature/top_p) benchmark**: not run — no budget
  left after the model-size comparison above, which was the higher-
  priority question ("is qwen3.5:4b even in the right size class").

**This is a real, load-bearing finding, not a guess:** "just use a bigger
model" is not a viable near-term fix on the current Otto host's hardware
profile (assuming it matches this machine's CPU-only inference — that
assumption itself should be checked against the actual mac-mini specs,
which this session had no access to confirm).

## Golden Set (Fase 2 — created, not executed)

`packages/otto/test-fixtures/creative-golden-set.ts`: 15 fictional briefs
(fictional client/product names deliberately, per the same reasoning
`client-context.ts` gives for keeping real client data out of this public
repo) covering the requested diversity — 5 Reel subtypes, 3 carousel
subtypes, 2 Meta ad subtypes, 1 caption, 1 landing copy, 2 creative
briefs, 1 rewrite-after-feedback. Each fixture carries client/brand
context, audience, objective, platform, requested deliverables, explicit
constraints, and a `factsThatCannotBeInvented` list for hallucination
checking. No response is hard-coded — grading is meant to be structural
and rubric-based against each fixture's fields, not text matching.

**Not executed against the live model.** One fixture
(`reel-launch-imobiliario`) is essentially the Jardim Europa V case
already scored above. At ~3-6 minutes per turn observed this session,
running all 15 live is 45-90+ minutes of pure model latency — a
dedicated session's work, not something to compress into this one
without either rushing the scoring or fabricating results. Recommend the
next session run these via `live-run.ts` in the background while doing
other work (the harness's docstring explains exact usage and the
context-block ordering gotcha this session discovered the hard way).

## Real Tammy Case — final number

**59/100**, honestly scored, real live model, real fixes in place,
synthetic-but-plausible client context. Required gate: ≥90, no dimension
below 9 for script/copy/executability/overall. **Not met.** Primary gaps:
no critic/rewrite pass exists on this path (Phase 9-10, not attempted
this session — a real architecture addition, not a config tweak), and a
small-model instruction-following ceiling on hashtag compliance that
prompt engineering alone did not close within this session's attempts.

## Latency

Observed, not the full Phase 24 matrix (planning/generation/critic/
rewrite broken out separately) — single end-to-end numbers per turn,
`llm_ms` from `metadata.timings`:

- 4b, no context, post-fixes: 325,380 ms
- 4b, with context, post-fixes: 351,996 ms
- 9b, with context: >240,000 ms (timed out, did not complete)

A critic+rewrite loop (Phase 9-10, not implemented) would at minimum
double this on the current hardware. **This needs to be a first-class
design constraint for whoever builds the critic pass next** — either an
async "peça sendo refinada" UX pattern, or a hardware/model change,
because a naive addition of a synchronous critic pass to a 5-6 minute
turn is not shippable as-is.

## Tests

`pnpm --filter @desigual-os/otto test`: 252/252 passed (17 files).
`pnpm --filter @desigual-os/otto-node test`: 41/41 passed (3 files).
`pnpm --filter @desigual-os/otto typecheck` / `otto-node typecheck`:
clean. `pnpm --filter @desigual-os/otto lint` / `otto-node lint`: clean.

## Known risks / what's still unverified

- The B2B-strategy-invention failure mode (run 3) is not fixed — only
  documented. The production path's prompt has no equivalent of the
  chat path's "mark what's missing instead of guessing" discipline.
- Hashtag compliance in the caption is unresolved even with the contract
  now wired in — this looks like a genuine small-model instruction-
  following limit, not a missing instruction, but that conclusion rests
  on a small sample (2 live runs) and deserves more data before being
  treated as settled.
- No critic/rewrite/quality-gate pass exists anywhere on the production
  (reels/video/carousel/image) path. `runCreativePipeline`'s anti-generic
  gate is real but narrow (genericity only, not the full rubric this
  document scores against).
- Golden set exists as fixtures only; zero live executions beyond the
  one case that overlaps Jardim Europa V.
- This session's live-run harness talks to *local* Ollama on this laptop.
  It has not been run against the actual production mac-mini — if that
  machine has different hardware (GPU vs. CPU) the latency numbers above
  may not transfer directly. Worth confirming before treating the
  "qwen3.5:9b is not viable" finding as final for production infra.

## Shared changes needed

None — same as Phase 1, everything stayed inside `packages/otto` and
`nodes/otto-node`.

## Integration instructions for Master Agent

Same cherry-pick pattern as Phase 1, now two commits:

```
git cherry-pick 93055e1 375f7ba
```

or, if `main` has moved:

```
git diff 53f0804 otto-elite-quality -- packages/otto nodes/otto-node | git apply
```

Both commits are additive/backward-compatible — no existing behavior was
narrowed, only bugs fixed and new optional fields/contracts added.

## Risk

Low for what shipped (same reasoning as Phase 1: localized, tested,
additive). The risk that matters now is scope, not safety: the mission's
quality bar (senior+, ≥90/100) is not met, and closing that gap needs
real architecture work (critic/rewrite loop) plus a latency budget
decision that this session's data says can't be waved away.

## Final gate check

| Requirement | Result |
|---|---|
| Structural regression | PASS (252/252 + 41/41, typecheck/lint clean) |
| Live model | PASS (runs to completion after fixes; see caveats above) |
| Tammy regression ≥90 | **FAIL — 59/100** |
| Golden set ≥88 avg | NOT RUN |
| Golden set worst ≥80 | NOT RUN |
| Deliverable completeness 100% | PARTIAL — script+shotlist+caption all present; caption missing hashtags |
| Approval regression (§26) | untouched, presumed intact (not in this session's diff) |
| No critical hallucination | PASS in tested runs — facts (date, no-registration) preserved; no invented stats/names observed |
| Tests / typecheck / lint | PASS |

## FINAL TERMINAL OUTPUT

```
OTTO ELITE PHASE 2 COMPLETE (PARTIAL — SEE GATE ABOVE)

BRANCH: otto-elite-quality
PHASE 1 COMMIT: 93055e1
PHASE 2 COMMIT: 375f7ba

MODEL TESTED: qwen3.5:4b (works, slow), qwen3.5:9b (timeout, not viable
  on this hardware within 240s), kairo:latest (not tested)

REAL TAMMY REGRESSION: 59/100 (required: >=90) — FAIL
GOLDEN SET: 0/15 executed (fixtures built, not run)
AVERAGE CREATIVE QUALITY: not computable (golden set not run)
WORST CASE: not computable

DELIVERABLE COMPLETENESS: script+shotlist+caption present;
  caption missing hashtags on every live run observed

SCRIPT: PASS (present, coherent, executable with minor gaps)
COPY/CAPTION: PARTIAL (present, missing hashtags)
CAROUSEL: not tested live this session
ADS: not tested live this session
BRIEF: not tested live this session
FEEDBACK: not tested live this session (rewrite fixture exists, not run)
APPROVAL: untouched this session

TESTS: 252/252 + 41/41 PASS
TYPECHECK: PASS
LINT: PASS

MASTER SESSION INTERFERENCE: NONE

FINAL:

CREATIVE QUALITY BLOCKER

Real, live-verified progress (3 new bugs found and fixed against a real
model, not mocks; honest 59/100 score up from an estimated 15-25/100
failure state) but the mission's senior-level bar is not met. The path
forward is architectural (a critic/rewrite pass, Phase 9-10) and a
latency budget decision — not more prompt tweaking. This is not a MODEL
CAPABILITY BLOCKER: qwen3.5:4b's failures (missing hashtags, soft hooks)
look like missing verification/rewrite, not a hard ceiling — nothing
here rules out the same model clearing the bar with a critic pass in
front of it.
```

---

# PHASE 2 — OTTO ELITE 101% (critic/rewrite + RTX hardware discovery)

Commit: `94c6a44` (critic/rewrite implementation). This section is the
current state of the document — everything above is kept for the record.

## RTX 4090 hardware discovery (read-only, as instructed)

Found the machine: `nodes/studio-node/.env.example` documents it directly
— "Studio Node Agent (roda no PC com a RTX 4090)" — reached via Tailscale
IP `100.107.198.50` (the comment there notes this IP, not the MagicDNS
hostname, is the only confirmed-reachable path from the Orchestrator).

Probed from this laptop, read-only, no writes/installs attempted:

| Check | Result |
|---|---|
| `ping 100.107.198.50` | Succeeds, 5-8ms — same Tailscale network, low latency |
| Port 8188 (ComfyUI) | **HTTP 200** on one probe — Studio is actively running on that machine |
| Port 4100 (studio-node metrics) | Connection refused instantly — the studio-node *agent* process isn't listening (only ComfyUI itself was, that moment) |
| Port 11434 (Ollama) | Closed/filtered — **no Ollama running on that machine** |
| Ports 8000/8080/5000/7860 (vLLM/generic/text-gen-webui/gradio) | All closed/filtered — **no LLM inference runtime of any kind found listening** |
| SSH (22) | Closed/filtered — **no remote shell access available to this session** |

**Conclusion: the RTX 4090 is real, network-reachable, and actively
running ComfyUI/Studio workloads right now — but no LLM inference server
is running on it, and this session has no credentials or remote-exec
path to start one.** This is a hard stop on Phase 3 (model benchmark
matrix) and Phase 31 (RTX experiment A-E) as live, measured comparisons.

This is reported honestly as **RTX ELITE NOT REACHABLE THIS SESSION** —
an infrastructure/access gap, not a judgment that "RTX isn't beneficial"
(that would require actually running a model on it to compare, which
wasn't possible). Do not read the architecture decision below as having
ruled out RTX; it simply couldn't be tested.

**Also directly relevant to Phase 32 (GPU concurrency):** ComfyUI
responding HTTP 200 during this probe means Studio may have been in
active use at that moment. Nothing in this session sent any inference or
job request to that machine — the only interaction was an HTTP GET to
`/` and a raw TCP connection check, both read-only and effectively
instantaneous. No designer's work was touched or could have been
affected.

**What the next session needs to actually benchmark RTX:** either (a)
someone with access to that machine starts Ollama or a similar server
there and shares the resulting URL/port, or (b) this session (or a future
one) is given SSH or equivalent remote-exec credentials for
`100.107.198.50`. Neither existed here. No model was downloaded or
installed anywhere as a result of this constraint — per the mission's own
"NO BLIND INSTALL" rule, and because installing anything on a machine
this session can't reach isn't possible anyway.

## Architecture decision: FAST / ELITE mapping

The mission asks for a FAST/STANDARD/ELITE complexity router (Phase 4)
with GPU escalation (Phase 16) when the local model can't hit the gate.
Given the RTX constraint above, this session could not build or test the
GPU-escalation half. What it **did** build, deliberately reusing existing
architecture rather than adding a parallel classifier:

- **FAST/STANDARD = the existing chat path.** `detectProductionIntent()`
  (execute.ts) already decides, per turn, whether a request is a small
  edit/question (→ chat, single LLM call, already fast) or a production
  deliverable. This *is* the FAST/STANDARD split the mission describes —
  headline tweaks, CTA changes, short questions, quick captions all stay
  on the existing single-call path. Nothing needed to change here.
- **ELITE = the existing production path (`reels`/`video`/`carousel`),
  now with the critic/rewrite pass attached.** These are exactly the
  formats the mission's own ELITE trigger list names explicitly (reel,
  video, carousel, launch content, multi-deliverable). `image`/`upscale`
  stay on the production path but **without** the critic — the
  deliverable there is the rendered image (Studio/ComfyUI renders it
  later), not text, so the critic's rubric (hook, retention, script)
  doesn't apply the same way, and skipping it avoids ~1-2 extra LLM calls
  of latency for a job type where it wouldn't change much.

**What this does NOT include, and why:** the mission's "user override"
trigger (Phase 4 — "capricha", "faz nível senior", "premium" forcing a
chat-path request up to ELITE) was not implemented. Doing that safely
means rerouting a chat-classified request into the production pipeline,
which expects a `StudioJobType` and produces a `ProductionSpec` headed
for the Studio queue — appropriate for "make me a stronger reel," much
less obviously appropriate for "capricha nessa resposta" on a pure
Q&A turn. This needs a deliberate design decision (a third pipeline shape
for "elite text-only response," not a reuse of the image-production one)
that this session didn't have time to build and test safely. Flagged as
a concrete next step, not silently dropped.

**Model routing (Phase 44 format):**

- **FAST_MODEL:** qwen3.5:4b (local, chat path) — same as before.
- **STANDARD_MODEL:** qwen3.5:4b (local) — same model, chat path; the
  "standard" tier is really about *classification* (small ask vs. big
  ask), not a different model, since only one local model was available
  to route to this session.
- **ELITE_MODEL (draft):** qwen3.5:4b (local) — no alternative was
  reachable (see RTX section above). **This is the biggest gap in the
  "elite" story:** the draft generation model is currently identical to
  the fast one. The critic/rewrite pass is what's actually elevating
  quality on this path, not a bigger model.
- **CRITIC_MODEL:** qwen3.5:4b (local) — same reachability constraint.
  A critic call is architecturally cheaper (single structured JSON
  response, no multi-field image-direction schema) so in practice it
  should be faster per-call than a full `createCreativePlan`, though
  this session did not isolate and measure that difference precisely.
- **REWRITE_MODEL:** qwen3.5:4b (local) — same.
- **RTX POLICY:** not activated. `critiqueDeliverable`/`produce()` are
  both plain functions taking an `OttoLLMProvider` — nothing in this
  design assumes a specific model or host, so pointing the ELITE tier at
  an RTX-hosted provider later is a config change (a second
  `OttoLLMProvider` instance pointed at a reachable RTX endpoint), not a
  rearchitecture. That's the concrete integration point for whoever gets
  access to start a server on that machine.
- **FALLBACK:** implicit and always-on, not a new code path — since
  ELITE_MODEL currently *is* the same as FAST_MODEL, there's no
  `ELITE_GPU_UNAVAILABLE` state to surface yet. Once an RTX-hosted model
  is actually wired in as the elite draft/critic model, this needs a real
  fallback (catch the connection error, log
  `ELITE_GPU_UNAVAILABLE`, fall back to the local model) — not built yet
  because there's nothing to fall back *from* today.

## Critic + rewrite implementation (Phases 9-15 of the brief)

Summarized from the commit message (`94c6a44`), full detail there:

- `packages/otto/src/creative/critic.ts`: `critiqueDeliverable()` — one
  structured LLM call scoring ten fixed rubric dimensions (not a free-form
  record — the model can't omit or rename a dimension) plus eleven flags
  (`missing_deliverables`, `genericity`, `ai_slop`, `weak_hook`, etc).
  `overall` is computed in code as the mean of the ten scores — **not**
  requested from the model, the same lesson as the `duration`-sum bug
  from the Fase 1 session (commit `375f7ba`): don't ask the model to do
  arithmetic on numbers it just generated.
- `passesCriticGate()`: deterministic gate exactly as the brief specifies
  — overall < 88, or concept/copy/executability < 8, or any requested
  deliverable missing → fail.
- Wired into `nodes/otto-node/src/execute.ts` for `reels`/`video`/
  `carousel` only. On gate failure: **one** rewrite (not the brief's two)
  with the critic's structured feedback appended to the briefing, then
  one re-evaluation. Capped at one rewrite deliberately — see latency
  note below. Never blocks the turn: if still failing after the rewrite,
  the response still ships, with `metadata.critic.passed = false` so
  the failure is visible for audit rather than silently swallowed (same
  principle the existing anti-generic loop already follows).
- 17 new tests (13 in `critic.test.ts`, 4 in `execute.test.ts`) covering:
  the deterministic gate math, the revision-note formatting, first-pass
  approval (no rewrite), rejection→rewrite→approval end-to-end against
  the real `executeTask` code path (mocked LLM), rejection that persists
  even after rewrite (ships anyway, flagged), and confirmation the critic
  does *not* run for `image`/`upscale`.

**Latency risk, stated plainly:** worst case for a `reels`/`video`/
`carousel` turn is now roughly 2× a single generation (initial
`produce()` + one critic call + one rewritten `produce()` + one more
critic call). At this session's observed 200-350s per single generation
on CPU-only qwen3.5:4b, that's a plausible 10-20 minute worst case for
one turn. This was a conscious tradeoff (cap rewrites at 1, not 2) but
it does not eliminate the risk the brief itself calls out in Phase 35-36
("not 5 minutes for every Reel"). This needs a real answer — async UX
with progress state (Phase 36), and/or the RTX escalation once reachable
— not just a smaller rewrite cap.

## Live test: critic/rewrite against the real Cosentino case

Superseded by the Otto Elite closure runs below — the "in progress"
placeholder that used to live here belonged to an early phase of this
same long session and was never filled in before the session moved on
to the full strategy/critic/rewrite architecture. See the next section
for the actual, current live evidence.

## Otto Elite Senior V1.0 — final closure attempt (this session, latest)

Base commit for everything below: `720b62d` (all 4 "final blocker"
fixes — semantic deliverable validation, `reference_strategy` schema
resilience, deterministic root-cause reconciliation, factual-claim
gate + narrow correction stage — tests/typecheck/lint green on both
`otto` and `otto-node`).

**Same Tammy/Cosentino request every time** (no fixture-specific
prompt, no hardcoding): *"Otto, preciso que crie o conteudo para um
reels da Cosentino informando a abertura de vendas do Jardim Europa V
dia 24 de setembro, com roteiro, sugestao de imagem para as telas e
legenda."* — with a synthetic Cosentino client-context block (segment,
campaign, the no-prior-registration fact, brand tone, audience, and
explicit "do not invent" guardrails for unit count/scarcity/commercial
terms).

### Live runs, local CPU (qwen3.5:4b)

| Run | Overall | Root cause | Notes |
|---|---|---|---|
| 1 (Fase 1 baseline) | 59/100 | — | pre-critic-architecture |
| 2 (post 6-blocker closure) | 87/100 | NONE→reclassified n/a (ran before Blocker 3 existed) | best local run; REWRITE #1 crashed on `reference_strategy` as a bare string (fixed this session) |
| 3 (post 4-blocker closure, this session) | 64/100 | EXECUTABILITY (model self-classified correctly) | strategy/completeness/factual all genuinely PASS (verified independently, not just trusted); weak script — static 5s scenes, 2 of 6 scenes `"Visual: None, purely typographic"`; REWRITE #1 crashed on a *different* new bug: `reference_strategy[].placement: "canvas_top_center"`, not in the enum |

**Volatility across local runs: 59 → 87 → 64.** Unacceptable for an
Elite bar by the mission's own stability rule (worst run must be ≥85).

### GPU discovery (Studio node, `100.107.198.50`, RTX 4090 24GB)

Read-only discovery only — no drivers touched, no processes killed, no
restarts. Findings:

- Port 22 (SSH) open, but **no credentials/keys configured on this
  machine** — `ssh -o BatchMode=yes` → `Permission denied`. No shell
  access, so no `nvidia-smi`, no way to read total/free VRAM or confirm
  what Studio/ComfyUI currently holds.
- Port 8188 (ComfyUI) open — not queried further (would touch Studio's
  own service surface).
- **Port 11434: a working Ollama runtime already installed and
  running** (`version 0.32.1`) — nothing needed installing. Models
  already pulled: `qwen2.5:14b` (14.8B, Q4_K_M, ~9GB), `llama3.1:8b`
  (~5GB), `ministral-3:3b` (~3GB), `qwen3.6:35b-a3b` (36B MoE,
  "thinking"-capable, **23.9GB — effectively the whole 24GB card**),
  `nomic-embed-text`.
- `GET /api/ps` (Ollama's own read-only loaded-models endpoint) is the
  only VRAM visibility available without host access. At the time of
  testing it showed `qwen2.5:14b` loaded using the full ~12GB it
  needs, with no error — a working data point, but it says nothing
  about what ComfyUI is holding outside Ollama's own tracking.

### Live run, GPU (`qwen2.5:14b`, same Tammy request, unchanged pipeline — just `OTTO_OLLAMA_URL`/`OTTO_MODEL` pointed at the GPU host)

**71/100 — worse than the local model's best run (87), and worse than
its own average.** 186s total (much faster than local, as expected),
but genuinely lower creative quality: `concept` 7/10, `copy` 7/10,
`hook` 6/10, `originality` 5/10, and the script was noticeably weaker
than even the poor local run 3 — four 1-2s static scenes, no camera
direction, repeated "static, high-end real estate sales office" with
no variation. The gate correctly failed it for a **genuinely new,
real unsupported claim** this run surfaced: *"O Jardim Europa V
oferece um marco no mercado imobiliário premium"* — not in the
briefing, caught by this session's Blocker 4 gate working exactly as
designed on a case that isn't the one it was built against. REWRITE #1
crashed on yet another distinct schema gap: `generation_prompts`
(required array) omitted entirely.

**Reading this honestly: a 3.5x larger general-purpose model did not
produce better Otto output.** More parameters didn't fix hook
specificity or video-direction quality, and it introduced its own new
schema-compliance gaps. This suggests the ceiling here isn't raw model
size — it may be closer to a base-model-for-creative-Portuguese-video-
direction fit issue, or a prompt/scaffolding gap that both models share
(e.g. the video-planning prompt not constraining shot variety/timing
strongly enough — flagged, not fixed, per the mission's stop rule).

### Why `qwen3.6:35b-a3b` (the one real remaining candidate) was not tested

At 23.9GB on a 24GB card that Studio's ComfyUI also actively uses for
image generation, and with **no VRAM telemetry available** (no SSH, no
`nvidia-smi`, `/api/ps` only shows Ollama's own footprint, not
ComfyUI's), loading it blind fails this mission's own explicit safety
rule ("NO OOM. Reserve safe VRAM headroom. Measure real peak VRAM.").
Not tested. This is the one open item blocking a complete GPU-tier
verdict.

### What Pedro needs to unblock this fully

One of:
1. Confirm Studio/ComfyUI is idle right now and authorize a bounded,
   watched test of `qwen3.6:35b-a3b` (worst case: an Ollama-side OOM
   error, not a host crash — Ollama fails allocation gracefully in the
   normal case, but this hasn't been verified on this specific host/
   driver combination); or
2. Grant read-only VRAM telemetry (an SSH key limited to
   `nvidia-smi --query-gpu=memory.used,memory.free`, or a monitoring
   endpoint) so headroom can be checked before every GPU-tier call,
   not just this one test; or
3. Decide the 35B candidate isn't worth the operational risk and this
   session's verdict (below) stands as the answer without it.

## Honest current gate status

**Not ready for master integration.** Neither tested configuration
(local qwen3.5:4b, GPU qwen2.5:14b) clears the ≥90 Tammy bar or the
stability bar (worst run ≥85); local shows unacceptable run-to-run
volatility (59/87/64) and the one untested candidate that could
plausibly change the outcome (`qwen3.6:35b-a3b`) cannot be safely
tested without VRAM telemetry this session does not have access to.
Everything upstream of the model choice — strategy/angle/hook
architecture, semantic completeness validation, factual-claim gate,
root-cause classification, best-valid-artifact fallback — has held up
across three different live runs against three different failure
modes and is not the current bottleneck.
