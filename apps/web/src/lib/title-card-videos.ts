/**
 * Vídeo de motion por tela, no card de título (PageHeader/BrandBanner).
 *
 * Pedido do Endrigo (03/09/2026): "vincule os vídeos aos cards de títulos,
 * para cada um ficar um vídeo... deixar as telas mais dinâmicas". Os arquivos
 * vieram em assets/ na raiz do projeto; só 4 são únicos (um quinto era
 * duplicata exata, confirmado por hash MD5) - copiados pra
 * public/brand/videos/ com nome curto.
 *
 * Mapeamento fixo por rota, não aleatório: a mesma tela sempre mostra o
 * mesmo vídeo entre uma visita e outra, e cada rota é distinguível da vizinha
 * na sidebar (não repete duas adjacentes).
 */
const VIDEOS = [
  '/brand/videos/motion-bars-01.mp4',
  '/brand/videos/motion-bars-02.mp4',
  '/brand/videos/motion-bars-03.mp4',
  '/brand/videos/motion-pattern-01.mp4',
] as const;

const ROUTE_VIDEO: Record<string, (typeof VIDEOS)[number]> = {
  '/': VIDEOS[0],
  '/agents': VIDEOS[1],
  '/clients': VIDEOS[2],
  '/tasks': VIDEOS[1],
  '/studio': VIDEOS[3],
  '/workflows': VIDEOS[0],
  '/history': VIDEOS[1],
  '/knowledge': VIDEOS[2],
  '/analytics': VIDEOS[3],
  '/costs': VIDEOS[0],
  '/monitoring': VIDEOS[1],
  '/admin': VIDEOS[2],
  '/settings': VIDEOS[3],
  '/messages': VIDEOS[0],
  // Adicionadas em 08/10/2026 — navegação cresceu bastante desde o mapeamento
  // original (Empresas, Campanhas, Mídias, Pipeline, Bento à vista etc.) e
  // essas rotas caíam todas no fallback (sempre o mesmo vídeo), o que viola a
  // regra de não repetir entre vizinhas da barra. Mesma lógica de escolha:
  // nunca igual ao vizinho imediato (antes ou depois) na ordem da sidebar.
  '/today': VIDEOS[0],
  '/calendar': VIDEOS[1],
  '/signals': VIDEOS[2],
  '/organizations': VIDEOS[1],
  '/inbox': VIDEOS[3],
  '/demands': VIDEOS[0],
  '/midias': VIDEOS[2],
  '/pipeline': VIDEOS[1],
  '/people': VIDEOS[3],
  '/approvals': VIDEOS[2],
  '/memory': VIDEOS[0],
  '/decisions': VIDEOS[3],
  '/health': VIDEOS[1],
  '/activity': VIDEOS[2],
  '/mcp': VIDEOS[0],
  '/tools': VIDEOS[3],
  '/permissions': VIDEOS[1],
  '/audit': VIDEOS[2],
  '/errors': VIDEOS[0],
  '/integrations': VIDEOS[3],
  '/data-quality': VIDEOS[1],
  '/usage': VIDEOS[2],
  '/chat': VIDEOS[2],
};

/** Prefixo mais longo primeiro: "/clients/123" precisa cair em "/clients", não em "/". */
export function titleCardVideoFor(pathname: string): string {
  const match = Object.keys(ROUTE_VIDEO)
    .sort((a, b) => b.length - a.length)
    .find((route) => pathname === route || pathname.startsWith(`${route}/`));
  return ROUTE_VIDEO[match ?? '/'] ?? VIDEOS[0];
}
