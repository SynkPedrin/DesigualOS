import { eq, desc, asc } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { getSupabaseAdminClient } from '@desigual-os/auth';
import { renderToBuffer } from '@react-pdf/renderer';
import {
  getMetaAccountInsights,
  getMetaCampaigns,
  resolveMetaAccessByConnectionId,
  getGoogleAdsAccountInsights,
  getGoogleAdsCampaigns,
  resolveGoogleAdsAccessByConnectionId,
  getGoogleAdsEnvConfig,
} from '@desigual-os/tool-gateway';
import type { Logger } from '@desigual-os/logging';
import { ClientReportDocument, type ChannelReportData, type ClientReportData } from '../reports/client-report-document.js';

const BUCKET = 'user-uploads';

function getSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) throw new Error('SUPABASE_URL/SUPABASE_SECRET_KEY not configured');
  return getSupabaseAdminClient(supabaseUrl, secretKey);
}

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * generate-client-report.ts — Relatórios PDF (§46-51 do prompt de
 * refinamento, 06/10/2026). Roda no worker, não na rota HTTP: duas chamadas
 * de API externa por canal (período atual + anterior, pra comparação) mais a
 * renderização do PDF são longas demais pra uma requisição síncrona segurar
 * (mesmo raciocínio documentado em client-report-queue.ts).
 *
 * SEM AI INSIGHTS NESTA VERSÃO, de propósito: o prompt (§50) exige separar
 * DADO de INTERPRETAÇÃO, e essa fronteira merece sua própria atenção, não um
 * parágrafo apressado no fim de um recurso grande. Todo número aqui vem
 * direto da Graph API / Google Ads API — zero texto gerado por IA.
 */
export async function generateClientReport(reportId: string, logger: Logger): Promise<void> {
  const [report] = await db.select().from(schema.clientReports).where(eq(schema.clientReports.id, reportId));
  if (!report) {
    logger.warn({ reportId }, 'client_report não encontrado — pulando');
    return;
  }

  await db.update(schema.clientReports).set({ status: 'processing', updatedAt: new Date() }).where(eq(schema.clientReports.id, reportId));

  try {
    const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, report.clientId));
    if (!client) throw new Error(`Cliente ${report.clientId} não encontrado`);

    const periodoAtual = { since: toYmd(report.periodStart), until: toYmd(report.periodEnd) };
    const duracaoMs = report.periodEnd.getTime() - report.periodStart.getTime();
    const periodoAnterior = {
      since: toYmd(new Date(report.periodStart.getTime() - duracaoMs)),
      until: toYmd(new Date(report.periodStart.getTime() - 1)),
    };

    const canais = new Set(report.channels);

    const meta = canais.has('meta') ? await buscarCanalMeta(report.clientId, periodoAtual, periodoAnterior, logger) : null;
    const googleAds = canais.has('google_ads') ? await buscarCanalGoogleAds(report.clientId, periodoAtual, periodoAnterior, logger) : null;

    const dados: ClientReportData = {
      clienteNome: client.name,
      periodoInicio: report.periodStart,
      periodoFim: report.periodEnd,
      periodoDias: report.periodDays,
      geradoEm: new Date(),
      meta,
      googleAds,
    };

    const pdfBuffer = await renderToBuffer(ClientReportDocument({ data: dados }));

    const path = `reports/${report.clientId}/${report.id}.pdf`;
    const supabase = getSupabase();
    const { error } = await supabase.storage.from(BUCKET).upload(path, pdfBuffer, { contentType: 'application/pdf', upsert: true });
    if (error) throw new Error(`Upload do relatório falhou: ${error.message}`);
    const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path);

    await db
      .update(schema.clientReports)
      .set({ status: 'ready', storageUrl: publicUrlData.publicUrl, updatedAt: new Date() })
      .where(eq(schema.clientReports.id, reportId));

    logger.info({ reportId, clientId: report.clientId }, 'Relatório PDF gerado');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ reportId, error }, 'Falha ao gerar relatório PDF');
    await db.update(schema.clientReports).set({ status: 'failed', errorMessage: message, updatedAt: new Date() }).where(eq(schema.clientReports.id, reportId));
  }
}

