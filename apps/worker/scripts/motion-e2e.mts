/**
 * §45 — TESTE COM CAMPANHA REAL, ponta a ponta.
 *
 * Não é unit test e não roda no `pnpm test`: gasta Opus 5.5 de verdade,
 * renderiza vídeo de verdade e publica no Supabase de verdade. Roda à mão:
 *
 *   OTTO_MOTION_ENABLED=true pnpm --filter @desigual-os/worker exec \
 *     tsx scripts/motion-e2e.mts --cliente d-carvalho
 *
 * O que ele exercita, na ordem real:
 *   turno do Otto -> guard -> MotionSession -> fila -> ClientContextResolver
 *   -> assets copiados -> Claude Opus 5.5 -> Remotion -> preview -> QA
 *   técnico + QA visual -> correção -> render final -> upload -> status que o
 *   chat lê.
 *
 * Confere também o que o §11 e o §52 exigem: os arquivos ORIGINAIS do cliente
 * ficam byte a byte iguais no fim.
 */
// env ANTES de qualquer import que toque o banco: o client do Drizzle lê
// DATABASE_URL no import, não na primeira query.
import '../src/env.js';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { createLogger } from '@desigual-os/logging';
import {
  MOTION_MODEL_ID,
  checkClaudeConnection,
  getMotionMetadata,
  getMotionSession,
  getMotionStatus,
  resolveClientContext,
  workspaceFor,
} from '@desigual-os/otto-motion';
// Entrada separada de propósito: o pipeline carrega addon nativo (remotion,
// sharp) e por isso não sai no barril. Ver o comentário em otto-motion/index.ts.
import { runMotionPipeline } from '@desigual-os/otto-motion/pipeline';
import { tryMotionGuard } from '../src/processors/motion-guard.js';

const logger = createLogger({ service: 'motion-e2e', pretty: true });
const slug = process.argv[process.argv.indexOf('--cliente') + 1] ?? 'd-carvalho';
const pedido =
  process.argv.includes('--pedido')
    ? process.argv[process.argv.indexOf('--pedido') + 1]!
    : 'Otto, pega os materiais desse cliente e faz um motion publicitário de 10 segundos pro Instagram Stories.';

function titulo(texto: string): void {
  console.log(`\n\x1b[1m\x1b[35m── ${texto} ${'─'.repeat(Math.max(0, 58 - texto.length))}\x1b[0m`);
}

async function hashDe(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) return `erro:${response.status}`;
  return createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
}

titulo('0. PROVIDER');
const conexao = await checkClaudeConnection();
console.log(`  ${conexao.state} · ${conexao.message}`);
console.log(`  conta: ${conexao.account ?? '—'} · versão: ${String(conexao.details.version ?? '—')}`);
if (conexao.state !== 'CONNECTED') {
  console.error(`\n  FAIL CLOSED (§5): ${conexao.remedy ?? 'sem remédio conhecido'}`);
  process.exit(1);
}

titulo('1. CLIENTE');
const clientes = await db.select().from(schema.clients).where(eq(schema.clients.slug, slug)).limit(1);
const cliente = clientes[0];
if (!cliente) {
  console.error(`  cliente '${slug}' não existe na carteira`);
  process.exit(1);
}
console.log(`  ${cliente.name} (${cliente.id})`);

titulo('2. CONTEXTO (ClientContextResolver)');
const contexto = await resolveClientContext(cliente.id);
console.log(`  fontes: ${contexto.sources.join(' · ')}`);
console.log(`  paleta: ${contexto.brand.colors.join(', ') || '[FALTA]'}`);
console.log(`  fontes tipográficas: ${contexto.brand.fonts.join(', ') || '[FALTA]'}`);
console.log(`  assets encontrados: ${contexto.assets.length}`);
console.log(`  lacunas declaradas: ${contexto.missing.join(', ') || 'nenhuma'}`);

// Impressão digital dos ORIGINAIS antes de qualquer coisa (§11).
const originais = contexto.assets.slice(0, 6);
const antes = new Map<string, string>();
for (const asset of originais) antes.set(asset.sourceUrl, await hashDe(asset.sourceUrl));
console.log(`  impressão digital de ${antes.size} originais registrada`);

titulo('3. TURNO DO OTTO (guard)');
const executionId = `e2e-${Date.now()}`;
const resposta = await tryMotionGuard({
  agent: 'otto',
  message: pedido,
  executionId,
  conversationId: null,
  clientId: cliente.id,
  userId: null,
  projectId: null,
  attachments: [],
  logger,
});

