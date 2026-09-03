export const ROLE_NAMES = ['master', 'colaborador'] as const;

export type RoleName = (typeof ROLE_NAMES)[number];
