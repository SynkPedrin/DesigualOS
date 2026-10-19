import { http, HttpResponse } from 'msw';

/**
 * Bento no WhatsApp em modo mock: o canal aparece LIGADO e sem vínculo, e o
 * código gerado é "reivindicado" no segundo GET seguinte, para a tela
 * mostrar a confirmação sem WhatsApp de verdade. Nada aqui fala com OpenWA.
 */
const estado: {
  link: { id: string; phone: string; linked_at: string } | null;
  pending: { id: string; status: 'pending' | 'claimed'; expires_at: string; claimed_phone: string | null; leituras: number } | null;
} = { link: null, pending: null };

export const bentoWhatsappHandlers = [
  http.get('/bento-whatsapp/me', () => {
    if (estado.pending && estado.pending.status === 'pending') {
      estado.pending.leituras += 1;
      if (estado.pending.leituras >= 2) {
        estado.pending.status = 'claimed';
        estado.pending.claimed_phone = '+55 18 99111-0001';
      }
    }
    const p = estado.pending;
    return HttpResponse.json({
      enabled: true,
      bot_phone: '+55 18 99798-7295',
      link: estado.link,
      pending_code: p ? { id: p.id, status: p.status, expires_at: p.expires_at, claimed_phone: p.claimed_phone } : null,
    });
  }),

  http.post('/bento-whatsapp/me/link-code', () => {
    const expires = new Date(Date.now() + 10 * 60_000).toISOString();
    estado.pending = { id: 'mock-code', status: 'pending', expires_at: expires, claimed_phone: null, leituras: 0 };
    return HttpResponse.json({
      id: 'mock-code',
      code: 'BENTO-MOCK-2026',
      expires_at: expires,
      bot_phone: '+55 18 99798-7295',
      wa_link: 'https://wa.me/5518997987295?text=BENTO-MOCK-2026',
    });
  }),

  http.post('/bento-whatsapp/me/link-code/:id/confirm', () => {
    if (!estado.pending?.claimed_phone) return HttpResponse.json({ error: 'Não há código aguardando confirmação.' }, { status: 404 });
    estado.link = { id: 'mock-link', phone: estado.pending.claimed_phone, linked_at: new Date().toISOString() };
    estado.pending = null;
    return HttpResponse.json({ ok: true, phone: estado.link.phone });
  }),

  http.post('/bento-whatsapp/me/link-code/:id/reject', () => {
    estado.pending = null;
    return HttpResponse.json({ ok: true });
  }),

  http.delete('/bento-whatsapp/me/link', () => {
    estado.link = null;
    return HttpResponse.json({ ok: true });
  }),

  http.get('/bento-whatsapp/admin/status', () =>
    HttpResponse.json({
      enabled: true,
      source: 'painel',
      can_provision: true,
      kill_switch: false,
      webhook_url: 'https://api.citavel.ai/bento-whatsapp/webhook',
      agent_hint: 'AUTO',
      missing_config: [],
      bot_phone: '+55 18 99798-7295',
      transcription: 'openai',
      documents: true,
      allowed_groups: 0,
      session: { status: 'qr_ready', phone: null },
      gateway: { ready: true },
      brain: { last_reply_at: null },
      last_24h: { by_status: {}, latency_ms: { p50: null, p95: null, samples: 0 } },
      recent_failures: [],
      linked_users: estado.link ? 1 : 0,
    }),
  ),

  http.get('/bento-whatsapp/admin/links', () =>
    HttpResponse.json({
      links: estado.link
        ? [{ id: estado.link.id, user: { id: 'u', name: 'Você', email: 'voce@desigual.test' }, phone: '+55 18 9****-0001', linked_at: estado.link.linked_at, last_inbound_at: null }]
        : [],
    }),
  ),

  http.delete('/bento-whatsapp/admin/links/:id', () => {
    estado.link = null;
    return HttpResponse.json({ ok: true });
  }),

  http.post('/bento-whatsapp/admin/session/provision', () => HttpResponse.json({ status: 'qr_ready', created: true })),

  http.post('/bento-whatsapp/admin/channel', () => HttpResponse.json({ enabled: true })),

  http.post('/bento-whatsapp/admin/session/start', () => HttpResponse.json({ status: 'initializing' })),

  http.post('/bento-whatsapp/admin/session/pairing-code', () => HttpResponse.json({ pairing_code: 'ABCD1234', phone: '+55 18 99798-7295' })),

  http.get('/bento-whatsapp/admin/session/qr', () =>
    HttpResponse.json({ error: 'Modo mock: nenhum OpenWA real para gerar QR.' }, { status: 409 }),
  ),
];