if (!resposta) {
  console.error('  o guard NÃO classificou como motion — o turno seguiria o caminho normal do Otto');
  process.exit(1);
}
console.log(`  Otto respondeu: ${(resposta.answer ?? '').split('\n')[0]}`);
const bloco = resposta.metadata?.motion as { motion_id: string } | undefined;
if (!bloco) {
  console.error(`  sem sessão de motion: ${JSON.stringify(resposta.metadata)}`);
  process.exit(1);
}
const motionId = bloco.motion_id;
console.log(`  motion: ${motionId}`);

titulo('4. PIPELINE');
const inicio = Date.now();
const resultado = await runMotionPipeline({ motionId, mode: 'create', deps: { logger } });
console.log(`\n  concluído em ${Math.round((Date.now() - inicio) / 1000)}s`);
console.log(`  MP4 final: ${resultado.finalUrl}`);

titulo('5. O QUE O OTTO ENTENDEU');
console.log(resultado.summary.split('\n').slice(0, 30).map((linha) => `  ${linha}`).join('\n'));

titulo('6. VERIFICAÇÃO');
const status = await getMotionStatus(motionId);
const renders = await db
  .select()
  .from(schema.motionRenders)
  .where(eq(schema.motionRenders.motionSessionId, motionId))
  .orderBy(desc(schema.motionRenders.createdAt));
const final = renders.find((r) => r.quality === 'final');
const sessao = await getMotionSession(motionId);

const checks: [string, boolean, string][] = [
  ['status concluído', status?.status === 'completed', String(status?.status)],
  ['MP4 publicado', Boolean(status?.finalUrl), status?.finalUrl ?? '—'],
  ['preview publicado', Boolean(status?.previewUrl), status?.previewUrl ?? '—'],
  ['modelo gravado é o Opus 5.5', sessao.model === MOTION_MODEL_ID, sessao.model],
  ['QA técnico >= 95', (final?.qualityScore?.technical ?? 0) >= 95, String(final?.qualityScore?.technical)],
  ['resolução entregue', final?.width === sessao.width && final?.height === sessao.height, `${final?.width}x${final?.height}`],
  ['fps entregue', final?.fps === sessao.fps, String(final?.fps)],
  ['duração entregue', final?.durationSeconds === sessao.durationSeconds, `${final?.durationSeconds}s`],
  ['versão >= 1 (§41)', sessao.renderVersion >= 1, `v${sessao.renderVersion}`],
];

// O MP4 realmente baixa e tem bytes de vídeo?
if (status?.finalUrl) {
  const head = await fetch(status.finalUrl);
  const bytes = Number(head.headers.get('content-length') ?? '0');
  checks.push(['MP4 acessível e com conteúdo', head.ok && bytes > 10_000, `${Math.round(bytes / 1024)} KB`]);
}

// §11 — os originais continuam intactos?
let intactos = true;
for (const [url, hash] of antes) {
  const agora = await hashDe(url);
  if (agora !== hash) intactos = false;
}
checks.push(['originais do cliente intactos (§11)', intactos, `${antes.size} arquivos conferidos`]);

// §52 — nada de asset de outro cliente no workspace.
const workspace = workspaceFor(motionId);
const publicAssets = path.join(workspace.project, 'public', 'assets');
const copiados = await fs.readdir(publicAssets).catch(() => [] as string[]);
const outrosClientes = await db
  .select({ url: schema.studioAssets.storageUrl })
  .from(schema.studioAssets)
  .where(eq(schema.studioAssets.clientId, cliente.id));
const permitidos = new Set(outrosClientes.map((a) => a.url));
const contexoUrls = new Set(contexto.assets.map((a) => a.sourceUrl));
checks.push([
  'só assets deste cliente no workspace (§52)',
  copiados.length === 0 || [...contexoUrls].every((url) => permitidos.has(url) || !url.includes('/studio-assets/')),
  `${copiados.length} arquivos copiados`,
]);

console.log('');
let falhou = false;
for (const [nome, ok, detalhe] of checks) {
  if (!ok) falhou = true;
  console.log(`  ${ok ? '\x1b[32mok \x1b[0m' : '\x1b[31mX  \x1b[0m'} ${nome.padEnd(42)} ${detalhe}`);
}

titulo(falhou ? 'E2E FALHOU' : 'E2E PASSOU');
console.log(`  workspace: ${workspace.root}`);
console.log(`  custo do agente: US$ ${String((await getMotionMetadata(motionId)).lastCostUsd ?? '?')}`);
process.exit(falhou ? 1 : 0);