async function buscarCanalMeta(
  clientId: string,
  periodoAtual: { since: string; until: string },
  periodoAnterior: { since: string; until: string },
  logger: Logger,
): Promise<ChannelReportData> {
  const [mapping] = await db
    .select()
    .from(schema.clientMetaAccounts)
    .where(eq(schema.clientMetaAccounts.clientId, clientId))
    .orderBy(desc(schema.clientMetaAccounts.isPrimary), asc(schema.clientMetaAccounts.createdAt))
    .limit(1);

  if (!mapping) return { conectado: false, atual: null, anterior: null, campanhas: [], motivoNaoConectado: 'Meta Ads não está conectado para este cliente.' };
  if (!mapping.connectionId) {
    return { conectado: false, atual: null, anterior: null, campanhas: [], motivoNaoConectado: 'O vínculo de Meta Ads deste cliente está sem conexão OAuth associada — reconecte em Integrações.' };
  }

  const access = await resolveMetaAccessByConnectionId(mapping.connectionId);
  if (!access) {
    return { conectado: false, atual: null, anterior: null, campanhas: [], motivoNaoConectado: 'A conexão Meta Ads usada neste vínculo foi desconectada ou expirou.' };
  }

  try {
    const [insightsAtual, insightsAnterior, campanhas] = await Promise.all([
      getMetaAccountInsights(access.token, mapping.accountId, periodoAtual),
      getMetaAccountInsights(access.token, mapping.accountId, periodoAnterior),
      getMetaCampaigns(access.token, mapping.accountId, periodoAtual),
    ]);
    return {
      conectado: true,
      atual: insightsAtual && { spend: insightsAtual.spend, resultados: insightsAtual.results, ctr: insightsAtual.ctr, custoMedio: insightsAtual.cpc },
      anterior: insightsAnterior && { spend: insightsAnterior.spend, resultados: insightsAnterior.results, ctr: insightsAnterior.ctr, custoMedio: insightsAnterior.cpc },
      campanhas: campanhas.map((c) => ({ id: c.id, name: c.name, status: c.status, spend: c.spend, clicks: c.clicks, ctr: c.ctr })),
    };
  } catch (error) {
    logger.error({ clientId, error }, 'Falha ao buscar dados do Meta Ads para o relatório');
    return { conectado: false, atual: null, anterior: null, campanhas: [], motivoNaoConectado: 'Não foi possível buscar os dados do Meta Ads agora. Tente gerar o relatório novamente.' };
  }
}

async function buscarCanalGoogleAds(
  clientId: string,
  periodoAtual: { since: string; until: string },
  periodoAnterior: { since: string; until: string },
  logger: Logger,
): Promise<ChannelReportData> {
  const [mapping] = await db
    .select()
    .from(schema.clientGoogleAdsAccounts)
    .where(eq(schema.clientGoogleAdsAccounts.clientId, clientId))
    .orderBy(desc(schema.clientGoogleAdsAccounts.isPrimary), asc(schema.clientGoogleAdsAccounts.createdAt))
    .limit(1);

  if (!mapping) return { conectado: false, atual: null, anterior: null, campanhas: [], motivoNaoConectado: 'Google Ads não está conectado para este cliente.' };
  if (!mapping.connectionId) {
    return { conectado: false, atual: null, anterior: null, campanhas: [], motivoNaoConectado: 'O vínculo de Google Ads deste cliente está sem conexão OAuth associada — reconecte em Integrações.' };
  }

  const access = await resolveGoogleAdsAccessByConnectionId(mapping.connectionId);
  const envConfig = getGoogleAdsEnvConfig();
  if (!access || !envConfig) {
    return { conectado: false, atual: null, anterior: null, campanhas: [], motivoNaoConectado: 'A conexão Google Ads usada neste vínculo foi desconectada, expirou, ou o Orchestrator não está configurado.' };
  }
  const config = mapping.loginCustomerId ? { ...envConfig, loginCustomerId: mapping.loginCustomerId } : envConfig;

  try {
    const [insightsAtual, insightsAnterior, campanhas] = await Promise.all([
      getGoogleAdsAccountInsights(config, access.accessToken, mapping.customerId, periodoAtual),
      getGoogleAdsAccountInsights(config, access.accessToken, mapping.customerId, periodoAnterior),
      getGoogleAdsCampaigns(config, access.accessToken, mapping.customerId, periodoAtual),
    ]);
    return {
      conectado: true,
      atual: insightsAtual && { spend: insightsAtual.spend, resultados: insightsAtual.conversions, ctr: insightsAtual.ctr, custoMedio: insightsAtual.averageCpc },
      anterior: insightsAnterior && { spend: insightsAnterior.spend, resultados: insightsAnterior.conversions, ctr: insightsAnterior.ctr, custoMedio: insightsAnterior.averageCpc },
      campanhas: campanhas.map((c) => ({ id: c.id, name: c.name, status: c.status, spend: c.spend, clicks: c.clicks, ctr: c.ctr })),
    };
  } catch (error) {
    logger.error({ clientId, error }, 'Falha ao buscar dados do Google Ads para o relatório');
    return { conectado: false, atual: null, anterior: null, campanhas: [], motivoNaoConectado: 'Não foi possível buscar os dados do Google Ads agora. Tente gerar o relatório novamente.' };
  }
}
