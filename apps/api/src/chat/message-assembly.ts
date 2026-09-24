import type { AgentName } from '@desigual-os/types';

/**
 * Regras de montagem da mensagem por agente, extraídas de chat/routes.ts para
 * serem testáveis de forma isolada (portão do Jarbas, Onda 0). A lógica é a
 * mesma que estava inline na rota; os comentários com a medição original
 * continuam em chat/routes.ts.
 *
 * As regras nasceram de incidentes medidos em produção (09/09, 10/09 e
 * 17/09/2026):
 *
 * - O bento-qa usa a mensagem INTEIRA como consulta vetorial. Bloco de
 *   contexto geral (usuário, dossiê, histórico) na mensagem degradava a busca
 *   e gerava resposta errada COM citação. Por isso o Bento não recebe o bloco
 *   de contexto na mensagem; o dado operacional vai em campo separado.
 *
 * - O serviço de Jarbas/Suzy classifica a mensagem inteira, e um bloco
 *   operacional grande (nomes de cliente, "campanha", "relatório") dispara o
 *   edge case job_via_whatsapp, que responde com erro genérico e ignora a
 *   pergunta. Por isso o bloco operacional NUNCA vai na mensagem deles.
 *
 * - O Otto ganhou projeção de contexto no worker (por intenção: pedido
 *   criativo não recebe lista de tarefa nem id de lista). Só que a API
 *   concatenava OUTRA cópia do dossiê e do histórico na mensagem, por fora do
 *   projetor. Medido em 17/09/2026 numa conversa real: 16 chars de pedido
 *   contra 3913 chars de bloco não projetado, citando ClickUp e id de lista, e
 *   com 6 linhas de RESPOSTAS ANTERIORES DO PRÓPRIO OTTO — uma resposta
 *   operacional virava contexto operacional do turno seguinte e o
 *   enquadramento se reforçava sozinho. Projetar num caminho enquanto o outro
 *   despeja o texto cru não projeta nada.
 *
 * A regra que ficou: a MENSAGEM É A MENSAGEM DO USUÁRIO. Conhecimento chega
 * por estrutura — o ContextPack que o worker monta (e projeta) e o campo
 * apartado de dado operacional. Nada disso reduz o que o agente sabe; muda só
 * por onde entra.
 */

/**
 * Quem recebe o bloco de contexto GERAL (usuário, dossiê, histórico) colado na
 * mensagem.
 *
 * Bento fora: envenena a busca vetorial dele. Otto fora: o worker já monta e
 * PROJETA esse mesmo conhecimento, e a segunda cópia crua era o que anulava a
 * projeção.
 *
 * Jarbas e Suzy saíram em 24/09/2026, medido no front publicado. O bloco
 * OPERACIONAL já era proibido para eles (edge case job_via_whatsapp), mas o
 * bloco GERAL continuava indo — e ele carrega o dossiê inteiro do cliente.
 * Efeito: "quanto gastou?" com a 3Net selecionada chegava no serviço como a
 * pergunta mais ~2 KB de BRAIN, e a resposta voltava "Sobre qual cliente você
 * tá falando?" — com a 3Net escrita no meio do texto que ele acabou de
 * receber. O mesmo despejo levou "qual campanha tá melhor?" a responder pela
 * carteira inteira, num período que ninguém pediu.
 *
 * O serviço deles resolve cliente lendo o texto (findClientInText) e classifica
 * a mensagem INTEIRA: o que ele precisa é a pergunta e o NOME do cliente, não o
 * dossiê. Essa linha curta o worker anexa (ver execute-job.ts, sufixoDeCliente).
 * Sobra o Studio, que não tem ContextPack nem serviço com classificador próprio.
 */
export function contextoGeralVaiNaMensagem(agent: AgentName): boolean {
  return agent === 'studio';
}

/**
 * Quem pode receber o bloco operacional do ClickUp ANEXADO na mensagem.
 *
 * Jarbas e Suzy nunca (edge case job_via_whatsapp). Bento e Otto recebem o
 * mesmo dado por CAMPO SEPARADO — ver `operacionalPorCampoApartado`. Sobra o
 * Studio, que não tem campo próprio.
 */
export function agenteAceitaBlocoNaMensagem(agent: AgentName): boolean {
  return agent === 'studio';
}

/**
 * Quem recebe o dado operacional por campo apartado, fora da mensagem.
 *
 * No Bento o campo vira `operational_context` no /ask. No Otto ele entra no
 * ContextPack do worker como bloco de fonte, sujeito à mesma projeção por
 * intenção que o resto: turno operacional recebe, pedido criativo não. É isto
 * que permite tirar o bloco da mensagem sem o Otto perder o dado ao vivo.
 */
export function operacionalPorCampoApartado(agent: AgentName): boolean {
  return agent === 'bento' || agent === 'otto';
}
