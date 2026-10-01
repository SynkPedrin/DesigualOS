import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import type { AuthenticatedUser } from '../auth/middleware';
import { escopoDeOrganizacao } from '../lib/escopo-de-organizacao';
import { normalizarSlug, slugEhValido } from './criar';

/**
 * ficha.ts — LER e CONFIGURAR uma empresa.
 *
 * O que faltava para a fábrica virar produto. Até aqui dava para criar uma
 * empresa e entrar nela, e dentro dela não havia nada que se pudesse ajustar:
 * nome, identificador, nome do assistente, cor, quem trabalha lá. A conta
 * existia e era imutável — que é um cadastro, não uma conta de cliente.
 *
 * QUEM PODE CONFIGURAR, e a regra é mais estreita que "quem pode ver":
 *
 *   - o PROVEDOR, que atende todas as empresas;
 *   - quem é DONO ou ADMINISTRADOR daquela empresa.
 *
 * Um colaborador da empresa a enxerga inteira e não muda a identidade dela. É
 * a diferença entre usar a conta e ser responsável por ela, e ela precisa
 * existir antes do primeiro cliente de verdade: quem contrata não quer que
 * qualquer pessoa da equipe troque o nome e a cor da própria empresa.
 */

/** Papéis que respondem pela empresa. Comparados sem caixa porque a base tem
 *  as duas convenções ('owner' e 'SUPER_ADMIN') vindas de épocas diferentes. */
const PAPEIS_QUE_RESPONDEM = new Set(['owner', 'admin', 'master', 'super_admin', 'provider_owner', 'provider_admin']);

export interface PermissaoDeConfigurar {
  pode: boolean;
  /** Por que não, em linguagem de gente. `null` quando pode. */
  motivo: string | null;
  /** Se chegou aqui como provedor, e não por um vínculo com a empresa. */
  comoProvedor: boolean;
}

export async function podeConfigurar(
  user: AuthenticatedUser,
  organizationId: string,
): Promise<PermissaoDeConfigurar> {
  const escopo = await escopoDeOrganizacao(user);

  const [vinculo] = await db
    .select({ role: schema.organizationMembers.role })
    .from(schema.organizationMembers)
    .where(
      and(
        eq(schema.organizationMembers.userId, user.id),
        eq(schema.organizationMembers.organizationId, organizationId),
      ),
    )
    .catch(() => []);

  if (escopo.ehProvider) return { pode: true, motivo: null, comoProvedor: !vinculo };

  /**
   * "Não existe" e "não é sua" respondem igual de propósito, pela mesma razão
   * da troca de contexto: distinguir as duas confirma a existência de uma
   * empresa para quem não deveria saber que ela existe.
   */
  if (!vinculo) return { pode: false, motivo: 'Empresa não encontrada.', comoProvedor: false };

  if (!PAPEIS_QUE_RESPONDEM.has(vinculo.role.toLowerCase())) {
    return {
      pode: false,
      motivo: 'Só quem responde pela empresa pode mudar a configuração dela.',
      comoProvedor: false,
    };
  }

  return { pode: true, motivo: null, comoProvedor: false };
}

export interface PessoaDaEmpresa {
  id: string;
  nome: string | null;
  email: string;
  papel: string;
  ativa: boolean;
  responde_pela_empresa: boolean;
}

export interface FichaDaEmpresa {
  id: string;
  nome: string;
  slug: string;
  status: string;
  eh_provedora: boolean;
  identidade: {
    nome_assistente: string | null;
    mensagem_boas_vindas: string | null;
    logo_url: string | null;
    cor_primaria: string | null;
    cor_secundaria: string | null;
  };
  pessoas: PessoaDaEmpresa[];
  /**
   * O QUE ESTA EMPRESA TEM. Contagens reais, nunca zero por ausência de
   * leitura: a tela precisa poder dizer "ninguém ainda" sem que isso se
   * confunda com "não consegui contar".
   */
  numeros: { clientes: number; pessoas: number; memorias: number; conversas: number };
  /**
   * COMO ESTA EMPRESA SE MEXEU, dia a dia. É o que transforma a ficha de um
   * cadastro num painel: quatro números parados dizem o tamanho da conta, a
   * curva diz se ela está viva.
   *
   * `desde` existe porque a janela nem sempre é de 30 dias: numa empresa criada
   * há três dias, os 27 anteriores não são dias de silêncio — são dias em que
   * ela não existia, e desenhá-los no zero inventaria uma queda que nunca
   * aconteceu. A tela diz qual janela está vendo.
   */
  atividade: { dia: string; mensagens: number; execucoes: number }[];
  atividade_desde: string | null;
  /** `null` = nenhuma mensagem registrada. Nunca uma data inventada. */
  ultima_atividade: string | null;
  criada_em: string | null;
}

