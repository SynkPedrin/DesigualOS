import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { decidirEscopo, decidirOrganizacaoDeTrabalho } from '@desigual-os/auth';
import type { AuthenticatedUser } from '../auth/middleware';
import {
  escopoDeOrganizacao,
  organizacaoProvedora,
  type EscopoDeOrganizacao,
} from '../lib/escopo-de-organizacao';

/**
 * contexto.ts — entrar numa empresa e sair dela.
 *
 * É o que transforma "existem várias empresas no banco" em "eu consigo
 * trabalhar dentro de uma delas". Sem isto, a tela de Empresas lista contas que
 * ninguém consegue abrir.
 *
 * A REGRA QUE DECIDE O DESENHO: quem valida é o SERVIDOR, e o resultado fica no
 * banco.
 *
 * A alternativa fácil seria `?org=<id>` na URL. Ela não pode ser usada, e o
 * motivo não é estilo: a barra de endereço viraria superfície de autorização.
 * Qualquer pessoa trocaria o id e o servidor teria que confiar no que o
 * navegador mandou — o bypass exato que a fronteira entre empresas existe para
 * impedir. A URL pode REFLETIR a empresa para a pessoa se situar; a decisão de
 * quem pode entrar onde nunca sai daqui.
 *
 * TRÊS COISAS SÃO CONFERIDAS, e cada uma cobre um caso real:
 *
 *   1. a empresa existe;
 *   2. a pessoa é membro dela — ou é o provedor, que atende todas;
 *   3. a empresa está ATIVA. Uma conta suspensa não pode ser aberta nem por
 *      quem é membro, senão "suspender" é só um rótulo na tela.
 */

export interface ResultadoDaTroca {
  ok: boolean;
  /** Por que não deu, em linguagem de gente. `null` quando deu certo. */
  motivo: string | null;
  organizacao: { id: string; name: string; slug: string } | null;
}

/**
 * Entra numa empresa. `null` sai de qualquer empresa e volta ao contexto do
 * provedor — que é o estado normal de quem pertence a uma organização só.
 */
export async function trocarOrganizacaoAtiva(
  user: AuthenticatedUser,
  organizationId: string | null,
): Promise<ResultadoDaTroca> {
  if (organizationId === null) {
    await db
      .update(schema.users)
      .set({ organizacaoAtivaId: null })
      .where(eq(schema.users.id, user.id));
    return { ok: true, motivo: null, organizacao: null };
  }

  const [org] = await db
    .select({
      id: schema.organizations.id,
      name: schema.organizations.name,
      slug: schema.organizations.slug,
      status: schema.organizations.status,
    })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .catch(() => []);

  /**
   * "Não existe" e "você não pode" respondem a MESMA coisa de propósito: dizer
   * "essa empresa existe, mas não é sua" confirma a existência de uma conta
   * para quem não deveria saber que ela existe.
   */
  if (!org) return { ok: false, motivo: 'Empresa não encontrada.', organizacao: null };

  const escopo = await escopoDeOrganizacao(user);
  const ehMembro = escopo.organizationIds.includes(org.id);
  if (!ehMembro && !escopo.ehProvider) {
    return { ok: false, motivo: 'Empresa não encontrada.', organizacao: null };
  }

  if (org.status !== 'ativa') {
    return {
      ok: false,
      motivo: `A empresa ${org.name} está ${org.status}. Reative-a antes de entrar.`,
      organizacao: null,
    };
  }

  await db
    .update(schema.users)
    .set({ organizacaoAtivaId: org.id })
    .where(eq(schema.users.id, user.id));

  /**
   * Toda troca é auditada. É o registro que responde "quem entrou na conta de
   * qual cliente, quando" — pergunta que aparece no dia em que algo for
   * alterado na empresa errada.
   */
  await db
    .insert(schema.auditLogs)
    .values({
      userId: user.id,
      organizationId: org.id,
      action: 'organization.enter',
      result: 'success',
      source: 'app',
      metadata: { slug: org.slug, como: escopo.ehProvider && !ehMembro ? 'provedor' : 'membro' },
    })
    .catch(() => undefined);

  return { ok: true, motivo: null, organizacao: { id: org.id, name: org.name, slug: org.slug } };
}

