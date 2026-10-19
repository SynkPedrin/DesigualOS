/** Demand (P1-D, 06/10/2026) — "o cliente pediu algo". Distinto de Task
 *  (produção) e Brief (especificação) — ver packages/database schema/demands.ts. */
export const DEMAND_SOURCES = ['whatsapp', 'manual', 'bento'] as const;
export type DemandSource = (typeof DEMAND_SOURCES)[number];

export const DEMAND_STATUSES = ['new', 'briefing', 'in_production', 'done', 'cancelled'] as const;
export type DemandStatus = (typeof DEMAND_STATUSES)[number];

export const DEMAND_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type DemandPriority = (typeof DEMAND_PRIORITIES)[number];
