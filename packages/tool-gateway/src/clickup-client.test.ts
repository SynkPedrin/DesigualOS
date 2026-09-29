import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSafeAttachmentUrl, createTask, getTask, getTeamMembers, resolveMemberByName, uploadTaskAttachment } from './clickup-client';

/**
 * Cobertura do timeout de rede adicionado na auditoria de production
 * readiness (2026-09): todo fetch pro ClickUp sai com AbortSignal de 20s e
 * um estouro de timeout vira mensagem legível, porque os call sites (rotas
 * da API) só propagam error.message.
 */

const CONFIG = { apiKey: 'pk_fake', teamId: 'T1' };

afterEach(() => vi.unstubAllGlobals());

describe('resolveMemberByName — rede de segurança contra verbo colado no nome (achado real de QA 25/09/2026)', () => {
  const membros = () =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ team: { members: [{ user: { id: 1, username: 'Jamile Galdino', email: 'j@x.com', profilePicture: null } }] } }),
      })),
    );

  it('"remove Jamile Galdino" resolve pro membro "Jamile Galdino" (não procura por um membro chamado "remove Jamile Galdino")', async () => {
    membros();
    const resolution = await resolveMemberByName(CONFIG, 'remove Jamile Galdino');
    expect(resolution.status).toBe('resolved');
    if (resolution.status === 'resolved') expect(resolution.member.username).toBe('Jamile Galdino');
  });

  it('"tira a Jamile Galdino" também resolve (verbo + preposição)', async () => {
    membros();
    const resolution = await resolveMemberByName(CONFIG, 'tira a Jamile Galdino');
    expect(resolution.status).toBe('resolved');
  });

  it('nome sem verbo continua resolvendo normalmente (sem falso positivo na stripagem)', async () => {
    membros();
    const resolution = await resolveMemberByName(CONFIG, 'Jamile Galdino');
    expect(resolution.status).toBe('resolved');
  });
});

describe('timeout de rede nos fetches do ClickUp', () => {
  it('getTeamMembers sai com AbortSignal de timeout', async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ team: { members: [] } }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock);

    await getTeamMembers(CONFIG);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('createTask também sai com signal (método POST, não só GETs)', async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'abc', url: 'https://app.clickup.com/t/abc' }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock);

    await createTask(CONFIG, { listId: 'L1', name: 'Tarefa' });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('timeout vira mensagem legível em pt-BR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
      }),
    );
    await expect(getTeamMembers(CONFIG)).rejects.toThrow(/não respondeu em 20s/);
  });

  it('erros que não são timeout seguem propagando intactos', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    await expect(getTeamMembers(CONFIG)).rejects.toThrow('fetch failed');
  });
});

/**
 * P1-09 (release readiness audit, 22/09/2026): `uploadTaskAttachment`
 * recebia `fileUrl` de `z.string().url()` (validação de FORMATO, não de
 * DESTINO) e baixava de onde quer que apontasse — SSRF clássico: metadata de
 * nuvem, localhost, serviço interno. Anexo real deste sistema só existe no
 * nosso próprio Storage; a correção restringe a origem a isso.
 */
describe('assertSafeAttachmentUrl — SSRF: anexo só do nosso Storage', () => {
  const env = { SUPABASE_URL: 'https://xyzcompany.supabase.co' } as NodeJS.ProcessEnv;

  it('aceita URL do nosso bucket público de storage', () => {
    expect(() => assertSafeAttachmentUrl('https://xyzcompany.supabase.co/storage/v1/object/public/user-uploads/foo.png', env)).not.toThrow();
  });

  it.each([
    ['metadata de nuvem (AWS/GCP)', 'https://169.254.169.254/latest/meta-data/iam/security-credentials/'],
    ['localhost', 'https://localhost:5432/admin'],
    ['IP privado (rede interna)', 'https://10.0.0.5/internal-api'],
    ['outro host qualquer, mesmo https', 'https://attacker.example.com/payload'],
    ['nosso host mas fora do prefixo de storage público', 'https://xyzcompany.supabase.co/rest/v1/users'],
    ['nosso host mas com bucket certo NA QUERY, não no path (bypass tentando enganar startsWith)', 'https://attacker.example.com/x?u=https://xyzcompany.supabase.co/storage/v1/object/public/'],
  ])('rejeita %s', (_label, url) => {
    expect(() => assertSafeAttachmentUrl(url, env)).toThrow();
  });

  it('rejeita http:// mesmo que fosse o host certo — só https', () => {
    expect(() => assertSafeAttachmentUrl('http://xyzcompany.supabase.co/storage/v1/object/public/user-uploads/foo.png', env)).toThrow(/https/);
  });

  it('sem SUPABASE_URL configurada, falha fechado — nada passa', () => {
    expect(() => assertSafeAttachmentUrl('https://xyzcompany.supabase.co/storage/v1/object/public/user-uploads/foo.png', {} as NodeJS.ProcessEnv)).toThrow(/SUPABASE_URL/);
  });

  it('URL malformada não derruba o processo, só rejeita', () => {
    expect(() => assertSafeAttachmentUrl('não é uma url', env)).toThrow();
  });
});