/**
 * A empresa em que a pessoa está agora, já validada.
 *
 * Revalida o vínculo em vez de confiar na coluna: alguém pode ter sido removido
 * da empresa DEPOIS de entrar nela, e nesse caso o contexto salvo passa a ser
 * uma permissão vencida guardada no banco.
 */
export async function organizacaoAtivaDe(
  user: AuthenticatedUser,
  escopoJaLido?: EscopoDeOrganizacao,
): Promise<{ id: string; name: string; slug: string } | null> {
  const [linha] = await db
    .select({ ativa: schema.users.organizacaoAtivaId })
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .catch(() => []);

  if (!linha?.ativa) return null;

  /**
   * `escopoJaLido` não é micro-otimização: foi uma regressão medida. Quando
   * `/me` passou a resolver a empresa de trabalho, `escopoDeOrganizacao` caiu
   * três vezes na MESMA requisição — e `/me` é chamado em toda navegação. Com
   * `DATABASE_POOL_MAX=3`, a rota foi de instantânea para 2,2s e a home passou
   * a estourar o tempo do painel. Com o pool desse tamanho, ida ao banco
   * repetida não é desperdício: é fila.
   */
  const escopo = escopoJaLido ?? (await escopoDeOrganizacao(user));
  if (!escopo.ehProvider && !escopo.organizationIds.includes(linha.ativa)) {
    // Vínculo perdido desde a entrada: limpa e volta ao provedor, em silêncio
    // para a pessoa mas sem manter o acesso.
    await db.update(schema.users).set({ organizacaoAtivaId: null }).where(eq(schema.users.id, user.id));
    return null;
  }

  const [org] = await db
    .select({ id: schema.organizations.id, name: schema.organizations.name, slug: schema.organizations.slug })
    .from(schema.organizations)
    .where(and(eq(schema.organizations.id, linha.ativa), eq(schema.organizations.status, 'ativa')))
    .catch(() => []);

  return org ?? null;
}

export interface MarcaDaOrganizacao {
  /** Nomes em inglês de propósito: é o shape que o brand-provider do web lê
   *  (`--color-brand-primary` etc.). Traduzir aqui quebraria a tela em
   *  silêncio — o front nunca acharia `corPrimaria`. */
  primary: string | null;
  secondary: string | null;
  /** Reservado para o sistema de tokens; não há coluna para ele ainda. */
  accent: string | null;
  logo_url: string | null;
  nome_assistente: string | null;
}

export interface ContextoCompleto {
  escopo: EscopoDeOrganizacao;
  /** Todas as empresas em que a pessoa é membro, já com nome. */
  organizacoes: { id: string; name: string }[];
  /** A que ela abriu de propósito, validada. `null` = contexto do provedor. */
  ativa: { id: string; name: string; slug: string; marca: MarcaDaOrganizacao } | null;
  /** Onde ela está trabalhando agora. Nunca nula quando há vínculo.
   *  `eh_provedora` é a identidade ESTÁVEL da provedora (id comparado ao
   *  PROVIDER_ORGANIZATION_ID do ambiente) — substitui o regex no nome que o
   *  front usava para saber se está "dentro de um tenant". */
  deTrabalho: { id: string; name: string; slug: string; marca: MarcaDaOrganizacao; eh_provedora: boolean } | null;
}

