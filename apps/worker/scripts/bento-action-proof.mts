/**
 * _qa-bento-mutation.mts — E2E REAL do caso da Tammy, restrito à lista QA.
 * A cerca CLICKUP_TEST_LIST_ID garante que nenhuma escrita sai daqui.
 */
import '../src/env.js';
import { createLogger } from '@desigual-os/logging';
import { tryBentoActionGuard } from '../src/processors/bento-action-guard.js';
import { queryOperationTasks, getTask, getTaskComments, getWriteScopeListId } from '@desigual-os/tool-gateway';

const logger = createLogger({ service: 'qa' });
const config = { apiKey: process.env.CLICKUP_API_KEY!, teamId: process.env.CLICKUP_TEAM_ID! };
const QA_LIST = getWriteScopeListId()!;
const QA_CLIENT_ID = process.argv[2]!;

const casos: Array<{ nome: string; message: string }> = [
  {
    nome: 'CASO REAL (solicitação acima + separar + lançar pro Gui)',
    message: `precisamos desenvolver algumas placas seguindo o padrão visual e as diretrizes do MIV, que também vou encaminhar para vocês utilizarem como base na criação.
Precisamos das seguintes placas:
Placa "Estacione de Ré";
Placa "Estacionamento Clientes";
Placa "Estacionamento Diretoria";
Placa de orientação em formato de mapa, utilizando como base o mapa encaminhado em arquivo.

Bento, tenho a solicitação acima. Preciso que separe a demanda e lance pro Gui a criação do layout, no Clickup, na lista da Clinica Teste Fase 7.`,
  },
  { nome: 'IDEMPOTÊNCIA (mesma mensagem de novo)', message: '__REPETE__' },
  {
    nome: 'MULTI-TASK (layout pro Gui, texto pra Jamile)',
    message: 'Bento, separa essa demanda da Clinica Teste Fase 7: o layout fica com o Gui e o texto com a Jamile. Cria os dois com briefing.',
  },
  {
    nome: 'PESSOA AMBÍGUA (Gabriel casa com dois)',
    message: 'Bento, cria o roteiro pro Gabriel na Clinica Teste Fase 7.',
  },
  {
    nome: 'PESSOA INEXISTENTE (Sofia)',
    message: 'Bento, cria o texto pra Sofia na Clinica Teste Fase 7.',
  },
  {
    nome: 'AÇÃO PROIBIDA (concluir trabalho humano)',
    message: 'Bento, marca essa task como concluída.',
  },
  {
    nome: 'ANÁLISE (não pode escrever nada)',
    message: 'Bento, analisa essas peças da Clinica Teste Fase 7 e me diz se estão boas.',
  },
  {
    nome: 'CARGA ALTA NÃO BLOQUEIA (cria mesmo com a lista cheia)',
    message: 'Bento, cria o vídeo pro Gui na Clinica Teste Fase 7.',
  },
];

const antes = await queryOperationTasks(config, { listIds: [QA_LIST], includeClosed: false });
console.log(`lista QA ${QA_LIST}: ${antes.tasks.length} tasks abertas ANTES`);

const criadasNoTeste: string[] = [];
let ultimaMensagem = '';
for (const caso of casos) {
  const message = caso.message === '__REPETE__' ? ultimaMensagem : caso.message;
  if (caso.message !== '__REPETE__') ultimaMensagem = message;
  console.log(`\n${'='.repeat(70)}\n### ${caso.nome}`);
  const r = await tryBentoActionGuard({
    message,
    conversationId: null,
    userName: 'tammy (QA)',
    userClickUpEmail: null,
    agencyListId: null,
    clientId: QA_CLIENT_ID,
    clientName: 'Clinica Teste Fase 7',
    briefingWriter: async () => null,
    logger,
  });
  if (!r) { console.log('guard: NULL (segue pro agente — sem escrita)'); continue; }
  console.log('--- RESPOSTA ---\n' + r.answer);
  const md = r.metadata as Record<string, unknown> | undefined;
  console.log('--- METADATA ---');
  console.log(JSON.stringify({ action: md?.action, intent: md?.intent_classification, count: md?.action_plan_count, tasks: md?.tasks }, null, 1));
  for (const t of (md?.tasks as Array<{ task_id: string | null; status: string }> | undefined) ?? []) {
    if (t.status === 'created' && t.task_id) criadasNoTeste.push(t.task_id);
  }
}

console.log(`\n${'='.repeat(70)}\n### VERIFICAÇÃO INDEPENDENTE NO CLICKUP (não confia no retorno da API de escrita)`);
for (const id of criadasNoTeste) {
  const t = await getTask(config, id);
  const cs = await getTaskComments(config, id);
  console.log(` - ${id} | "${t.name}" | responsáveis: ${t.assignees.map((a) => a.username).join(', ') || '(nenhum)'} | comentários: ${cs.length}`);
}
const depois = await queryOperationTasks(config, { listIds: [QA_LIST], includeClosed: false });
console.log(`\nlista QA: ${antes.tasks.length} -> ${depois.tasks.length} tasks abertas (delta ${depois.tasks.length - antes.tasks.length})`);
console.log('IDS CRIADOS NO TESTE:', JSON.stringify(criadasNoTeste));
process.exit(0);
