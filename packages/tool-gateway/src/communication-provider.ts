/**
 * communication-provider.ts — a abstração de comunicação externa (P1-A,
 * 06/10/2026), espelhando `task-provider.ts` em ESPÍRITO, não forçada a ter
 * os mesmos métodos.
 *
 * A diferença de forma vem da diferença real: ClickUp é pull (o Desigual
 * pergunta "o que mudou?"); WhatsApp via Evolution API é push (o provedor
 * manda webhook quando chega mensagem — não existe "sincronizar
 * conversas" fazendo sentido aqui, por isso NÃO há `syncConversations`:
 * forçar um método sem consumidor real é exatamente o que o plano de
 * execução (§25) pediu pra evitar).
 *
 * Lifecycle de conexão (criar/remover instância) mora em
 * `organization_connectors` via `apps/api/src/connectors/routes.ts`, não
 * nesta interface — mesmo padrão de `TaskProvider`, que também não tem
 * connect/disconnect.
 */
export interface CommunicationProvider {
  readonly provider: 'whatsapp';
  /** Envia uma mensagem de texto pro contato. `to` é o telefone/JID no
   *  formato que o provider espera (já validado pelo adapter). */
  sendMessage(input: { to: string; text: string }): Promise<{ externalMessageId: string | null }>;
  /** Estado da conexão com o provedor — não o estado da conta do WhatsApp
   *  em si (conectado/pareando/etc.), só "a API responde". */
  health(): Promise<{ healthy: boolean; detail?: string }>;
  /**
   * Mídia (07/10/2026, pedido explícito do usuário) — OPCIONAL de propósito:
   * nem todo vendor tem a chamada implementada ainda (Evolution continua só
   * texto), e forçar um método sem consumidor real é o que este arquivo já
   * evita pra `syncConversations` (ver cabeçalho). Quem chama confere
   * `typeof provider.sendImage === 'function'` antes de usar.
   */
  sendImage?(input: { to: string; url: string; caption?: string }): Promise<{ externalMessageId: string | null }>;
  sendAudio?(input: { to: string; url: string }): Promise<{ externalMessageId: string | null }>;
  sendDocument?(input: { to: string; url: string; filename: string }): Promise<{ externalMessageId: string | null }>;
}

/** Mensagem normalizada, independente do provider — o que o webhook handler
 *  monta a partir do payload cru de cada um. */
export interface NormalizedInboundMessage {
  externalMessageId: string | null;
  fromPhone: string;
  fromName: string | null;
  text: string | null;
  occurredAt: Date;
}
