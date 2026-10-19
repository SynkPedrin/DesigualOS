import type { FonteDeContexto } from './context-assembler';

/**
 * provenance-block.ts — quando perguntam "de onde você tirou isso?".
 *
 * Medido no navegador em 16/09/2026: perguntado "quem trabalha na conta da
 * Cosentino e de onde você tirou essa informação?", o Bento nomeou a equipe
 * certa e simplesmente não disse a origem. A resposta estava correta e mesmo
 * assim era inútil para quem precisa decidir se confia nela.
 *
 * A correção não é pedir ao modelo, num prompt, que "sempre cite a fonte" —
 * ele não tem como saber de onde o texto veio, porque o contexto chega como
 * texto. A correção é ENTREGAR a lista de fontes realmente consultadas neste
 * turno, para que citar seja questão de ler, não de lembrar.
 */

/** O turno está pedindo proveniência? */
const PEDE_FONTE =
  /\b(de onde|da onde|qual (é |e )?a fonte|quais (as )?fontes|como (você |voce )?sabe|onde (você |voce )?(viu|leu|achou)|em que (você |voce )?se baseou|baseado em qu[êe])\b/i;

export function pedeProveniencia(mensagem: string): boolean {
  return PEDE_FONTE.test(mensagem);
}

/**
 * QUEM registrou um conhecimento — a autoria que vem de `memories.metadata`
 * quando a escrita foi feita por uma identidade operacional (credencial de
 * conexão do MCP). Sem `actor_type` não há o que afirmar: `recorded_by` sozinho
 * é texto legado e o bloco não o promove a autoria.
 */
export interface AutoriaDeRegistro {
  /** `metadata.recorded_by` — "Pedro Claude", "Equipe Atendimento". */
  recordedBy: string;
  /** `metadata.actor_type` — decide se é honesto nomear uma pessoa. */
  actorType: 'person' | 'shared_account' | 'service';
}

/**
 * Lê a autoria de um `metadata` de memória. `null` quando falta qualquer uma
 * das duas partes — memória antiga ou gravada pelo fluxo legado renderiza
 * exatamente como antes.
 */
export function autoriaDeMetadata(metadata: unknown): AutoriaDeRegistro | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, unknown>;
  const recordedBy = typeof m.recorded_by === 'string' && m.recorded_by.trim().length > 0 ? m.recorded_by : null;
  const actorType = m.actor_type;
  if (!recordedBy) return null;
  if (actorType !== 'person' && actorType !== 'shared_account' && actorType !== 'service') return null;
  return { recordedBy, actorType };
}

/**
 * A frase de autoria. Conta compartilhada carrega o aviso no próprio texto —
 * é o que sustenta o "não é possível atribuir" quando perguntarem por uma
 * pessoa específica.
 */
export function descreverAutoria(autoria: AutoriaDeRegistro): string {
  if (autoria.actorType === 'shared_account') return `registrado por ${autoria.recordedBy} (conta compartilhada)`;
  if (autoria.actorType === 'service') return `registrado por ${autoria.recordedBy} (automação)`;
  return `registrado por ${autoria.recordedBy}`;
}

function dedupeAutorias(autorias: AutoriaDeRegistro[]): AutoriaDeRegistro[] {
  const vistas = new Set<string>();
  return autorias.filter((a) => {
    const chave = `${a.actorType}|${a.recordedBy}`;
    if (vistas.has(chave)) return false;
    vistas.add(chave);
    return true;
  });
}

/** Como cada fonte do pacote se chama para um humano. */
const NOME_HUMANO: Record<FonteDeContexto, string> = {
  frescor: 'estado de sincronização com o ClickUp',
  // O diálogo recente entra no pacote pra resolver referência, mas NÃO
  // sustenta fato: citá-lo como fonte seria o agente se citando.
  dialogo: 'o que já foi dito nesta conversa',
  cliente: 'dossiê do cliente registrado no sistema',
  campanha: 'registro de campanhas, derivado das tarefas do ClickUp',
  pessoas: 'registro de pessoas e relações, derivado do ClickUp',
  episodios: 'memória do que foi decidido em conversas anteriores, com data',
  // O event store é registro do que ACONTECEU (webhook do ClickUp, equipe via
  // MCP) — não é memória de conversa nem dado ao vivo, e o nome precisa dizer
  // isso pra quem confere a fonte.
  eventos_recentes: 'registro de eventos recentes da operação (o que aconteceu, com data)',
  // Recuperada por semelhança de texto, não por registro direto: o nome
  // humano precisa carregar essa diferença de confiança.
  memoria_semantica: 'memória relacionada ao assunto, recuperada por semelhança',
  preferencias: 'preferências consolidadas do cliente',
  // Atribuição honesta importa aqui mais que em qualquer outra fonte: dizer
  // "ClickUp" para algo que alguém falou no chat inventa uma autoridade que o
  // fato não tem, e quem lê não consegue mais checar de onde veio.
  aprendizado: 'informado por alguém da equipe na conversa, com data',
  outra: 'registro adicional',
} as Record<FonteDeContexto, string>;

