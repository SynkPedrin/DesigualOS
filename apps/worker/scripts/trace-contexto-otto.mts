/**
 * trace-contexto-otto.mts — quanto de cada coisa chega ao modelo, por turno.
 *
 * Cinco rodadas de correção de INSTRUÇÃO não mudaram o comportamento do Otto:
 * "me dá 3 títulos" continuou voltando com nome de tarefa do ClickUp, "faz uma
 * legenda" com recusa. Quando instrução não move o resultado, o que manda é
 * outra coisa — e aqui a hipótese é a FORMA do contexto, não o texto das
 * regras.
 *
 * Este script não despacha turno e não escreve nada. Ele monta os MESMOS blocos
 * que o dispatch monta e mede: quantos caracteres cada fonte ocupa, quanto isso
 * é do total, quantas marcações de lacuna entram e quantos nomes de tarefa
 * viajam junto. É a tabela que decide se a hipótese se sustenta.
 *
 *   pnpm --filter @desigual-os/worker exec tsx scripts/trace-contexto-otto.mts
 */
import '../src/env.js';
import { assembleContext, type BlocoDeContexto } from '../src/processors/context-assembler.js';
import { contarClientes, formatClientBlock, resolveClientTurnContext } from '../src/processors/client-context.js';
import { formatCampaignBlock, nomeDoCliente, resolveCampaignTurnContext } from '../src/processors/campaign-context.js';
import { formatPersonBlock, resolvePersonTurnContext } from '../src/processors/person-context.js';

const ELITE = '21b90202-1cfa-4aa1-93d6-53bac5dcfa72';

const TURNOS = [
  'Me dá 3 títulos.',
  'Agora faz uma legenda.',
  'Tá com cara de IA.',
  'Faz de outro jeito então.',
  'Uma versão pro cliente.',
];

/** Nome de tarefa do ClickUp tem a cara de "Cliente, Coisa, Mês" ou "Cliente_Coisa". */
function nomesDeTarefa(texto: string): number {
  return (texto.match(/^\s*[-*]?\s*[A-Z][\wÀ-ÿ]+[,_][^\n]{6,80}$/gm) ?? []).length;
}
function lacunas(texto: string): number {
  return (texto.match(/\[FALTA\]|a coletar|\[CONFIRMAR/gi) ?? []).length;
}

const totalClientes = await contarClientes();

for (const mensagem of TURNOS) {
  const cliente = await resolveClientTurnContext({ message: mensagem, executionClientId: ELITE });
  const blocoCliente = cliente ? formatClientBlock(cliente, totalClientes) : '';
  const campanha = await resolveCampaignTurnContext({ message: mensagem, clientId: ELITE }).catch(() => null);
  const dono = campanha?.campanha ? await nomeDoCliente(campanha.campanha.clientId).catch(() => null) : null;
  const blocoCampanha = campanha ? formatCampaignBlock(campanha, { campanhaDe: dono }) : '';
  const pessoa = await resolvePersonTurnContext(mensagem).catch(() => null);
  const blocoPessoas = pessoa ? formatPersonBlock(pessoa) : '';

  const blocos: BlocoDeContexto[] = [
    { fonte: 'cliente', texto: blocoCliente },
    { fonte: 'campanha', texto: blocoCampanha },
    { fonte: 'pessoas', texto: blocoPessoas },
  ];
  const pack = assembleContext(blocos);

  console.log(`\n=== "${mensagem}" (pedido: ${mensagem.length} chars)`);
  console.log(`total do contexto: ${pack.totalChars} chars — ${Math.round(pack.totalChars / mensagem.length)}x o pedido`);
  console.log('fonte        chars     %   lacunas  nomes-de-tarefa');
  const porFonte: Array<[string, string]> = [
    ['cliente', blocoCliente],
    ['campanha', blocoCampanha],
    ['pessoas', blocoPessoas],
  ];
  for (const [nome, texto] of porFonte) {
    if (texto.length === 0) continue;
    const pct = Math.round((texto.length / Math.max(pack.totalChars, 1)) * 100);
    console.log(
      `${nome.padEnd(12)} ${String(texto.length).padStart(6)}  ${String(pct).padStart(3)}%  ${String(lacunas(texto)).padStart(7)}  ${String(nomesDeTarefa(texto)).padStart(15)}`,
    );
  }
}
process.exit(0);