export async function fichaDaEmpresa(
  organizationId: string,
  provedora: string | null,
): Promise<FichaDaEmpresa | null> {
  const [org] = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .catch(() => []);

  if (!org) return null;

  const pessoas = await db
    .select({
      id: schema.users.id,
      nome: schema.users.name,
      email: schema.users.email,
      papel: schema.organizationMembers.role,
      ativa: schema.users.active,
    })
    .from(schema.organizationMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
    .where(
      and(
        eq(schema.organizationMembers.organizationId, organizationId),
        isNull(schema.users.deletedAt),
      ),
    )
    .catch(() => []);

  /**
   * Uma consulta só para os quatro números. Quatro `select count(*)` separados
   * custam quatro idas ao banco com `DATABASE_POOL_MAX=3` — já foi a causa de
   * uma tela de 2,9s neste mesmo repositório.
   */
  const bruto: unknown = await db
    .execute(
      sql`select
        (select count(*)::int from clients where organization_id = ${organizationId}::uuid and deleted_at is null) as clientes,
        (select count(*)::int from organization_members where organization_id = ${organizationId}::uuid) as pessoas,
        (select count(*)::int from memories where organization_id = ${organizationId}::uuid and status = 'active') as memorias,
        (select count(*)::int from conversations where organization_id = ${organizationId}::uuid) as conversas`,
    )
    .catch(() => null);

  const n = (((bruto as { rows?: unknown[] } | null)?.rows ?? (bruto as unknown[] | null) ?? [])[0] ?? {
    clientes: 0,
    pessoas: pessoas.length,
    memorias: 0,
    conversas: 0,
  }) as { clientes: number; pessoas: number; memorias: number; conversas: number };

  /**
   * A SÉRIE SAI DE `generate_series`, não das linhas existentes.
   *
   * Agrupar só o que existe produziria uma curva sem os dias de silêncio — e o
   * silêncio é justamente o que o dono precisa ver. Um gráfico que pula o
   * sábado faz a semana parecer contínua.
   *
   * E a janela começa no NASCIMENTO da empresa quando ele é recente: dia em que
   * a conta não existia não é dia de zero movimento.
   *
   * MAS "nascimento" NÃO É a data da linha em `organizations`, e essa distinção
   * custou uma medição: a provedora tem a linha criada em 21/09 e mensagens de
   * 04/09, trazidas pelo backfill da 0045. Clipar na linha escondia duas
   * semanas de história real. Então o início é o MENOR entre a data da linha e
   * a primeira atividade registrada — se há movimento anterior, a empresa já
   * existia, qualquer que seja o carimbo da linha.
   */
  const serieBruta: unknown = await db
    .execute(
      sql`with janela as (
            select greatest(
              date_trunc('day', now() - interval '29 days'),
              date_trunc('day', least(
                coalesce((select created_at from organizations where id = ${organizationId}::uuid), now()),
                coalesce((select min(created_at) from messages where organization_id = ${organizationId}::uuid), now())
              ))
            ) as inicio
          ),
          dias as (
            select generate_series((select inicio from janela), date_trunc('day', now()), interval '1 day') as dia
          )
          select to_char(d.dia, 'YYYY-MM-DD') as dia,
                 (select count(*)::int from messages m
                   where m.organization_id = ${organizationId}::uuid
                     and m.created_at >= d.dia and m.created_at < d.dia + interval '1 day') as mensagens,
                 (select count(*)::int from executions e
                   where e.organization_id = ${organizationId}::uuid
                     and e.created_at >= d.dia and e.created_at < d.dia + interval '1 day') as execucoes
          from dias d
          order by d.dia`,
    )
    .catch(() => null);

  const atividade = (((serieBruta as { rows?: unknown[] } | null)?.rows ??
    (serieBruta as unknown[] | null) ??
    []) as Array<{ dia: string; mensagens: number; execucoes: number }>).map((l) => ({
    dia: l.dia,
    mensagens: Number(l.mensagens),
    execucoes: Number(l.execucoes),
  }));

  const ultimaBruta: unknown = await db
    .execute(
      sql`select max(created_at) as quando from messages where organization_id = ${organizationId}::uuid`,
    )
    .catch(() => null);
  const ultima = (((ultimaBruta as { rows?: unknown[] } | null)?.rows ??
    (ultimaBruta as unknown[] | null) ??
    [])[0] ?? { quando: null }) as { quando: string | Date | null };

  return {
    id: org.id,
    nome: org.name,
    slug: org.slug,
    status: org.status,
    eh_provedora: provedora !== null && org.id === provedora,
    identidade: {
      nome_assistente: org.nomeAssistente,
      mensagem_boas_vindas: org.mensagemBoasVindas,
      logo_url: org.logoUrl,
      cor_primaria: org.corPrimaria,
      cor_secundaria: org.corSecundaria,
    },
    pessoas: pessoas.map((p) => ({
      ...p,
      responde_pela_empresa: PAPEIS_QUE_RESPONDEM.has(p.papel.toLowerCase()),
    })),
    numeros: n,
    atividade,
    atividade_desde: atividade[0]?.dia ?? null,
    ultima_atividade: ultima.quando ? new Date(ultima.quando).toISOString() : null,
    criada_em: org.createdAt ? new Date(org.createdAt).toISOString() : null,
  };
}

/**
 * `| undefined` explícito em cada campo porque o projeto usa
 * `exactOptionalPropertyTypes`: sem isso, "não mandei o campo" e "mandei
 * `undefined`" seriam tipos diferentes, e o corpo validado pelo zod não
 * encaixaria aqui. A distinção que importa de verdade continua sendo outra:
 * ausente = não mexe, `null` = apaga.
 */
export interface MudancaDeEmpresa {
  nome?: string | undefined;
  slug?: string | undefined;
  nome_assistente?: string | null | undefined;
  mensagem_boas_vindas?: string | null | undefined;
  cor_primaria?: string | null | undefined;
  cor_secundaria?: string | null | undefined;
  logo_url?: string | null | undefined;
  status?: 'ativa' | 'suspensa' | undefined;
}

export type ResultadoDaEdicao = { ok: true } | { ok: false; motivo: string };

/**
 * Aplica a mudança. Só os campos ENVIADOS são tocados — `undefined` é "não
 * mexe", `null` é "apaga". A distinção importa: sem ela, salvar a aba de
 * identidade apagaria a cor que alguém configurou na aba ao lado.
 */
export async function configurarEmpresa(
  organizationId: string,
  mudanca: MudancaDeEmpresa,
  provedora: string | null,
): Promise<ResultadoDaEdicao> {
  const patch: Record<string, unknown> = {};

  if (mudanca.nome !== undefined) {
    const nome = mudanca.nome.trim();
    if (nome.length < 2) return { ok: false, motivo: 'O nome da empresa precisa de pelo menos 2 letras.' };
    patch.name = nome;
  }

  if (mudanca.slug !== undefined) {
    const slug = normalizarSlug(mudanca.slug);
    const valido = slugEhValido(slug);
    if (!valido.ok) return { ok: false, motivo: valido.motivo };

    const [conflito] = await db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(and(eq(schema.organizations.slug, slug), ne(schema.organizations.id, organizationId)))
      .catch(() => []);
    if (conflito) return { ok: false, motivo: `O identificador "${slug}" já é de outra empresa.` };

    patch.slug = slug;
  }

  if (mudanca.status !== undefined) {
    /**
     * A PROVEDORA NÃO PODE SER SUSPENSA. Suspendê-la tiraria do ar a conta que
     * opera a plataforma — inclusive a tela onde se desfaria a suspensão.
     */
    if (mudanca.status === 'suspensa' && provedora !== null && organizationId === provedora) {
      return { ok: false, motivo: 'A empresa que opera a plataforma não pode ser suspensa.' };
    }
    patch.status = mudanca.status;
  }

  /** Texto vazio vira `null`: "apagado" e "string em branco" não podem ser dois
   *  estados diferentes para o mesmo campo, ou a tela mostra um vazio que não
   *  é vazio. */
  const texto = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() ? v.trim() : null);

  for (const [coluna, valor] of [
    ['nomeAssistente', texto(mudanca.nome_assistente)],
    ['mensagemBoasVindas', texto(mudanca.mensagem_boas_vindas)],
    ['logoUrl', texto(mudanca.logo_url)],
  ] as const) {
    if (valor !== undefined) patch[coluna] = valor;
  }

  for (const [coluna, valor] of [
    ['corPrimaria', mudanca.cor_primaria],
    ['corSecundaria', mudanca.cor_secundaria],
  ] as const) {
    if (valor === undefined) continue;
    if (valor === null || valor.trim() === '') {
      patch[coluna] = null;
      continue;
    }
    const cor = valor.trim();
    if (!/^#[0-9a-f]{6}$/i.test(cor)) {
      return { ok: false, motivo: `"${cor}" não é uma cor. Use o formato #RRGGBB.` };
    }
    patch[coluna] = cor.toLowerCase();
  }

  if (Object.keys(patch).length === 0) return { ok: true };

  patch.updatedAt = new Date();
  await db.update(schema.organizations).set(patch).where(eq(schema.organizations.id, organizationId));
  return { ok: true };
}
