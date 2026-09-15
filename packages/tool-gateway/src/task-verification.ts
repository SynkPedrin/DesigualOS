import type { TaskDetail } from './clickup-client';

/**
 * Verificação de escrita por read-back (seções 32-33 da spec V2). Tudo aqui é
 * PURO e determinístico: recebe o estado REAL já relido e o que a ação
 * prometeu, e diz se bateu. É o que transforma "criada e validada" numa
 * afirmação verificável em vez de uma promessa que confia na resposta do POST.
 */

export interface ExpectedTaskState {
  name?: string;
  assigneeIds?: number[];
  /** null = espera SEM prazo; number = epoch ms esperado. */
  dueDate?: number | null;
  /** Status esperado (compara sem caixa/espaço). */
  status?: string;
  /** Tolerância ao comparar prazo (fuso/segundos). Default 60s. */
  dueDateToleranceMs?: number;
  /**
   * Granularidade do prazo. 'day' compara o DIA do calendário, não o instante.
   *
   * Existe porque o ClickUp normaliza prazo sem hora: mandamos fim do dia
   * (23:59:59.999) e a task volta com outro instante do mesmo dia. Com
   * comparação exata, todo create com "vencimento hoje" era relido como
   * divergência (medido ao vivo no release gate, 15/09/2026: esperado
   * 1789527599999, atual 1789455600000 — mesmo 15/09). Intenção de prazo em
   * linguagem natural ("hoje", "amanhã") é dia, não instante; quem precisa de
   * instante continua usando 'exact' (o default, que não muda nada).
   */
  dueDateGranularity?: 'exact' | 'day';
}

export interface TaskVerification {
  ok: boolean;
  /** O que foi conferido (pra o recibo dizer o que foi verificado de fato). */
  checked: string[];
  /** Divergências legíveis; vazio quando ok. */
  mismatches: string[];
}

/** Mesmo dia do calendário no fuso local (que é o fuso da operação). */
function mesmoDia(a: number, b: number): boolean {
  const da = new Date(a);
  const dbb = new Date(b);
  return (
    da.getFullYear() === dbb.getFullYear() && da.getMonth() === dbb.getMonth() && da.getDate() === dbb.getDate()
  );
}

function diaLegivel(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Normaliza nome pra comparar sem depender de acento/caixa/espaço. */
export function normalizeTaskName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compara o estado REAL relido da task com o esperado. Só cobra o que foi
 * pedido (campo ausente no expected não é conferido).
 */
export function verifyTaskState(actual: TaskDetail, expected: ExpectedTaskState): TaskVerification {
  const mismatches: string[] = [];
  const checked: string[] = [];

  if (expected.name !== undefined) {
    checked.push('nome');
    if (normalizeTaskName(actual.name) !== normalizeTaskName(expected.name)) {
      mismatches.push(`nome esperado "${expected.name}", mas a task está como "${actual.name}"`);
    }
  }

  if (expected.assigneeIds !== undefined) {
    checked.push('responsável');
    const actualIds = new Set(actual.assignees.map((a) => a.id));
    const faltando = expected.assigneeIds.filter((id) => !actualIds.has(id));
    if (faltando.length > 0) {
      mismatches.push(`responsável(is) ${faltando.join(', ')} não constam na task após a escrita`);
    }
  }

  if (expected.dueDate !== undefined) {
    checked.push('prazo');
    const tolerance = expected.dueDateToleranceMs ?? 60_000;
    if (expected.dueDate === null) {
      if (actual.dueDate !== null) mismatches.push('esperava sem prazo, mas a task tem prazo definido');
    } else if (actual.dueDate === null) {
      mismatches.push(`prazo não bateu (esperado ${expected.dueDate}, atual nenhum)`);
    } else if (expected.dueDateGranularity === 'day') {
      if (!mesmoDia(actual.dueDate, expected.dueDate)) {
        mismatches.push(
          `prazo não bateu (esperado ${diaLegivel(expected.dueDate)}, atual ${diaLegivel(actual.dueDate)})`,
        );
      }
    } else if (Math.abs(actual.dueDate - expected.dueDate) > tolerance) {
      mismatches.push(`prazo não bateu (esperado ${expected.dueDate}, atual ${actual.dueDate})`);
    }
  }

  if (expected.status !== undefined) {
    checked.push('status');
    if ((actual.status ?? '').toLowerCase().trim() !== expected.status.toLowerCase().trim()) {
      mismatches.push(`status esperado "${expected.status}", mas a task está como "${actual.status ?? 'sem status'}"`);
    }
  }

  return { ok: mismatches.length === 0, checked, mismatches };
}

/**
 * IDEMPOTÊNCIA (seção 33): dado o conjunto de tasks já existentes na lista,
 * encontra uma com o MESMO nome normalizado. Se o create anterior tiver
 * gravado (timeout que mentiu, ou o guard rodando duas vezes), o retry acha a
 * task existente em vez de criar uma duplicata. Puro: recebe as tasks buscadas.
 */
export function findDuplicateTask<T extends { id: string; name: string }>(existing: T[], name: string): T | null {
  const target = normalizeTaskName(name);
  return existing.find((task) => normalizeTaskName(task.name) === target) ?? null;
}
