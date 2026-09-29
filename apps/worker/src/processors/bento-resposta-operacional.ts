/**
 * bento-resposta-operacional.ts — a pergunta sobre a OPERAÇÃO também merece GPT.
 *
 * Relato de 29/09/2026: "criar e alterar usam GPT; responder sai por outro
 * node, outro modelo — o briefing é sênior, a conversa não". É verdade e era
 * estrutural: leitura e análise devolvem `null` no core e caem no serviço
 * externo `bento-qa`, que roda o próprio modelo em outra máquina.
 *
 * Este arquivo cobre UMA fatia disso, e a escolha da fatia é o ponto:
 *
 *   PERGUNTA OPERACIONAL — "quantas atrasadas?", "quem está sobrecarregado?",
 *   "o que falta pra Colormaq essa semana?" — é respondida AQUI, com GPT, em
 *   cima de números que o próprio sistema apurou e do dossiê do cliente.
 *
 *   PERGUNTA DE CONHECIMENTO — "o que a gente fez na campanha X?", "qual o tom
 *   de voz da 3Net?" — continua no `bento-qa`, porque lá existe busca vetorial
 *   no vault inteiro, e aqui não. Trocar isso por GPT sem o retrieval seria
 *   piorar com cara de melhorar.
 *
 * A regra de sempre: número é apurado, resposta é raciocínio sobre ele, e o
 * que não está nos dados vira "não sei" — nunca estimativa com ar de fato.
 */

import type { Logger } from '@desigual-os/logging';

/** Interrogação explícita ou pedido de leitura. */
const PERGUNTA_RE =
  /\?|(^|\s)(quant[ao]s?|quem|qual|quais|onde|quando|por que|porque|o que|me diz|me fala|me mostra|tem alguma|existe algum)\b/i;

/**
 * PEDIDO DE ATA / DESDOBRAMENTO DE REUNIÃO (29/09/2026).
 *
 * A Tammy sai de uma reunião com a transcrição na mão e precisa de UMA coisa:
 * o que ficou decidido, quem faz o quê, e o que disso já existe no ClickUp.
 * Não é pergunta de estado nem pedido de escrita — é leitura cruzada, e sem
 * gatilho próprio caía no caminho errado.
 */
const ATA_RE =
  /\b(ata|resumo da reuni[ãa]o|o que (ficou|saiu) (decidido|da reuni[ãa]o)|desdobr\w*|p[óo]s-?reuni[ãa]o|encaminhamentos?)\b/i;

export function pedeAtaDeReuniao(mensagem: string, temMaterial: boolean): boolean {
  return temMaterial && ATA_RE.test(mensagem);
}

const BARRA_ATA = `Você é o gerente de operação de uma agência de mídia digital. Acabou de receber a transcrição de uma reunião e o estado atual do ClickUp.

Produza EXATAMENTE isto, nesta ordem, sem preâmbulo:

## O QUE FICOU DECIDIDO
Os pontos fechados na reunião, um por linha. Só o que a transcrição diz. Nada de "foi discutido" — decisão é o que tem dono ou consequência.

## O QUE VIRA TRABALHO
Uma linha por entregável que a reunião gerou: **entregável** — função responsável (redação/design/vídeo/tráfego) — prazo, se a reunião deu um.
Se a reunião não disse a função ou o prazo, escreva [CONFIRMAR: ...] no lugar. Não deduza.

## JÁ EXISTE NO CLICKUP?
Cruze o que vira trabalho com as tarefas que aparecem no estado da operação. Por item: já tem task, não tem, ou não dá pra saber com o que você recebeu. NUNCA afirme que existe uma task sem ver o nome dela nos dados.

## O QUE EU FARIA AGORA
Duas ou três ações, na ordem, executáveis hoje. A primeira tem que ser a que destrava as outras.

Restrições:
- Só o que está na transcrição e nos dados. Nome de pessoa, cliente, prazo ou número que não estiver ali não existe.
- Português do Brasil, direto. Sem adjetivo de relatório.`;

export interface AtaParams {
  pergunta: string;
  material: string;
  estadoDaOperacao: string | null;
  blocoCliente?: string | null;
  escritor: (prompt: string, opts?: { maxTokens?: number }) => Promise<string | null>;
  logger: Logger;
}

/** A ata do dia: decisões, trabalho gerado, o que já existe, e o próximo passo. */
export async function montarAtaDeReuniao(params: AtaParams): Promise<string | null> {
  const dados = [
    `TRANSCRIÇÃO DA REUNIÃO:\n${params.material}`,
    params.estadoDaOperacao ? `ESTADO DO CLICKUP AGORA:\n${params.estadoDaOperacao}` : null,
    params.blocoCliente,
  ]
    .filter((b): b is string => Boolean(b?.trim()))
    .join('\n\n');

  const r = await params
    .escritor(`${BARRA_ATA}\n\n${dados}\n\nPEDIDO:\n${params.pergunta}`, { maxTokens: 1600 })
    .catch((error: unknown) => {
      params.logger.warn({ error }, '[bento-ata] escritor falhou');
      return null;
    });
  const limpa = r?.trim();
  return limpa && limpa.length > 40 ? limpa : null;
}

