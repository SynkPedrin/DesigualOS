import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { WorkContext } from './context';
import { invalid, notFound } from './errors';
import { getTask } from './tasks';

const TIPOS = ['text', 'number', 'date', 'drop_down', 'labels', 'checkbox', 'url', 'email', 'phone', 'currency', 'short_text'] as const;

export async function listCustomFields(ctx: WorkContext, spaceId: string) {
  return db.select().from(schema.workCustomFields).where(and(eq(schema.workCustomFields.organizationId, ctx.organizationId), eq(schema.workCustomFields.spaceId, spaceId))).orderBy(asc(schema.workCustomFields.position));
}

export async function createCustomField(ctx: WorkContext, spaceId: string, input: { name: string; fieldType: string; options?: string[] }) {
  if (!input.name.trim()) throw invalid('Dê um nome ao campo.');
  if (!(TIPOS as readonly string[]).includes(input.fieldType)) throw invalid(`Tipo inválido. Use: ${TIPOS.join(', ')}.`);
  const [sp] = await db.select({ id: schema.workSpaces.id }).from(schema.workSpaces).where(and(eq(schema.workSpaces.id, spaceId), eq(schema.workSpaces.organizationId, ctx.organizationId)));
  if (!sp) throw notFound('Espaço');
  const options = (input.options ?? []).map((l, i) => ({ id: `opt${i + 1}`, label: l.trim() })).filter((o) => o.label);
  const [f] = await db.insert(schema.workCustomFields).values({ organizationId: ctx.organizationId, spaceId, name: input.name.trim(), fieldType: input.fieldType, options, position: Date.now() }).returning();
  return f!;
}

/** Grava (ou limpa, com `null`) o valor de um campo numa tarefa. O campo precisa ser do espaço da tarefa. */
export async function setCustomFieldValue(ctx: WorkContext, taskId: string, fieldId: string, value: unknown) {
  const task = await getTask(ctx, taskId);
  const [f] = await db.select().from(schema.workCustomFields).where(and(eq(schema.workCustomFields.id, fieldId), eq(schema.workCustomFields.organizationId, ctx.organizationId)));
  if (!f) throw notFound('Campo');
  const [lista] = await db.select({ spaceId: schema.workLists.spaceId }).from(schema.workLists).where(eq(schema.workLists.id, task.listId));
  if (lista?.spaceId !== f.spaceId) throw invalid('Este campo pertence a outro espaço.');
  if (value === null || value === '') {
    await db.delete(schema.workCustomFieldValues).where(and(eq(schema.workCustomFieldValues.taskId, taskId), eq(schema.workCustomFieldValues.fieldId, fieldId)));
    return { ok: true };
  }
  if (f.fieldType === 'number' || f.fieldType === 'currency') { if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid('Informe um número.'); }
  if (f.fieldType === 'checkbox' && typeof value !== 'boolean') throw invalid('Informe sim ou não.');
  if (f.fieldType === 'drop_down' && !f.options.some((o) => o.label === value)) throw invalid('Opção inexistente.');
  await db.insert(schema.workCustomFieldValues).values({ organizationId: ctx.organizationId, taskId, fieldId, value })
    .onConflictDoUpdate({ target: [schema.workCustomFieldValues.taskId, schema.workCustomFieldValues.fieldId], set: { value, updatedAt: new Date() } });
  return { ok: true };
}
