# OTTO ELITE CREATIVE HANDOFF

Branch: `otto-elite-quality`
Base SHA: `53f0804` (main, at worktree creation — a separate master session had
substantial uncommitted work on `main` at the same time; this worktree never
touched that checkout)
Commit: see `git log otto-elite-quality` after this handoff is committed

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

## Status

CREATIVE QUALITY BLOCKER (partial)

Two real, root-cause-verified, tested structural bugs are fixed and
ready for integration as-is — they directly close the mechanism behind
the named regression. The broader elite-creative-quality mission
(angle engine, multi-specialist critique, quality gate scoring, model
benchmark, golden set, blind evaluation) is untouched and remains
BLOCKED on future sessions with budget for live-model iteration, which
this pass did not have. Do not read this as "Otto is now senior-level" —
read it as "the specific mechanism that produced junior-looking Reels
scripts is closed; the rest of the quality program is still ahead."
