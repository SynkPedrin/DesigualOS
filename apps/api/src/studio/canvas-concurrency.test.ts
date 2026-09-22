import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

/**
 * Teste 02 do critério de aceite ("dois usuários editam o mesmo recurso") e §53
 * (concorrência otimista) da auditoria de 18/09/2026.
 *
 * O defeito: `PATCH /studio/canvas-documents/:id` gravava incondicionalmente.
 * O editor do Canva autossalva o documento INTEIRO (`pages` é o desenho todo,
 * não um diff) a cada 1,5s, e o workspace de um cliente é compartilhado pela
 * equipe toda (hasClientAccess devolve true pra qualquer autenticado). Dois
 * colaboradores com o mesmo design aberto se apagavam: o último PATCH a chegar
 * vencia, sem erro, sem aviso e sem forma de recuperar o que foi perdido.
 *
 * Este teste sobe a rota real num Fastify real e simula o banco fazendo o que o
 * Postgres faz com o UPDATE condicional: grava quando a versão bate, não grava
 * quando não bate.
 */

/** Uma "linha" de studio_canvas_documents, com a versão que o banco enxerga. */
const linha = {
  id: 'doc-1',
  clientId: 'client-1',
  ownerId: 'user-a',
  projectId: null,
  name: 'Post',
  width: 1080,
  height: 1080,
  thumbnailUrl: null,
  pages: [] as unknown[],
  version: 1,
  createdAt: new Date('2026-09-18T10:00:00Z'),
  updatedAt: new Date('2026-09-18T10:00:00Z'),
};

const gravacoes: unknown[] = [];

/**
 * Lê os VALORES que a rota amarrou na cláusula `where` do UPDATE.
 *
 * É o que torna este teste honesto: a decisão de gravar ou recusar sai da
 * condição que a ROTA montou, não de uma variável que o teste combinou consigo
 * mesmo. Primeira versão deste arquivo caía nessa armadilha - passava verde
 * mesmo com o UPDATE incondicional, porque quem decidia era o teste.
 */
function valoresDaCondicao(no: unknown, saida: unknown[] = []): unknown[] {
  if (no === null || no === undefined) return saida;
  if (Array.isArray(no)) {
    for (const item of no) valoresDaCondicao(item, saida);
    return saida;
  }
  if (typeof no === 'object') {
    const nome = (no as { constructor?: { name?: string } }).constructor?.name;
    // StringChunk é o texto do SQL (" = ", " and "), não um valor amarrado.
    if (nome === 'StringChunk') return saida;
    if (nome === 'Param') {
      saida.push((no as { value: unknown }).value);
      return saida;
    }
    const chunks = (no as { queryChunks?: unknown }).queryChunks;
    if (chunks !== undefined) valoresDaCondicao(chunks, saida);
    return saida;
  }
  saida.push(no);
  return saida;
}

vi.mock('@desigual-os/database', () => {
  const tabela = {
    id: 'id',
    clientId: 'client_id',
    version: 'version',
    updatedAt: 'updated_at',
  };
  return {
    schema: { studioCanvasDocuments: tabela, studioProjects: {}, clients: {} },
    db: {
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: (condicao: unknown) => ({
            returning: () => {
              // Faz o que o Postgres faria: a linha só é pega se a condição
              // casar. A condição de versão é lida do SQL que a rota montou -
              // se a rota parar de condicionar, este teste fica vermelho.
              const versaoExigida = valoresDaCondicao(condicao).find((v) => typeof v === 'number') as
                | number
                | undefined;
              if (versaoExigida !== undefined && versaoExigida !== linha.version) return Promise.resolve([]);
              gravacoes.push(patch);
              linha.version += 1;
              if (patch.pages !== undefined) linha.pages = patch.pages as unknown[];
              if (patch.name !== undefined) linha.name = patch.name as string;
              return Promise.resolve([{ ...linha }]);
            },
          }),
        }),
      }),
      select: () => ({ from: () => ({ where: () => Promise.resolve([{ ...linha }]) }) }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ ...linha }]) }) }),
    },
  };
});

