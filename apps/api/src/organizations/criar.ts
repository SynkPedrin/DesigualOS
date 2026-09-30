import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';

/**
 * criar.ts — a fábrica de empresas.
 *
 * É a peça que faltava para o produto ser multiempresa de verdade. Medido no
 * repositório em 30/09/2026: `insert(schema.organizations)` não aparecia UMA
 * VEZ no monorepo inteiro, nem `insert(organizationMembers)`. A fronteira entre
 * empresas existia e funcionava; criar uma empresa, não.
 *
 * TUDO OU NADA, e é a decisão que mais importa aqui.
 *
 * Criar uma empresa são quatro escritas encadeadas: a organização, o vínculo do
 * dono, o papel dele e o registro de auditoria. Se a terceira falhar, sobra uma
 * empresa SEM DONO no banco — e uma empresa sem dono não aparece para ninguém,
 * não pode ser aberta, e não dá para apagar pela interface. Lixo invisível que
 * só um desenvolvedor com acesso ao banco resolve, que é exatamente o oposto do
 * que este trabalho inteiro persegue.
 *
 * Por isso é transação. Ou a empresa nasce inteira, ou não nasce.
 *
 * O QUE ELA NÃO FAZ, de propósito: não cria usuário no Supabase. Convidar
 * pessoa é outro fluxo, que já existe em `/admin/invite`, e que depende de
 * e-mail e de um provedor externo que pode estar fora do ar. Amarrar a criação
 * da empresa ao envio de um e-mail faria uma falha de SMTP impedir a empresa de
 * existir. O dono é ligado quando já existe conta; quando não existe, a empresa
 * nasce sem dono e a interface diz isso — estado visível é melhor que escrita
 * pela metade.
 */

export interface NovaEmpresa {
  nome: string;
  slug: string;
  /** Quem está criando. Vira `created_by` e entra como membro. */
  criadoPor: string;
  /** Opcionais, porque empresa sem identidade usa a do produto. */
  corPrimaria?: string | null;
  corSecundaria?: string | null;
  logoUrl?: string | null;
  nomeAssistente?: string | null;
  /** E-mail de quem será dono, se já tiver conta no sistema. */
  emailDoDono?: string | null;
}

export interface EmpresaCriada {
  id: string;
  nome: string;
  slug: string;
  donoVinculado: boolean;
  /** Por que o dono não foi vinculado, quando não foi. Nunca silencioso. */
  avisoSobreDono: string | null;
}

/**
 * Normaliza o slug. Não é enfeite: o slug é o identificador legível da empresa
 * e tem UNIQUE no banco — aceitar "Cosentino Ltda." cru geraria um slug com
 * espaço e ponto que ninguém consegue digitar numa URL depois.
 */
export function normalizarSlug(bruto: string): string {
  return bruto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** Slugs que o produto usa para outra coisa e que não podem virar empresa. */
const SLUGS_RESERVADOS = new Set(['admin', 'api', 'app', 'desigual', 'master', 'novo', 'settings', 'login']);

export function slugEhValido(slug: string): { ok: true } | { ok: false; motivo: string } {
  if (slug.length < 2) return { ok: false, motivo: 'O identificador precisa de pelo menos 2 caracteres.' };
  if (SLUGS_RESERVADOS.has(slug)) return { ok: false, motivo: `"${slug}" é reservado pelo sistema.` };
  return { ok: true };
}

export async function criarEmpresa(entrada: NovaEmpresa): Promise<EmpresaCriada> {
  const slug = normalizarSlug(entrada.slug || entrada.nome);
  const valido = slugEhValido(slug);
  if (!valido.ok) throw new Error(valido.motivo);

  /**
   * O DONO É RESOLVIDO ANTES DA TRANSAÇÃO.
   *
   * Consultar dentro da transação seguraria a conexão do pool por mais tempo —
   * e o pool tem três. Fora dela, a busca é barata e o resultado entra pronto.
   */
  let donoId: string | null = null;
  let avisoSobreDono: string | null = null;

  if (entrada.emailDoDono) {
    const [dono] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, entrada.emailDoDono.trim().toLowerCase()))
      .catch(() => []);
    if (dono) donoId = dono.id;
    else
      avisoSobreDono =
        `Ninguém com o e-mail ${entrada.emailDoDono} tem conta ainda. ` +
        `A empresa foi criada; convide a pessoa em Equipe para ela virar administradora.`;
  }

  return db.transaction(async (tx) => {
    const [org] = await tx
      .insert(schema.organizations)
      .values({
        name: entrada.nome.trim(),
        slug,
        corPrimaria: entrada.corPrimaria ?? null,
        corSecundaria: entrada.corSecundaria ?? null,
        logoUrl: entrada.logoUrl ?? null,
        nomeAssistente: entrada.nomeAssistente ?? null,
        createdBy: entrada.criadoPor,
        status: 'ativa',
      })
      .returning({ id: schema.organizations.id, name: schema.organizations.name, slug: schema.organizations.slug });

    if (!org) throw new Error('A empresa não foi criada.');

    /**
     * QUEM CRIA ENTRA COMO MEMBRO, sempre.
     *
     * Sem isto, o provedor cria uma empresa e não consegue abri-la — porque
     * `escopoDeOrganizacao` resolve pelo vínculo em `organization_members`, e
     * não por quem clicou no botão. A empresa existiria e seria inalcançável
     * até alguém rodar SQL, que é o problema que esta fábrica existe para
     * acabar.
     */
    await tx
      .insert(schema.organizationMembers)
      .values({ organizationId: org.id, userId: entrada.criadoPor, role: 'owner' })
      .onConflictDoNothing();

    if (donoId && donoId !== entrada.criadoPor) {
      await tx
        .insert(schema.organizationMembers)
        .values({ organizationId: org.id, userId: donoId, role: 'owner' })
        .onConflictDoNothing();
    }

    // O registro de quem criou o quê. Mesma tabela do consentimento: é onde
    // "quem fez o quê" mora neste produto.
    await tx.insert(schema.auditLogs).values({
      userId: entrada.criadoPor,
      organizationId: org.id,
      action: 'organization.create',
      result: 'success',
      source: 'app',
      metadata: { slug: org.slug, nome: org.name, dono_vinculado: Boolean(donoId) },
    });

    return {
      id: org.id,
      nome: org.name,
      slug: org.slug,
      donoVinculado: Boolean(donoId),
      avisoSobreDono,
    };
  });
}
