/**
 * Configuração do Bento no WhatsApp.
 *
 * Mesmo padrão dos outros flags do repositório (`ottoMotionEnabled`,
 * `bentoOpenAiCoreEnabled`): leitura de `process.env` num helper pequeno,
 * sem módulo de config central — o repositório não tem um, e inventar um aqui
 * seria uma convenção que só este canal segue.
 *
 * DESLIGADO por padrão. Com `BENTO_WHATSAPP_ENABLED` diferente de `true`, o
 * webhook responde 200 e não grava nem processa nada, e as rotas de vínculo
 * respondem que o canal está desligado. Nada mais do sistema muda.
 */

export interface BentoWhatsappConfig {
  enabled: boolean;
  /** URL base do OpenWA, sem `/api` no fim. Ex.: http://127.0.0.1:2785 */
  openwaBaseUrl: string | null;
  /** Chave do OpenWA (`X-API-Key`), papel operator, idealmente escopada à sessão do Bento. */
  openwaApiKey: string | null;
  /** UUID da sessão do número do Bento no OpenWA. Uma sessão, nunca a de outra pessoa. */
  sessionId: string | null;
  /** Segredo HMAC configurado no webhook da sessão. Sem ele o webhook recusa tudo. */
  webhookSecret: string | null;
  /** Número do Bento, só dígitos. Mensagem vinda dele é ignorada (anti-loop). */
  botPhone: string | null;
  /** Ids extras do próprio Bento (ex.: o `@lid` dele), para reconhecer menção em grupo. */
  botExtraIds: string[];
  /** Grupos autorizados (`...@g.us`). Vazio = Bento só conversa no privado. */
  allowedGroups: string[];
  /** Provedor de transcrição: 'openai' quando há credencial (padrão) ou 'none'. Ver transcription.ts. */
  transcriptionProvider: 'none' | 'openai';
  /** Imagem e documento recebidos viram anexo do turno, como o upload do chat web. */
  documentsEnabled: boolean;
  /**
   * 'AUTO' (padrão): o mesmo roteamento do chat web — a pergunta de mídia paga
   * vai pro Jarbas, a criativa pro Otto, a operacional pro Bento. 'BENTO'
   * fixa o Bento em todo turno.
   */
  agentHint: 'AUTO' | 'BENTO';
  /** Teto de espera pela resposta do Brain antes de avisar que demorou. */
  replyTimeoutMs: number;
  /** Depois disso sem resposta, manda UMA mensagem de andamento. */
  progressNoticeMs: number;
  /** Janela para juntar mensagens seguidas da mesma pessoa num turno só. */
  coalesceWindowMs: number;
  /** Turnos por pessoa por hora. */
  maxTurnsPerHour: number;
  /** Turnos processados ao mesmo tempo, somando todas as pessoas. */
  maxConcurrentTurns: number;
  /** Envelope do webhook mais velho que isto é recusado (proteção contra replay). */
  maxEventAgeMs: number;
  /** Horas sem conversa depois das quais o próximo turno abre conversa nova. */
  conversationIdleHours: number;
}

function numero(valor: string | undefined, padrao: number): number {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

function lista(valor: string | undefined): string[] {
  return (valor ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function vazioViraNull(valor: string | undefined): string | null {
  const limpo = valor?.trim();
  return limpo ? limpo : null;
}

/** O número corporativo do Bento (conta WhatsApp Business dedicada). */
export const NUMERO_DO_BENTO = '5518997987295';

export function bentoWhatsappConfig(env: NodeJS.ProcessEnv = process.env): BentoWhatsappConfig {
  return {
    enabled: env.BENTO_WHATSAPP_ENABLED === 'true',
    openwaBaseUrl: vazioViraNull(env.BENTO_WHATSAPP_OPENWA_URL)?.replace(/\/+$/, '').replace(/\/api$/, '') ?? null,
    openwaApiKey: vazioViraNull(env.BENTO_WHATSAPP_OPENWA_API_KEY),
    sessionId: vazioViraNull(env.BENTO_WHATSAPP_SESSION_ID),
    webhookSecret: vazioViraNull(env.BENTO_WHATSAPP_WEBHOOK_SECRET),
    botPhone: vazioViraNull(env.BENTO_WHATSAPP_BOT_PHONE)?.replace(/\D/g, '') ?? NUMERO_DO_BENTO,
    botExtraIds: lista(env.BENTO_WHATSAPP_BOT_EXTRA_IDS),
    allowedGroups: lista(env.BENTO_WHATSAPP_ALLOWED_GROUPS),
    // Capacidade total por padrão (pedido do Pedro, 19/10/2026: "igual ao chat
    // que puxa tudo"). Cada recurso desliga com a variável em 'none'/'false'.
    transcriptionProvider:
      env.BENTO_WHATSAPP_TRANSCRIPTION === 'none' || !env.OPENAI_API_KEY?.trim() ? 'none' : 'openai',
    documentsEnabled: env.BENTO_WHATSAPP_DOCUMENTS_ENABLED !== 'false',
    agentHint: env.BENTO_WHATSAPP_AGENT_HINT === 'BENTO' ? 'BENTO' : 'AUTO',
    replyTimeoutMs: numero(env.BENTO_WHATSAPP_REPLY_TIMEOUT_MS, 170_000),
    progressNoticeMs: numero(env.BENTO_WHATSAPP_PROGRESS_NOTICE_MS, 15_000),
    coalesceWindowMs: numero(env.BENTO_WHATSAPP_COALESCE_MS, 2_500),
    maxTurnsPerHour: numero(env.BENTO_WHATSAPP_MAX_TURNS_PER_HOUR, 60),
    maxConcurrentTurns: numero(env.BENTO_WHATSAPP_MAX_CONCURRENT, 4),
    maxEventAgeMs: numero(env.BENTO_WHATSAPP_MAX_EVENT_AGE_MS, 10 * 60_000),
    conversationIdleHours: numero(env.BENTO_WHATSAPP_CONVERSATION_IDLE_HOURS, 12),
  };
}

/** O que falta para o canal funcionar. Lista vazia = configuração completa. */
export function pendenciasDeConfiguracao(config: BentoWhatsappConfig): string[] {
  const faltas: string[] = [];
  if (!config.openwaBaseUrl) faltas.push('BENTO_WHATSAPP_OPENWA_URL');
  if (!config.openwaApiKey) faltas.push('BENTO_WHATSAPP_OPENWA_API_KEY');
  if (!config.sessionId) faltas.push('BENTO_WHATSAPP_SESSION_ID');
  if (!config.webhookSecret) faltas.push('BENTO_WHATSAPP_WEBHOOK_SECRET');
  if (!config.botPhone) faltas.push('BENTO_WHATSAPP_BOT_PHONE');
  return faltas;
}
