import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { WorkContext } from './context';
import { invalid } from './errors';

/** Visualização INDIVIDUAL: cada pessoa escolhe colunas, densidade, agrupamento e a visão em que a tela abre. */
export const COLUNAS_DA_LISTA = ['andamento', 'responsavel', 'prazo', 'prioridade', 'status', 'cliente', 'tags'] as const;
export interface WorkPreferences {
  colunas: Array<(typeof COLUNAS_DA_LISTA)[number]>;
  densidade: 'compacta' | 'confortavel';
  agrupar: boolean;
  visaoPadrao: 'lista' | 'quadro' | 'calendario' | 'tabela' | 'gantt';
  mostrarConcluidas: boolean;
  subtarefasAbertas: boolean;
}
export const PREFERENCIAS_PADRAO: WorkPreferences = { colunas: ['andamento', 'responsavel', 'prazo', 'prioridade', 'status'], densidade: 'confortavel', agrupar: false, visaoPadrao: 'lista', mostrarConcluidas: false, subtarefasAbertas: false };

function normalizar(raw: Record<string, unknown> | undefined): WorkPreferences {
  const r = raw ?? {};
  const colunas = Array.isArray(r.colunas) ? (r.colunas.filter((c): c is WorkPreferences['colunas'][number] => (COLUNAS_DA_LISTA as readonly string[]).includes(String(c)))) : PREFERENCIAS_PADRAO.colunas;
  return {
    colunas,
    densidade: r.densidade === 'compacta' ? 'compacta' : 'confortavel',
    agrupar: r.agrupar === true,
    visaoPadrao: (['lista', 'quadro', 'calendario', 'tabela', 'gantt'] as const).find((v) => v === r.visaoPadrao) ?? 'lista',
    mostrarConcluidas: r.mostrarConcluidas === true,
    subtarefasAbertas: r.subtarefasAbertas === true,
  };
}

export async function getPreferences(ctx: WorkContext): Promise<WorkPreferences> {
  const [row] = await db.select({ p: schema.workUserState.preferences }).from(schema.workUserState).where(and(eq(schema.workUserState.organizationId, ctx.organizationId), eq(schema.workUserState.userId, ctx.userId)));
  return normalizar(row?.p);
}

export async function setPreferences(ctx: WorkContext, patch: Partial<WorkPreferences>): Promise<WorkPreferences> {
  if (patch.colunas && patch.colunas.some((c) => !(COLUNAS_DA_LISTA as readonly string[]).includes(c))) throw invalid('Coluna desconhecida.');
  const novo = normalizar({ ...(await getPreferences(ctx)), ...patch });
  await db.insert(schema.workUserState).values({ organizationId: ctx.organizationId, userId: ctx.userId, preferences: novo as unknown as Record<string, unknown> })
    .onConflictDoUpdate({ target: [schema.workUserState.organizationId, schema.workUserState.userId], set: { preferences: sql`${JSON.stringify(novo)}::jsonb` } });
  return novo;
}
