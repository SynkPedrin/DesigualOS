import '../env.js';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { createLogger } from '@desigual-os/logging';
import { db, schema } from '@desigual-os/database';
import { getTasksInList, type ClickUpTaskSummary } from '@desigual-os/tool-gateway';
import { resolveSharedClickUpAccess, type ClickUpAccess } from '../integrations/access';

/**
 * Importa a memória de cada cliente pro chat (`pnpm memory:import`).
 *
 * Fonte: pastas "arquivos clientes/CLIENTES/CLIENTE_XX_NOME" na raiz do repo,
 * cada uma com 13 arquivos .md padronizados (00 a 12). Pra cada pasta que
 * casa com um cliente do banco (por clickup_list_id achado nos .md, ou pelo
 * nome normalizado como fallback), monta um dossiê único, anexa um resumo
 * das tarefas abertas no ClickUp e grava em memories com kind
 * 'client.profile' (uma linha por cliente: reimportar atualiza, não duplica).
 *
 * NUNCA cria cliente: pasta sem match vira linha "SEM MATCH" no relatório.
 *
 * Flags:
 *   --only=<substr>   roda só pras pastas cujo nome contém <substr>
 *   --dry-run         monta tudo e imprime, sem gravar nada no banco
 */
const logger = createLogger({ service: 'memory-import' });

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const CLIENTS_DIR = join(REPO_ROOT, 'arquivos clientes', 'CLIENTES');

/** Arquivo com a visão consolidada; quando não existe, cai pro 00_CLIENTE. */
const MAIN_FILE = '12_CONTEXTO_COMPLETO.md';
const FALLBACK_MAIN_FILE = '00_CLIENTE.md';

const SECTION_MAX_CHARS = 1200;
const DOSSIER_MAX_CHARS = 12000;
const OPEN_TASKS_PREVIEW = 10;
const TOP_TAGS = 5;

/** IDs de lista do ClickUp são numéricos de ~12 dígitos (ex: 901412055584). */
const CLICKUP_LIST_ID_PATTERN = /\b\d{12}\b/;

interface ClientRow {
  id: string;
  name: string;
  slug: string;
  clickupListId: string | null;
}

