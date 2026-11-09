import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { createLogger } from '@desigual-os/logging';
import { getTeamMembers, type ClickUpMember } from '@desigual-os/tool-gateway';
import { tokenDoClickUpDe, tokenRecusado } from '../clickup/escrita-daily';
import type { Conversa, MensagemCompleta } from './service';

const logger = createLogger({ service: 'chat-clickup-saida' });

/**
 * O QUE SE ESCREVE NA COMUNICAÇÃO APARECE NO CHAT DO CLICKUP (03/11/2026).
 *
 * A importação (importar-clickup.ts) traz o ClickUp para cá; isto é o caminho de volta. Toda mensagem escrita aqui
 * numa conversa ligada a um canal do ClickUp é publicada lá, e a resposta em thread vai para a thread certa.
 *
 * EM NOME DE QUEM: o token OAuth de quem escreveu (Integrações), como na escrita do Daily. O ClickUp mostra o dono do
 * token como autor. Sem token (ou recusado), só canal tem saída: vai pela chave da agência, com o nome de quem
 * escreveu na frente. Conversa direta e grupo sem o token de quem escreveu ficam só aqui, porque a agência não
 * participa da conversa dos outros.
 *
 * CONVERSA QUE NASCEU AQUI: conversa direta e grupo ganham a conversa equivalente no ClickUp (o ClickUp devolve a que
 * já existe entre as mesmas pessoas). O vínculo nasce com o marco zerado: a próxima passada traz o histórico de lá
 * para cá sem notificar ninguém. Canal criado aqui (e o #Geral) não cria canal no ClickUp.
 *
 * SEM DUPLICAR NA VOLTA: cada mensagem publicada fica em `work_external_mappings` (tipo `chat_message`), e a
 * importação pula esses ids. Enquanto uma publicação está em andamento, a importação pula a conversa inteira nessa
 * passada (a mensagem existe lá antes de o vínculo estar gravado aqui); a próxima passada pega o resto.
 *
 * ORDEM: uma fila por conversa, para duas mensagens seguidas chegarem lá na mesma ordem.
 */

const BASE = 'https://api.clickup.com/api/v3/workspaces';
/** Mesma chave da importação (CHAT_CLICKUP_SYNC=off desliga os dois sentidos); CHAT_CLICKUP_SAIDA=off desliga só este. */
const ligado = () => process.env.CHAT_CLICKUP_SYNC !== 'off' && process.env.CHAT_CLICKUP_SAIDA !== 'off';

const emAndamento = new Map<string, number>();
const filas = new Map<string, Promise<unknown>>();

/** A importação pergunta isto antes de ler a conversa. */
export function espelhandoConversa(conversationId: string): boolean {
  return (emAndamento.get(conversationId) ?? 0) > 0;
}

function naFila<T>(conversationId: string, passo: () => Promise<T>): Promise<T> {
  emAndamento.set(conversationId, (emAndamento.get(conversationId) ?? 0) + 1);
  const anterior = filas.get(conversationId) ?? Promise.resolve();
  const atual = anterior.catch(() => undefined).then(passo).finally(() => {
    const n = (emAndamento.get(conversationId) ?? 1) - 1;
    if (n <= 0) emAndamento.delete(conversationId); else emAndamento.set(conversationId, n);
    if (filas.get(conversationId) === atual) filas.delete(conversationId);
  });
  filas.set(conversationId, atual);
  return atual;
}

/** O que o espelho precisa do ClickUp; os testes trocam por um ClickUp simulado. */
export interface ApiDeEscrita {
  publicar(token: string, workspace: string, canalId: string, conteudo: string): Promise<string>;
  responder(token: string, workspace: string, mensagemId: string, conteudo: string): Promise<string>;
  editar(token: string, workspace: string, mensagemId: string, conteudo: string): Promise<void>;
  apagar(token: string, workspace: string, mensagemId: string): Promise<void>;
  conversaDireta(token: string, workspace: string, userIds: string[]): Promise<{ id: string; tipo: string }>;
}

