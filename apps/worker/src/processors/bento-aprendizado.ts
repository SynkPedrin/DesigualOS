/**
 * bento-aprendizado.ts — a correção vira regra, e a regra vale na próxima.
 *
 * Pedido da operação (29/09/2026), e o ponto mais importante dele: "ela fala
 * 'esse briefing ficou ruim, para social sempre coloque contexto, objetivo,
 * formato, referências, CTA e entregável'. O sistema não deveria responder
 * 'entendido'. A correção precisa virar conhecimento operacional."
 *
 * A diferença entre isto e "ter memória" é que memória guarda o que foi DITO;
 * isto guarda o que muda o que o sistema FAZ. A regra entra na montagem do
 * próximo briefing daquele tipo, sem ninguém repetir nada.
 *
 * Três decisões que sustentam o arquivo:
 *
 * 1. ESCOPO EXPLÍCITO. "para tarefas de social" vale pra social de todo
 *    cliente; "nos briefings da D. Carvalho" vale só pra ela. Sem escopo dito,
 *    a regra nasce do cliente do turno — o caso estreito é o seguro, porque
 *    uma regra global errada contamina a agência inteira.
 *
 * 2. SÓ CORREÇÃO EXPLÍCITA VIRA REGRA. "não gostei" sozinho é insatisfação,
 *    não instrução: sem o que fazer diferente, não há o que registrar. Gravar
 *    a insatisfação como regra encheria o sistema de ruído com cara de
 *    aprendizado.
 *
 * 3. A REGRA É DECLARADA NA RESPOSTA. "Aprendizado registrado: briefing de
 *    social → ..." — porque aprendizado que a pessoa não vê é indistinguível
 *    de "entendido", e foi exatamente isso que a operação reclamou.
 */

import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { organizacaoDaEscrita } from '@desigual-os/auth';
import type { Logger } from '@desigual-os/logging';
import type { DeliveryType } from './briefing-schema';

export const KIND_REGRA = 'briefing.rule';

/** Tipo de entrega dito em português no pedido de correção. */
const TIPOS: Array<{ tipo: DeliveryType; re: RegExp }> = [
  { tipo: 'social_content', re: /\b(social|feed|post|carross[eé]l|carrossel|stories|instagram)\b/i },
  { tipo: 'video', re: /\b(v[ií]deo|reels?|motion|edi[çc][ãa]o)\b/i },
  { tipo: 'landing_page', re: /\b(landing ?page|lp|site)\b/i },
  { tipo: 'campaign', re: /\b(campanha|m[ií]dia paga|tr[áa]fego|an[úu]ncios?|ads)\b/i },
];

/**
 * CRÍTICA ao que saiu. Sozinha não vira regra — é o sinal de que o turno é
 * sobre qualidade, não um pedido novo.
 */
const CRITICA_RE =
  /\b(ficou ruim|n[ãa]o gostei|ruim|fraco|gen[ée]rico|porco|p[ée]ssimo|refaz|refa[çc]a|melhora|est[áa] raso|faltou)\b/i;

/**
 * INSTRUÇÃO: o que fazer diferente daqui pra frente. É isto que transforma
 * reclamação em regra — sem o "sempre/nunca/deveria", não há o que aplicar.
 */
const INSTRUCAO_RE =
  /\b(sempre|nunca|de agora em diante|daqui pra frente|a partir de agora|deveria|tem que|precisa (ter|conter|incluir)|coloca|coloque|inclui|inclua|acrescent\w+|use|usa|evite|evita)\b/i;

/** "para tarefas de social", "nos briefings de vídeo" — escopo por TIPO. */
const ESCOPO_TIPO_RE = /\b(para|pra|nos?|nas?|em)\s+(tarefas?|briefings?|pe[çc]as?|demandas?)\s+d[eo]s?\s+(.{3,30}?)\b/i;

/**
 * O ASPECTO da regra: qual parte do trabalho ela governa.
 *
 * Existe por um pedido explícito da operação (29/09/2026): "o Bento precisa
 * saber quando uma regra deve substituir outra, não só acumular instruções".
 *
 * Sem isso, corrigir duas vezes o mesmo ponto deixava as DUAS no prompt. Se a
 * pessoa disse "sempre 5 linhas" e depois "na verdade sempre 3 linhas", o
 * briefing seguinte recebia as duas ordens e obedecia a sorte — e o pior é que
 * a mais nova, que é a que ela quis, podia perder pro teto de 6 regras.
 *
 * A política é a MESMA que o memory-engine já aplica a fato de cliente, e está
 * escrita no CLAUDE.md: mesmo aspecto se aposenta, o último vale; aspecto
 * desconhecido acumula em vez de apagar o anterior. Acumular é o erro barato;
 * apagar a regra errada é o caro.
 */
