/**
 * classifier-prompt-eval.mts — mede a QUALIDADE do prompt do classificador
 * pago, isolada das camadas anteriores.
 *
 * Por que isto existe (13/10/2026): o classificador passou a usar GPT e o
 * prompt dele descrevia cinco agentes em quatro linhas, sem nenhuma regra de
 * desambiguação. O classificador LOCAL tem few-shot e regra explícita porque
 * alguém mediu 11/15 sem elas; a camada paga, que é a que de fato decide
 * quando a GPU está fora, não tinha nada disso — e ninguém media.
 *
 * O QUE ISTO MEDE E O QUE NÃO MEDE: chama `classifyWithLLM` direto, então
 * mede o PROMPT. Não mede as regras nem o classificador local — esses rodam
 * antes e têm o próprio harness (intelligence-routing-check.mts). Os casos
 * aqui são justamente os que ESCAPAM das regras: ambíguos, de fronteira, ou
 * com vocabulário que nenhuma keyword cobre.
 *
 * CUSTO: cada caso é uma chamada real ao modelo mais barato (luna). O
 * conjunto inteiro custa centavos de dólar. Rodar sob demanda, não em CI.
 *
 * Uso: pnpm exec tsx scripts/classifier-prompt-eval.mts
 */
import '../src/env.js';
import { classifyWithLLM } from '@desigual-os/router';
import type { AgentName } from '@desigual-os/types';

interface Caso {
  id: string;
  pergunta: string;
  esperado: AgentName;
  /** Por que este caso existe — a maioria é incidente real, não invenção. */
  origem: string;
}