/**
 * TUDO O QUE `/me` PRECISA SABER SOBRE EMPRESA, EM UMA IDA AO BANCO.
 *
 * MEDIDO EM 01/10/2026, e é o número que explica a função: cada consulta
 * trivial contra este banco custa ~300ms. Não é custo de consulta — `select
 * organization_id from organization_members where user_id = $1` devolve duas
 * linhas de uma tabela de onze. São 300ms de ida e volta de REDE, porque o
 * banco é remoto.
 *
 * Com isso, "quantas consultas" deixa de ser questão de elegância e vira a
 * latência inteira da rota. O `/me` fazia quatro em sequência — vínculos,
 * nomes das empresas, empresa ativa, dados da empresa ativa — e levava 1,3s.
 * Numa rota que TODA navegação chama, isso é um terço de segundo colado em
 * cada clique, e foi o que fez o painel da home estourar os 20 segundos do
 * teste debaixo de carga.
 *
 * A consulta abaixo traz tudo junto: as empresas de que a pessoa é membro, e
 * a empresa ativa MESMO QUANDO ela não é membro dela — que é o caso do
 * provedor visitando um cliente, e a razão de o `left join` não bastar
 * sozinho.
 *
 * A REGRA NÃO MUDOU, só o número de viagens: quem decide continua sendo
 * `decidirEscopo` e `decidirOrganizacaoDeTrabalho`, as mesmas funções puras
 * que o middleware usa. Juntar consultas não pode virar a desculpa para a
 * fronteira entre empresas ser decidida em SQL ad hoc.
 */
export async function contextoCompletoDe(user: AuthenticatedUser): Promise<ContextoCompleto> {
  const bruto: unknown = await db
    .execute(
      sql`with eu as (select id, organizacao_ativa_id from users where id = ${user.id}::uuid)
          select o.id,
                 o.name,
                 o.slug,
                 o.status,
                 o.cor_primaria,
                 o.cor_secundaria,
                 o.logo_url,
                 o.nome_assistente,
                 (om.user_id is not null) as sou_membro,
                 (o.id = (select organizacao_ativa_id from eu)) as eh_ativa
          from organizations o
          left join organization_members om
            on om.organization_id = o.id and om.user_id = (select id from eu)
          where om.user_id is not null
             or o.id = (select organizacao_ativa_id from eu)`,
    )
    .catch(() => null);

  const linhas = (((bruto as { rows?: unknown[] } | null)?.rows ?? (bruto as unknown[] | null) ?? []) as Array<{
    id: string;
    name: string;
    slug: string;
    status: string;
    cor_primaria: string | null;
    cor_secundaria: string | null;
    logo_url: string | null;
    nome_assistente: string | null;
    sou_membro: boolean;
    eh_ativa: boolean;
  }>);

  /**
   * A marca vem na MESMA consulta — quatro colunas a mais numa query que já
   * existia, não uma ida nova ao banco (a nota de latência acima vale para
   * ela também). É o que faz o brand-provider do web deixar de ser no-op:
   * `/me` passa a devolver `organizacao_ativa.marca` no shape exato que ele
   * lê (primary/secondary/accent), e a tela re-tematiza sem nenhuma tela
   * precisar mudar.
   */
  const marcaDe = (l: (typeof linhas)[number]): MarcaDaOrganizacao => ({
    primary: l.cor_primaria,
    secondary: l.cor_secundaria,
    accent: null,
    logo_url: l.logo_url,
    nome_assistente: l.nome_assistente,
  });

  const membros = linhas.filter((l) => l.sou_membro);
  const escopo = decidirEscopo(
    membros.map((l) => l.id),
    user.roles,
    organizacaoProvedora(),
  );

  const linhaAtiva = linhas.find((l) => l.eh_ativa) ?? null;

  /**
   * As MESMAS duas condições de `organizacaoAtivaDe`, aplicadas em memória:
   * a empresa precisa estar ativa, e o vínculo precisa continuar valendo. A
   * segunda é a que importa — alguém pode ter sido removido da empresa DEPOIS
   * de entrar nela, e aí o contexto salvo é permissão vencida guardada no
   * banco.
   */
  const ativaVale =
    linhaAtiva !== null &&
    linhaAtiva.status === 'ativa' &&
    (escopo.ehProvider || escopo.organizationIds.includes(linhaAtiva.id));

  if (linhaAtiva && !ativaVale && !escopo.ehProvider && !escopo.organizationIds.includes(linhaAtiva.id)) {
    // Limpa o contexto vencido. Em silêncio para a pessoa, mas sem manter o
    // acesso. Não bloqueia a resposta: se falhar, a validação acima já barrou.
    void db
      .update(schema.users)
      .set({ organizacaoAtivaId: null })
      .where(eq(schema.users.id, user.id))
      .catch(() => undefined);
  }

  const ativa = ativaVale && linhaAtiva ? { id: linhaAtiva.id, name: linhaAtiva.name, slug: linhaAtiva.slug, marca: marcaDe(linhaAtiva) } : null;

  const escolha = decidirOrganizacaoDeTrabalho({
    pedida: null,
    ativa: ativa?.id ?? null,
    vinculos: escopo.organizationIds,
    provedora: organizacaoProvedora(),
    ehProvider: escopo.ehProvider,
  });

  const linhaTrabalho = escolha.ok ? (linhas.find((l) => l.id === escolha.organizationId) ?? null) : null;

  return {
    escopo,
    organizacoes: membros.map((l) => ({ id: l.id, name: l.name })),
    ativa,
    deTrabalho: linhaTrabalho
      ? {
          id: linhaTrabalho.id,
          name: linhaTrabalho.name,
          slug: linhaTrabalho.slug,
          marca: marcaDe(linhaTrabalho),
          eh_provedora: linhaTrabalho.id === organizacaoProvedora(),
        }
      : null,
  };
}

