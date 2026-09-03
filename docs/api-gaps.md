# API Gaps

Living log of anything the frontend needed that was not (yet) precisely defined in
`brain/06 - Contratos de API.md`. Each entry is a proposal from the frontend side, not a
final contract: the backend team reviews and confirms or adjusts before we consider it settled.

As of 2026-09-01, every item below has been confirmed by the backend team and implemented.
Kept as a record of what was assumed vs. what turned out to be true, and for the couple of
items intentionally deferred.

---

## Resolved, all implemented in `contracts.ts`

- **`GET /health/infrastructure`**: real since backend's Fase 03. `warning` is a real
  `NodeStatus` (not summary-only), added to `NODE_STATUSES` in `@desigual-os/types` by the
  backend. `last_backup_at` is always `null` (no backup system built yet, not missing data).
  There is no `nodes_active` separate from `agents_connected` (1 node = 1 agent).
- **`POST /chat`, `GET /executions`, `GET /executions/:id`**: real and tested. `agent_hint`
  (request) is intentionally uppercase (`AUTO|BENTO|JARBAS|SUZY|STUDIO`, prompt mestre seção 9)
  while `agent` (response) is the lowercase domain `AgentName`, modeled as two distinct types
  on purpose. `estimated_cost`/`actual_cost` are computed for real now (not always `null`).
  `client_id` is present on both list and detail items, `GET /executions?client_id=` filters.
  `steps[].output.sources` is `string[]` (e.g. Obsidian file paths like
  `"02 - Stack Tecnologica.md"`), not `{ label, url }`.
- **Error envelope**: always `{ error: string }`, no exceptions, confirmed by the backend.
  Validation failures (Zod) are always `400 { error: "Validation failed", details: [{ path,
  message }] }`. `apiFetch` / `ApiRequestError` updated accordingly.
- **`POST /studio/jobs`, `GET /studio/jobs/:id`, `GET /studio/assets`**: real, tested, requires
  `studio:write`. Request body confirmed as `{ client_id, project_id?, type, prompt?,
  resolution? }`. `type` is `STUDIO_JOB_TYPES` from `@desigual-os/types`
  (`image | carousel | video | reels | upscale`), imported rather than redeclared. `resolution`
  has no fixed mapping per type on the backend, the per-type defaults in `JobForm` are a
  frontend UI decision. Assets are SVG placeholders for now (no GPU wired up), documented by
  the backend, not a frontend guess.
- **`GET /costs/overview|by-agent|by-client|by-user`**: real, tested. `total_cost_usd` always
  USD, no exchange rate on the backend. Now requires `costs:read`, master-only: colaborador
  gets 403. Frontend should avoid calling these routes at all for a colaborador session rather
  than surface the error (see role-aware UI note below).
- **`GET /clients`, `GET /clients/:id`, `POST /clients`**: real now (`clients:write` is
  master-only). Shape: `{ id, name, slug, status }`. Replaced the earlier 4-client frontend
  placeholder wholesale.

## Deferred by choice, not open questions

- **`GET /nodes`, `GET /nodes/:node_id`**: confirmed real with exact shapes (`/nodes` is a
  plain list without metrics; `/nodes/:node_id` adds `capabilities: string[]` and a nested
  `latest_metrics`). Not implemented: `GET /health/infrastructure` already covers everything
  Monitoramento needs. Revisit if a node detail drill-down view gets built.
- **`/ws`**: a real WebSocket channel exists and broadcasts unfiltered `studio.job.progress`
  events, per the backend. The frontend deliberately still polls `GET /executions/:id` /
  `GET /studio/jobs/:id` instead of connecting to it, to avoid mixing mock-vs-live per endpoint
  mid-build. Swapping polling for the real socket is confined to the query hooks, no screen
  component needs to change.

## GET /conversations, GET /conversations/:id/messages

**Status:** confirmed real by the backend (2026-09-01), but only described in prose (agent
filter via `?agent=`, ordered by `updated_at`, `last_agent` + `last_message_preview` on the
list, full messages on the detail), not shown as JSON. `ConversationSummaryWire` /
`ConversationMessageWire` in `contracts.ts` are the frontend's best-effort shape from that
description. Backend: please confirm or correct the exact field names when convenient, not
blocking. Powers the new Chat sidebar (Claude-style conversation history) and the Agentes
screen's "ver histórico" link (`/chat?agent=X` pre-filters both the agent selector and the
sidebar).

## New: role-aware UI (not a backend gap, a frontend TODO)

Backend confirmed `costs:read` is master-only. Frontend still queries `/costs/*`
unconditionally regardless of role, colaborador sessions would see a 403 surface as an error
state instead of the Costs nav item just not being there. Fix: gate the Costs nav link and any
cost widgets behind `useMe().data.roles.includes('master')`.
