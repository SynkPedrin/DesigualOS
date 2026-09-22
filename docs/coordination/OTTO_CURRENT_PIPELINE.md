# Otto — Current Pipeline (as-built trace, 2026-09-22)

Trace of the Otto **node** (the running Fastify service on port 4002, `packages/otto` +
`nodes/otto-node`) — not the Claude Code Otto skill. Worktree: `otto-elite-quality`,
base commit `53f0804`. Every claim below is file:line-grounded; see the full trace
in the handoff for citations.

## Request path

```
user message (chat/WhatsApp/web)
  → apps/worker agentic-dispatch.ts (assembles outbound context, appends it
    INLINE into the message text after a "\n\n---\nContexto:\n" marker)
  → client-context.ts::resolveClientTurnContext (queries schema.memories,
    kind='client.profile', merges criativo/operacional/aprendizado registries
    into a budgeted 9000-char block)
  → POST nodes/otto-node /execute → executeTask() (execute.ts:381-794)
      ├─ detectProductionIntent() → StudioJobType (carousel/reels/video/
      │   upscale/image) — requires an explicit production verb, else falls
      │   through to plain CHAT
      ├─ Brain retrieval (packages/otto/src/brain/retrieval.ts) — lexical/
      │   keyword scoring, no embeddings, over Brain-Marketing/ (6 generic
      │   docs in this worktree) + STUDIO-BRAIN/ (155/161 docs, NOT present
      │   in this worktree — lives on the Otto host)
      ├─ referent resolution, creative DNA (brand kit + feedback history)
      └─ TWO DIFFERENT OUTPUT PATHS:
           A) CHAT path (execute.ts:564-601): single Ollama call
              (CHAT_SYSTEM_PROMPT + FECHAMENTO_ENTREGA + context blocks),
              temperature 0.7, num_predict 1000, NO critique pass, returns
              raw text straight to the user.
           B) PRODUCTION path (image/carousel/video/upscale only):
              runCreativePipeline() — generate → assessCreativeCopy()
              anti-generic gate → up to 2 revision passes → qualityPassed
              flag. Real multi-pass loop, but only reachable when the
              request maps to a StudioJobType.
```

## Model

- Provider: Ollama only. Model: `qwen3.5:4b`, CPU inference on a Mac mini
  (~10 tok/s). `OTTO_LLM_TIMEOUT_MS` = 120s. `numCtx` = 16 384 (set
  explicitly — Ollama's silent 4096 default was truncating the system
  prompt). `think:false` forced at all depth tiers (136× latency win, but
  means the model never reasons before answering).
- `num_predict`: **1000 tokens for chat**, 4000 for structured/JSON planning
  calls. No `top_p` set. No fallback model/provider.
- Temperature: 0.7 chat, 0.8 creative planner, 0.2 QC evaluator.

## The structural gap

**Everything phases 3–21 of an "elite creative pipeline" ask for — angle
divergence, strategist framing, hook lab, multi-specialist critique, quality
gate, completeness contract — exists ONLY on the production/image path
(`runCreativePipeline`, anti-generic gate). The CHAT path, which is what
handles a request like "cria o roteiro do Reels e a legenda" when it has no
image-generation component, is a single unstructured LLM call with zero
critique and a 1000-token output cap.**

`detectProductionIntent()` (execute.ts:142-158) only routes to the
production pipeline when it detects an explicit production verb *and* an
asset-type keyword (carousel/video/upscale/image). A request for a **text**
deliverable package — script + shot suggestions + caption, no image
render — has no asset-type keyword to match, so it falls through to CHAT.
This is exactly the shape of the real Tammy regression case (Jardim Europa V
Reels): informational script + caption, not an image job.

## Brain Marketing content

In this worktree, `Brain-Marketing/` has 6 generic strategy docs (GTM,
positioning, brand architecture, content pyramid, demand funnel,
attribution) — no client-specific creative material. Real client material
lives in `STUDIO-BRAIN/06_CLIENTS` and `07_PROJECTS`, which is a synced
vault not present in this repo checkout (consistent with `.gitignore`
excluding `arquivos clientes/` and `brain/` per CLAUDE.md). Client-specific
grounding for chat responses currently comes almost entirely from the
upstream `client.profile` memories block, not from Otto's own brain index.

## Tests

20 unit test files exist (classifiers, schema validation, pipeline wiring
with mocked LLM). **No golden-set or creative-quality regression suite
exists.** Testing today verifies plumbing, not output quality.

## `brain/Agentes/Otto.md`

Does not exist in this repo — the CLAUDE.md reference to it is stale or it
lives outside this checkout.
