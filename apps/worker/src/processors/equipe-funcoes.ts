/**
 * equipe-funcoes.ts — quem faz o quê, DECLARADO, nunca inferido.
 *
 * A operação declarou em 28/09/2026: o briefing de redação vai pro Matheus
 * Sain, o de design pro Gui, o de edição de vídeo pro Celso. Esse é o registro
 * inteiro — e a regra vale pro resto: função que ninguém declarou vira PERGUNTA
 * ao usuário, nunca um palpite.
 *
 * Por que não deduzir do ClickUp. Este repositório já pagou por isso: o
 * incidente da Esther (16/09/2026, ver person-context.ts) foi promover "aparece
 * em task deste cliente" a "responde pela conta". Quem mais recebeu task de
 * layout não é "o designer" — pode ser quem estava livre no mês passado. Cargo
 * é fato declarado; volume é coincidência.
 *
 * Por que env e não código. Time muda, gente entra e sai, e um mapa que exige
 * deploy pra corrigir é um mapa que fica errado. `BENTO_FUNCOES_EQUIPE` aceita
 * o mapa inteiro em JSON e vence o padrão abaixo:
 *
 *   BENTO_FUNCOES_EQUIPE='{"redacao":["Matheus Sain"],"design":["Gui","Bruna Baldacini"]}'
 *
 * E o modo de falhar é seguro nos dois sentidos: mapa vazio pergunta tudo;
 * mapa com duas pessoas na mesma função também pergunta. O Bento só resolve
 * sozinho quando existe UMA resposta declarada — nas outras situações,
 * perguntar é mais barato que atribuir no nome errado.
 */

import type { FuncaoId, MembroConhecido } from './bento-campanha';
import { FUNCOES } from './bento-campanha';

/**
 * O que a operação declarou. Propositalmente curto: só entra aqui o que
 * alguém afirmou. Design com um nome só é o que foi dito — se houver outro
 * designer, acrescente e o Bento passa a perguntar entre os dois, que é o
 * comportamento certo.
 */
const DECLARADO_PELA_OPERACAO: Partial<Record<FuncaoId, string[]>> = {
  redacao: ['Matheus Sain'],
  design: ['Gui'],
  video: ['Celso de Andrade Guimarães'],
};

const IDS_VALIDOS = new Set<string>(FUNCOES.map((f) => f.id));

function lerDaEnv(env: NodeJS.ProcessEnv): Partial<Record<FuncaoId, string[]>> | null {
  const bruto = env.BENTO_FUNCOES_EQUIPE?.trim();
  if (!bruto) return null;
  try {
    const parsed = JSON.parse(bruto) as Record<string, unknown>;
    const out: Partial<Record<FuncaoId, string[]>> = {};
    for (const [chave, valor] of Object.entries(parsed)) {
      if (!IDS_VALIDOS.has(chave) || !Array.isArray(valor)) continue;
      const nomes = valor.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
      if (nomes.length > 0) out[chave as FuncaoId] = nomes;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    // JSON quebrado não pode virar mapa vazio silencioso nem derrubar o turno:
    // cai pro declarado, e o pior caso é uma pergunta a mais.
    return null;
  }
}

/** O registro de funções, na forma que `resolverResponsaveis` consome. */
export function membrosPorFuncao(env: NodeJS.ProcessEnv = process.env): MembroConhecido[] {
  const mapa = lerDaEnv(env) ?? DECLARADO_PELA_OPERACAO;
  const porPessoa = new Map<string, FuncaoId[]>();
  for (const [funcao, nomes] of Object.entries(mapa) as Array<[FuncaoId, string[]]>) {
    for (const nome of nomes) {
      const atual = porPessoa.get(nome) ?? [];
      if (!atual.includes(funcao)) atual.push(funcao);
      porPessoa.set(nome, atual);
    }
  }
  return [...porPessoa.entries()].map(([nome, funcoes]) => ({ nome, funcoes }));
}
