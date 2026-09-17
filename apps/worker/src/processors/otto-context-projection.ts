/**
 * otto-context-projection.ts — o que o MODELO vê neste turno.
 *
 * Cinco rodadas de correção de instrução não mudaram o comportamento do Otto.
 * Quando instrução não move o resultado, quem manda é outra coisa. A medição
 * (scripts/trace-contexto-otto.mts) mostrou o quê:
 *
 *   "Me dá 3 títulos."      16 chars de pedido
 *   contexto do cliente   8211 chars   — 513x o pedido
 *   com 24 marcações de lacuna
 *
 * E dentro desses 8211, a MAIOR seção é "## ClickUp (sincronizado em ...)",
 * com 1642 chars de nomes de tarefa — enquanto a voz da marca tem 361, quase
 * todos [FALTA]. O contexto tornava nome de tarefa o candidato a título mais
 * saliente do prompt, e foi exatamente isso que voltou como resposta: "Elite
 * Aniversário 70 anos Setembro", "Elite Ads".
 *
 * Nenhuma frase de instrução vence 20% do prompt falando de outra coisa.
 *
 * O CONHECIMENTO CONTINUA INTEIRO. Isto é uma VIEW: o ContextPack segue com
 * tudo, a evidência para grounding segue com tudo, e o que muda é só o recorte
 * que chega ao modelo neste turno. Pedido criativo não precisa da lista de
 * tarefas; pergunta operacional precisa, e aí ela entra.
 *
 * Escopo: SÓ O OTTO. O Bento é operacional por natureza e está passando.
 */
import { contratoDeSaida, ehRevisaoEliptica, exigeFrescorOperacional } from '@desigual-os/otto';

export type ModoDoTurno = 'CRIACAO' | 'REVISAO' | 'OPERACIONAL' | 'MISTO' | 'OUTRO';

export interface TurnoClassificado {
  modo: ModoDoTurno;
  artefato: string;
}

/**
 * O que este turno está pedindo. Determinístico de propósito: se a projeção do
 * contexto dependesse do humor do modelo, o mesmo pedido veria coisas
 * diferentes a cada execução.
 */
export function classificarTurno(mensagem: string): TurnoClassificado {
  const artefato = contratoDeSaida(mensagem).artefato;
  const pedeCriacao = artefato !== 'indefinido';
  const pedeRevisao = ehRevisaoEliptica(mensagem);
  const pedeOperacao = exigeFrescorOperacional(mensagem);

  if ((pedeCriacao || pedeRevisao) && pedeOperacao) return { modo: 'MISTO', artefato };
  if (pedeRevisao) return { modo: 'REVISAO', artefato };
  if (pedeCriacao) return { modo: 'CRIACAO', artefato };
  if (pedeOperacao) return { modo: 'OPERACIONAL', artefato };
  return { modo: 'OUTRO', artefato };
}

/** Seções do dossiê que são registro de PROCESSO, não matéria-prima criativa. */
const SECOES_OPERACIONAIS = /clickup|evid[êe]ncias encontradas|[úu]ltima atualiza[çc][ãa]o|fontes|sincroniz/i;
/** Seções que existem para listar o que falta. Viram uma linha só. */
const SECOES_DE_LACUNA = /lacunas?/i;
/** Marcação de ausência, nas duas grafias que o dossiê usa (com e sem crase). */
const EH_LACUNA = /`?\[FALTA\]`?|a coletar|`?\[CONFIRMAR/i;

function ehCabecalho(linha: string): boolean {
  return /^#{1,3}\s+\S/.test(linha.trim());
}

/** Campos marcados como ausentes, por nome, para caber numa linha. */
function camposFaltando(texto: string): string[] {
  const nomes: string[] = [];
  let secao = '';
  for (const linha of texto.split('\n')) {
    if (ehCabecalho(linha)) secao = linha.replace(/^#+\s*|^\d+\.\s*/g, '').trim();
    if (!EH_LACUNA.test(linha)) continue;
    // Duas formas no dossiê: "- **Onde atua:** `[FALTA]`" e "`[FALTA]` — promessa
    // central, diferenciais...". A primeira nomeia o campo; a segunda descreve o
    // bloco, e aí o nome útil é o da seção.
    const rotulo =
      /^[\s>*-]*\**\s*([A-Za-zÀ-ÿ0-9 ./]{3,40}?)\**\s*:/.exec(linha)?.[1]?.trim() ??
      (secao.length > 0 ? secao : null);
    if (rotulo && !nomes.includes(rotulo)) nomes.push(rotulo);
  }
  return nomes.slice(0, 8);
}

/**
 * Recorta o dossiê para um turno criativo.
 *
 * Tira o que é registro de processo (lista do ClickUp, evidências, data de
 * sincronização, fontes) e COLAPSA as lacunas numa linha só. As 24 marcações
 * espalhadas não informavam melhor que uma frase — só ocupavam a maior parte do
 * texto dizendo "não sei", e o modelo respondia à mensagem dominante.
 *
 * Nada some do sistema: o bloco inteiro continua disponível para o turno
 * operacional e para a evidência.
 */
export function projetarBlocoDeCliente(texto: string, modo: ModoDoTurno): string {
  if (texto.length === 0) return texto;
  if (modo === 'OPERACIONAL' || modo === 'MISTO' || modo === 'OUTRO') return texto;

  const linhas = texto.split('\n');
  const mantidas: string[] = [];
  let descartando = false;

  for (const linha of linhas) {
    if (ehCabecalho(linha)) {
      const cab = linha.replace(/^#+\s*/, '');
      descartando = SECOES_OPERACIONAIS.test(cab) || SECOES_DE_LACUNA.test(cab);
      if (descartando) continue;
    }
    if (descartando) continue;
    mantidas.push(linha);
  }

  const faltando = camposFaltando(texto);
  const recortado = mantidas
    // Toda linha que existe só pra dizer "não sei" sai: 22 delas repetindo a
    // mesma ausência não informam melhor que uma frase, e ocupavam a maior
    // parte do texto que o modelo lia.
    .filter((l) => !EH_LACUNA.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const resumoDeLacunas =
    faltando.length > 0
      ? `\n\nO QUE O DOSSIÊ AINDA NÃO TEM: ${faltando.join(', ')}. Assuma a hipótese mais provável, diga em uma linha o que assumiu, entregue, e cite o que falta DEPOIS da peça.`
      : '';

  return `${recortado}${resumoDeLacunas}`;
}

/** Para observabilidade: o que a projeção fez, em números. */
export interface RelatorioDeProjecao {
  modo: ModoDoTurno;
  artefato: string;
  antes: number;
  depois: number;
  lacunasAntes: number;
  lacunasDepois: number;
}

export function relatarProjecao(
  antes: string,
  depois: string,
  turno: TurnoClassificado,
): RelatorioDeProjecao {
  const conta = (t: string): number => (t.match(/\[FALTA\]|a coletar|\[CONFIRMAR/gi) ?? []).length;
  return {
    modo: turno.modo,
    artefato: turno.artefato,
    antes: antes.length,
    depois: depois.length,
    lacunasAntes: conta(antes),
    lacunasDepois: conta(depois),
  };
}
