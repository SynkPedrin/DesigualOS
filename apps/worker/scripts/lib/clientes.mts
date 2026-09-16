/**
 * clientes.mts — casamento de nome de pasta/dossie com o cliente do banco.
 *
 * Extraido de sync-brains.mts quando a importacao dos dossies passou a precisar
 * exatamente da mesma regra: duas copias da heuristica divergiriam na primeira
 * correcao, e o preco do erro aqui e alto — casar errado poe o dossie de um
 * cliente na ficha de outro.
 */
import { db, schema } from '@desigual-os/database';
import { isNull } from 'drizzle-orm';

export interface ClienteDoBanco {
  id: string;
  name: string;
  slug: string | null;
}

/** Normaliza para comparar: sem acento, minusculo, separadores virando hifen. */
export const dobra = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export async function carregarClientes(): Promise<ClienteDoBanco[]> {
  return db
    .select({ id: schema.clients.id, name: schema.clients.name, slug: schema.clients.slug })
    .from(schema.clients)
    .where(isNull(schema.clients.deletedAt));
}

/**
 * Acha o cliente por um ou mais candidatos (slug do frontmatter, nome, pasta).
 * Exato primeiro; so entao prefixo e conteudo. Devolve null quando nada casa —
 * NUNCA chuta, porque cliente errado e pior que cliente ausente.
 */
export function acharCliente(candidatos: string[], clientes: ClienteDoBanco[]): ClienteDoBanco | null {
  const alvos = candidatos.map(dobra).filter((a) => a.length >= 3);

  for (const alvo of alvos) {
    const exato = clientes.find((c) => dobra(c.name) === alvo || (c.slug ? dobra(c.slug) === alvo : false));
    if (exato) return exato;
  }
  for (const alvo of alvos) {
    const prefixo = clientes.find((c) => dobra(c.name).startsWith(alvo) || alvo.startsWith(dobra(c.name)));
    if (prefixo) return prefixo;
  }
  for (const alvo of alvos) {
    // "por-do-sol" -> "Cond. Por do Sol": o nome do banco carrega prefixo.
    const contido = clientes.find(
      (c) => dobra(c.name).includes(alvo) || (c.slug ? alvo.includes(dobra(c.slug)) : false),
    );
    if (contido) return contido;
  }
  return null;
}

/** Frontmatter YAML raso (chave: valor). Suficiente para os dossies. */
export function lerFrontmatter(texto: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(texto);
  if (!m) return {};
  const campos: Record<string, string> = {};
  for (const linha of m[1]!.split(/\r?\n/)) {
    const par = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(linha);
    if (!par) continue;
    campos[par[1]!] = par[2]!.trim().replace(/^["']|["']$/g, '');
  }
  return campos;
}
