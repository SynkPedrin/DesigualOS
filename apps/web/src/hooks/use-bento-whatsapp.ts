import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';

/**
 * Bento no WhatsApp (16/10/2026) — vínculo do colaborador e painel master.
 *
 * Os tipos de wire moram aqui e não em lib/api/contracts.ts: o contrato é só
 * desta tela, e o arquivo de contratos está sendo editado em paralelo pela
 * integração OpenWA do Inbox.
 */

export interface BentoWhatsappMeWire {
  enabled: boolean;
  bot_phone: string | null;
  link: { id: string; phone: string; linked_at: string } | null;
  pending_code: {
    id: string;
    status: 'pending' | 'claimed';
    expires_at: string;
    claimed_phone: string | null;
  } | null;
}

export interface BentoWhatsappCodeWire {
  id: string;
  code: string;
  expires_at: string;
  bot_phone: string | null;
  wa_link: string | null;
}

export interface BentoWhatsappAdminStatusWire {
  enabled: boolean;
  /** 'painel' (provisionada aqui), 'env' (variáveis do servidor) ou 'nenhuma' (falta conectar). */
  source: 'painel' | 'env' | 'nenhuma';
  can_provision: boolean;
  kill_switch: boolean;
  webhook_url: string | null;
  agent_hint: 'AUTO' | 'BENTO';
  missing_config: string[];
  bot_phone: string | null;
  transcription: 'none' | 'openai';
  documents: boolean;
  allowed_groups: number;
  session: {
    status: string;
    phone?: string | null;
    connected_at?: string | null;
    last_active?: string | null;
    last_error?: string | null;
    error?: string;
  };
  gateway: { ready: boolean };
  brain: { last_reply_at: string | null };
  last_24h: {
    by_status: Record<string, number>;
    latency_ms: { p50: number | null; p95: number | null; samples: number };
  };
  recent_failures: Array<{ id: string; at: string; status: string; reason: string | null; error: string | null }>;
  linked_users: number;
}

export interface BentoWhatsappLinkWire {
  id: string;
  user: { id: string; name: string; email: string };
  phone: string;
  linked_at: string;
  last_inbound_at: string | null;
}

const CHAVE = ['bento-whatsapp'] as const;

export function useBentoWhatsappMe() {
  return useQuery({
    queryKey: [...CHAVE, 'me'],
    queryFn: () => apiFetch<BentoWhatsappMeWire>('/bento-whatsapp/me'),
    // Enquanto há código esperando o WhatsApp, a tela pergunta de novo: é
    // assim que o "confirme este número" aparece sem a pessoa recarregar.
    refetchInterval: (query) => (query.state.data?.pending_code ? 3_000 : false),
  });
}

export function useGerarCodigoBentoWhatsapp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<BentoWhatsappCodeWire>('/bento-whatsapp/me/link-code', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...CHAVE, 'me'] }),
  });
}

export function useConfirmarVinculoBentoWhatsapp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (codeId: string) =>
      apiFetch<{ ok: true; phone: string }>(`/bento-whatsapp/me/link-code/${codeId}/confirm`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CHAVE }),
  });
}

export function useRecusarCodigoBentoWhatsapp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (codeId: string) => apiFetch(`/bento-whatsapp/me/link-code/${codeId}/reject`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...CHAVE, 'me'] }),
  });
}

export function useDesvincularBentoWhatsapp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch('/bento-whatsapp/me/link', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CHAVE }),
  });
}

export function useBentoWhatsappAdminStatus(enabled: boolean) {
  return useQuery({
    queryKey: [...CHAVE, 'admin', 'status'],
    queryFn: () => apiFetch<BentoWhatsappAdminStatusWire>('/bento-whatsapp/admin/status'),
    enabled,
    // Durante a conexão (Chromium subindo, QR, autenticando) olha de 3 em 3 s;
    // com tudo estável, de 15 em 15.
    refetchInterval: (query) =>
      ['created', 'initializing', 'qr_ready', 'authenticating'].includes(query.state.data?.session?.status ?? '') ? 3_000 : 15_000,
  });
}

export function useBentoWhatsappLinks(enabled: boolean) {
  return useQuery({
    queryKey: [...CHAVE, 'admin', 'links'],
    queryFn: () => apiFetch<{ links: BentoWhatsappLinkWire[] }>('/bento-whatsapp/admin/links'),
    enabled,
  });
}

export function useRevogarVinculoBentoWhatsapp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => apiFetch(`/bento-whatsapp/admin/links/${linkId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CHAVE }),
  });
}

export function useIniciarSessaoBentoWhatsapp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ status: string }>('/bento-whatsapp/admin/session/start', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...CHAVE, 'admin'] }),
  });
}

/** QR só sob demanda (botão), nunca em polling: ver o QR é poder conectar o número, e fica auditado. */
export function useQrBentoWhatsapp() {
  return useMutation({
    mutationFn: () => apiFetch<{ qr_code: string; status: string }>('/bento-whatsapp/admin/session/qr'),
  });
}

/** Cria (ou retoma) a sessão do número do Bento no OpenWA. Idempotente. */
export function useProvisionarSessaoBentoWhatsapp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ status: string; created: boolean }>('/bento-whatsapp/admin/session/provision', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...CHAVE] }),
  });
}

export function useLigarCanalBentoWhatsapp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch<{ enabled: boolean }>('/bento-whatsapp/admin/channel', { method: 'POST', body: JSON.stringify({ enabled }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...CHAVE] }),
  });
}

/** Código de 8 caracteres para digitar no celular do Bento (alternativa ao QR). */
export function useCodigoDeConexaoBentoWhatsapp() {
  return useMutation({
    mutationFn: () =>
      apiFetch<{ pairing_code: string; phone: string }>('/bento-whatsapp/admin/session/pairing-code', { method: 'POST' }),
  });
}