const ASPECTOS: Array<{ aspecto: string; re: RegExp }> = [
  { aspecto: 'estrutura', re: /\b(estrutura|se[çc][ãa]o|se[çc][õo]es|campos?|t[óo]pic|contexto.*objetivo|objetivo.*formato|conter|incluir)\b/i },
  { aspecto: 'tamanho', re: /\b(linhas?|par[áa]grafos?|caracteres?|palavras?|curto|longo|enxut|resum)\b/i },
  { aspecto: 'tom', re: /\b(tom|linguagem|voz|formal|informal|gíria|coloquial|s[ée]rio|descontra)\b/i },
  { aspecto: 'referencias', re: /\b(refer[êe]ncias?|benchmark|exemplos? de|moodboard|inspira)\b/i },
  { aspecto: 'cta', re: /\b(cta|chamada para a[çc][ãa]o|call to action)\b/i },
  { aspecto: 'publico', re: /\b(p[úu]blico|persona|audi[êe]ncia|target)\b/i },
  { aspecto: 'entregavel', re: /\b(entreg[áa]vel|formato de entrega|arquivo|dimens[õo]es|proporç)\b/i },
];

/** null = aspecto desconhecido, e regra sem aspecto ACUMULA (nunca aposenta ninguém). */
export function aspectoDaRegra(texto: string): string | null {
  return ASPECTOS.find((a) => a.re.test(texto))?.aspecto ?? null;
}

export interface RegraDetectada {
  /** O texto da regra, como a pessoa disse — nunca reescrito. */
  regra: string;
  /** null = vale pra qualquer tipo de entrega. */
  deliveryType: DeliveryType | null;
  /** true quando a pessoa disse "para tarefas de X" — escopo além deste cliente. */
  escopoDeTipoExplicito: boolean;
}

/**
 * Detecta uma correção que vira regra. Devolve null na esmagadora maioria dos
 * turnos — inclusive em elogio, em pedido novo e em reclamação sem instrução.
 */
export function detectarRegraDeBriefing(mensagem: string): RegraDetectada | null {
  const texto = mensagem.trim();
  if (texto.length < 15) return null;
  // Precisa das DUAS coisas: que o turno seja sobre qualidade, e que diga o
  // que fazer diferente. Uma sem a outra não é regra.
  if (!CRITICA_RE.test(texto) || !INSTRUCAO_RE.test(texto)) return null;
  // Pedido de escrita não é correção: "cria a task e sempre coloca o prazo"
  // está mandando fazer, não ensinando.
  if (/\b(cria|crie|criar|lan[çc]a|lance|abre|abra)\b/i.test(texto) && !/\bbriefing\b/i.test(texto)) return null;

  const escopo = ESCOPO_TIPO_RE.exec(texto);
  const alvoDoEscopo = escopo?.[3] ?? '';
  const porEscopo = TIPOS.find((t) => t.re.test(alvoDoEscopo));
  const porTexto = TIPOS.find((t) => t.re.test(texto));

  return {
    regra: texto.slice(0, 600),
    deliveryType: porEscopo?.tipo ?? porTexto?.tipo ?? null,
    escopoDeTipoExplicito: Boolean(porEscopo),
  };
}

export interface RegraGravada {
  id: string;
  regra: string;
  deliveryType: DeliveryType | null;
  /** null = vale pra toda a agência. */
  clientId: string | null;
}

/**
 * Grava a regra. O escopo é o mais ESTREITO que o pedido sustenta: sem a
 * pessoa dizer "para tarefas de X", a regra fica presa ao cliente do turno —
 * uma regra global errada contamina a agência inteira, e desfazer isso depois
 * é muito mais caro que pedir de novo.
 */
