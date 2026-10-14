import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { decidirEscopo, organizacaoProvedora } from '@desigual-os/auth';

/**
 * equipe-da-agencia.ts — A EQUIPE ENTRA NO CONTEXTO DE TODO TURNO.
 *
 * Pedido do Pedro (13/10/2026): "o Bento sabe de tudo — dos clientes, dos
 * colaboradores novos, dos colaboradores já em trabalho, da agência". Até
 * aqui o agente sabia de tarefas, dossiês e memória, mas não sabia QUEM
 * trabalha na casa: "quem é a Tammy?", "quem entrou essa semana?", "com
 * quem eu falo de tráfego?" não tinham fonte nenhuma no prompt.
 *
 * O recorte é o de autorização, não o conveniente: a pessoa vê a equipe das
 * empresas de que é membro (`decidirEscopo`, a mesma fronteira de
 * `colegasVisiveis` na API). Quem opera no nível da plataforma vê a equipe
 * da organização PROVEDORA — que é o que "a equipe da agência" quer dizer;
 * listar os usuários de todos os tenants seria vazamento, não visão.
 */
export interface MembroDaEquipe {
  userId?: string;
  nome: string;
  /** O que a pessoa FAZ na operação (Tráfego, Atendimento...). `users.job_title`. */
  funcao: string | null;
  /** Papel na empresa (owner/admin/collaborator), de organization_members. */
  papel: string;
  /** Quando entrou na empresa (created_at do vínculo, não do usuário). */
  entrouEm: Date | null;
  /** O e-mail que amarra a pessoa daqui à pessoa do ClickUp. */
  emailClickUp: string | null;
}

const JANELA_NOVO_DIAS = 30;

/** As empresas cuja equipe esta pessoa enxerga (a mesma decisão de buscarEquipeVisivel). */
export async function organizacoesVisiveis(userId: string): Promise<string[]> {
  const [vinculos, papeisRows] = await Promise.all([
    db.select({ organizationId: schema.organizationMembers.organizationId }).from(schema.organizationMembers).where(eq(schema.organizationMembers.userId, userId)),
    db
      .select({ roleName: schema.roles.name })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
      .where(eq(schema.userRoles.userId, userId)),
  ]);
  const escopo = decidirEscopo([...new Set(vinculos.map((v) => v.organizationId))], papeisRows.map((r) => r.roleName), organizacaoProvedora());
  return escopo.ehProvider ? [organizacaoProvedora()!] : escopo.organizationIds;
}