/**
 * P1-priority (release readiness, achado real no E2E de release,
 * 22/09/2026): a leitura de QUALQUER task com prioridade definida quebrava
 * — inclusive DELETE, que sempre relê a task antes de apagar. Causa:
 * `priority.priority` do ClickUp é o RÓTULO em texto ("high"/"urgent"/
 * "normal"/"low"), não o dígito — só `priority.id` é o número 1-4.
 * Reproduzido com a resposta REAL batida direto na API pra confirmar o
 * formato: `{"color":"#f8ae00","id":"2","orderindex":"2","priority":"high"}`.
 */
describe('getTask — prioridade do ClickUp é rótulo em texto, não o dígito', () => {
  const RESPOSTA_BASE = { id: 't1', name: 'X', status: null, due_date: null, list: { id: 'L1' }, assignees: [], description: '', attachments: [] };

  it('task com prioridade "alta" (id "2", rótulo "high") lê priority: 2', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ ...RESPOSTA_BASE, priority: { color: '#f8ae00', id: '2', orderindex: '2', priority: 'high' } }),
    })));
    const t = await getTask(CONFIG, 't1');
    expect(t.priority).toBe(2);
  });

  it('task sem prioridade nenhuma (priority: null) lê priority: null, não quebra', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ...RESPOSTA_BASE, priority: null }) })));
    const t = await getTask(CONFIG, 't1');
    expect(t.priority).toBeNull();
  });

  it.each([
    ['1', 'urgent'], ['2', 'high'], ['3', 'normal'], ['4', 'low'],
  ])('id "%s" (rótulo "%s") lê o dígito certo', async (id, label) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ ...RESPOSTA_BASE, priority: { color: '#x', id, orderindex: id, priority: label } }),
    })));
    const t = await getTask(CONFIG, 't1');
    expect(t.priority).toBe(Number(id));
  });
});

describe('uploadTaskAttachment recusa SSRF antes de qualquer fetch', () => {
  const CONFIG_ATTACH = { apiKey: 'pk_fake', teamId: 'T1' };

  it('URL fora do Storage nunca chega a fazer fetch nenhum', async () => {
    const original = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = 'https://xyzcompany.supabase.co';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(uploadTaskAttachment(CONFIG_ATTACH, 'task-1', 'https://169.254.169.254/latest/meta-data/', 'x.png')).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = original;
    }
  });
});

/**
 * Relato da Tammy (29/09/2026), no fluxo que mais importa: ela pediu a ata,
 * desmembrou as demandas e, na hora de subir a task, leu "No ClickUp member
 * matches Guilherme". No ClickUp ele está como "Gui".
 *
 * O elenco aqui é o REAL do workspace, com as duas armadilhas que tornam
 * casamento aproximado perigoso: existe "Gi" além de "Gui", e existem dois
 * "Gabriel".
 */
describe('apelido cadastrado: a pessoa fala o nome inteiro, o ClickUp tem o apelido', () => {
  const equipe = () =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          team: {
            members: [
              { user: { id: 10, username: 'Gui', email: 'gui@x.com', profilePicture: null } },
              { user: { id: 11, username: 'Gi', email: 'gi@x.com', profilePicture: null } },
              { user: { id: 12, username: 'Gabriel Prado', email: 'gp@x.com', profilePicture: null } },
              { user: { id: 13, username: 'Gabriel Serafim Sena', email: 'gs@x.com', profilePicture: null } },
              { user: { id: 14, username: 'Ana Luiza', email: 'al@x.com', profilePicture: null } },
              { user: { id: 15, username: 'Tammy', email: 't@x.com', profilePicture: null } },
            ],
          },
        }),
      })),
    );

  /**
   * Correção da operação no mesmo dia, e é a parte que importa: ele NÃO deve
   * atribuir. "Ele não achou o Gui, ele tem que perguntar — não encontrei o
   * Guilherme, achei o Gui, é ele?"
   *
   * Atribuir tarefa por semelhança de nome é o tipo de acerto que ninguém
   * confere e o tipo de erro que ninguém percebe.
   */
  it('o caso da Tammy: "Guilherme" SUGERE o "Gui", e não atribui sozinho', async () => {
    equipe();
    const r = await resolveMemberByName(CONFIG, 'Guilherme');
    expect(r.status).toBe('sugestao');
    if (r.status === 'sugestao') expect(r.sugerido.username).toBe('Gui');
  });

  /** "Gi" tem 2 letras e não pode virar chave de casamento de nome nenhum. */
  it('apelido de 2 letras não casa: "Gilberto" não vira "Gi"', async () => {
    equipe();
    expect((await resolveMemberByName(CONFIG, 'Gilberto')).status).toBe('not_found');
  });

  /** Nome composto não é apelido: senão "Anabela" viraria "Ana Luiza". */
  it('nome cadastrado com dois tokens não entra na regra', async () => {
    equipe();
    expect((await resolveMemberByName(CONFIG, 'Anabela')).status).toBe('not_found');
  });

  it('o casamento exato continua ganhando do apelido', async () => {
    equipe();
    const r = await resolveMemberByName(CONFIG, 'Gui');
    expect(r.status).toBe('resolved');
    if (r.status === 'resolved') expect(r.matchedBy).toBe('full');
  });

  /** Dois Gabriel: pergunta, nunca escolhe. Errar a pessoa é pior que não achar. */
  it('nome que serve pra duas pessoas continua ambíguo', async () => {
    equipe();
    const r = await resolveMemberByName(CONFIG, 'Gabriel');
    expect(r.status).toBe('ambiguous');
    if (r.status === 'ambiguous') expect(r.candidates).toHaveLength(2);
  });
});