/**
 * A empresa em que a pessoa está TRABALHANDO — que não é a mesma pergunta que
 * `organizacaoAtivaDe`.
 *
 * "Ativa" é o que a pessoa abriu de propósito, e é `null` na maior parte do
 * tempo. "De trabalho" nunca é nula quando há vínculo: quando ninguém abriu
 * nada, ela resolve pela mesma escada que o middleware usa — vínculo único,
 * depois a provedora.
 *
 * ESTA FUNÇÃO EXISTE PARA QUE `/me` E `requireTenant` NÃO DIVIRJAM. Enquanto
 * `/me` respondia `organizacoes[0]` e o middleware resolvia pela regra, a
 * interface podia dizer "você está na Cosentino" e a gravação cair na Desigual
 * — o mesmo formato de defeito que acabou de derrubar a tela de Clientes, uma
 * porta a menos. Ordem de linha do banco não é autoridade sobre nada.
 *
 * `opcoes.pedida` cobre o cabeçalho `x-organization-id` do middleware; `/me`
 * chama sem ele. `opcoes.escopo` evita reler o que quem chama já leu — ver a
 * nota sobre o pool em `organizacaoAtivaDe`.
 */
export async function organizacaoDeTrabalhoDe(
  user: AuthenticatedUser,
  opcoes: { pedida?: string | null; escopo?: EscopoDeOrganizacao } = {},
): Promise<{ id: string; name: string; slug: string } | null> {
  const escopo = opcoes.escopo ?? (await escopoDeOrganizacao(user));

  /**
   * Os vínculos saem do escopo que já foi lido — é a MESMA consulta
   * (`organization_members` por usuário) que `escopoDeOrganizacao` acabou de
   * fazer. Repeti-la aqui era uma ida ao banco para reconfirmar o que já
   * estava em memória.
   *
   * A diferença que resta: `escopoDeOrganizacao` não filtra conta desativada.
   * Quem está desativado não autentica, então não chega aqui — e quem desativa
   * alguém no meio da sessão precisa que a autenticação a derrube, não que uma
   * resolução de contexto a contorne.
   */
  const vinculos = escopo.organizationIds;

  const ativa = await organizacaoAtivaDe(user, escopo);

  const escolha = decidirOrganizacaoDeTrabalho({
    pedida: opcoes.pedida ?? null,
    ativa: ativa?.id ?? null,
    vinculos,
    provedora: organizacaoProvedora(),
    ehProvider: escopo.ehProvider,
  });

  if (!escolha.ok) return null;
  if (ativa && ativa.id === escolha.organizationId) return ativa;

  const [org] = await db
    .select({ id: schema.organizations.id, name: schema.organizations.name, slug: schema.organizations.slug })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, escolha.organizationId))
    .catch(() => []);

  return org ?? null;
}