vi.mock('@desigual-os/auth', () => ({ hasPermission: () => true }));
vi.mock('../auth/middleware', () => ({
  requireAuth: async (request: { authUser?: unknown }) => {
    request.authUser = { id: 'user-a', email: 'a@desigual.com', roles: ['colaborador'], permissions: [] };
  },
  requirePermission: () => async () => {},
}));
vi.mock('../lib/access', () => ({ hasClientAccess: async () => true }));

const { registerCanvasDocumentRoutes } = await import('./canvas-routes');

async function subirApp() {
  const app = Fastify();
  await registerCanvasDocumentRoutes(app);
  return app;
}

function salvar(app: Awaited<ReturnType<typeof subirApp>>, corpo: Record<string, unknown>) {
  return app.inject({ method: 'PATCH', url: '/studio/canvas-documents/doc-1', payload: corpo });
}

describe('PATCH /studio/canvas-documents/:id — dois colaboradores no mesmo design', () => {
  beforeEach(() => {
    linha.version = 1;
    linha.pages = [];
    linha.name = 'Post';
    gravacoes.length = 0;
  });

  it('o primeiro a salvar grava e recebe a versão nova', async () => {
    const app = await subirApp();
    const r = await salvar(app, { name: 'Post da Ana', version: 1 });

    expect(r.statusCode).toBe(200);
    expect(r.json().version).toBe(2);
    expect(gravacoes).toHaveLength(1);
  });

  it('o SEGUNDO, com a versão velha, é RECUSADO — não apaga o trabalho do primeiro', async () => {
    const app = await subirApp();
    // Ana e Bruno abriram o mesmo design: os dois têm version 1 em mãos.
    await salvar(app, { name: 'Post da Ana', version: 1 });
    const bruno = await salvar(app, { name: 'Post do Bruno', version: 1 });

    expect(bruno.statusCode).toBe(409);
    expect(bruno.json().conflict).toBe(true);
    // O que está gravado continua sendo o da Ana.
    expect(linha.name).toBe('Post da Ana');
    expect(gravacoes).toHaveLength(1);
  });

  it('a resposta do conflito traz o estado ATUAL, pra dar como reconciliar', async () => {
    const app = await subirApp();
    await salvar(app, { name: 'Post da Ana', version: 1 });
    const bruno = await salvar(app, { name: 'Post do Bruno', version: 1 });

    const corpo = bruno.json();
    expect(corpo.document.name).toBe('Post da Ana');
    expect(corpo.document.version).toBe(2);
    expect(corpo.error).toMatch(/outra pessoa salvou/i);
  });

  it('recarregando (pegando a versão nova), Bruno consegue salvar', async () => {
    const app = await subirApp();
    await salvar(app, { name: 'Post da Ana', version: 1 });
    const recarregado = (await salvar(app, { name: 'x', version: 1 })).json().document.version;

    const bruno = await salvar(app, { name: 'Post do Bruno', version: recarregado });

    expect(bruno.statusCode).toBe(200);
    expect(linha.name).toBe('Post do Bruno');
  });

  it('cliente que não manda versão continua funcionando, mas ainda faz a versão avançar', async () => {
    // Compatibilidade: script/cliente antigo não quebra. E como a gravação
    // dele também incrementa, quem MANDA versão não fica cego pro que ele fez.
    const app = await subirApp();
    const r = await salvar(app, { name: 'de um script' });

    expect(r.statusCode).toBe(200);
    expect(r.json().version).toBe(2);
  });

  it('todo salvamento bem-sucedido devolve a versão, senão o editor não teria o que reenviar', async () => {
    const app = await subirApp();
    const primeira = await salvar(app, { name: 'a', version: 1 });
    const segunda = await salvar(app, { name: 'b', version: primeira.json().version });

    expect(segunda.json().version).toBe(primeira.json().version + 1);
  });
});
