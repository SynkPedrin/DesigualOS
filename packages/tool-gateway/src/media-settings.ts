import { and, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';

/**
 * media-settings.ts — SINGLE SOURCE OF TRUTH das configurações de Mídia.
 *
 * Telas de Mídia, agentes, motor de alertas, relatórios e envio de WhatsApp
 * leem as configurações DAQUI e de nenhum outro lugar: não há cópia em prompt,
 * em .env nem em estado de tela. Mudou aqui, o próximo turno de qualquer um
 * deles já vê (o cache é invalidado na escrita, no mesmo processo, e expira em
 * poucos segundos nos outros).
 *
 * Precedência, do mais específico para o mais amplo:
 *     conta  >  cliente (workspace)  >  organização  >  padrão do código
 * Override é sempre explícito: existe como linha própria, e `source` diz de
 * onde cada valor veio. Nada é "mesclado" por campo dentro de uma chave: a
 * chave inteira vem de UM escopo, para não existir configuração contraditória
 * costurada de dois lugares.
 */

const destination = z
  .object({ kind: z.enum(['group', 'contact']), externalId: z.string().min(1), label: z.string().min(1) })
  .nullable();

/**
 * Pessoa da EQUIPE que recebe os avisos internos pelo número do Bento. O
 * telefone fica na configuração (banco), nunca no código: o repositório é
 * público e este é o número pessoal de alguém.
 */
const internalRecipient = z.object({
  name: z.string().trim().min(1).max(60),
  /** Só dígitos, com DDI 55 e DDD (ex.: 5518...): celular (9 + 8 dígitos) ou fixo. A agência é toda no Brasil, e número estranho aqui manda aviso de mídia para a pessoa errada. */
  phone: z.string().regex(/^55[1-9][1-9](?:9\d{8}|[2-5]\d{7})$/, 'telefone brasileiro só com dígitos, incluindo 55 e DDD'),
});

const period = z.enum(['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'this_month', 'last_month']);

/** Registro de chaves: o que existe, o formato aceito e o padrão. Chave fora daqui é recusada na escrita. */
export const MEDIA_SETTING_DEFS = {
  'dashboard.defaultPeriod': { schema: period, default: 'last_30d' as z.infer<typeof period> },
  'dashboard.compareWithPrevious': { schema: z.boolean(), default: true },
  'dashboard.favoriteMetrics': {
    schema: z.array(z.enum(['spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpc', 'cpm', 'results', 'cpl', 'frequency', 'roas'])).min(1).max(11),
    default: ['spend', 'impressions', 'clicks', 'ctr', 'results', 'cpl'] as string[],
  },
  'alerts.defaultCooldownHours': { schema: z.number().int().min(1).max(720), default: 24 },
  'reports.defaultPeriodDays': { schema: z.number().int().min(1).max(90), default: 7 },
  'reports.includeAgentAnalysis': { schema: z.boolean(), default: true },
  /** Interruptor-mestre de envio externo. Desligado por padrão: nada sai para cliente sem alguém ligar isto de propósito. */
  'whatsapp.sendEnabled': { schema: z.boolean(), default: false },
  'whatsapp.defaultDestination': { schema: destination, default: null as z.infer<typeof destination> },
  'whatsapp.sendWindow': { schema: z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }), default: { start: '08:00', end: '20:00' } },
  /**
   * AVISOS INTERNOS PELO NÚMERO DO BENTO. Quando ligado, todo alerta de mídia
   * que dispara também vira uma mensagem para estas pessoas da equipe, enviada
   * pelo WhatsApp do Bento. É um canal SEPARADO do envio ao cliente
   * (`whatsapp.sendEnabled`, que continua desligado por padrão): aqui o
   * destinatário é gente da agência, nunca cliente. Desligado por padrão.
   */
  'alerts.internalDelivery': {
    schema: z.object({ enabled: z.boolean(), recipients: z.array(internalRecipient).max(5) }),
    default: { enabled: false, recipients: [] as Array<{ name: string; phone: string }> },
  },
  /** O que um agente de IA pode fazer neste escopo. Ação de escrita na plataforma é sempre uma proposta que uma pessoa aprova. */
  'agent.permissions': {
    schema: z.object({ analyze: z.boolean(), generateReports: z.boolean(), prepareMessages: z.boolean(), proposeActions: z.boolean() }),
    default: { analyze: true, generateReports: true, prepareMessages: true, proposeActions: false },
  },
} as const;

export type MediaSettingKey = keyof typeof MEDIA_SETTING_DEFS;
export type MediaSettingScope = 'default' | 'organization' | 'client' | 'account';

export interface MediaSettingRow {
  clientId: string | null;
  accountKey: string | null;
  key: string;
  value: unknown;
}

export interface ResolvedMediaSettings {
  values: { [K in MediaSettingKey]: z.infer<(typeof MEDIA_SETTING_DEFS)[K]['schema']> };
  source: Record<MediaSettingKey, MediaSettingScope>;
}

function scopeOf(row: MediaSettingRow): MediaSettingScope {
  if (row.accountKey) return 'account';
  if (row.clientId) return 'client';
  return 'organization';
}
const RANK: Record<MediaSettingScope, number> = { default: 0, organization: 1, client: 2, account: 3 };

/**
 * Pura, sem banco. Recebe as linhas JÁ filtradas para (cliente, conta) e devolve
 * o valor efetivo de cada chave. Valor inválido gravado no banco (migração
 * antiga, edição manual) é IGNORADO e cai no escopo seguinte: configuração
 * corrompida nunca derruba o dashboard.
 */
export function resolveMediaSettings(rows: MediaSettingRow[]): ResolvedMediaSettings {
  const values: Record<string, unknown> = {};
  const source: Record<string, MediaSettingScope> = {};
  for (const key of Object.keys(MEDIA_SETTING_DEFS) as MediaSettingKey[]) {
    const def = MEDIA_SETTING_DEFS[key];
    values[key] = def.default;
    source[key] = 'default';
    const candidates = rows.filter((r) => r.key === key).sort((a, b) => RANK[scopeOf(b)] - RANK[scopeOf(a)]);
    for (const row of candidates) {
      const parsed = def.schema.safeParse(row.value);
      if (parsed.success) {
        values[key] = parsed.data;
        source[key] = scopeOf(row);
        break;
      }
    }
  }
  return { values: values as ResolvedMediaSettings['values'], source: source as ResolvedMediaSettings['source'] };
}

// ── Banco + cache ────────────────────────────────────────────────────────

const TTL_MS = 10_000;
const cache = new Map<string, { at: number; resolved: ResolvedMediaSettings }>();
const cacheKey = (org: string, client: string | null, account: string | null) => `${org}|${client ?? ''}|${account ?? ''}`;

export function invalidateMediaSettings(organizationId: string): void {
  for (const k of cache.keys()) if (k.startsWith(`${organizationId}|`)) cache.delete(k);
}

export async function getMediaSettings(organizationId: string, clientId: string | null = null, accountKey: string | null = null): Promise<ResolvedMediaSettings> {
  const ck = cacheKey(organizationId, clientId, accountKey);
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.resolved;

  const rows = await db
    .select({ clientId: schema.mediaSettings.clientId, accountKey: schema.mediaSettings.accountKey, key: schema.mediaSettings.key, value: schema.mediaSettings.value })
    .from(schema.mediaSettings)
    .where(
      and(
        eq(schema.mediaSettings.organizationId, organizationId),
        clientId ? or(isNull(schema.mediaSettings.clientId), eq(schema.mediaSettings.clientId, clientId)) : isNull(schema.mediaSettings.clientId),
        accountKey ? or(isNull(schema.mediaSettings.accountKey), eq(schema.mediaSettings.accountKey, accountKey)) : isNull(schema.mediaSettings.accountKey),
      ),
    );
  const resolved = resolveMediaSettings(rows);
  cache.set(ck, { at: Date.now(), resolved });
  return resolved;
}

export class MediaSettingError extends Error {}

/**
 * Grava (ou remove, com `value: undefined`) um override num escopo. Valida o
 * formato contra o registro, audita e invalida o cache. `accountKey` sem
 * `clientId` é recusado: conta pertence a um cliente.
 */
export async function setMediaSetting(input: {
  organizationId: string;
  clientId: string | null;
  accountKey: string | null;
  key: string;
  value: unknown;
  userId: string;
}): Promise<void> {
  const def = MEDIA_SETTING_DEFS[input.key as MediaSettingKey];
  if (!def) throw new MediaSettingError(`Configuração desconhecida: ${input.key}`);
  if (input.accountKey && !input.clientId) throw new MediaSettingError('Configuração de conta exige o cliente.');

  const where = and(
    eq(schema.mediaSettings.organizationId, input.organizationId),
    eq(schema.mediaSettings.key, input.key),
    input.clientId ? eq(schema.mediaSettings.clientId, input.clientId) : isNull(schema.mediaSettings.clientId),
    input.accountKey ? eq(schema.mediaSettings.accountKey, input.accountKey) : isNull(schema.mediaSettings.accountKey),
  );

  const [before] = await db.select({ value: schema.mediaSettings.value }).from(schema.mediaSettings).where(where);

  if (input.value === undefined) {
    await db.delete(schema.mediaSettings).where(where);
  } else {
    const parsed = def.schema.safeParse(input.value);
    if (!parsed.success) throw new MediaSettingError(`Valor inválido para ${input.key}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    if (before) {
      await db.update(schema.mediaSettings).set({ value: parsed.data, updatedBy: input.userId, updatedAt: new Date() }).where(where);
    } else {
      await db.insert(schema.mediaSettings).values({
        organizationId: input.organizationId,
        clientId: input.clientId,
        accountKey: input.accountKey,
        key: input.key,
        value: parsed.data,
        updatedBy: input.userId,
      });
    }
  }

  await db.insert(schema.auditLogs).values({
    userId: input.userId,
    action: 'media.setting.changed',
    result: 'completed',
    metadata: { organizationId: input.organizationId, clientId: input.clientId, accountKey: input.accountKey, key: input.key, before: before?.value ?? null, after: input.value ?? null },
  });
  invalidateMediaSettings(input.organizationId);
}
