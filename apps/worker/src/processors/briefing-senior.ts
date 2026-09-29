/**
 * briefing-senior.ts — a leitura da demanda, não só a ficha dela.
 *
 * Relato da operação (28/09/2026): "o conteúdo é básico, não aprofunda nem
 * elabora; somos uma das maiores empresas de mídia digital do país e todo
 * funcionário aqui é sênior".
 *
 * Três causas somadas, e nenhuma era o modelo ser ruim:
 *
 *   1. O briefing é um TEMPLATE preenchido com fatos de uma linha. Cliente,
 *      público, canal, prazo. Está tudo certo e não há UMA frase de
 *      pensamento — por construção, não por acidente.
 *   2. O modelo só era chamado como EXTRATOR de campo ("leia o pedido,
 *      preencha 'objetivo:'"). Nunca foi pedido a ele que pensasse.
 *   3. O teto era de 700 tokens. Profundidade não cabe em 700 tokens.
 *
 * O que este arquivo acrescenta é a parte que um sênior escreveria à mão: por
 * que essa peça agora, qual o ângulo, o que derruba a entrega, e o que faz
 * alguém aprovar sem mexer.
 *
 * A REGRA QUE SUSTENTA ISSO, e que separa elaboração de invenção: fato e
 * leitura ficam em lugares diferentes e declarados. Os fatos continuam vindo
 * do dossiê, determinísticos, com procedência, na parte de cima. Esta seção é
 * LEITURA — raciocínio sobre aqueles fatos — e não pode afirmar nada novo
 * sobre o cliente. Precisou de um dado que não tem? Vira `[CONFIRMAR: ...]`,
 * igual ao resto do sistema. Briefing bonito com dado inventado é o pior
 * resultado possível: ninguém confere o que parece pensado.
 */

import type { Logger } from '@desigual-os/logging';
import type { ComposedBriefing } from './briefing-composer';

/**
 * As mesmas frases que a porta de qualidade já reconhece como enchimento.
 * Aqui elas servem de reprovação: se a elaboração voltar com isso, ela não
 * elaborou nada e é melhor não anexar do que anexar ruído com cara de análise.
 */
const ENCHIMENTO =
  /(executar a entrega descrita no t|detalhes adicionais devem ser complementados|criar uma campanha de qualidade|produzir conte[úu]do alinhado|conte[úu]do alinhado com a marca|seguir o padr[ãa]o da ag[êe]ncia|material de alta qualidade|conforme solicitado|de acordo com as necessidades do cliente|entrega revisada e aprovada pelo solicitante|alinhado (?:à|a) identidade|garantir (?:a )?qualidade)/i;

/** Abaixo disso não é análise, é legenda. */
const MINIMO_DE_SUBSTANCIA = 320;

const BARRA_SENIOR = `Você está escrevendo para uma equipe SÊNIOR de uma das maiores empresas de mídia digital do país. Ninguém aqui precisa que expliquem o que é um carrossel.

A régua é esta, e ela é dura:
- um redator ou designer sênior lê isto e COMEÇA A PRODUZIR, sem voltar perguntando nada;
- nada do que você escrever pode ser verdade para qualquer outro cliente. Se a frase serve pra Colormaq e pra uma pizzaria, ela não diz nada;
- você não repete o que já está nos fatos acima. Você diz o que eles IMPLICAM.

Escreva EXATAMENTE estas quatro seções, em markdown, nesta ordem, sem preâmbulo e sem conclusão:

## LEITURA DA DEMANDA
Por que esta peça, para este público, agora. O que está em jogo se ela sair genérica. 2 a 4 frases.

## ÂNGULO
O recorte específico que faz a mensagem morder — a tensão real do público, não o benefício do produto. Diga também o ângulo ÓBVIO que deve ser evitado, e por quê. 2 a 4 frases.

## O QUE DERRUBA ESTA ENTREGA
3 a 5 itens, cada um concreto e específico deste trabalho: o erro provável, não uma regra geral. Nada de "evitar erros de português".

## CRITÉRIO DE PRONTO
3 a 4 itens verificáveis: o que alguém CONFERE pra aprovar sem mexer. Verificável significa que dá pra responder sim ou não olhando a peça.

Restrições que não se negociam:
- Você NÃO tem informação nova sobre o cliente. Raciocine apenas sobre os fatos listados acima. Precisou de um dado que não está lá? Escreva "[CONFIRMAR: <o que falta>]" e siga. NUNCA afirme característica, número, história ou preferência do cliente que não esteja nos fatos.
- Nada de frase de efeito, nada de "alinhado à identidade da marca", nada de listar o óbvio da profissão.
- Português do Brasil, direto, sem adjetivo de propaganda.`;

