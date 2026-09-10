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
};

/** Prefixo mais longo primeiro: "/clients/123" precisa cair em "/clients", não em "/". */
export function titleCardVideoFor(pathname: string): string {
  const match = Object.keys(ROUTE_VIDEO)
    .sort((a, b) => b.length - a.length)
    .find((route) => pathname === route || pathname.startsWith(`${route}/`));
  return ROUTE_VIDEO[match ?? '/'] ?? VIDEOS[0];
}
