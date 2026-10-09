import { origemHumana } from './conhecimento';

/**
 * apresentacao/atividade.ts — o evento operacional vira frase.
 *
 * Mesma regra do irmão `conhecimento.ts`: nada aqui muda o modelo interno.
 * `operational_events`, `task.updated` e `actor_identity_id` continuam com
 * esses nomes no banco. O que muda é o que a pessoa lê.
 *
 * ---
 *
 * O QUE O DADO REALMENTE TEM, levantado em 02/10/2026 — e é a parte
 * desconfortável deste arquivo:
 *
 *   clickup / task.updated        541
 *   clickup / task.created        331
 *   mcp     / CONNECTION_CREATED   29
 *   chat    / CLIENT_DECISION       1
 *
 * Os 872 eventos de tarefa guardam `{event, list_id, actor_resolution}` e
 * mais nada. Medido:
 *
 *   `actor`        nulo nos 872
 *   `employee_id`  nulo nos 872
 *   `summary`      nulo nos 872
 *   `task_id`      presente em 25 de 872
 *   `actor_resolution`  'nao_resolvido' nos 25 que o têm
 *
 * EU NÃO CONSIGO MONTAR o card que o produto quer:
 *
 *     Tammy · ClickUp
 *     Atualizou "Campanha Outubro"
 *     Em produção → Em aprovação
 *
 * Nome da tarefa, status anterior, status novo e pessoa NUNCA foram gravados.
 * Uma camada de apresentação traduz o que existe; ela não inventa o que o
 * webhook não guardou. Fabricar "Tammy" aqui seria a mesma falsificação de
 * autoria que o bloco de identidade gastou um dia inteiro para impedir.
 *
 * Então o mapper abaixo diz o que é verdade — e `dadoInsuficiente` marca os
 * eventos onde a frase sai pobre POR FALTA DE DADO, não por falta de
 * tradução. É esse campo que diz onde o conserto é no webhook, não aqui.
 */

export type CategoriaDeAtividade = 'tarefa' | 'conhecimento' | 'decisao' | 'integracao' | 'sistema';

export type TipoDeAtor = 'person' | 'shared_account' | 'service' | 'system';

export interface EventoBruto {
  id?: string;
  source?: string | null;
  type?: string | null;
  summary?: string | null;
  actor?: string | null;
  clientName?: string | null;
  occurredAt?: string | Date | null;
  payload?: unknown;
  /** Identidade operacional, quando o evento veio por conexão do Claude. */
  actorIdentityName?: string | null;
  actorType?: TipoDeAtor | null;
}

export interface AtividadeApresentada {
  categoria: CategoriaDeAtividade;
  /** A linha principal: "Atualizou uma tarefa". */
  titulo: string;
  /** O detalhe, quando existe. Nunca JSON. */
  descricao: string | null;
  ator: { rotulo: string; tipo: TipoDeAtor };
  origem: string;
  cliente: string | null;
  /** Entra na timeline principal? Ruído de integração fica fora por padrão. */
  visivelNaTimeline: boolean;
  /**
   * A frase saiu pobre porque o DADO é pobre, não porque a tradução falhou.
   * É o marcador que aponta o conserto para o webhook em vez de para esta
   * camada — sem ele, alguém passaria meses melhorando texto aqui.
   */
  dadoInsuficiente: boolean;
}

/**
 * O ATOR, e a regra de autoria é a mesma do resto do sistema.
 *
 * Conta compartilhada mostra a EQUIPE, nunca um membro. Um membro só não muda
 * nada: hoje é o Sain, amanhã são três, e o histórico já teria nome gravado.
 */
function resolverAtor(e: EventoBruto): { rotulo: string; tipo: TipoDeAtor } {
  if (e.actorIdentityName) {
    return { rotulo: e.actorIdentityName, tipo: e.actorType ?? 'shared_account' };
  }
  if (e.actor && e.actor.trim().length > 0) {
    return { rotulo: e.actor.trim(), tipo: 'person' };
  }
  /**
   * SEM ATOR É O CASO COMUM, não a exceção: 872 de 902 eventos não têm. A
   * ferramenta vira o ator, que é honesto — "o ClickUp registrou isto" é
   * verdade; "Tammy fez isto" seria invenção.
   */
  return { rotulo: origemHumana(e.source), tipo: 'system' };
}

/** Nome de lista do ClickUp, quando o payload traz. Nunca o id cru na tela. */
function temListaSemNome(payload: unknown): boolean {
  const p = payload as { list_id?: unknown } | null;
  return typeof p?.list_id === 'string';
}

interface MudancaNoPayload {
  campo?: unknown;
  rotulo?: unknown;
  de?: unknown;
  para?: unknown;
}

/**
 * O QUE O WEBHOOK PASSOU A GRAVAR em 02/10/2026: `task_name` e `changes`.
 *
 * Os 872 eventos antigos não têm nenhum dos dois e continuam sem ter — não há
 * de onde tirá-los depois do fato. Por isso esta função devolve `null` em vez
 * de adivinhar, e o chamador cai na frase curta de sempre, marcada como
 * `dadoInsuficiente`. A tela fica, literalmente, dividida em antes e depois
 * da correção, que é a verdade.
 */