/**
 * Vocabulário de ESTADO da operação — o que este arquivo sabe responder.
 *
 * "operação" ficou DE FORA de propósito: cliente batiza campanha com esse
 * nome, e "o que a gente fez na campanha Operação Blindada?" é pergunta de
 * VAULT, não de estado. Quem pergunta pela operação inteira ("como tá a
 * operação?") já tem gatilho próprio no panorama.
 */
const OPERACIONAL_RE =
  /\b(atrasad\w*|vencend\w*|vence|prazo|sem respons[áa]vel|sem dono|sobrecarreg\w*|carga|gargalo|em aberto|pendent\w*|parad\w*|abandonad\w*|entregas?|demandas?|tarefas?|tasks?)\b/i;

/**
 * PASSADO é vault, presente é operação. "o que a gente FEZ", "o que JÁ RODOU",
 * "quais campanhas ROLARAM" pedem histórico — e histórico mora no vault, com
 * busca vetorial. O estado do ClickUp não responde isso, e responder com ele
 * seria trocar uma resposta boa por uma que parece boa.
 */
const PASSADO_RE =
  /\b(fez|fizemos|fizeram|rodou|rodaram|rolou|rolaram|j[áa] (foi|fizemos|rodou)|aconteceu|entregamos|foi feito|hist[óo]rico)\b/i;

/**
 * É pergunta sobre o ESTADO da operação? Conservador nos três sentidos: sem
 * interrogação não é pergunta, sem vocabulário de estado não é deste arquivo,
 * e pergunta sobre o passado vai pro vault.
 */
export function ehPerguntaOperacional(mensagem: string): boolean {
  if (PASSADO_RE.test(mensagem)) return false;
  return PERGUNTA_RE.test(mensagem) && OPERACIONAL_RE.test(mensagem);
}

const BARRA = `Você é o gerente de operação de uma agência de mídia digital, respondendo a quem decide.

Responde à pergunta com o que está nos DADOS abaixo. Nada além deles.

Como se responde aqui:
- Comece pela resposta. Sem "claro", sem repetir a pergunta, sem preâmbulo.
- Número que você citar tem que estar nos dados, exatamente como está lá.
- Se os dados não respondem, diga o que falta em uma linha. "Não tenho isso" é resposta; número estimado não é.
- Quando a resposta expõe um risco que ninguém perguntou (gargalo numa pessoa, trabalho sem dono há dias), diga em UMA linha no fim. Não faça relatório.
- Português do Brasil, direto, sem adjetivo de relatório ("crítico", "preocupante") — o número já diz.
- Curto. Três a seis linhas resolvem quase tudo.

Nunca invente nome de cliente, de pessoa ou de task que não esteja nos dados.`;

export interface RespostaOperacionalParams {
  pergunta: string;
  /** Números apurados do ClickUp (bento-panorama). Sem isto, não há o que responder. */
  estadoDaOperacao: string | null;
  /** Dossiê e identidade do cliente do turno, quando há um. */
  blocoCliente?: string | null;
  /** Bloco operacional do turno (lista de tasks que a API já resolveu). */
  contextoOperacional?: string | null;
  /**
   * Texto dos arquivos anexados no pedido — ata de reunião, briefing do
   * cliente, apresentação. É FONTE, do mesmo nível do dossiê: entra junto com
   * os números em vez de disputar com eles.
   */
  material?: string | null;
  escritor: (prompt: string, opts?: { maxTokens?: number }) => Promise<string | null>;
  logger: Logger;
}

/**
 * Responde, ou devolve null pra quem chamou seguir pelo caminho de sempre.
 * Null aqui nunca é erro — é "esta pergunta não é minha".
 */
export async function responderOperacional(params: RespostaOperacionalParams): Promise<string | null> {
  /**
   * UM conjunto de números por vez. Medido em 29/09/2026: mandar o estado
   * apurado (146 atrasadas) JUNTO com o bloco operacional que a API monta por
   * outra consulta produziu uma resposta com 198 atrasadas numa pessoa só —
   * dois recortes diferentes somados como se fossem o mesmo. O modelo até
   * percebeu e avisou, mas contar com isso seria sorte.
   *
   * O estado apurado ganha: é determinístico, tem teto declarado e a mesma
   * base pra todo mundo. O bloco da API só entra quando não há estado.
   */
  const numeros = params.estadoDaOperacao ?? params.contextoOperacional ?? null;
  const dados = [numeros, params.material, params.blocoCliente]
    .filter((b): b is string => Boolean(b?.trim()))
    .join('\n\n');

  // Sem dado apurado não há resposta a dar — e inventar seria pior que
  // devolver a pergunta pro caminho antigo.
  if (!dados.trim()) return null;

  const resposta = await params.escritor(
    `${BARRA}\n\nDADOS:\n${dados}\n\nPERGUNTA:\n${params.pergunta}`,
    { maxTokens: 700 },
  ).catch((error: unknown) => {
    params.logger.warn({ error }, '[bento-resposta-operacional] escritor falhou; seguindo pro caminho antigo');
    return null;
  });

  const limpa = resposta?.trim();
  if (!limpa || limpa.length < 12) return null;
  return limpa;
}
