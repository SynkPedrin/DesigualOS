/**
 * apresentacao/conhecimento.ts — a camada que faz o produto parar de falar como banco.
 *
 * REGRA DO ARQUIVO: nada aqui muda o modelo interno. `agent.episode`,
 * `client.profile` e `mcp.user_private` continuam existindo com esses nomes no
 * banco, no retrieval e no Brain. O que muda é o que a pessoa lê.
 *
 * ---
 *
 * OS TIPOS SÃO OS QUE EXISTEM, levantados do banco em 02/10/2026 — não os que
 * eu imaginaria:
 *
 *   agent.episode                238   registro de um turno de agente
 *   client.profile               124   dossiê/brain/aprendizado do cliente
 *   clickup.mention_answered      43
 *   studio.asset_created          39
 *   mcp.agency                    18
 *   daily_checklist               17
 *   mcp.user_private              16
 *   otto.creative_plan_created    11
 *   otto.studio_handoff           10
 *   otto.approval_reason           1
 *   briefing.rule                  1
 *   otto.feedback                  1
 *
 * ---
 *
 * NADA DE MAPEAMENTO CEGO, e o `agent.episode` é a razão de a regra existir.
 *
 * Seriam 238 itens virando "Aprendizado" de uma vez — e eles não são
 * aprendizado. Conferido: o `subject` deles tem a forma
 * `episode:<agente>:<objetivo>: <pergunta do usuário>`, e o conteúdo é o relato
 * de um turno ("Objetivo: analisar performance..."). É registro de TRABALHO. Se
 * entrassem como conhecimento, a tela de Conhecimento viraria um log de
 * conversas — 238 itens afogando os 96 dossiês curados que são o valor real.
 *
 * E `client.profile` é o oposto: 124 itens que parecem um tipo só e são três,
 * distinguidos pelo `subject` — brain (51), dossiê (45), aprendizado (2). O
 * aprendizado ainda tem `aspect`, e é ele que diz se o fato é sobre uma pessoa,
 * uma preferência ou um processo.
 */

/** As categorias que uma pessoa entende. Não há "memória" nem "episódio" aqui. */
export type CategoriaDeConhecimento =
  | 'Preferências'
  | 'Aprendizados'
  | 'Pessoas'
  | 'Processos'
  | 'Contexto'
  | 'Decisões'
  | 'Feedbacks'
  | 'Atividade registrada';

export interface ItemBruto {
  kind: string;
  content?: string | null;
  metadata?: unknown;
  sourceType?: string | null;
}

export interface ConhecimentoApresentado {
  categoria: CategoriaDeConhecimento;
  /** De onde veio, em português: Claude, ClickUp, Bento, Sistema. */
  origem: string;
  /**
   * Deve aparecer na tela comercial? `false` para o que é registro de trabalho
   * e para o que é privado de uma pessoa — nos dois casos mostrar seria errado
   * por motivos diferentes.
   */
  visivelNoProduto: boolean;
  /** Por que não aparece, quando não aparece. Para diagnóstico, não para a tela. */
  motivoOculto: string | null;
}

/**
 * ASPECTO -> CATEGORIA, para o conhecimento que a equipe ensina no chat.
 *
 * Os aspectos são os que o extrator produz (ver `client-knowledge-extraction`
 * no orchestrator): decisor, contato, publico, ramo, produto, praca,
 * concorrente, canal, restricao, posicionamento, contrato.
 */
const CATEGORIA_POR_ASPECTO: Record<string, CategoriaDeConhecimento> = {
  decisor: 'Pessoas',
  contato: 'Pessoas',
  restricao: 'Preferências',
  canal: 'Preferências',
  posicionamento: 'Contexto',
  publico: 'Contexto',
  ramo: 'Contexto',
  produto: 'Contexto',
  praca: 'Contexto',
  concorrente: 'Contexto',
  contrato: 'Processos',
};

/** Fonte técnica -> nome que a pessoa reconhece. */
const ORIGEM_HUMANA: Record<string, string> = {
  claude: 'Claude',
  claude_mcp: 'Claude',
  mcp: 'Claude',
  clickup: 'ClickUp',
  clickup_webhook: 'ClickUp',
  chat_message: 'Bento',
  chat: 'Bento',
  agent: 'Bento',
  vault: 'Sistema',
  manual: 'Sistema',
};

