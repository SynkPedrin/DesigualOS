/**
 * bento-v2-qa.mts — Action Intent V2 contra o ClickUp REAL, lista de QA.
 * A cerca CLICKUP_TEST_LIST_ID garante que nada sai daqui.
 */
import '../src/env.js';
import { createLogger } from '@desigual-os/logging';
import { tryBentoActionGuard } from '../src/processors/bento-action-guard.js';
import { queryOperationTasks, getTask, getWriteScopeListId } from '@desigual-os/tool-gateway';

const logger = createLogger({ service: 'qa-v2', level: 'error' });
const config = { apiKey: process.env.CLICKUP_API_KEY!, teamId: process.env.CLICKUP_TEAM_ID! };
const QA = getWriteScopeListId()!;
const CLIENTE = process.argv[2]!;

const PRINT = { url: 'https://dddchncdrgbhdirytdsp.supabase.co/storage/v1/object/public/user-uploads/chat-uploads/4cc7c39f-7ac4-4e84-8422-afe3c5c4fa41/1789672634699-Captura-de-Tela-2026-09-17-a-s-16.16.41.png', filename: 'referencia-v2.png', contentType: 'image/png' };

interface Caso { nome: string; message: string; esperaDelta: number; attachments?: typeof PRINT[]; env?: Record<string, string> }

const CASOS: Caso[] = [
  { nome: '1. ordem simples', message: 'Bento, separa essa arte pro Gui na Clinica Teste Fase 7.', esperaDelta: 1 },
  { nome: '2. análise pura', message: 'Bento, analisa essa peça da Clinica Teste Fase 7 e me fala pra quem deveria ir.', esperaDelta: 0 },
  { nome: '3. negação explícita', message: 'Bento, não cria nada ainda, só analisa essa demanda da Clinica Teste Fase 7.', esperaDelta: 0 },
  {
    nome: '4. multi-parágrafo com ordem no fim',
    message: `O cliente mandou o material de sinalização e pediu urgência.\nAinda falta o arquivo-base.\n\nBento, tenho a solicitação acima. Separa e lança pro Gui o mapa da unidade na Clinica Teste Fase 7.`,
    esperaDelta: 1,
  },
  {
    nome: '5. quatro itens, multi-write DESLIGADO',
    message: `Bento, separa essas quatro pro Gui na Clinica Teste Fase 7:\n- Placa "Estacione de Ré"\n- Placa "Confiança"\n- Placa "Troca de óleo"\n- Placa "Revisão"`,
    esperaDelta: 0,
  },
  {
    nome: '5b. os MESMOS quatro itens, multi-write LIGADO (só QA)',
    message: `Bento, separa essas quatro pro Gui na Clinica Teste Fase 7:\n- Placa "Estacione de Ré"\n- Placa "Confiança"\n- Placa "Troca de óleo"\n- Placa "Revisão"`,
    esperaDelta: 4,
    env: { BENTO_MULTI_ACTION_WRITE: 'true' },
  },
  {
    nome: '6. DEDUP: repete o caso 1',
    message: 'Bento, separa essa arte pro Gui na Clinica Teste Fase 7.',
    esperaDelta: 0,
  },
  {
    nome: '7. ANEXO: regressão de referência + upload',
    message: 'Bento, cria a landing page de novembro pro Gui na Clinica Teste Fase 7 com o material que mandei.',
    esperaDelta: 1,
    attachments: [PRINT],
  },
  {
    nome: '8. KILL SWITCH off: pedido válido não escreve',
    message: 'Bento, cria o material institucional pro Gui na Clinica Teste Fase 7.',
    esperaDelta: 0,
    env: { BENTO_WRITE_ENABLED: 'false' },
  },
  {
    nome: '9. AÇÃO PROIBIDA: concluir trabalho humano',
    message: 'Bento, marca a peça do Gui como concluída na Clinica Teste Fase 7.',
    esperaDelta: 0,
  },
];

const so = process.argv.find((a) => a.startsWith('--so='))?.slice(5);
const criadas: string[] = [];
let passou = 0;
for (const caso of CASOS.filter((c) => !so || c.nome.startsWith(`${so}.`) || c.nome.startsWith(`${so}b.`))) {
  const backup: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(caso.env ?? {})) { backup[k] = process.env[k]; process.env[k] = v; }

  const antes = (await queryOperationTasks(config, { listIds: [QA], includeClosed: false })).tasks.length;
  const r = await tryBentoActionGuard({
    message: caso.message, conversationId: null, userName: 'tammy (QA)', userClickUpEmail: null,
    userEmail: 'tammy@institutoalmada.org', agencyListId: null, clientId: CLIENTE,
    clientName: 'Clinica Teste Fase 7', briefingWriter: async () => null, logger,
    ...(caso.attachments ? { attachments: caso.attachments } : {}),
  });
  const depois = (await queryOperationTasks(config, { listIds: [QA], includeClosed: false })).tasks.length;

  for (const [k, v] of Object.entries(backup)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }

  const delta = depois - antes;
  const md = (r?.metadata ?? {}) as Record<string, unknown>;
  const tasks = (md.tasks as Array<{ task_id: string | null; status: string; attachments?: unknown[] }>) ?? [];
  for (const t of tasks) if (t.status === 'created' && t.task_id) criadas.push(t.task_id);
  const ok = delta === caso.esperaDelta;
  if (ok) passou++;
  console.log(`${ok ? 'PASS' : 'FALHA'}  ${caso.nome}`);
  console.log(`   delta=${delta} (esperado ${caso.esperaDelta}) | action=${md.action ?? (r ? '?' : 'guard devolveu null -> análise')} | plano=${md.action_plan_count ?? tasks.length}`);
  console.log(`   resposta: ${(r?.answer ?? '(segue pro agente)').replace(/\n/g, ' | ').slice(0, 150)}`);
}

console.log(`\n=== VERIFICAÇÃO INDEPENDENTE NO CLICKUP ===`);
for (const id of criadas) {
  const t = await getTask(config, id);
  console.log(` - ${id} | "${t.name}" | ${t.assignees.map((a) => a.username).join(',') || '(sem responsável)'} | anexos=${t.attachments.length} | refs=${(t.description.match(/https?:\/\//g) ?? []).length}`);
}
const total = so ? CASOS.filter((c) => c.nome.startsWith(`${so}.`) || c.nome.startsWith(`${so}b.`)).length : CASOS.length;
console.log(`\n${passou}/${total} casos QA PASS | tasks criadas nesta bateria: ${criadas.length}`);
process.exit(passou === total ? 0 : 1);
