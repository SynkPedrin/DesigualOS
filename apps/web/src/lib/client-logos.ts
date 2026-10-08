/**
 * Logos reais de cliente, entregues pelo Pedro em `assets/logos clientes/`
 * (08/10/2026) — copiados pra `public/logos/clientes/` e casados aqui por
 * NOME, não por id/slug: `EntityAvatar` só recebe `name` na maioria das telas
 * que mostram cliente (grade, inbox, aprovações, pipeline, Hoje), e pedir pra
 * cada uma delas carregar o cliente inteiro só pra ter o slug seria inverter
 * a dependência por causa do avatar.
 *
 * `normalizar` tira acento, emoji, pontuação e caixa — "🔥 CITÁVEL™ —
 * Enterprise" e "citavel enterprise" precisam bater no MESMO texto pra não
 * depender de digitar o nome exatamente igual ao arquivo.
 *
 * NEM TODO CLIENTE TEM LOGO AINDA (21 de ~58 no lote de hoje). Cliente sem
 * entrada aqui cai no fallback de iniciais do EntityAvatar — nunca um logo
 * genérico ou inventado.
 */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

const LOGO_POR_NOME: Record<string, string> = {
  '3net': '/logos/clientes/3net.png',
  apae: '/logos/clientes/apae.png',
  'areia branca': '/logos/clientes/areia-branca.png',
  'citavel enterprise': '/logos/clientes/citavel-enterprise.png',
  colpar: '/logos/clientes/colpar.png',
  // Mesma marca, segundo registro na carteira ("Colpar Brasil"). O mapa casa
  // por nome normalizado, então variação de nome vira cliente sem logo —
  // apontar as duas entradas é mais barato que renomear o registro.
  'colpar brasil': '/logos/clientes/colpar.png',
  'cond por do sol': '/logos/clientes/cond-por-do-sol.jpeg',
  cosentino: '/logos/clientes/cosentino.png',
  'costa azul': '/logos/clientes/costa-azul.jpeg',
  'da mata': '/logos/clientes/da-mata.png',
  'dcs diagnostico por imagem': '/logos/clientes/dcs-diagnostico-por-imagem.png',
  elite: '/logos/clientes/elite.jpeg',
  'endrigo almada': '/logos/clientes/endrigo-almada.png',
  engeuni: '/logos/clientes/engeuni.png',
  envu: '/logos/clientes/envu.png',
  'facil seguros': '/logos/clientes/facil-seguros.png',
  'ibiza ii': '/logos/clientes/ibiza-ii.png',
  ipis: '/logos/clientes/ipis.png',
  'jardim do lago': '/logos/clientes/jardim-do-lago.png',
  // A JOHN DEERE NÃO É CLIENTE — a D. Carvalho é, e é concessionária John
  // Deere. O registro "John Deere" era duplicata na carteira e saiu; a marca
  // que aparece na peça segue a mesma, agora apontada pro cliente certo.
  'd carvalho': '/logos/clientes/john-deere.png',
  'top tennis club': '/logos/clientes/top-tennis-club.png',
  'yak sushibar': '/logos/clientes/yak-sushibar.jpeg',
};

const LOGO_NORMALIZADO: Record<string, string> = Object.fromEntries(
  Object.entries(LOGO_POR_NOME).map(([nome, src]) => [normalizar(nome), src]),
);

/** Logo real do cliente pelo nome, ou `null` quando ainda não entregamos um — nunca inventa. */
export function logoDoCliente(name: string | null | undefined): string | null {
  if (!name) return null;
  return LOGO_NORMALIZADO[normalizar(name)] ?? null;
}