export interface ElaborarParams {
  composto: ComposedBriefing;
  /** O pedido original, na íntegra. */
  mensagem: string;
  clientName: string | null;
  /** Regras que a operação já corrigiu — obrigatórias, ver bento-aprendizado.ts. */
  regras?: string | null;
  escritor: (prompt: string, opts?: { maxTokens?: number }) => Promise<string | null>;
  logger: Logger;
}

export interface ElaboracaoSenior {
  markdown: string;
  /** Quantas tentativas foram necessárias — entra no log, não na task. */
  tentativas: number;
}

/**
 * Reprova o que não tem substância. Duas checagens baratas e honestas: tamanho
 * (análise curta demais é legenda) e enchimento conhecido. Não tenta julgar o
 * mérito do raciocínio — isso é trabalho de gente.
 */
export function elaboracaoAceitavel(texto: string): boolean {
  const limpo = texto.trim();
  if (limpo.length < MINIMO_DE_SUBSTANCIA) return false;
  if (ENCHIMENTO.test(limpo)) return false;
  // As quatro seções pedidas precisam existir: meia elaboração desorienta mais
  // do que a ficha seca, porque parece que alguém pensou e parou no meio.
  const secoes = ['LEITURA DA DEMANDA', 'ÂNGULO', 'DERRUBA', 'CRITÉRIO DE PRONTO'];
  return secoes.every((s) => limpo.toUpperCase().includes(s));
}

/**
 * Escreve a leitura sênior da demanda. Uma retentativa quando a primeira volta
 * rasa — e desistir em silêncio quando nem a segunda serve: o briefing factual
 * já é entregável sozinho, e anexar análise vazia é pior que não anexar.
 */
export async function elaborarBriefingSenior(params: ElaborarParams): Promise<ElaboracaoSenior | null> {
  const base = [
    BARRA_SENIOR,
    '',
    `CLIENTE: ${params.clientName ?? '[CONFIRMAR: cliente]'}`,
    '',
    'FATOS APURADOS (é só sobre isto que você pode raciocinar):',
    params.composto.markdown,
    '',
    'PEDIDO ORIGINAL, como a pessoa escreveu:',
    params.mensagem,
    // As regras vêm POR ÚLTIMO de propósito: é a instrução mais recente e a
    // que a operação corrigiu à mão, então é a que tem que vencer.
    params.regras ? `\n${params.regras}` : '',
  ].join('\n');

  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const prompt =
      tentativa === 1
        ? base
        : `${base}\n\nA versão anterior voltou rasa ou genérica. Reescreva com mais especificidade: cada frase precisa ser verdadeira SÓ para este cliente e este trabalho.`;
    // Teto alto de propósito: a causa do briefing raso não era o modelo, era o
    // orçamento de 700 tokens que não cabia um raciocínio.
    const saida = await params.escritor(prompt, { maxTokens: 1800 }).catch(() => null);
    if (saida && elaboracaoAceitavel(saida)) {
      return { markdown: saida.trim(), tentativas: tentativa };
    }
    params.logger.info(
      { tentativa, tamanho: saida?.length ?? 0 },
      '[briefing-senior] elaboração reprovada (rasa, genérica ou incompleta)',
    );
  }
  return null;
}

/**
 * Junta ficha e leitura numa peça só. A leitura entra DEPOIS dos fatos e antes
 * das pendências: quem executa lê o que sabemos, depois como lemos aquilo, e
 * por último o que ainda falta confirmar.
 */
export function costurar(composto: ComposedBriefing, elaboracao: ElaboracaoSenior | null): string {
  if (!elaboracao) return composto.markdown;
  const marcador = '## PENDENTE DE CONFIRMAÇÃO';
  const idx = composto.markdown.indexOf(marcador);
  const bloco = `${elaboracao.markdown.trim()}\n\n`;
  if (idx < 0) return `${composto.markdown.trimEnd()}\n\n${bloco}`.trimEnd();
  return `${composto.markdown.slice(0, idx)}${bloco}${composto.markdown.slice(idx)}`;
}