export async function registrarRegra(params: {
  deteccao: RegraDetectada;
  clientId: string | null;
  userId: string | null;
  logger: Logger;
}): Promise<RegraGravada | null> {
  const global = params.deteccao.escopoDeTipoExplicito;
  const clientId = global ? null : params.clientId;
  const aspecto = aspectoDaRegra(params.deteccao.regra);
  try {
    /**
     * A regra nova aposenta a anterior do MESMO aspecto, mesmo escopo e mesmo
     * tipo de entrega. Aspecto desconhecido não aposenta ninguém: acumular é o
     * erro barato, apagar a regra certa é o caro.
     */
    if (aspecto) {
      const aposentadas = await db
        .update(schema.memories)
        .set({ status: 'superseded' })
        .where(
          and(
            eq(schema.memories.kind, KIND_REGRA),
            eq(schema.memories.status, 'active'),
            clientId ? eq(schema.memories.clientId, clientId) : isNull(schema.memories.clientId),
            sql`${schema.memories.metadata}->>'aspecto' = ${aspecto}`,
            sql`${schema.memories.metadata}->>'deliveryType' IS NOT DISTINCT FROM ${params.deteccao.deliveryType}`,
          ),
        )
        .returning({ id: schema.memories.id });
      if (aposentadas.length > 0) {
        params.logger.info(
          { aspecto, aposentadas: aposentadas.length },
          '[bento-aprendizado] regra nova aposentou a anterior do mesmo aspecto',
        );
      }
    }
    const organizationId = await organizacaoDaEscrita({ userId: params.userId, clientId });

    const [linha] = await db
      .insert(schema.memories)
      .values({
        organizationId,
        kind: KIND_REGRA,
        content: params.deteccao.regra,
        clientId,
        userId: params.userId,
        sourceType: 'chat_message',
        confidence: '0.950',
        importance: '0.900',
        status: 'active',
        metadata: {
          deliveryType: params.deteccao.deliveryType,
          escopo: clientId ? 'cliente' : 'agencia',
          aspecto,
        },
      })
      .returning({ id: schema.memories.id });
    if (!linha) return null;
    params.logger.info(
      { regra: params.deteccao.regra.slice(0, 80), deliveryType: params.deteccao.deliveryType, escopo: clientId ? 'cliente' : 'agencia' },
      '[bento-aprendizado] correção virou regra de briefing',
    );
    return { id: linha.id, regra: params.deteccao.regra, deliveryType: params.deteccao.deliveryType, clientId };
  } catch (error) {
    params.logger.warn({ error }, '[bento-aprendizado] não consegui gravar a regra');
    return null;
  }
}

/**
 * As regras que valem para ESTE briefing: as da agência mais as deste cliente,
 * filtradas pelo tipo de entrega. Regra sem tipo vale para todos.
 *
 * Mais nova primeiro: se a pessoa corrigiu duas vezes, a última é a que ela
 * quis. Teto baixo de propósito — vinte regras num prompt deixam de ser regra
 * e viram ruído.
 */
export async function regrasAplicaveis(params: {
  clientId: string | null;
  deliveryType: DeliveryType;
  logger: Logger;
}): Promise<string[]> {
  try {
    const linhas = await db
      .select({ content: schema.memories.content, metadata: schema.memories.metadata })
      .from(schema.memories)
      .where(
        and(
          eq(schema.memories.kind, KIND_REGRA),
          eq(schema.memories.status, 'active'),
          params.clientId
            ? or(isNull(schema.memories.clientId), eq(schema.memories.clientId, params.clientId))
            : isNull(schema.memories.clientId),
        ),
      )
      .orderBy(desc(schema.memories.createdAt))
      .limit(40);

    return linhas
      .filter((l) => {
        const tipo = (l.metadata as { deliveryType?: unknown } | null)?.deliveryType;
        return !tipo || tipo === params.deliveryType;
      })
      .map((l) => l.content)
      .slice(0, 6);
  } catch (error) {
    params.logger.warn({ error }, '[bento-aprendizado] não consegui ler as regras');
    return [];
  }
}

/** O bloco que entra na montagem do briefing. */
export function regrasEmTexto(regras: string[]): string | null {
  if (regras.length === 0) return null;
  return [
    'REGRAS QUE A OPERAÇÃO JÁ CORRIGIU (valem para este briefing, sem exceção):',
    ...regras.map((r) => `- ${r}`),
    'Estas regras vieram de correção humana. Se alguma exigir informação que você não tem, declare a lacuna — não ignore a regra.',
  ].join('\n');
}

/** A confirmação que a pessoa lê: aprendizado invisível é indistinguível de "entendido". */
export function confirmacaoDeAprendizado(r: RegraGravada, clientName: string | null): string {
  const onde = r.clientId ? `briefings ${clientName ? `da ${clientName}` : 'deste cliente'}` : 'briefings da agência';
  const tipo = r.deliveryType ? ` de ${r.deliveryType === 'social_content' ? 'social' : r.deliveryType}` : '';
  return `📌 **Aprendizado registrado** — ${onde}${tipo}: ${r.regra}\n\nVale a partir da próxima demanda desse tipo, sem você precisar repetir.`;
}