async function chamar(token: string, metodo: string, url: string, corpo?: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(url, {
    method: metodo,
    headers: { Authorization: token, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`ClickUp chat (${r.status}) ${metodo} ${url.replace(BASE, '').split('?')[0]}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  const texto = await r.text();
  return texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
}

function idDaResposta(j: Record<string, unknown>): string {
  const d = (j.data ?? j) as Record<string, unknown>;
  const id = d.id;
  if (typeof id !== 'string' && typeof id !== 'number') throw new Error('ClickUp chat: resposta sem id da mensagem');
  return String(id);
}

export const apiDeEscritaReal: ApiDeEscrita = {
  async publicar(token, ws, canalId, conteudo) {
    return idDaResposta(await chamar(token, 'POST', `${BASE}/${ws}/chat/channels/${canalId}/messages`, { type: 'message', content: conteudo, content_format: 'text/md' }));
  },
  async responder(token, ws, mensagemId, conteudo) {
    return idDaResposta(await chamar(token, 'POST', `${BASE}/${ws}/chat/messages/${mensagemId}/replies`, { type: 'message', content: conteudo, content_format: 'text/md' }));
  },
  async editar(token, ws, mensagemId, conteudo) {
    await chamar(token, 'PATCH', `${BASE}/${ws}/chat/messages/${mensagemId}`, { content: conteudo, content_format: 'text/md' });
  },
  async apagar(token, ws, mensagemId) {
    await chamar(token, 'DELETE', `${BASE}/${ws}/chat/messages/${mensagemId}`);
  },
  async conversaDireta(token, ws, userIds) {
    const j = await chamar(token, 'POST', `${BASE}/${ws}/chat/channels/direct_message`, { user_ids: userIds });
    const d = (j.data ?? j) as Record<string, unknown>;
    if (typeof d.id !== 'string') throw new Error('ClickUp chat: conversa direta sem id');
    return { id: d.id, tipo: String(d.type ?? (userIds.length > 1 ? 'GROUP_DM' : 'DM')).toUpperCase() };
  },
};

let api: ApiDeEscrita = apiDeEscritaReal;
let membrosDoTime: (() => Promise<ClickUpMember[]>) | null = null;
/** Só para testes. */
export function usarClickUpDeTeste(a: ApiDeEscrita | null, membros?: ClickUpMember[]): void {
  api = a ?? apiDeEscritaReal;
  membrosDoTime = membros ? async () => membros : null;
  membrosEmCache = null;
}

const workspace = () => process.env.CLICKUP_TEAM_ID ?? '';
const chaveDaAgencia = () => process.env.CLICKUP_API_KEY ?? '';

let membrosEmCache: { em: number; lista: ClickUpMember[] } | null = null;
async function membros(): Promise<ClickUpMember[]> {
  if (membrosEmCache && Date.now() - membrosEmCache.em < 10 * 60_000) return membrosEmCache.lista;
  const lista = membrosDoTime ? await membrosDoTime() : await getTeamMembers({ apiKey: chaveDaAgencia(), teamId: workspace() });
  membrosEmCache = { em: Date.now(), lista };
  return lista;
}

async function vinculoDaConversa(organizationId: string, conversationId: string) {
  const [v] = await db.select().from(schema.workExternalMappings).where(and(
    eq(schema.workExternalMappings.organizationId, organizationId), eq(schema.workExternalMappings.provider, 'clickup'),
    eq(schema.workExternalMappings.externalType, 'chat_channel'), eq(schema.workExternalMappings.entityType, 'internal_conversation'),
    eq(schema.workExternalMappings.entityId, conversationId),
  )).limit(1);
  return v ?? null;
}

/** Id do ClickUp de uma mensagem daqui: a importada guarda no clientMessageId; a publicada daqui, no vínculo. */
async function idNoClickUp(organizationId: string, messageId: string): Promise<string | null> {
  const [m] = await db.select({ cmid: schema.internalMessages.clientMessageId }).from(schema.internalMessages).where(eq(schema.internalMessages.id, messageId)).limit(1);
  if (m?.cmid.startsWith('clickup:')) return m.cmid.slice('clickup:'.length);
  const [v] = await db.select({ ext: schema.workExternalMappings.externalId }).from(schema.workExternalMappings).where(and(
    eq(schema.workExternalMappings.organizationId, organizationId), eq(schema.workExternalMappings.provider, 'clickup'),
    eq(schema.workExternalMappings.externalType, 'chat_message'), eq(schema.workExternalMappings.entityId, messageId),
  )).limit(1);
  return v?.ext ?? null;
}

/** Conversa direta ou grupo nascido aqui: a conversa equivalente no ClickUp, aberta com o token de quem escreveu. */
async function abrirNoClickUp(conversa: Conversa, autorId: string, token: string): Promise<string | null> {
  if (conversa.kind !== 'direct' && conversa.kind !== 'group') return null;
  const pessoas = await db.select({ id: schema.users.id, email: schema.users.email, clickupEmail: schema.users.clickupEmail })
    .from(schema.internalConversationMembers).innerJoin(schema.users, eq(schema.users.id, schema.internalConversationMembers.userId))
    .where(eq(schema.internalConversationMembers.conversationId, conversa.id));
  const outros = pessoas.filter((p) => p.id !== autorId);
  if (outros.length === 0) return null;
  const porEmail = new Map((await membros()).map((m) => [m.email.trim().toLowerCase(), String(m.id)]));
  const ids = outros.map((p) => porEmail.get((p.clickupEmail ?? '').trim().toLowerCase()) ?? porEmail.get(p.email.trim().toLowerCase()));
  // Alguém da conversa não está no ClickUp: lá a conversa seria outra (faltaria gente). Fica só aqui.
  if (ids.some((id) => !id)) return null;
  const canal = await api.conversaDireta(token, workspace(), ids as string[]);
  await db.insert(schema.workExternalMappings).values({
    organizationId: conversa.organizationId, provider: 'clickup', externalType: 'chat_channel', externalId: canal.id,
    entityType: 'internal_conversation', entityId: conversa.id,
    // Marco zerado + primeira carga: a próxima passada traz o histórico de lá sem notificar ninguém.
    meta: { ultimaMs: 0, tipo: canal.tipo, primeiraCarga: true },
  }).onConflictDoNothing();
  const v = await vinculoDaConversa(conversa.organizationId, conversa.id);
  return v?.externalId ?? null;
}

function textoParaOClickUp(m: MensagemCompleta): string | null {
  const partes: string[] = [];
  if (m.message.content) partes.push(m.message.content);
  if (m.attachments.length) partes.push(`📎 ${m.attachments.map((a) => a.filename).join(', ')} (no DesigualOS)`);
  if (m.objects.length && !m.message.content) partes.push('Compartilhou um item no DesigualOS');
  return partes.length ? partes.join('\n\n') : null;
}

async function gravarVinculoDaMensagem(organizationId: string, messageId: string, externalId: string) {
  await db.insert(schema.workExternalMappings).values({
    organizationId, provider: 'clickup', externalType: 'chat_message', externalId, entityType: 'internal_message', entityId: messageId, meta: {},
  }).onConflictDoNothing();
}

/**
 * Publica no ClickUp a mensagem que acabou de ser gravada aqui. Nunca lança: a mensagem já está na Comunicação, e
 * uma falha lá não pode virar erro para quem enviou.
 */
export function espelharMensagem(conversa: Conversa, m: MensagemCompleta): Promise<void> {
  if (!ligado() || m.message.kind !== 'user' || !workspace()) return Promise.resolve();
  return naFila(conversa.id, async () => {
    const autor = m.message.senderId;
    const conteudo = textoParaOClickUp(m);
    if (!conteudo) return;
    const doAutor = await tokenDoClickUpDe(autor, workspace());
    const vinculo = await vinculoDaConversa(conversa.organizationId, conversa.id);
    const canalId = vinculo?.externalId ?? (doAutor ? await abrirNoClickUp(conversa, autor, doAutor) : null);
    if (!canalId) return;
    const tipo = String((vinculo?.meta as { tipo?: string } | undefined)?.tipo ?? 'CHANNEL').toUpperCase();
    const raizNoClickUp = m.message.threadRootId ? await idNoClickUp(conversa.organizationId, m.message.threadRootId) : null;
    if (m.message.threadRootId && !raizNoClickUp) return; // a thread começou numa mensagem que não existe lá

    const enviar = (token: string, texto: string) => raizNoClickUp
      ? api.responder(token, workspace(), raizNoClickUp, texto)
      : api.publicar(token, workspace(), canalId, texto);
    const pelaAgencia = () => enviar(chaveDaAgencia(), `**${(m.sender?.name ?? 'Alguém').replace(/\*/g, '')}**: ${conteudo}`);
    let externalId: string;
    if (doAutor) {
      try {
        externalId = await enviar(doAutor, conteudo);
      } catch (error) {
        if (!tokenRecusado(error) || tipo !== 'CHANNEL' || !chaveDaAgencia()) throw error;
        externalId = await pelaAgencia();
      }
    } else if (tipo === 'CHANNEL' && chaveDaAgencia()) {
      externalId = await pelaAgencia();
    } else {
      return;
    }
    await gravarVinculoDaMensagem(conversa.organizationId, m.message.id, externalId);
  }).catch((error: unknown) => {
    logger.warn({ error: error instanceof Error ? error.message : String(error), conversationId: conversa.id }, 'Comunicação → ClickUp: mensagem não publicada');
  });
}

/** Edição e exclusão daqui chegam lá, pela mesma pessoa (só quem escreveu edita, aqui e lá). */
export function espelharAlteracao(conversa: Pick<Conversa, 'id' | 'organizationId'>, autorId: string, messageId: string, novoTexto: string | null): Promise<void> {
  if (!ligado() || !workspace()) return Promise.resolve();
  return naFila(conversa.id, async () => {
    const [v] = await db.select({ ext: schema.workExternalMappings.externalId }).from(schema.workExternalMappings).where(and(
      eq(schema.workExternalMappings.organizationId, conversa.organizationId), eq(schema.workExternalMappings.provider, 'clickup'),
      eq(schema.workExternalMappings.externalType, 'chat_message'), eq(schema.workExternalMappings.entityId, messageId),
    )).limit(1);
    if (!v) return;
    const token = await tokenDoClickUpDe(autorId, workspace());
    if (!token) return; // publicada pela agência: lá ela é da agência, e o nome de quem escreveu está no texto
    if (novoTexto === null) await api.apagar(token, workspace(), v.ext);
    else await api.editar(token, workspace(), v.ext, novoTexto);
  }).catch((error: unknown) => {
    logger.warn({ error: error instanceof Error ? error.message : String(error), conversationId: conversa.id }, 'Comunicação → ClickUp: alteração não publicada');
  });
}

/** Ids do ClickUp que já existem aqui porque saíram daqui (a importação pula), com o id da mensagem daqui. */
export async function publicadasDaqui(organizationId: string, idsDoClickUp: string[]): Promise<Map<string, string>> {
  if (idsDoClickUp.length === 0) return new Map();
  const linhas = await db.select({ ext: schema.workExternalMappings.externalId, id: schema.workExternalMappings.entityId }).from(schema.workExternalMappings).where(and(
    eq(schema.workExternalMappings.organizationId, organizationId), eq(schema.workExternalMappings.provider, 'clickup'),
    eq(schema.workExternalMappings.externalType, 'chat_message'), inArray(schema.workExternalMappings.externalId, idsDoClickUp),
  ));
  return new Map(linhas.map((l) => [l.ext, l.id]));
}
