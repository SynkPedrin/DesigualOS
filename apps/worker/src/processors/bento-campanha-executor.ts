/**
 * bento-campanha-executor.ts — a campanha vira N tasks, uma por frente.
 *
 * Roda só quando o pedido é explicitamente de SEGMENTAÇÃO (ver
 * `pedeSegmentacaoDeCampanha`): "divide a campanha entre a equipe", "lança as
 * tasks pra cada um". Pedido comum de criar uma task continua no caminho de
 * sempre — este arquivo não disputa turno com ele.
 *
 * A ordem importa e é esta:
 *
 *   decompor → resolver dono → SE FALTAR DONO, PERGUNTAR E PARAR → criar
 *
 * Perguntar vem ANTES de criar, sempre, e não cria "as que dá" deixando o
 * resto pendente. Lançar metade de uma campanha é pior que não lançar: a
 * operação passa a enxergar um conjunto incompleto como se fosse o plano
 * inteiro, e o que faltou não aparece em lugar nenhum.
 *
 * Cada task nasce com o briefing DELA — é o ponto do pedido. Quem abre a task
 * de redação não deveria precisar ler a de design pra entender o trabalho.
 */

import { createVerifiedSeniorTask, MutationBudget, type ClickUpConfig, type SeniorToolContext } from '@desigual-os/tool-gateway';
import type { Logger } from '@desigual-os/logging';
import { decomporCampanha, montarPergunta, resolverResponsaveis, rotuloDaFuncao, type FrenteComDono } from './bento-campanha';
import { membrosPorFuncao } from './equipe-funcoes';

/**
 * Sinal EXPLÍCITO de segmentação. Conservador de propósito: um falso positivo
 * aqui transforma "cria a task do carrossel" em cinco tasks com donos
 * diferentes, que é estrago real. Exige as duas coisas — o objeto (campanha,
 * demanda, projeto) e o verbo de repartir, ou a forma "uma task pra cada".
 */
const OBJETO_RE = /\b(campanha|demanda|projeto|briefing|job|a[çc][aã]o)\b/i;
const REPARTIR_RE = /\b(segment\w*|divid\w*|distribu\w*|repart\w*|quebr\w*|separ\w*|desdobr\w*)\b/i;
const POR_PESSOA_RE = /\b(uma|1)\s+(task|tarefa|demanda)\s+(pra|para)\s+cada\b|\bpra\s+cada\s+(um|colaborador|respons[áa]vel|fun[çc][aã]o)\b|\bentre\s+(a\s+)?(equipe|time|galera)\b/i;

export function pedeSegmentacaoDeCampanha(mensagem: string): boolean {
  return (OBJETO_RE.test(mensagem) && REPARTIR_RE.test(mensagem)) || POR_PESSOA_RE.test(mensagem);
}

export interface ResultadoDaCampanha {
  /** Quando preenchido, o turno TERMINA aqui: falta dono e o Bento perguntou. */
  pergunta: string | null;
  /** Relato do que foi criado — vazio quando perguntou. */
  resposta: string | null;
  criadas: Array<{ id: string; url: string; titulo: string; responsavel: string }>;
}

export interface ExecutarCampanhaParams {
  mensagem: string;
  clientName: string | null;
  contextoDoCliente?: string | null;
  listId: string;
  config: ClickUpConfig;
  seniorToolContext: SeniorToolContext;
  escritor: (prompt: string) => Promise<string | null>;
  logger: Logger;
  env?: NodeJS.ProcessEnv;
}

export async function executarCampanha(params: ExecutarCampanhaParams): Promise<ResultadoDaCampanha | null> {
  const frentes = await decomporCampanha({
    mensagem: params.mensagem,
    clientName: params.clientName,
    contextoDoCliente: params.contextoDoCliente ?? null,
    escritor: params.escritor,
  });
  if (frentes.length === 0) {
    params.logger.info({ clientName: params.clientName }, '[bento-campanha] nada segmentável no pedido; segue o caminho normal');
    return null;
  }

  const resolucao = resolverResponsaveis(frentes, membrosPorFuncao(params.env ?? process.env));
  const pergunta = montarPergunta(resolucao);
  if (pergunta) {
    params.logger.info(
      { frentes: frentes.length, pendentes: resolucao.perguntas.map((p) => p.funcao) },
      '[bento-campanha] falta dono em alguma frente — perguntando ANTES de criar qualquer task',
    );
    return { pergunta, resposta: null, criadas: [] };
  }

  const criadas: ResultadoDaCampanha['criadas'] = [];
  const falhas: string[] = [];
  const orcamento = new MutationBudget();

  for (const frente of resolucao.prontas as FrenteComDono[]) {
    try {
      const r = await createVerifiedSeniorTask(
        params.config,
        params.seniorToolContext,
        {
          listId: params.listId,
          name: frente.titulo,
          description: frente.briefing,
          assigneeName: frente.responsavel,
        },
        orcamento,
      );
      if (r.success) criadas.push({ id: r.resourceId, url: r.resourceUrl, titulo: frente.titulo, responsavel: frente.responsavel });
      else falhas.push(`${frente.titulo}: ${r.message}`);
    } catch (error) {
      falhas.push(`${frente.titulo}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Cada frente reporta o seu resultado. Uma falha no meio não apaga as que
  // deram certo, e não é escondida atrás de um "pronto" geral.
  const linhas = [
    criadas.length > 0 ? `Lancei ${criadas.length} task(s) da campanha, cada uma com o briefing dela:` : 'Não consegui lançar nenhuma task da campanha.',
    ...criadas.map((c) => `- ${c.titulo} → ${c.responsavel} · ${c.url}`),
  ];
  if (falhas.length > 0) {
    linhas.push('', `⚠️ ${falhas.length} não saiu/saíram:`);
    for (const f of falhas) linhas.push(`- ${f}`);
  }
  const porFuncao = new Map<string, number>();
  for (const f of resolucao.prontas) porFuncao.set(rotuloDaFuncao(f.funcao), (porFuncao.get(rotuloDaFuncao(f.funcao)) ?? 0) + 1);

  params.logger.info({ criadas: criadas.length, falhas: falhas.length }, '[bento-campanha] campanha segmentada e lançada');
  return { pergunta: null, resposta: linhas.join('\n'), criadas };
}
