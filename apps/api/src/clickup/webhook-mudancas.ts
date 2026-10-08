/**
 * webhook-mudancas.ts — O QUE mudou na tarefa, em texto que uma pessoa lê.
 *
 * O handler já extraía QUEM mexeu e QUANDO (`webhook-actor.ts`). O que
 * continuava indo para o lixo é o resto do `history_items[0]`: `field`,
 * `before` e `after`. Medido em 02/10/2026, os 872 eventos de tarefa guardavam
 * `payload = {event, list_id, actor_resolution}` e `summary = null` — a tela
 * conseguia escrever no máximo "Atualizou uma tarefa", e a pergunta que a
 * operação faz de verdade ("o que mudou de status hoje?") era irrespondível.
 *
 * TUDO AQUI É FUNÇÃO PURA. O payload do ClickUp é irregular o bastante
 * (`before` ora é string, ora objeto, ora lista, ora null) para merecer teste
 * sem Fastify, sem banco e sem rede.
 *
 * O que NÃO está aqui, de propósito: o nome da tarefa. O webhook não manda o
 * nome em nenhum evento — nem no `taskCreated` — e inventá-lo a partir do id
 * seria falsificar. Quem chama busca o nome na API e passa adiante.
 */

export interface MudancaDeTarefa {
  /** Nome do campo como o ClickUp manda (`status`, `priority`, `due_date`...). */
  campo: string;
  /** Rótulo em português, para a frase. */
  rotulo: string;
  de: string | null;
  para: string | null;
}

/**
 * Rótulos dos campos que a operação de fato acompanha. Campo fora da lista
 * não some: cai no próprio nome normalizado — some seria pior, porque a tela
 * passaria a dizer "atualizou" sem dizer o quê.
 */
const ROTULOS: Record<string, string> = {
  status: 'status',
  name: 'nome',
  priority: 'prioridade',
  due_date: 'prazo',
  start_date: 'início',
  content: 'descrição',
  assignee_add: 'responsável',
  assignee_rem: 'responsável',
  tag: 'etiqueta',
  comment: 'comentário',
  section_moved: 'lista',
  time_estimate: 'estimativa',
};

/**
 * `before`/`after` chegam em quatro formatos diferentes no mesmo payload:
 * texto puro (nome, descrição), objeto (status, prioridade, pessoa), lista
 * (etiquetas) e epoch em string (datas). Normaliza para texto ou null —
 * e null aqui significa "não havia", que é informação, não falha.
 */
export function valorLegivel(valor: unknown, campo?: string): string | null {
  if (valor === null || valor === undefined) return null;

  if (typeof valor === 'string') {
    const limpo = valor.trim();
    if (limpo === '') return null;
    // Data vem como epoch em string. Mostrar "1759363200000" seria pior que nada.
    if ((campo === 'due_date' || campo === 'start_date') && /^\d{10,}$/.test(limpo)) {
      const d = new Date(Number(limpo));
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
    return limpo;
  }

  if (typeof valor === 'number') {
    if (campo === 'due_date' || campo === 'start_date') {
      const d = new Date(valor);
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
    return String(valor);
  }

  if (Array.isArray(valor)) {
    const partes = valor.map((v) => valorLegivel(v, campo)).filter((v): v is string => v !== null);
    return partes.length > 0 ? partes.join(', ') : null;
  }

  if (typeof valor === 'object') {
    const o = valor as Record<string, unknown>;
    // A ordem importa: `status` antes de `name` porque o objeto de status do
    // ClickUp às vezes traz os dois, e o que a pessoa quer ler é o status.
    for (const chave of ['status', 'priority', 'username', 'name', 'email', 'label']) {
      const v = o[chave];
      if (typeof v === 'string' && v.trim() !== '') return v.trim();
    }
    return null;
  }

  return null;
}

/**
 * Lê todos os `history_items` (o ClickUp normalmente manda um, mas uma edição
 * em lote manda vários no mesmo corpo — ler só o primeiro, como o extrator de
 * autor faz por não precisar de mais, perderia a mudança de status quando ela
 * vem acompanhada de outra).
 */
export function extrairMudancas(raw: Record<string, unknown> | undefined): MudancaDeTarefa[] {
  if (!raw) return [];
  const items = raw['history_items'];
  if (!Array.isArray(items)) return [];

  const mudancas: MudancaDeTarefa[] = [];
  for (const bruto of items) {
    if (!bruto || typeof bruto !== 'object') continue;
    const item = bruto as Record<string, unknown>;
    const campo = item['field'];
    if (typeof campo !== 'string' || campo.trim() === '') continue;

    const de = valorLegivel(item['before'], campo);
    const para = valorLegivel(item['after'], campo);
    // Item sem antes e sem depois não diz nada — guardá-lo encheria o payload
    // de ruído e faria a tela escrever "alterou o status" sem o status.
    if (de === null && para === null) continue;

    mudancas.push({ campo, rotulo: ROTULOS[campo] ?? campo.replace(/_/g, ' '), de, para });
  }
  return mudancas;
}

/** A mudança de status é a que a operação pergunta. Vem primeiro na frase. */
export function mudancaDeStatus(mudancas: readonly MudancaDeTarefa[]): MudancaDeTarefa | null {
  return mudancas.find((m) => m.campo === 'status') ?? null;
}

/**
 * A FRASE. Sem o nome de quem fez: a tela já mostra o ator numa coluna
 * própria, e repeti-lo aqui produziria "Tammy · Tammy moveu...".
 *
 * Quando o nome da tarefa não veio (busca na API falhou, tarefa apagada), a
 * frase diz "uma tarefa" em vez de inventar. Pior que uma frase curta é uma
 * frase confiante e errada.
 */
export function frasearEventoDeTarefa(params: {
  evento: 'taskCreated' | 'taskUpdated' | 'taskDeleted' | string;
  nomeDaTarefa: string | null;
  mudancas: readonly MudancaDeTarefa[];
}): string {
  const nome = params.nomeDaTarefa?.trim() || null;
  const alvo = nome ? `"${nome}"` : 'uma tarefa';

  // Com nome: "a tarefa X". Sem nome: só "uma tarefa" — "a tarefa uma tarefa"
  // é o tipo de frase que um template monta e ninguém lê antes de subir.
  if (params.evento === 'taskCreated') return nome ? `Criou a tarefa ${alvo}` : 'Criou uma tarefa';
  if (params.evento === 'taskDeleted') return nome ? `Apagou a tarefa ${alvo}` : 'Apagou uma tarefa';

  const status = mudancaDeStatus(params.mudancas);
  if (status && status.para) {
    return status.de
      ? `Moveu ${alvo} de ${status.de} para ${status.para}`
      : `Colocou ${alvo} em ${status.para}`;
  }

  const outras = params.mudancas.filter((m) => m.campo !== 'status');
  if (outras.length === 1) return `Mudou ${outras[0]!.rotulo} de ${alvo}`;
  if (outras.length > 1) {
    const rotulos = [...new Set(outras.map((m) => m.rotulo))];
    return `Mudou ${rotulos.slice(0, 3).join(', ')} de ${alvo}`;
  }

  return `Atualizou ${alvo}`;
}
