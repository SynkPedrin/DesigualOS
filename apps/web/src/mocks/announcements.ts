import { http, HttpResponse } from 'msw';

/** Anúncios na demo: nenhum (o modo mock não deve abrir novidade sobre a demonstração). */
export const announcementHandlers = [
  http.get('/announcements', () => HttpResponse.json({ announcements: [] })),
  http.post('/announcements/:key/events', () => HttpResponse.json({ error: 'Anúncio não encontrado.' }, { status: 404 })),
  http.get('/admin/announcements', () => HttpResponse.json({ announcements: [] })),
];