function detalheDaTarefa(payload: unknown): { nome: string | null; mudancas: MudancaNoPayload[] } | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as { task_name?: unknown; changes?: unknown };
  const nome = typeof p.task_name === 'string' && p.task_name.trim() !== '' ? p.task_name.trim() : null;
  const mudancas = Array.isArray(p.changes) ? (p.changes as MudancaNoPayload[]) : [];
  if (nome === null && mudancas.length === 0) return null;
  return { nome, mudancas };
}

/** "status: Em produção → Em aprovação, prazo → 2026-10-10" */
function descreverMudancas(mudancas: readonly MudancaNoPayload[]): string | null {
  const partes = mudancas
    .map((m) => {
      const rotulo = typeof m.rotulo === 'string' ? m.rotulo : typeof m.campo === 'string' ? m.campo : null;
      if (!rotulo) return null;
      const de = typeof m.de === 'string' ? m.de : null;
      const para = typeof m.para === 'string' ? m.para : null;
      if (de && para) return `${rotulo}: ${de} → ${para}`;
      if (para) return `${rotulo} → ${para}`;
      if (de) return `${rotulo}: ${de} (removido)`;
      return null;
    })
    .filter((p): p is string => p !== null);
  return partes.length > 0 ? partes.join(' · ') : null;
}

export function apresentarAtividade(e: EventoBruto): AtividadeApresentada {
  const ator = resolverAtor(e);
  const origem = origemHumana(e.source);
  const cliente = e.clientName?.trim() || null;
  const base = { ator, origem, cliente, visivelNaTimeline: true, dadoInsuficiente: false };

  switch (e.type) {
    /**
     * OS DOIS MAIORES, e os mais pobres. Sem nome e sem mudança registrada, a
     * frase honesta é curta. Marcados como `dadoInsuficiente` para que a
     * lacuna apareça no relatório em vez de virar texto bonito e vazio.
     */
    case 'task.created':
    case 'task.updated':
    case 'task.deleted': {
      const detalhe = detalheDaTarefa(e.payload);
      if (!detalhe) {
        // Evento gravado antes de 02/10/2026: nome e mudanças nunca existiram.
        return {
          ...base,
          categoria: 'tarefa',
          titulo: e.type === 'task.created' ? 'Criou uma tarefa' : 'Atualizou uma tarefa',
          descricao: temListaSemNome(e.payload) ? null : null,
          dadoInsuficiente: true,
        };
      }
      return {
        ...base,
        categoria: 'tarefa',
        // O webhook já escreveu a frase; a tela não a recalcula. Se ela vier
        // vazia (caso que não deveria existir), a frase curta ainda cobre.
        titulo: e.summary?.trim() || (e.type === 'task.created' ? 'Criou uma tarefa' : 'Atualizou uma tarefa'),
        descricao: descreverMudancas(detalhe.mudancas),
        dadoInsuficiente: false,
      };
    }

    /**
     * CONEXÃO é manutenção de integração, não trabalho. São 29, e numa
     * timeline de operação eles competem com o que a equipe fez. Ficam fora
     * por padrão — o `summary` já é humano ("pedro gabriel conectou o Claude
     * ao Desigual OS"), então quando alguém pedir a categoria Integrações a
     * frase já existe.
     */
    case 'CONNECTION_CREATED':
      return {
        ...base,
        categoria: 'integracao',
        titulo: e.summary?.trim() || 'Conectou o Claude ao Desigual OS',
        descricao: null,
        visivelNaTimeline: false,
      };

    case 'CLIENT_DECISION':
      return {
        ...base,
        categoria: 'decisao',
        titulo: 'Registrou uma decisão',
        descricao: e.summary?.trim() || null,
      };

    /**
     * TIPO NOVO. Não mostra o nome técnico e não some: vira frase genérica e
     * fica marcado, para o mapper evoluir com evidência em vez de palpite.
     */
    default:
      return {
        ...base,
        categoria: 'sistema',
        titulo: e.summary?.trim() || 'Registrou uma atualização operacional',
        descricao: null,
        dadoInsuficiente: true,
      };
  }
}

/** Tipos que o mapper ainda não conhece — para monitorar, não para a tela. */
export function tiposNaoMapeados(eventos: readonly EventoBruto[]): string[] {
  const CONHECIDOS = new Set([
    'task.created',
    'task.updated',
    'task.deleted',
    'CONNECTION_CREATED',
    'CLIENT_DECISION',
  ]);
  const novos = new Set<string>();
  for (const e of eventos) if (e.type && !CONHECIDOS.has(e.type)) novos.add(e.type);
  return [...novos];
}

/**
 * "Hoje", "Ontem", "30 de setembro" — nunca ISO.
 *
 * O fuso é o da operação (America/Sao_Paulo), o mesmo que o resto do produto
 * usa; sem ele, um evento das 22h de Brasília cairia no dia seguinte.
 */
const FUSO = 'America/Sao_Paulo';

export function rotuloDoDia(quando: Date, agora: Date = new Date()): string {
  const dia = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  if (dia(quando) === dia(agora)) return 'Hoje';
  const ontem = new Date(agora.getTime() - 86_400_000);
  if (dia(quando) === dia(ontem)) return 'Ontem';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: 'numeric', month: 'long' }).format(quando);
}

export function horaLocal(quando: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' }).format(quando);
}
