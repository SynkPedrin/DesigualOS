/**
 * import-comfyui-outputs.ts — traz pro Studio TODA imagem que a RTX 4090
 * produziu no ComfyUI, não só as que nasceram de um job do Studio.
 *
 * O problema real (16/09/2026): `studio_assets` só recebe peça quando o
 * studio-node processa um job. Qualquer imagem gerada direto no ComfyUI —
 * teste na interface do Comfy, workflow rodado à mão, benchmark, experimento
 * de prompt — fica só no disco da máquina da GPU e nunca aparece na galeria.
 * Medido nesta data: o /history do ComfyUI tinha 6 imagens de saída e apenas
 * 1 existia no Studio; as outras 5 eram invisíveis pra equipe.
 *
 * Registra em `studio_assets`, a mesma tabela que a galeria já lê — não há
 * tela nova pra construir, a peça aparece no Studio assim que a linha entra.
 *
 * Idempotente: checa por `filename` dentro do cliente, o mesmo critério que
 * `persistSlideAsset` (src/index.ts) usa pra não duplicar numa retentativa.
 * Rodar de novo não empilha.
 *
 * `--cliente` é OBRIGATÓRIO e não tem default: `studio_assets.client_id` é
 * NOT NULL com FK, e chutar um cliente colocaria a peça de um cliente na
 * galeria de outro. Imagem feita solta no ComfyUI não carrega de quem é —
 * quem roda o script decide.
 *
 *   pnpm --filter @desigual-os/studio-node exec tsx scripts/import-comfyui-outputs.ts --cliente "Nome"
 *   pnpm --filter @desigual-os/studio-node exec tsx scripts/import-comfyui-outputs.ts --cliente "Nome" --aplicar
 */
import { config as dotenv } from 'dotenv';
import { resolve } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { loadConfig } from '../src/config';
import { uploadAsset } from '../src/storage';

dotenv({ path: resolve('../../.env'), quiet: true });
const { db, schema } = await import('@desigual-os/database');
const config = loadConfig();

const APLICAR = process.argv.includes('--aplicar');
function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const comfyuiUrl = arg('--comfyui') ?? config.COMFYUI_URL;
const nomeCliente = arg('--cliente');

if (!nomeCliente) {
  console.error('Faltou --cliente "<nome>". Sem cliente não dá pra registrar o asset (client_id é NOT NULL).\n');
  console.error('Clientes disponíveis:');
  const lista = await db.select({ name: schema.clients.name }).from(schema.clients).where(isNull(schema.clients.deletedAt)).limit(100);
  for (const c of lista) console.error(`  - ${c.name}`);
  process.exit(1);
}

const [cliente] = await db
  .select()
  .from(schema.clients)
  .where(and(eq(schema.clients.name, nomeCliente), isNull(schema.clients.deletedAt)))
  .limit(1);
if (!cliente) {
  console.error(`Cliente "${nomeCliente}" não existe (o nome tem que bater exatamente com clients.name).`);
  process.exit(1);
}

interface HistoryImage {
  filename: string;
  subfolder: string;
  type: string;
}
type HistoryEntry = { outputs?: Record<string, { images?: HistoryImage[] }>; status?: { completed?: boolean } };

const resposta = await fetch(`${comfyuiUrl}/history?max_items=200`);
if (!resposta.ok) {
  console.error(`ComfyUI em ${comfyuiUrl} respondeu ${resposta.status}. A máquina da GPU está no ar e alcançável?`);
  process.exit(1);
}
const history = (await resposta.json()) as Record<string, HistoryEntry>;

// Só saída de execução CONCLUÍDA: 'temp'/'input' são intermediários do
// próprio ComfyUI, não peça entregável, e execução interrompida deixa
// imagem pela metade.
const encontradas: Array<{ promptId: string; image: HistoryImage }> = [];
for (const [promptId, entrada] of Object.entries(history)) {
  if (entrada.status?.completed !== true) continue;
  for (const saida of Object.values(entrada.outputs ?? {})) {
    for (const image of saida.images ?? []) {
      if (image.type === 'output') encontradas.push({ promptId, image });
    }
  }
}

console.log(`ComfyUI (${comfyuiUrl}): ${encontradas.length} imagem(ns) de saída concluída no histórico.`);
console.log(`Cliente destino: ${cliente.name} (${cliente.id})`);
if (!APLICAR) console.log('SIMULAÇÃO — nada será gravado. Use --aplicar pra valer.\n');

let importadas = 0;
let jaExistiam = 0;
let falhas = 0;

for (const { promptId, image } of encontradas) {
  const [existente] = await db
    .select({ id: schema.studioAssets.id })
    .from(schema.studioAssets)
    .where(and(eq(schema.studioAssets.clientId, cliente.id), eq(schema.studioAssets.filename, image.filename)))
    .limit(1);
  if (existente) {
    jaExistiam++;
    continue;
  }

  if (!APLICAR) {
    console.log(`  [importaria] ${image.filename}`);
    importadas++;
    continue;
  }

  try {
    const params = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder ?? '', type: 'output' });
    const arquivo = await fetch(`${comfyuiUrl}/view?${params.toString()}`);
    if (!arquivo.ok) throw new Error(`/view respondeu ${arquivo.status}`);
    const bytes = Buffer.from(await arquivo.arrayBuffer());

    const storageUrl = await uploadAsset(config, `${cliente.id}/${image.filename}`, bytes, 'image/png');

    await db.insert(schema.studioAssets).values({
      clientId: cliente.id,
      projectId: null,
      type: 'image',
      filename: image.filename,
      storageUrl,
      agent: 'studio',
      prompt: null,
      model: 'comfyui (importado do histórico da GPU)',
      metadata: {
        // Procedência explícita: esta peça NÃO nasceu de um job do Studio.
        // Sem isso ninguém distingue depois o que a casa produziu pelo fluxo
        // da equipe do que foi experimento solto na GPU.
        source: 'comfyui_history_import',
        comfyui_prompt_id: promptId,
        comfyui_url: comfyuiUrl,
        imported_at: new Date().toISOString(),
      },
    });
    console.log(`  [importada] ${image.filename}`);
    importadas++;
  } catch (erro) {
    console.error(`  [falhou] ${image.filename}: ${String(erro)}`);
    falhas++;
  }
}

console.log(`\n${APLICAR ? 'Importadas' : 'Importaria'}: ${importadas} | já no Studio: ${jaExistiam} | falhas: ${falhas}`);
process.exit(falhas > 0 ? 1 : 0);
