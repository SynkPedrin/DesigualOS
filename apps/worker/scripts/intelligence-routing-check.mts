/**
 * intelligence-routing-check.mts — a pergunta chega ao agente certo?
 *
 * PONTO CEGO QUE ISTO FECHA (29/09/2026). O benchmark de inteligência
 * (scripts/benchmark/intelligence-benchmark.mjs) manda `agent_hint: 'BENTO'`
 * em toda chamada. Ele mede muito bem o que o Bento SABE — e não mede nada do
 * que acontece antes: se a pergunta sequer chega até ele.
 *
 * O custo desse ponto cego foi medido pela sessão paralela: "o que está em
 * risco hoje" era roteado para o JARBAS (agente de mídia paga) com confiança
 * 1.0. A pergunta central da gestão da operação caía no agente errado, e
 * NENHUMA bateria por HTTP pegava, porque todas mandavam o hint. Só apareceu
 * dirigindo o chat como a Tammy dirige — sem clicar no chip do agente.
 *
 * A asserção aqui é simples e forte: TODA pergunta do benchmark de
 * inteligência é pergunta de OPERAÇÃO. Nenhuma pede criação (Otto) nem
 * métrica de mídia (Jarbas). Se alguma roteia para outro lugar, é bug.
 *
 * Roda o `route()` de verdade, inclusive o classificador local — é onde o bug
 * morava, e testar só a camada de regras deixaria o buraco aberto.
 */
import '../src/env.js';
import { route } from '@desigual-os/router';

const PERGUNTAS: Array<[string, string]> = [
  ['Q01', 'Me explique tudo que você sabe sobre a Agência Desigual.'],
  ['Q02', 'Quem trabalha aqui e qual é a função de cada pessoa?'],
  ['Q03', 'Quais clientes precisam de atenção hoje?'],
  ['Q04', 'Quais são os maiores riscos operacionais neste momento?'],
  ['Q05', 'O que mudou na agência nos últimos 7 dias?'],
  ['Q06', 'Quais clientes estão com entregas atrasadas?'],
  ['Q07', 'Quais projetos internos parecem abandonados?'],
  ['Q08', 'Quem está sobrecarregado?'],
  ['Q09', 'Quais tarefas dependem do Endrigo?'],
  ['Q10', 'Quais clientes entraram recentemente?'],
  ['Q11', 'Quais clientes saíram recentemente?'],
  ['Q12', 'O que pode dar problema esta semana?'],
  ['Q13', 'Qual é o estado atual do Desigual OS?'],
  ['Q14', 'Qual é o estado do Citável?'],
  ['Q15', 'O que a agência deveria priorizar hoje?'],
  ['Q16', 'O que aconteceu ontem?'],
  ['Q17', 'Quais ações os agentes realizaram recentemente?'],
  ['Q18', 'Quais informações estão inconsistentes no ClickUp?'],
  ['Q19', 'O que está parado há mais tempo?'],
  ['Q20', 'Faça um briefing executivo completo da agência.'],
  ['GOLD', 'Analise todo o ClickUp da agência e me entregue um briefing completo de tudo que você sabe sobre a agência.'],
  ['V01', 'O que mudou na agência desde ontem?'],
  ['V02', 'O que o Bento fez hoje?'],
  ['V03', 'Quais problemas estão aparecendo repetidamente?'],
  ['V04', 'Quais clientes estão deteriorando operacionalmente?'],
  // As frases exatas do incidente da sessão paralela (commit 9a1564a).
  ['R01', 'o que está em risco hoje'],
  ['R02', 'o que está em risco na Cosentino?'],
  ['R03', 'me mostra o que ta atrasado'],
];

/**
 * O CONTRAPONTO importa tanto quanto a asserção. Uma correção que empurrasse
 * tudo para o Bento "consertaria" o teste acima e quebraria o Jarbas — estas
 * frases são a cerca do outro lado.
 */
const DEVE_IR_PRO_JARBAS: Array<[string, string]> = [
  ['J01', 'como está o CPA da campanha da D. Carvalho?'],
  ['J02', 'o ROAS caiu essa semana?'],
  ['J03', 'quanto gastamos em Meta Ads esse mês?'],
  ['J04', 'qual criativo está performando melhor?'],
];

const logger: any = { info() {}, warn() {}, error() {}, debug() {}, child() { return logger; }, level: 'info' };

let falhas = 0;
console.log('ID   | agente   | conf | origem        | pergunta');
console.log('-----+----------+------+---------------+----------------------------------------');

async function conferir(casos: Array<[string, string]>, esperado: string) {
  for (const [id, pergunta] of casos) {
    let agente = '?', conf = 0, origem = '?';
    try {
      const d = await route(pergunta, logger);
      agente = d.primary_agent;
      conf = d.confidence;
      origem = (d as { source?: string }).source ?? '?';
    } catch (e) {
      agente = `ERRO: ${(e as Error).message.slice(0, 30)}`;
    }
    const ok = agente === esperado;
    if (!ok) falhas += 1;
    console.log(
      `${id.padEnd(4)} | ${agente.padEnd(8)} | ${String(conf).padStart(4)} | ${String(origem).padEnd(13)} | ${ok ? '' : '<-- ESPERAVA ' + esperado.toUpperCase() + ' | '}${pergunta.slice(0, 50)}`,
    );
  }
}

console.log('\n--- perguntas de OPERAÇÃO (todas devem ir pro Bento) ---');
await conferir(PERGUNTAS, 'bento');
console.log('\n--- perguntas de MÍDIA (a cerca do outro lado: devem continuar no Jarbas) ---');
await conferir(DEVE_IR_PRO_JARBAS, 'jarbas');

const total = PERGUNTAS.length + DEVE_IR_PRO_JARBAS.length;
console.log(`\nROTEAMENTO: ${total - falhas}/${total} corretos`);
if (falhas > 0) {
  console.log('REGRESSÃO: pergunta chegando no agente errado. Nenhuma bateria com agent_hint pega isso.');
  process.exit(1);
}
process.exit(0);
