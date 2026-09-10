import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';

const FONTSOURCE_API_BASE = 'https://api.fontsource.org/v1';
/** Catálogo inteiro (~1500 fontes) muda raramente - cachear em memória evita
 * bater na API do Fontsource a cada tecla digitada na busca por todos os
 * colaboradores da agência. */
const CATALOG_TTL_MS = 60 * 60_000;

interface FontsourceListEntry {
  id: string;
  family: string;
  category: string;
  variants: Record<string, Record<string, Record<string, unknown>>>;
  subsets: string[];
  weights: number[];
  styles: string[];
  defSubset: string;
  lastModified: string;
}

let catalogCache: { fetchedAt: number; data: FontsourceListEntry[] } | null = null;

async function getCatalog(): Promise<FontsourceListEntry[]> {
  if (catalogCache && Date.now() - catalogCache.fetchedAt < CATALOG_TTL_MS) {
    return catalogCache.data;
  }
  const response = await fetch(`${FONTSOURCE_API_BASE}/fonts`);
  if (!response.ok) {
    throw new Error(`Fontsource respondeu ${response.status}`);
  }
  const data = (await response.json()) as FontsourceListEntry[];
  catalogCache = { fetchedAt: Date.now(), data };
  return data;
}

function toWire(entry: FontsourceListEntry) {
  return {
    id: entry.id,
    family: entry.family,
    category: entry.category,
    subsets: entry.subsets,
    weights: entry.weights,
    styles: entry.styles,
    default_subset: entry.defSubset,
  };
}

/**
 * Proxy pro catálogo público do Fontsource (https://fontsource.org, API
 * documentada em https://fontsource.org/docs/api/api). Não tem chave/segredo
 * envolvido (API pública), mas passa pelo Orchestrator mesmo assim: mesmo
 * padrão de "o browser só fala com nossos próprios endpoints" do resto do
 * app, e permite cachear o catálogo inteiro uma vez pra toda a agência em vez
 * de cada colaborador buscar os ~1500 registros direto.
 */
export async function registerFontRoutes(app: FastifyInstance): Promise<void> {
  const querySchema = z.object({
    q: z.string().optional(),
    category: z.enum(['sans-serif', 'serif', 'display', 'handwriting', 'monospace']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(40),
  });

  app.get('/studio/fonts', { preHandler: requireAuth }, async (request, reply) => {
    const query = querySchema.safeParse(request.query);
    if (!query.success) {
      reply.code(400);
      return { error: 'Parâmetros inválidos' };
    }

    let catalog: FontsourceListEntry[];
    try {
      catalog = await getCatalog();
    } catch (error) {
      request.log.error({ error }, 'font_load_failed');
      reply.code(502);
      return { error: 'Não foi possível carregar o catálogo de fontes agora.' };
    }

    const { q, category, limit } = query.data;
    const search = q?.trim().toLowerCase();
    const filtered = catalog.filter((entry) => {
      if (category && entry.category !== category) return false;
      if (search && !entry.family.toLowerCase().includes(search)) return false;
      return true;
    });

    return { fonts: filtered.slice(0, limit).map(toWire) };
  });

  app.get<{ Params: { id: string } }>('/studio/fonts/:id', { preHandler: requireAuth }, async (request, reply) => {
    let catalog: FontsourceListEntry[];
    try {
      catalog = await getCatalog();
    } catch (error) {
      request.log.error({ error }, 'font_load_failed');
      reply.code(502);
      return { error: 'Não foi possível carregar detalhes da fonte agora.' };
    }
    const entry = catalog.find((f) => f.id === request.params.id);
    if (!entry) {
      reply.code(404);
      return { error: `Fonte '${request.params.id}' não encontrada` };
    }
    return toWire(entry);
  });
}
