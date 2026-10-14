/**
 * collaborator-fact.ts — o que a equipe ensina sobre AS PESSOAS da equipe.
 * Bento 3.1, P1, 14/10/2026.
 *
 * O "anota" só gravava com cliente resolvido (client-fact.ts): "anota que a
 * Ana cuida dos carrosséis" ou "quando eu receber um briefing de Reels,
 * preciso de objetivo, público, referências e CTA" eram descartados. Este
 * módulo grava, na MESMA infraestrutura (`memories` via rememberFact), com a
 * procedência que a missão exige separar:
 *
 *   CONFIRMED_PREFERENCE  a própria pessoa disse, sobre si mesma.
 *   FACT                  responsabilidade registrada pela gestão (owner/admin).
 *   INFERENCE             dito por outra pessoa, ou autodeclaração de
 *                         responsabilidade — vale como pista, não como verdade.
 *
 * O que NÃO faz, de propósito:
 * - não deixa um colega reescrever o perfil de outro: o que um terceiro diz
 *   vai para um registro próprio (`...:por:<quem disse>`), que nunca substitui
 *   o que a pessoa confirmou;
 * - não vira regra da agência: o fato é preso à pessoa (`userId`) e à empresa;
 * - não infere traço pessoal: só grava o que foi dito, e só sobre trabalho
 *   (briefing, responsabilidade, revisão, fluxo).
 *
 * Determinístico. Nenhum modelo de linguagem decide o que é fato de quem.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { rememberFact, type RememberOutcome } from '@desigual-os/orchestrator';
import type { Logger } from '@desigual-os/logging';

export const KIND_COLABORADOR = 'collaborator.profile';

/** Padrão desligado: gravar e mostrar o perfil de colaborador são ligados juntos. */
export function contextoDeColaboradorLigado(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['true', '1', 'on'].includes((env.BENTO_COLLABORATOR_CONTEXT ?? '').trim().toLowerCase());
}

export type ClasseDoFato = 'CONFIRMED_PREFERENCE' | 'FACT' | 'INFERENCE';
export type AspectoDoColaborador = 'briefing' | 'responsabilidade' | 'revisao' | 'fluxo' | 'preferencia';

export interface MembroDaEquipe {
  userId: string;
  nome: string;
  gestor: boolean;
}

export interface FatoDeColaborador {
  alvo: MembroDaEquipe;
  aspecto: AspectoDoColaborador;
  classe: ClasseDoFato;
  /** O que foi dito, já sem o verbo de registro. */
  texto: string;
  /** Assunto da memória: decide o que substitui o quê. */
  subject: string;
}

const PERGUNTA = /\?\s*$|^\s*(o que|qual|quais|quem|quando foi|onde|como|por que|porque|quanto)\b/i;
const PEDIDO = /\b(crie|cria|criar|escrev[ae]|mont[ae]|list[ae]|faz|faça|gera|gere|lança|lance|atribu[ai]|marca|muda|troca|me (d[êe]|manda|mostra))\b/i;
const VERBO_DE_REGISTRO = /\b(anot[ae]|registr[ae]|guard[ae]|lembr[ae]|para constar|corrij[ae]|corrige|atualiz[ae])\b/i;
/** Primeira pessoa falando de como gosta de trabalhar: vale sem "anota". */
const PREFERENCIA_PROPRIA = /\b(quando eu|eu prefiro|prefiro (receber|que)|pra mim|para mim|eu preciso|eu gosto de receber|comigo)\b/i;
const PRIMEIRA_PESSOA = /\b(eu|mim|me|comigo|meu|minha|meus|minhas)\b/i;

const ASPECTOS: Array<{ aspecto: AspectoDoColaborador; re: RegExp }> = [
  { aspecto: 'responsabilidade', re: /\b(respons[áa]vel|cuida d|toca |é quem (faz|cuida)|fica com|dono d|dona d)/i },
  { aspecto: 'briefing', re: /\bbrief(ing)?s?\b/i },
  { aspecto: 'revisao', re: /\b(revis|aprova|feedback)/i },
  { aspecto: 'fluxo', re: /\b(fluxo|processo|prazo|entrega|hor[áa]rio|avis[oa])/i },
];

function dobrar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** A pessoa da equipe citada pelo nome (primeiro nome ou completo), sem empate. */
export function pessoaCitada(texto: string, equipe: MembroDaEquipe[], falanteId: string): MembroDaEquipe | null {
  const t = ` ${dobrar(texto).replace(/[^a-z0-9 ]/g, ' ')} `;
  const casam = equipe.filter((m) => {
    if (m.userId === falanteId) return false;
    const completo = dobrar(m.nome).trim();
    const primeiro = completo.split(/\s+/)[0] ?? '';
    return (completo.length > 2 && t.includes(` ${completo} `)) || (primeiro.length > 2 && t.includes(` ${primeiro} `));
  });
  return casam.length === 1 ? casam[0]! : null;
}

function limpar(texto: string): string {
  return texto
    .replace(/^\s*bento[,:]?\s*/i, '')
    .replace(VERBO_DE_REGISTRO, '')
    .replace(/^\s*(a[ií]|que|pra mim que)\s+/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,;:\-\s]+/, '')
    .replace(/[.\s]+$/, '')
    .trim();
}

/**
 * Puro: decide SE o turno ensina algo sobre uma pessoa da equipe, sobre quem,
 * e com que procedência. `null` = não é fato de colaborador (segue o fluxo).
 */