export function origemHumana(sourceType: string | null | undefined): string {
  if (!sourceType) return 'Sistema';
  return ORIGEM_HUMANA[sourceType.toLowerCase()] ?? 'Sistema';
}

function subjectDe(metadata: unknown): string {
  const s = (metadata as { subject?: unknown } | null)?.subject;
  return typeof s === 'string' ? s : '';
}

function aspectoDe(metadata: unknown): string {
  const a = (metadata as { aspect?: unknown } | null)?.aspect;
  return typeof a === 'string' ? a.toLowerCase() : '';
}

export function apresentarConhecimento(item: ItemBruto): ConhecimentoApresentado {
  const origem = origemHumana(item.sourceType);
  const base = { origem, visivelNoProduto: true, motivoOculto: null as string | null };

  switch (item.kind) {
    /**
     * O DOSSIÊ E O BRAIN são o conhecimento curado do cliente — quem ele é,
     * como se posiciona, o que não pode. É "Contexto" porque é o pano de
     * fundo que vale para tudo, não um fato isolado.
     */
    case 'client.profile': {
      const subject = subjectDe(item.metadata);
      if (/aprendizado/.test(subject)) {
        const aspecto = aspectoDe(item.metadata) || subject.split(':').pop() || '';
        return { ...base, categoria: CATEGORIA_POR_ASPECTO[aspecto] ?? 'Aprendizados' };
      }
      return { ...base, categoria: 'Contexto' };
    }

    /**
     * REGISTRO DE TURNO, não conhecimento. São 238 — a maioria da tabela — e
     * deixá-los entrar transformaria a tela de Conhecimento num log de
     * conversas, afogando os 96 dossiês que são o valor de verdade.
     */
    case 'agent.episode':
      return {
        ...base,
        categoria: 'Atividade registrada',
        visivelNoProduto: false,
        motivoOculto: 'é o registro de um turno de agente, não conhecimento da empresa',
      };

    /**
     * PRIVADO DE UMA PESSOA. Já é isolado no retrieval (environment
     * USER_PRIVATE); aqui some da tela compartilhada pelo mesmo motivo.
     */
    case 'mcp.user_private':
      return {
        ...base,
        categoria: 'Contexto',
        visivelNoProduto: false,
        motivoOculto: 'anotação privada de uma pessoa, não conhecimento da empresa',
      };

    case 'mcp.agency':
    case 'briefing.rule':
      return { ...base, categoria: 'Aprendizados' };

    case 'otto.feedback':
    case 'otto.approval_reason':
      return { ...base, categoria: 'Feedbacks' };

    /**
     * ACONTECIMENTOS. Têm valor e o lugar deles é a Atividade — na tela de
     * Conhecimento seriam ruído com data.
     */
    case 'clickup.mention_answered':
    case 'studio.asset_created':
    case 'daily_checklist':
    case 'otto.creative_plan_created':
    case 'otto.studio_handoff':
      return {
        ...base,
        categoria: 'Atividade registrada',
        visivelNoProduto: false,
        motivoOculto: 'é um acontecimento; o lugar dele é a Atividade',
      };

    /**
     * TIPO QUE EU NÃO CONHEÇO ainda. Não mostra o nome técnico e não some em
     * silêncio: entra como Contexto, que é a categoria mais honesta para "é
     * conhecimento e eu não sei classificar melhor".
     */
    default:
      return { ...base, categoria: 'Contexto' };
  }
}

/** As categorias que de fato aparecem, para montar o filtro sem opção vazia. */
export function categoriasPresentes(itens: readonly ItemBruto[]): CategoriaDeConhecimento[] {
  const vistas = new Set<CategoriaDeConhecimento>();
  for (const i of itens) {
    const a = apresentarConhecimento(i);
    if (a.visivelNoProduto) vistas.add(a.categoria);
  }
  return [...vistas].sort();
}

/**
 * NENHUM TERMO TÉCNICO SOBREVIVE A ESTA FUNÇÃO.
 *
 * É a rede de segurança do bloco: mesmo que um tipo novo apareça amanhã e caia
 * no `default`, o rótulo que vai à tela nunca é o nome interno.
 */
export function rotuloSeguro(categoria: CategoriaDeConhecimento): string {
  return categoria;
}
