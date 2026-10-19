/**
 * Comparação lado a lado: cabeçalho curto × manual completo do Bento, mesmo
 * contexto, mesmas perguntas, GPT de verdade. Não toca banco nem produção.
 *
 *   pnpm --filter @desigual-os/worker exec tsx scripts/comparar-persona-bento.mts > saida.md
 *
 * O CONTEXTO abaixo é de TESTE, montado à mão (Cliente Teste 7 é o cliente de
 * QA da casa). Serve para comparar tom e comportamento, não para validar dado.
 */
import { config } from 'dotenv';
config({ path: new URL('../../../.env', import.meta.url).pathname });
import { completeTextSafely } from '@desigual-os/router';
import { montarPromptDeLeitura } from '../src/processors/bento-leitura-gpt';

const logger = { info() {}, warn() {}, error() {}, debug() {}, child() { return logger; } } as never;

const CONTEXTO = `QUEM ESTÁ PERGUNTANDO: Pedro Gabriel (pedro@institutoalmada.org), papel master, e-mail no ClickUp pedro@institutoalmada.org.

EQUIPE DA AGÊNCIA:
- Pedro Gabriel, Gestão, master, desde 03/2026
- Tammy, Atendimento, colaboradora, desde 09/2026
- Marina Souza, Tráfego, colaboradora, desde 01/10/2026 (NOVO(A))

CLIENTE TESTE 7 (dossiê): cliente de testes internos. Segmento: serviços. Canal preferido: WhatsApp. Restrição registrada: nada de estatística inventada nas peças.

CLICKUP AO VIVO (tarefas abertas atribuídas a Pedro Gabriel, 3 no total):
1. "Criar carrossel de 5 slides sobre IA no atendimento" (Cliente Teste 7), status: to do, prazo 30/09/2026, ATRASADA há 13 dias
2. "Criar formato 1080x1350" (Cliente Teste 7), status: to do, prazo 30/09/2026, ATRASADA há 13 dias
3. "plug2" (Agência Desigual), status: in progress, sem prazo`;

const PERGUNTAS = [
  'o que é esse sistema?',
  'quem é você?',
  'quais minhas prioridades de hoje?',
  'como está o Cliente Teste 7?',
  'quem é a pessoa nova na equipe?',
  'qual CRM o Cliente Teste 7 usa?',
  'quanto o Cliente Teste 7 investe por mês em mídia?',
  'o que foi decidido na última reunião com o Cliente Teste 7?',
  'acho que devíamos parar de usar o ClickUp, o que você acha?',
  'você é uma IA?',
];

for (const pergunta of PERGUNTAS) {
  console.log(`\n## ${pergunta}\n`);
  for (const [rotulo, env] of [
    ['ANTES (cabeçalho curto)', { BENTO_PERSONA_COMPLETA: 'false' }],
    ['DEPOIS (manual completo)', {}],
  ] as const) {
    const t0 = Date.now();
    const r = await completeTextSafely(montarPromptDeLeitura(pergunta, CONTEXTO, env), logger, { maxTokens: 1200 });
    console.log(`### ${rotulo} (${((Date.now() - t0) / 1000).toFixed(1)}s)\n\n${r?.trim() ?? '(sem resposta)'}\n`);
  }
}

// Alguma conexão do router fica aberta e segura o processo depois da última resposta.
process.exit(0);
