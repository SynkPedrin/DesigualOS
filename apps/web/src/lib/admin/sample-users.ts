export const PERMISSION_MATRIX: Array<{ resource: string; master: boolean; colaborador: boolean }> = [
  { resource: 'chat:write', master: true, colaborador: true },
  { resource: 'studio:write', master: true, colaborador: true },
  { resource: 'costs:read', master: true, colaborador: false },
  { resource: 'admin:write', master: true, colaborador: false },
];
