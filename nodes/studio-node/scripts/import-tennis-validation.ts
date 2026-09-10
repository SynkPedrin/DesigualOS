import { config as dotenv } from 'dotenv';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { loadConfig } from '../src/config';
import { uploadAsset } from '../src/storage';

dotenv({ path: resolve('../../.env'), quiet: true });
const { db, schema } = await import('@desigual-os/database');
const config = loadConfig();
const directory = resolve(process.argv[2] ?? '../../artifacts/tennis-video-validation-2026-09-09');
// Exact target resolved from the user's “cliente teste 7”; never a fuzzy write.
const clientId = 'dddcd94d-7fea-4312-be67-d9161e79b887';
const [client] = await db.select().from(schema.clients).where(and(eq(schema.clients.id, clientId), isNull(schema.clients.deletedAt))).limit(1);
if (client?.name !== 'Clinica Teste Fase 7') throw new Error('O cadastro de teste mudou; confira o cliente antes da importação.');
const state = JSON.parse(await readFile(resolve(directory, 'validation-state.json'), 'utf8'));
const videos = ['tennis-portrait-v1', 'tennis-portrait-v2', 'tennis-ready-v1', 'tennis-ready-v2'];
for (const name of videos) {
  if (!state[name]?.done) throw new Error(`Vídeo ainda não concluído: ${name}`);
  await readFile(resolve(directory, `${name}.mp4`));
}
const projectName = 'Tênis - qualidade editorial - 2 conceitos x 2 variações';
let [project] = await db.select().from(schema.studioProjects).where(and(eq(schema.studioProjects.clientId, clientId), eq(schema.studioProjects.name, projectName))).limit(1);
if (!project) [project] = await db.insert(schema.studioProjects).values({ clientId, name: projectName }).returning();
if (!project) throw new Error('Não foi possível criar o projeto de validação.');
const imported: Array<{ filename: string; url: string; id: string }> = [];
for (const [index, file] of [...videos.map((name) => `${name}.mp4`), 'tennis-portrait-new.png', 'tennis-ready-new.png'].entries()) {
  const video = file.endsWith('.mp4');
  const storageName = `tennis-validation-20260909-${file}`;
  const bytes = await readFile(resolve(directory, file));
  const storageUrl = await uploadAsset(config, `${clientId}/${storageName}`, bytes, video ? 'video/mp4' : 'image/png');
  const [existing] = await db.select().from(schema.studioAssets).where(and(eq(schema.studioAssets.clientId, clientId), eq(schema.studioAssets.filename, storageName))).limit(1);
  if (existing) { imported.push({ filename: file, url: existing.storageUrl, id: existing.id }); continue; }
  const metadata = video ? JSON.parse(await readFile(resolve(directory, `${file}.json`), 'utf8')) : state[file.replace('.png', '')]?.generation;
  // Local 127.0.0.1 validation URLs expire; do not persist them as usable Studio assets.
  const clean = JSON.parse(JSON.stringify(metadata ?? {}, (_key, value) => typeof value === 'string' && value.startsWith('http://127.0.0.1:') ? undefined : value));
  const [asset] = await db.insert(schema.studioAssets).values({
    clientId, projectId: project.id, type: video ? 'reels' : 'carousel', filename: storageName, storageUrl, agent: 'studio',
    prompt: video ? 'Tênis: novos rostos, cores e ambientes; escritas e assinatura originais na composição final.' : 'Quadro-base FLUX.2 para sequência editorial de tênis.',
    model: video ? 'FLUX.2 -> H3 turbo 8 steps -> composição gráfica' : 'FLUX.2 native reference edit',
    metadata: { ...clean, origin: 'requested_quality_validation', job_id: video ? `tennis-validation-20260909-concept-${index < 2 ? 1 : 2}` : 'tennis-validation-20260909-keyframes',
      slide_index: video ? index % 2 : index - 4, slides_total: 2, variation_index: video ? index % 2 : undefined,
      visual_qa: 'human_review_required', output_note: video ? 'Clipe de validação de 5s com texto e assinatura compostos; não é um reel longo aprovado para publicação.' : 'Imagem-base sem composição gráfica; texto e assinatura são aplicados ao vídeo após a animação.',
    },
  }).returning();
  if (!asset) throw new Error('Falha ao registrar asset.');
  imported.push({ filename: file, url: storageUrl, id: asset.id });
  console.log(`imported ${file}`);
}
await writeFile(resolve(directory, 'studio-import.json'), JSON.stringify({ clientId, clientName: client.name, projectId: project.id, assets: imported }, null, 2));
console.log(JSON.stringify({ client: client.name, projectId: project.id, assets: imported.length }));
process.exit(0);