/**
 * Bloco com as fontes REAIS deste turno. Vazio quando ninguém perguntou — não
 * é para todo turno virar bibliografia.
 *
 * `autorias` (opcional): QUEM registrou o conhecimento que entrou no contexto,
 * quando a memória carrega `metadata.recorded_by` + `metadata.actor_type`. É o
 * que permite ao Bento responder "foi a Tammy?" com a verdade: pessoa nomeada
 * só quando a identidade é individual; conta compartilhada é a equipe, e
 * escolher alguém seria inventar.
 */
export function formatProvenanceBlock(mensagem: string, fontes: FonteDeContexto[], autorias: AutoriaDeRegistro[] = []): string {
  if (!pedeProveniencia(mensagem)) return '';
  if (fontes.length === 0) {
    return [
      'PROVENIÊNCIA: você NÃO recebeu nenhuma fonte estruturada neste turno.',
      'Diga isso com todas as letras em vez de citar uma fonte genérica.',
    ].join('\n');
  }
  const linhas = ['PERGUNTARAM DE ONDE VEIO A INFORMAÇÃO. As fontes deste turno, e só elas, são:'];
  for (const f of fontes) linhas.push(`- ${NOME_HUMANO[f] ?? f}`);
  const autoriasUnicas = dedupeAutorias(autorias);
  if (autoriasUnicas.length > 0) {
    linhas.push('', 'AUTORIA do que a equipe registrou nestas fontes:');
    for (const a of autoriasUnicas) linhas.push(`- ${descreverAutoria(a)}`);
    if (autoriasUnicas.some((a) => a.actorType === 'shared_account')) {
      linhas.push(
        'Conta compartilhada NÃO é uma pessoa: se perguntarem "foi a Tammy?" (ou qualquer nome),',
        'responda que não é possível atribuir — a informação veio da conta compartilhada. Não escolha ninguém.',
      );
    }
  }
  linhas.push(
    '',
    'Cite-as ao responder, em linguagem de gente. NÃO invente fonte que não está aqui,',
    'e NÃO diga "meu conhecimento interno": isso não é resposta para quem precisa conferir.',
  );
  return linhas.join('\n');
}

/**
 * Seção de fontes ANEXADA à resposta, montada a partir das evidências que de
 * fato entraram no turno.
 *
 * Por que determinística: o bloco de instrução resolve parte do problema, mas
 * medido no navegador (16/09/2026) o Bento recebeu as fontes e ainda assim
 * respondeu sem citá-las — a síntese do node prioriza o dado operacional e a
 * instrução se perde. Depender do modelo "lembrar de mencionar" a fonte é
 * depender exatamente do que falhou. Aqui a seção é escrita pelo sistema, com
 * os nomes reais, e não há como inventar rótulo de fonte.
 *
 * Só aparece quando alguém PERGUNTA. Fonte em toda resposta transformaria o
 * chat numa auditoria e treinaria a equipe a ignorar o rodapé.
 */
export function anexarFontes(resposta: string, mensagem: string, fontes: FonteDeContexto[], autorias: AutoriaDeRegistro[] = []): string {
  if (!pedeProveniencia(mensagem)) return resposta;
  if (resposta.trim().length === 0) return resposta;

  // Já citou de forma reconhecível? Não duplica a seção.
  if (/^\s*fontes? (utilizadas|consultadas)/im.test(resposta)) return resposta;

  if (fontes.length === 0) {
    return `${resposta.trimEnd()}\n\nFontes utilizadas: nenhuma fonte estruturada entrou neste turno.`;
  }
  const linhas = [...new Set(fontes.map((f) => NOME_HUMANO[f] ?? f))].map((n) => `- ${n}`);
  const autoriasUnicas = dedupeAutorias(autorias);
  const blocoAutoria = autoriasUnicas.length > 0
    ? `\nAutoria dos registros da equipe:\n${autoriasUnicas.map((a) => `- ${descreverAutoria(a)}`).join('\n')}`
    : '';
  return `${resposta.trimEnd()}\n\nFontes utilizadas:\n${linhas.join('\n')}${blocoAutoria}`;
}