export async function buscarEquipeVisivel(userId: string): Promise<MembroDaEquipe[]> {
  // Os papéis da pessoa (para a decisão provider) e os vínculos dela saem em
  // paralelo: nenhum depende do outro.
  const [vinculos, papeisRows] = await Promise.all([
    db
      .select({ organizationId: schema.organizationMembers.organizationId })
      .from(schema.organizationMembers)
      .where(eq(schema.organizationMembers.userId, userId))
      .catch(() => [] as Array<{ organizationId: string }>),
    db
      .select({ roleName: schema.roles.name })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
      .where(eq(schema.userRoles.userId, userId))
      .catch(() => [] as Array<{ roleName: string }>),
  ]);

  const escopo = decidirEscopo(
    [...new Set(vinculos.map((v) => v.organizationId))],
    papeisRows.map((r) => r.roleName),
    organizacaoProvedora(),
  );

  /**
   * Provider lê a equipe da PROVEDORA (a agência), não a de todos os tenants.
   * Sem vínculo nenhum, não há equipe a mostrar — e inventar uma lista vazia
   * com cara de "ninguém trabalha aqui" seria pior que não ter o bloco.
   */
  const orgIds = escopo.ehProvider ? [organizacaoProvedora()!] : escopo.organizationIds;
  if (orgIds.length === 0) return [];

  const linhas = await db
    .select({
      userId: schema.users.id,
      nome: schema.users.name,
      funcao: schema.users.jobTitle,
      papel: schema.organizationMembers.role,
      entrouEm: schema.organizationMembers.createdAt,
      emailClickUp: schema.users.clickupEmail,
    })
    .from(schema.organizationMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
    .where(inArray(schema.organizationMembers.organizationId, orgIds))
    .catch(() => [] as MembroDaEquipe[]);

  return linhas
    .filter((l) => l.nome)
    .sort((a, b) => (a.entrouEm?.getTime() ?? 0) - (b.entrouEm?.getTime() ?? 0));
}

/**
 * O bloco de texto que entra no prompt. "Novo" é calculado, não cadastrado:
 * vínculo com menos de 30 dias. Quem pergunta "quem entrou essa semana?"
 * precisa de data de entrada, não de um adjetivo que alguém esqueceu de tirar.
 */
export function equipeEmTexto(membros: readonly MembroDaEquipe[], now: Date = new Date()): string | null {
  if (membros.length === 0) return null;

  const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
  const linhas = membros.map((m) => {
    const entrou = m.entrouEm ? fmt.format(m.entrouEm) : null;
    const ehNovo = m.entrouEm ? now.getTime() - m.entrouEm.getTime() < JANELA_NOVO_DIAS * 86_400_000 : false;
    const partes = [m.nome];
    if (m.funcao) partes.push(m.funcao);
    if (m.papel === 'owner' || m.papel === 'admin') partes.push(`papel: ${m.papel}`);
    const sufixo = [entrou ? `desde ${entrou}` : null, ehNovo ? 'NOVO(A)' : null].filter(Boolean).join(' ');
    return `- ${partes.filter(Boolean).join(' — ')}${sufixo ? ` (${sufixo})` : ''}`;
  });

  return [
    `A EQUIPE DESTA AGÊNCIA (${membros.length} pessoas; quem trabalha aqui, com função e data de entrada):`,
    ...linhas,
    'Quando perguntarem quem faz o quê, quem entrou há pouco, ou com quem falar sobre um assunto, é desta lista que você responde. Pessoa fora da lista não existe para você: não adivinhe nome nem função.',
  ].join('\n');
}

/**
 * A PRIMEIRA MENSAGEM DA PESSOA NO SISTEMA, contada e não adivinhada.
 *
 * A mensagem atual já está gravada quando isto roda (a rota de chat insere
 * antes de despachar; a automação idem), então exatamente UMA mensagem de
 * usuário desta pessoa em TODAS as conversas significa: é a primeira.
 * `limit 2` porque só o que importa é distinguir 1 de mais-de-1.
 *
 * Falha de leitura vira `false` pelo chamador: perder a boas-vindas é uma
 * degradação silenciosa aceitável; dar boas-vindas a quem já usa o sistema
 * há meses seria o erro visível.
 */
export async function ehPrimeiraMensagemDoUsuario(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
    .where(and(eq(schema.conversations.userId, userId), eq(schema.messages.role, 'user')))
    .limit(2);
  return rows.length === 1;
}

/**
 * QUEM PERGUNTA + EQUIPE + PRIMEIRA MENSAGEM, num bloco só, para o Bento.
 *
 * Medido no código em 13/10/2026: o bloco geral de contexto (onde a equipe e
 * as boas-vindas entraram em 8ea3d00) NUNCA chega ao Bento. A API o retém de
 * propósito (apps/api/src/chat/routes.ts), porque o serviço da GPU usava a
 * mensagem inteira como consulta vetorial e o bloco puxava documento errado.
 * O Bento só recebia o bloco do ClickUp, e só em pergunta reconhecida como
 * operacional. Em "o que é esse sistema?" ou "quem é a pessoa nova?" ele não
 * sabia quem estava do outro lado nem quem trabalha na casa.
 *
 * Este bloco vai só para o GPT, que não faz busca vetorial com a mensagem —
 * a proteção da GPU continua de pé. A boas-vindas vem primeiro porque dá o
 * tom da resposta inteira.
 */
// ---------------------------------------------------------------------------
// COMO CADA PESSOA TRABALHA (Bento 3.1, P1, 14/10/2026)
//
// O cadastro diz quem é a pessoa; isto diz como ela trabalha — o que a própria
// pessoa confirmou, o que a gestão registrou e o que um colega contou, cada um
// com o rótulo do que é (ver collaborator-fact.ts no worker, que grava). A
// procedência vai no texto porque é o modelo que precisa distinguir
// preferência confirmada de inferência na hora de responder.
// ---------------------------------------------------------------------------

export interface FatoDeColaboradorLido {
  userId: string;
  conteudo: string;
  classe: string;
  informadoPor: string | null;
  atualizadoEm: Date | null;
}

export async function fatosDosColaboradores(userIds: string[], organizationIds: string[]): Promise<FatoDeColaboradorLido[]> {
  if (userIds.length === 0 || organizationIds.length === 0) return [];
  const linhas = await db
    .select({
      userId: schema.memories.userId,
      conteudo: schema.memories.content,
      metadata: schema.memories.metadata,
      atualizadoEm: schema.memories.updatedAt,
    })
    .from(schema.memories)
    .where(
      and(
        eq(schema.memories.kind, 'collaborator.profile'),
        eq(schema.memories.status, 'active'),
        inArray(schema.memories.userId, userIds),
        // Fronteira de empresa: o que se sabe de alguém numa empresa não vaza
        // para outra em que a mesma pessoa também esteja.
        inArray(schema.memories.organizationId, organizationIds),
      ),
    )
    .orderBy(desc(schema.memories.updatedAt))
    .limit(60)
    .catch(() => []);
  return linhas.flatMap((l) => {
      if (!l.userId) return [];
      const m = (l.metadata ?? {}) as { classe?: unknown; informado_por_nome?: unknown };
      return [{
        userId: l.userId,
        conteudo: l.conteudo,
        classe: typeof m.classe === 'string' ? m.classe : 'INFERENCE',
        informadoPor: typeof m.informado_por_nome === 'string' ? m.informado_por_nome : null,
        atualizadoEm: l.atualizadoEm ?? null,
      }];
    });
}

const ROTULO_DA_CLASSE: Record<string, string> = {
  CONFIRMED_PREFERENCE: 'confirmado pela própria pessoa',
  FACT: 'registrado pela gestão',
  INFERENCE: 'NÃO confirmado',
};

/** Puro. `null` = nada registrado sobre ninguém e nada a sugerir. */
export function fatosDaEquipeEmTexto(fatos: readonly FatoDeColaboradorLido[], quemPerguntaId: string | null): string | null {
  const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
  const linha = (f: FatoDeColaboradorLido) => {
    const quando = f.atualizadoEm ? `, ${fmt.format(f.atualizadoEm)}` : '';
    const porQuem = f.classe === 'INFERENCE' && f.informadoPor ? `; informado por ${f.informadoPor}` : '';
    return `- ${f.conteudo} [${ROTULO_DA_CLASSE[f.classe] ?? 'NÃO confirmado'}${porQuem}${quando}]`;
  };
  const meus = fatos.filter((f) => f.userId === quemPerguntaId);
  const dosOutros = fatos.filter((f) => f.userId !== quemPerguntaId);
  const blocos: string[] = [];
  if (meus.length > 0) {
    blocos.push(
      [
        'COMO QUEM PERGUNTA PREFERE TRABALHAR (registrado; use ao preparar trabalho para esta pessoa):',
        ...meus.map(linha),
      ].join('\n'),
    );
  } else if (quemPerguntaId) {
    blocos.push(
      'Não há preferência de trabalho registrada para quem pergunta. Se o pedido depender disso (formato de briefing, como quer receber uma demanda), responda primeiro e, no fim, faça UMA pergunta curta e sugira "anota que eu prefiro...". Não pergunte se o pedido não depende disso.',
    );
  }
  if (dosOutros.length > 0) {
    blocos.push(
      [
        'COMO A EQUIPE TRABALHA (cada linha diz de onde veio):',
        ...dosOutros.map(linha),
        'Preferência de uma pessoa vale para o trabalho DELA, nunca como regra da agência. "NÃO confirmado" é pista, não fato: diga que foi informado por alguém.',
      ].join('\n'),
    );
  }
  return blocos.length > 0 ? blocos.join('\n\n') : null;
}

export interface QuemPergunta {
  nome: string;
  funcao: string | null;
  emailClickUp: string | null;
}

export function pessoaEEquipeEmTexto(params: {
  quemPergunta: QuemPergunta | null;
  primeiraMensagem: boolean;
  equipe: string | null;
  comoTrabalham?: string | null;
}): string | null {
  const linhas: string[] = [];
  const nome = params.quemPergunta?.nome;
  if (params.primeiraMensagem && nome) {
    linhas.push(
      `Esta é a PRIMEIRA mensagem que ${nome} manda no sistema. Abra a resposta com boas-vindas curtas e calorosas pelo nome, diga em UMA frase o que você faz (acompanha a operação, os clientes, as tarefas e a memória da agência) e só então responda ao que foi perguntado. Não faça tour nem lista de funcionalidades.`,
    );
  }
  if (params.quemPergunta) {
    const q = params.quemPergunta;
    const detalhes = [q.funcao ? `função: ${q.funcao}` : null, q.emailClickUp ? `e-mail no ClickUp: ${q.emailClickUp}` : null]
      .filter(Boolean)
      .join('; ');
    linhas.push(
      `QUEM ESTÁ PERGUNTANDO: ${q.nome}${detalhes ? ` (${detalhes})` : ''}. "Eu", "meu" e "minhas" na pergunta se referem a esta pessoa.`,
    );
  }
  if (params.equipe) linhas.push(params.equipe);
  if (params.comoTrabalham) linhas.push(params.comoTrabalham);
  return linhas.length > 0 ? linhas.join('\n\n') : null;
}

export async function blocoDePessoaEEquipe(userId: string): Promise<string | null> {
  const [pessoa, equipe, primeiraMensagem] = await Promise.all([
    db
      .select({ nome: schema.users.name, funcao: schema.users.jobTitle, email: schema.users.email, clickupEmail: schema.users.clickupEmail })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1)
      .then((r) => r[0] ?? null)
      .catch(() => null),
    buscarEquipeVisivel(userId).catch(() => [] as MembroDaEquipe[]),
    ehPrimeiraMensagemDoUsuario(userId).catch(() => false),
  ]);
  // BENTO_COLLABORATOR_CONTEXT (padrão desligado): o mesmo flag que liga a
  // captura no worker (collaborator-fact.ts). Desligado, o bloco é o de antes.
  const ligado = ['true', '1', 'on'].includes((process.env.BENTO_COLLABORATOR_CONTEXT ?? '').trim().toLowerCase());
  const orgIds = ligado ? await organizacoesVisiveis(userId).catch(() => [] as string[]) : [];
  const ids = [...new Set([userId, ...equipe.map((m) => m.userId).filter((id): id is string => Boolean(id))])];
  const fatos = ligado ? await fatosDosColaboradores(ids, orgIds).catch(() => [] as FatoDeColaboradorLido[]) : [];
  return pessoaEEquipeEmTexto({
    quemPergunta: pessoa
      ? { nome: pessoa.nome, funcao: pessoa.funcao, emailClickUp: pessoa.clickupEmail ?? pessoa.email }
      : null,
    primeiraMensagem,
    equipe: equipeEmTexto(equipe),
    comoTrabalham: ligado ? fatosDaEquipeEmTexto(fatos, userId) : null,
  });
}
