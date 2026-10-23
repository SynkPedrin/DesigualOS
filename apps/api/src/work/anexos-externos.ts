import { Readable } from 'node:stream';
import { and, eq, like, or, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { AnexoRecusado, apagarAnexo, gravarAnexo } from '../internal-chat/arquivos';

/**
 * Copia para o armazenamento próprio os anexos que o importador deixou como link do ClickUp. Link do ClickUp expira
 * e depende de a conta de lá continuar existindo; arquivo copiado fica com a agência.
 *
 * Seguro por construção: só baixa de servidores do ClickUp (lista fechada, nada de URL arbitrária), passa pela MESMA
 * validação dos anexos da Comunicação (extensão, tipo, assinatura, limite por tipo e quota) e, se qualquer coisa falhar,
 * o link original continua valendo. Idempotente: quem já foi copiado não é tocado de novo.
 */
const HOSTS_DO_CLICKUP = [/(^|\.)clickup-attachments\.com$/i, /(^|\.)clickup\.com$/i];
const TEMPO_MAXIMO_MS = 60_000;

export interface RelatorioDeCopia { candidatos: number; copiados: number; recusados: Array<{ id: string; arquivo: string; motivo: string }>; falhas: Array<{ id: string; arquivo: string; motivo: string }>; restantes: number }

function hostPermitido(u: URL, extras: RegExp[]): boolean {
  if (extras.length === 0 && u.protocol !== 'https:') return false;
  return [...HOSTS_DO_CLICKUP, ...extras].some((r) => r.test(u.hostname));
}

export async function copiarAnexosDoClickUp(opts: { organizationId: string; limite?: number; simular?: boolean; hostsExtras?: RegExp[] }): Promise<RelatorioDeCopia> {
  const A = schema.workAttachments;
  const extras = opts.hostsExtras ?? [];
  const alvo = and(eq(A.organizationId, opts.organizationId), eq(A.storage, 'external'), or(like(A.url, '%clickup-attachments.com%'), like(A.url, '%clickup.com%'), ...(extras.length ? [like(A.url, 'http://127.0.0.1%')] : [])));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(A).where(alvo) as [{ n: number }];
  const lote = await db.select().from(A).where(alvo).orderBy(A.createdAt).limit(Math.min(Math.max(opts.limite ?? 25, 1), 100));
  const rel: RelatorioDeCopia = { candidatos: lote.length, copiados: 0, recusados: [], falhas: [], restantes: n };
  if (opts.simular) return rel;
  const [uso] = await db.select({ total: sql<string>`coalesce(sum(${A.sizeBytes}), 0)` }).from(A).where(and(eq(A.organizationId, opts.organizationId), eq(A.storage, 'storage')));
  let usado = Number(uso?.total ?? 0);

  for (const a of lote) {
    let chave: string | null = null;
    try {
      const u = new URL(a.url);
      if (!hostPermitido(u, extras)) throw new AnexoRecusado('Endereço fora do ClickUp.', 400);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TEMPO_MAXIMO_MS);
      try {
        const r = await fetch(u, { signal: ctl.signal, redirect: 'error' });
        if (!r.ok || !r.body) throw new Error(`o ClickUp respondeu ${r.status}`);
        let nome = a.fileName;
        if (!/\.[A-Za-z0-9]{2,5}$/.test(nome)) { const ext = u.pathname.match(/\.([A-Za-z0-9]{2,5})$/)?.[1]; if (ext) nome = `${nome}.${ext}`; }
        const g = await gravarAnexo({ organizationId: opts.organizationId, conversationId: `tarefa-${a.taskId}`, filename: nome, mimetype: r.headers.get('content-type') ?? a.mimeType ?? '', stream: Readable.fromWeb(r.body as never), usadoPelaOrganizacao: usado });
        chave = g.storageKey;
        const feito = await db.update(A).set({ url: `storage:${g.storageKey}`, storage: 'storage', mimeType: g.servirComo, sizeBytes: g.sizeBytes, fileName: g.filename, updatedAt: new Date() }).where(and(eq(A.id, a.id), eq(A.storage, 'external'))).returning({ id: A.id });
        if (!feito.length) { await apagarAnexo(g.storageKey); continue; } // outra execução chegou antes
        usado += g.sizeBytes; rel.copiados += 1; rel.restantes -= 1;
      } finally { clearTimeout(timer); }
    } catch (e) {
      if (chave) await apagarAnexo(chave).catch(() => undefined);
      const item = { id: a.id, arquivo: a.fileName, motivo: e instanceof Error ? e.message : String(e) };
      if (e instanceof AnexoRecusado) rel.recusados.push(item); else rel.falhas.push(item);
    }
  }
  return rel;
}