export function extrairFatoDeColaborador(
  mensagem: string,
  falante: MembroDaEquipe,
  equipe: MembroDaEquipe[],
): FatoDeColaborador | null {
  const texto = mensagem.trim();
  if (texto.length < 12 || texto.length > 500) return null;
  if (PERGUNTA.test(texto) || PEDIDO.test(texto)) return null;

  const registro = VERBO_DE_REGISTRO.test(texto);
  const outro = pessoaCitada(texto, equipe, falante.userId);
  const propria = !outro && (PREFERENCIA_PROPRIA.test(texto) || (registro && PRIMEIRA_PESSOA.test(texto)));
  if (!outro && !propria) return null;
  // Sobre outra pessoa, só com verbo de registro: contar de passagem não é
  // pedir para gravar (a mesma regra do fato de cliente, CLAUDE.md).
  if (outro && !registro) return null;

  const aspecto = ASPECTOS.find((a) => a.re.test(texto))?.aspecto ?? 'preferencia';
  // Fora do trabalho não grava: sem aspecto de trabalho e sem "prefer/precis",
  // é conversa, não perfil operacional.
  if (aspecto === 'preferencia' && !/\b(prefer|precis|gost[ao] de receber|quer receber|me mand)/i.test(texto)) return null;

  const alvo = outro ?? falante;
  let classe: ClasseDoFato;
  let subject = `colaborador:${alvo.userId}:${aspecto}`;
  if (!outro) {
    classe = aspecto === 'responsabilidade' ? 'INFERENCE' : 'CONFIRMED_PREFERENCE';
    if (classe === 'INFERENCE') subject += `:por:${falante.userId}`;
  } else if (falante.gestor && aspecto === 'responsabilidade') {
    classe = 'FACT';
  } else {
    classe = 'INFERENCE';
    subject += `:por:${falante.userId}`;
  }

  const conteudo = limpar(texto);
  if (conteudo.length < 8) return null;
  return { alvo, aspecto, classe, texto: conteudo, subject };
}

export async function equipeDaEmpresa(organizationId: string): Promise<MembroDaEquipe[]> {
  const linhas = await db
    .select({ userId: schema.users.id, nome: schema.users.name, role: schema.organizationMembers.role })
    .from(schema.organizationMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
    .where(and(eq(schema.organizationMembers.organizationId, organizationId), eq(schema.users.active, true), isNull(schema.users.deletedAt)));
  return linhas.map((l) => ({ userId: l.userId, nome: l.nome, gestor: l.role === 'owner' || l.role === 'admin' }));
}

const CONFIANCA: Record<ClasseDoFato, number> = { CONFIRMED_PREFERENCE: 0.95, FACT: 0.9, INFERENCE: 0.5 };

export interface FatoGravado {
  fato: FatoDeColaborador;
  outcome: RememberOutcome;
}

/** Grava, se o turno ensinar algo sobre alguém da equipe. Nunca lança. */
export async function captureCollaboratorFact(
  mensagem: string,
  ctx: { userId: string | null; organizationId: string | null; executionId: string; environment?: string },
  logger: Logger,
): Promise<FatoGravado | null> {
  if (!ctx.userId || !ctx.organizationId || !contextoDeColaboradorLigado()) return null;
  try {
    const equipe = await equipeDaEmpresa(ctx.organizationId);
    const falante = equipe.find((m) => m.userId === ctx.userId);
    // Quem não é da empresa não ensina nada sobre a equipe dela.
    if (!falante) return null;
    const fato = extrairFatoDeColaborador(mensagem, falante, equipe);
    if (!fato) return null;
    const outcome = await rememberFact({
      kind: KIND_COLABORADOR,
      content: `${fato.alvo.nome} — ${fato.texto}`,
      subject: fato.subject,
      userId: fato.alvo.userId,
      clientId: null,
      organizationId: ctx.organizationId,
      sourceType: 'chat_message',
      sourceId: ctx.executionId,
      confidence: CONFIANCA[fato.classe],
      importance: 0.7,
      environment: ctx.environment ?? 'production',
      metadata: {
        subject: fato.subject,
        classe: fato.classe,
        aspecto: fato.aspecto,
        informado_por: falante.userId,
        informado_por_nome: falante.nome,
        source_text: mensagem.slice(0, 300),
      },
    });
    logger.info({ subject: fato.subject, classe: fato.classe, status: outcome.status }, '[colaborador] fato registrado');
    return outcome.status === 'skipped' ? null : { fato, outcome };
  } catch (error) {
    logger.warn({ err: String(error) }, '[colaborador] falha ao registrar; turno segue');
    return null;
  }
}

/** A resposta que confirma o registro, dizendo a procedência — nunca prometendo o que não gravou. */
export function respostaDoRegistro(f: FatoDeColaborador, falanteId: string): string {
  const sobre = f.alvo.userId === falanteId ? 'Anotado como preferência sua' : `Anotado sobre ${f.alvo.nome}`;
  const procedencia =
    f.classe === 'CONFIRMED_PREFERENCE'
      ? 'Passo a considerar isso quando preparar trabalho para você.'
      : f.classe === 'FACT'
        ? 'Registrado como responsabilidade, informado pela gestão.'
        : f.alvo.userId === falanteId
          ? 'Fica como autodeclaração até a gestão confirmar.'
          : `Fica como informação sua, ainda sem confirmação de ${f.alvo.nome.split(' ')[0]}: não substitui o que ${f.alvo.nome.split(' ')[0]} disser sobre o próprio trabalho.`;
  return `${sobre}: ${f.texto}.\n${procedencia}\nSe entendi errado, me corrige que eu atualizo.`;
}
