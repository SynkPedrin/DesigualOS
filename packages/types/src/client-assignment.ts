/**
 * Responsabilidade operacional de um membro sobre um cliente (P0-C,
 * 06/10/2026) — distinta do `role` de acesso ao workspace (viewer/editor).
 * Texto livre validado aqui, não enum de banco: um tipo novo não deve exigir
 * migration.
 */
export const CLIENT_RESPONSIBILITIES = [
  'account',
  'traffic',
  'design',
  'copy',
  'social',
  'video',
  'manager',
  'sales',
  'other',
] as const;

export type ClientResponsibility = (typeof CLIENT_RESPONSIBILITIES)[number];
