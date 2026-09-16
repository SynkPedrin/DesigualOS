/**
 * clickup-crawl.mts — leitura da hierarquia inteira do ClickUp.
 *
 * Só LÊ. Nenhuma escrita, nenhum write scope envolvido. É a fonte de verdade
 * da reconciliação: sem enumerar tudo não há como responder "o que existe na
 * fonte e não está no índice?", que é a pergunta central deste release.
 */
const BASE = 'https://api.clickup.com/api/v2';

export interface CrawlTask {
  id: string;
  name: string;
  status: string | null;
  closed: boolean;
  listId: string;
  listName: string;
  space: string;
  folder: string | null;
  assignees: Array<{ id: string; username: string; email: string | null }>;
  parent: string | null;
  description: string;
  updatedAt: Date | null;
  createdAt: Date | null;
}

export interface CrawlList {
  id: string;
  name: string;
  space: string;
  folder: string | null;
}

export interface CrawlResult {
  lists: CrawlList[];
  tasks: CrawlTask[];
  members: Array<{ id: string; username: string; email: string }>;
  apiCalls: number;
}

function comData(raw: unknown): Date | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? new Date(n) : null;
}

export async function crawlClickUp(
  apiKey: string,
  teamId: string,
  log: (m: string) => void = () => {},
): Promise<CrawlResult> {
  const H = { Authorization: apiKey };
  let apiCalls = 0;

  async function get(url: string): Promise<any> {
    apiCalls += 1;
    // 429 do ClickUp é esperado num crawl inteiro; recuar e repetir é parte do
    // caminho feliz, não tratamento de erro exótico.
    for (let tentativa = 0; tentativa < 5; tentativa += 1) {
      const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(30_000) }).catch(() => null);
      if (!r) { await new Promise((s) => setTimeout(s, 2000)); continue; }
      if (r.status === 429) { await new Promise((s) => setTimeout(s, 3000 * (tentativa + 1))); continue; }
      if (!r.ok) return {};
      return r.json();
    }
    return {};
  }

  const membersRaw = await get(`${BASE}/team`);
  const time = (membersRaw.teams ?? []).find((t: any) => t.id === teamId) ?? (membersRaw.teams ?? [])[0];
  const members = (time?.members ?? []).map((m: any) => ({
    id: String(m.user.id), username: String(m.user.username ?? ''), email: String(m.user.email ?? ''),
  }));

  const spaces = (await get(`${BASE}/team/${teamId}/space?archived=false`)).spaces ?? [];
  const lists: CrawlList[] = [];
  for (const s of spaces) {
    const folders = (await get(`${BASE}/space/${s.id}/folder?archived=false`)).folders ?? [];
    for (const f of folders) {
      for (const l of f.lists ?? []) lists.push({ id: String(l.id), name: String(l.name), space: s.name, folder: f.name });
    }
    const soltas = (await get(`${BASE}/space/${s.id}/list?archived=false`)).lists ?? [];
    for (const l of soltas) lists.push({ id: String(l.id), name: String(l.name), space: s.name, folder: null });
  }
  log(`spaces ${spaces.length} | listas ${lists.length}`);

  const tasks: CrawlTask[] = [];
  for (const l of lists) {
    for (let page = 0; page < 30; page += 1) {
      const j = await get(`${BASE}/list/${l.id}/task?archived=false&include_closed=true&subtasks=true&page=${page}`);
      const lote = j.tasks ?? [];
      for (const t of lote) {
        tasks.push({
          id: String(t.id),
          name: String(t.name ?? ''),
          status: t.status?.status ?? null,
          // "encerrado"/"complete" varia por lista; o campo date_closed é o
          // único sinal uniforme de que a task saiu do fluxo.
          closed: Boolean(t.date_closed) || ['closed', 'complete', 'encerrado'].includes(String(t.status?.status ?? '').toLowerCase()),
          listId: l.id,
          listName: l.name,
          space: l.space,
          folder: l.folder,
          assignees: (t.assignees ?? []).map((a: any) => ({ id: String(a.id), username: String(a.username ?? ''), email: a.email ?? null })),
          parent: t.parent ? String(t.parent) : null,
          description: String(t.description ?? '').slice(0, 8000),
          updatedAt: comData(t.date_updated),
          createdAt: comData(t.date_created),
        });
      }
      if (lote.length < 100) break;
    }
  }
  log(`tasks ${tasks.length} | chamadas ${apiCalls}`);
  return { lists, tasks, members, apiCalls };
}