const CASOS: Caso[] = [
  // ---- Os incidentes documentados no código, que o prompt precisa acertar ----
  {
    id: 'I01',
    pergunta: 'como tá a 3Net esse mês?',
    esperado: 'jarbas',
    origem: 'local-classifier.ts: "como tá o <cliente>" pergunta DESEMPENHO de mídia. Sem a regra, o 3B mandava pro Bento.',
  },
  {
    id: 'I02',
    pergunta: 'como está a Elite esse mês?',
    esperado: 'jarbas',
    origem: 'mesma regra, segundo exemplo documentado.',
  },
  {
    id: 'I03',
    pergunta: 'qual cliente tem a melhor campanha hoje?',
    esperado: 'jarbas',
    origem: 'rules.ts: comparação de performance ENTRE clientes é mídia, não direção criativa — embora tenha a palavra "campanha".',
  },
  {
    id: 'I04',
    pergunta: 'o que está em risco na operação?',
    esperado: 'bento',
    origem: 'rules.ts: medido com o 3B mandando "o que está em risco" pro Jarbas com confiança 1.0.',
  },
  {
    id: 'I05',
    pergunta: 'Quem é o decisor do Cliente Teste 7?',
    esperado: 'bento',
    origem: 'rules.ts: bug reportado em produção 01/10 — virou esclarecimento numa pergunta cuja resposta está na memória do cliente.',
  },
  {
    id: 'I06',
    pergunta: 'faz 2 legendas pro aniversário da Cosentino',
    esperado: 'otto',
    origem: 'rules.ts: medido no front em 24/09 — foi parar no Bento, que respondeu com a data de fundação do vault.',
  },
  {
    id: 'I07',
    pergunta: 'quantos clientes ativos temos na carteira?',
    esperado: 'bento',
    origem: 'rules.ts: medido em 08/10 — esclarecimento numa pergunta que o sistema responde com um número.',
  },
  // ---- Fronteiras que NENHUMA keyword cobre (é pra isso que a camada existe) ----
  {
    id: 'F01',
    pergunta: 'e a Yak, tá indo bem?',
    esperado: 'jarbas',
    origem: 'variação coloquial da regra "como tá o <cliente>", sem a palavra "como".',
  },
  {
    id: 'F02',
    pergunta: 'vale a pena aumentar a verba da Colormaq?',
    esperado: 'jarbas',
    origem: 'decisão de mídia paga; "verba" sozinha não é keyword de regra nenhuma.',
  },
  {
    id: 'F03',
    pergunta: 'a campanha da Areia Branca tá cansando o público?',
    esperado: 'jarbas',
    origem: 'fadiga de criativo dita sem jargão — a regra só cobre a frase exata "fadiga de criativo".',
  },
  {
    id: 'F04',
    pergunta: 'escreve um texto curto pro post de dia das mães da Elite',
    esperado: 'otto',
    origem: 'pedido de peça criativa sem nenhuma palavra do vocabulário das regras ("texto curto" não é "legenda").',
  },
  {
    id: 'F05',
    pergunta: 'pensa num conceito diferente pra Black Friday da Cosentino',
    esperado: 'otto',
    origem: '"conceito" é topicKeyword fraca de propósito — decide o classificador, e a resposta certa é Otto.',
  },
  {
    id: 'F06',
    pergunta: 'chama o lead que chegou hoje de manhã e já agenda uma visita',
    esperado: 'suzy',
    origem: 'falar com lead sem usar as frases exatas das regras.',
  },
  {
    id: 'F07',
    pergunta: 'monta a arte do post de natal da Bravvo',
    esperado: 'studio',
    origem: 'GERAR a peça é Studio; "arte" não está no vocabulário das regras.',
  },
  {
    id: 'F08',
    pergunta: 'transforma essa foto num vídeo curto pro reels',
    esperado: 'studio',
    origem: 'execução em GPU sem "gerar vídeo" literal.',
  },
  {
    id: 'F09',
    pergunta: 'quem tá com muita coisa na mão essa semana?',
    esperado: 'bento',
    origem: '"sobrecarregado" dito sem jargão — pergunta de carga da equipe, não de mídia.',
  },
  {
    id: 'F10',
    pergunta: 'o que rolou de importante com os clientes essa semana?',
    esperado: 'bento',
    origem: 'resumo temporal da operação, sem "o que aconteceu" literal.',
  },
  // ---- As cercas do outro lado: o que NÃO pode vazar pra onde não deve ----
  {
    id: 'C01',
    pergunta: 'quantos leads vieram esse mês?',
    esperado: 'jarbas',
    origem: 'fronteira Suzy/Jarbas: lead como MÉTRICA de aquisição é mídia; Suzy é falar COM lead, não contar.',
  },
  {
    id: 'C02',
    pergunta: 'manda um zap pro cliente confirmando a reunião',
    esperado: 'suzy',
    origem: 'fronteira Suzy/Bento: falar com pessoa no WhatsApp é Suzy, mesmo sem a palavra "lead".',
  },
  {
    id: 'C03',
    pergunta: 'qual o orçamento mensal da D. Carvalho?',
    esperado: 'bento',
    origem: 'fronteira Bento/Jarbas: orçamento do CLIENTE (contrato) é fato cadastral; verba de MÍDIA seria Jarbas.',
  },
  {
    id: 'C04',
    pergunta: 'faz um prompt de imagem pro Studio gerar o conceito novo',
    esperado: 'otto',
    origem: 'fronteira Otto/Studio: escrever o PROMPT é direção criativa; só a geração é Studio.',
  },
];

const logger: any = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return logger;
  },
  level: 'warn',
};

let falhas = 0;
const erros: Caso[] = [];

console.log('ID   | esperado | obteve   | ms    | pergunta');
console.log('-----+----------+----------+-------+------------------------------------------');

for (const caso of CASOS) {
  const t = Date.now();
  let obtido = 'null';
  try {
    const r = await classifyWithLLM(caso.pergunta, logger);
    obtido = r?.primary_agent ?? 'null';
  } catch (e) {
    obtido = `erro`;
  }
  const ms = Date.now() - t;
  const ok = obtido === caso.esperado;
  if (!ok) {
    falhas += 1;
    erros.push(caso);
  }
  console.log(
    `${caso.id.padEnd(4)} | ${caso.esperado.padEnd(8)} | ${obtido.padEnd(8)} | ${String(ms).padStart(5)} | ${ok ? '' : '<-- ERRADO | '}${caso.pergunta.slice(0, 60)}`,
  );
}

console.log(`\nPROMPT DO CLASSIFICADOR: ${CASOS.length - falhas}/${CASOS.length} corretos`);
if (erros.length > 0) {
  console.log('\nOs casos que falharam, com a razão de existirem:');
  for (const c of erros) {
    console.log(`  ${c.id} (${c.esperado}): ${c.pergunta}`);
    console.log(`      ${c.origem}`);
  }
  process.exit(1);
}
process.exit(0);