/** Corte limpo: corta no último espaço perto do limite pra não quebrar palavra. */
function truncateClean(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxChars * 0.8 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

/** lowercase, sem acento, tudo que não é letra/número vira um espaço só. */
function normalizeName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "CLIENTE_04_COSENTINO" -> "cosentino" (normalizado). */
function normalizeFolderName(folder: string): string {
  return normalizeName(folder.replace(/^CLIENTE_\d+_/i, '').replace(/_/g, ' '));
}

function findClickUpListId(contents: string[]): string | null {
  for (const content of contents) {
    const match = content.match(CLICKUP_LIST_ID_PATTERN);
    if (match) return match[0];
  }
  return null;
}

function matchClient(folder: string, clickUpListId: string | null, clients: ClientRow[]): ClientRow | null {
  if (clickUpListId) {
    const byListId = clients.find((client) => client.clickupListId === clickUpListId);
    if (byListId) return byListId;
  }
  const wanted = normalizeFolderName(folder);
  return (
    clients.find((client) => normalizeName(client.name) === wanted) ??
    clients.find((client) => normalizeName(client.slug.replace(/-/g, ' ')) === wanted) ??
    null
  );
}

/**
 * Monta o dossiê: título com o nome do cliente, o arquivo principal integral
 * e os demais como seções truncadas. Para de adicionar quando estoura o
 * teto total, truncando a última seção que ainda cabe.
 */
function buildDossier(clientName: string, files: { name: string; content: string }[]): string {
  const main = files.find((file) => file.name === MAIN_FILE) ?? files.find((file) => file.name === FALLBACK_MAIN_FILE);
  const parts: string[] = [`# ${clientName}`];
  if (main) parts.push(main.content.trim());
  for (const file of files) {
    if (file === main) continue;
    const section = `## ${file.name.replace(/\.md$/, '')}\n\n${truncateClean(file.content.trim(), SECTION_MAX_CHARS)}`;
    parts.push(section);
  }

  let dossier = '';
  for (const part of parts) {
    const remaining = DOSSIER_MAX_CHARS - dossier.length;
    if (remaining <= 0) break;
    dossier += (dossier ? '\n\n' : '') + truncateClean(part, remaining);
  }
  return dossier;
}

function formatTaskLine(task: ClickUpTaskSummary): string {
  const bits = [task.status ?? 'sem status'];
  if (task.priority) bits.push(`prioridade ${task.priority}`);
  if (task.dueDate) bits.push(`prazo ${task.dueDate.slice(0, 10)}`);
  return `- ${task.name} [${bits.join(', ')}]`;
}

/** Resumo das tarefas abertas da lista do cliente. Falha aqui não derruba o cliente. */
async function buildClickUpSection(
  access: ClickUpAccess | null,
  clickUpListId: string,
  syncedAt: string,
): Promise<string | null> {
  if (!access) return null;
  const tasks = await getTasksInList(access.token, clickUpListId);

  const byStatus = new Map<string, number>();
  const tagCount = new Map<string, number>();
  for (const task of tasks) {
    const status = task.status ?? 'sem status';
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    for (const tag of task.tags) tagCount.set(tag.name, (tagCount.get(tag.name) ?? 0) + 1);
  }

  const lines = [`## ClickUp (sincronizado em ${syncedAt})`, ''];
  const statusSummary = [...byStatus.entries()].map(([status, count]) => `${status}: ${count}`).join(', ');
  lines.push(`Tarefas abertas: ${tasks.length}${statusSummary ? ` (${statusSummary})` : ''}`);
  for (const task of tasks.slice(0, OPEN_TASKS_PREVIEW)) lines.push(formatTaskLine(task));
  const topTags = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_TAGS)
    .map(([tag, count]) => `${tag} (${count})`);
  if (topTags.length > 0) lines.push('', `Tags mais frequentes: ${topTags.join(', ')}`);
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const only = args.find((arg) => arg.startsWith('--only='))?.slice('--only='.length).toLowerCase() ?? null;
  const dryRun = args.includes('--dry-run');

  const clickUpAccess = resolveSharedClickUpAccess();
  if (!clickUpAccess) {
    logger.warn('CLICKUP_API_KEY/CLICKUP_TEAM_ID não configurados: dossiês vão sem a seção do ClickUp');
  }

  const entries = await readdir(CLIENTS_DIR, { withFileTypes: true });
  const folders = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('CLIENTE_'))
    .map((entry) => entry.name)
    .sort()
    .filter((name) => !only || name.toLowerCase().includes(only));

  const clientRows = await db
    .select({ id: schema.clients.id, name: schema.clients.name, slug: schema.clients.slug, clickupListId: schema.clients.clickupListId })
    .from(schema.clients)
    .where(isNull(schema.clients.deletedAt));

  const syncedAt = new Date().toISOString();
  const report = { inserted: 0, updated: 0, semMatch: [] as string[], clickUpFailed: [] as string[], dryRun };

  for (const folder of folders) {
    const folderPath = join(CLIENTS_DIR, folder);
    const fileNames = (await readdir(folderPath)).filter((name) => name.endsWith('.md') && !name.startsWith('_')).sort();
    const files = await Promise.all(
      fileNames.map(async (name) => ({ name, content: await readFile(join(folderPath, name), 'utf8') })),
    );
    if (files.length === 0) {
      logger.warn({ folder }, 'Pasta sem arquivos .md, pulando');
      report.semMatch.push(`${folder} (sem .md)`);
      continue;
    }

    const clickUpListIdFromDocs = findClickUpListId(files.map((file) => file.content));
    const client = matchClient(folder, clickUpListIdFromDocs, clientRows);
    if (!client) {
      logger.warn({ folder, clickUpListIdFromDocs }, 'SEM MATCH: nenhum cliente do banco corresponde a esta pasta');
      report.semMatch.push(folder);
      continue;
    }

    let dossier = buildDossier(client.name, files);
    if (client.clickupListId) {
      try {
        const section = await buildClickUpSection(clickUpAccess, client.clickupListId, syncedAt);
        // Reserva o espaço da seção ANTES de concatenar: truncar depois de
        // somar cortava a seção inteira nos dossiês grandes (falha real: 6
        // clientes ficaram sem ClickUp na memória em 04/09/2026).
        if (section) dossier = `${truncateClean(dossier, DOSSIER_MAX_CHARS - section.length - 2)}\n\n${section}`;
      } catch (error: unknown) {
        logger.warn({ folder, client: client.name, error }, 'ClickUp falhou pra este cliente; dossiê vai sem a seção');
        report.clickUpFailed.push(folder);
      }
    }

    const metadata = {
      source: 'import-client-memories',
      folder,
      clickup_list_id: client.clickupListId,
      synced_at: syncedAt,
    };

    if (dryRun) {
      logger.info(
        { folder, client: client.name, chars: dossier.length, clickUpListId: client.clickupListId },
        'DRY RUN: dossiê montado',
      );
      console.log(`\n===== ${folder} -> ${client.name} (${dossier.length} chars) =====\n${dossier}\n`);
      continue;
    }

    const [existing] = await db
      .select({ id: schema.memories.id })
      .from(schema.memories)
      .where(and(eq(schema.memories.clientId, client.id), eq(schema.memories.kind, 'client.profile')))
      .orderBy(desc(schema.memories.updatedAt))
      .limit(1);

    if (existing) {
      await db
        .update(schema.memories)
        .set({ content: dossier, metadata, updatedAt: new Date() })
        .where(eq(schema.memories.id, existing.id));
      report.updated += 1;
      logger.info({ folder, client: client.name, chars: dossier.length }, 'Memória atualizada');
    } else {
      // agentId null, igual aos registros client.profile já existentes na base.
      await db.insert(schema.memories).values({ clientId: client.id, agentId: null, kind: 'client.profile', content: dossier, metadata });
      report.inserted += 1;
      logger.info({ folder, client: client.name, chars: dossier.length }, 'Memória criada');
    }
  }

  logger.info(report, 'Importação concluída');
  if (report.semMatch.length > 0) console.log(`SEM MATCH (${report.semMatch.length}): ${report.semMatch.join(', ')}`);
  process.exit(0);
}

main().catch((error: unknown) => {
  logger.error({ error }, 'Importação falhou');
  process.exit(1);
});
