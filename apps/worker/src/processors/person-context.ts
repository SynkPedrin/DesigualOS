import { db, schema } from '@desigual-os/database';
import { eq, inArray } from 'drizzle-orm';
import { casarEntidades, dobrar } from '@desigual-os/context-engine';

/**
 * person-context.ts — pessoa é entidade, e relação com cliente exige evidência.
 *
 * Caso relatado (16/09/2026): perguntaram as demandas da Esther e o Bento
 * afirmou que ela era RESPONSÁVEL PELA CONTA D. Carvalho. A relação não existe.
 * Pior: a Esther não existe em fonte nenhuma — não é membro do workspace, não
 * aparece em 7.408 tasks, não está no banco nem nos vaults. Foi afirmação criada
 * do zero, com forma de fato operacional.
 *
 * O que este módulo garante:
 *
 *   - pessoa citada é RESOLVIDA contra o registro derivado da fonte;
 *   - pessoa que não existe na fonte é declarada como não encontrada, sempre,
 *     em qualquer conversa — não some numa e reaparece noutra;
 *   - relação carrega TIPO e EVIDÊNCIA. "Aparece em task deste cliente"
 *     (TASK_ASSIGNEE) nunca pode ser lido como "responde pela conta"
 *     (ACCOUNT_MANAGER): são relações diferentes, e a segunda só existe se a
 *     fonte disser. Coocorrência, proximidade e semelhança NÃO são evidência.
 */

export interface RelacaoDePessoa {
  clientId: string;
  clientName: string;
  relationType: string;
  temporalStatus: string;
  evidenceCount: number;
  lastSeenAt: Date | null;
}

export interface PessoaDoTurno {
  id: string;
  canonicalName: string;
  employmentType: string;
  activeStatus: string;
  relacoes: RelacaoDePessoa[];
}

export interface PersonTurnContext {
  /** Pessoas citadas que EXISTEM no registro. */
  encontradas: PessoaDoTurno[];
  /**
   * Nomes com cara de pessoa que o texto cita e o registro não conhece. É o
   * caso Esther: o valor está em declarar a ausência, não em preencher.
   */
  naoEncontradas: string[];
}

/**
 * Sinal de que o turno fala de UMA PESSOA. Sem isto, qualquer palavra do texto
 * seria testada contra o registro e nomes comuns virariam falso positivo.
 */
const CITA_PESSOA =
  /\b(demandas?|tarefas?|responsa|respons[áa]vel|quem|squad|time|equipe|atribu|designer|redator|analista|atendimento)\b/i;

/** Preposição e palavra de ligação que antecedem nome próprio em português. */
const LIGACAO = new Set(['da', 'do', 'de', 'para', 'pra', 'com', 'a', 'o', 'e']);

/**
 * Nomes próprios candidatos no texto original (inicial maiúscula), ignorando o
 * começo de frase, que é maiúsculo por regra e não por ser nome.
 */
export function candidatosAPessoa(mensagem: string): string[] {
  const tokens = mensagem.split(/\s+/).filter(Boolean);
  const saida: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const bruto = tokens[i]!.replace(/[^\p{L}\p{N}'-]/gu, '');
    if (bruto.length < 3) continue;
    if (!/^[A-ZÀ-Ý]/.test(bruto)) continue;
    const anterior = i > 0 ? dobrar(tokens[i - 1]!) : '';
    // Primeira palavra da mensagem sem palavra de ligação antes tem chance alta
    // de ser só o começo da frase ("Liste as demandas..."), não nome.
    if (i === 0) continue;
    if (anterior && !LIGACAO.has(anterior) && !/[,:;]$/.test(tokens[i - 1]!)) {
      // Ainda aceita sequência de nome próprio ("Ana Luiza").
      if (!/^[A-ZÀ-Ý]/.test(tokens[i - 1]!.replace(/[^\p{L}]/gu, ''))) continue;
    }
    saida.push(bruto);
  }
  return [...new Set(saida)];
}

export async function resolvePersonTurnContext(mensagem: string): Promise<PersonTurnContext> {
  if (!CITA_PESSOA.test(mensagem)) return { encontradas: [], naoEncontradas: [] };

  const candidatos = candidatosAPessoa(mensagem);
  if (candidatos.length === 0) return { encontradas: [], naoEncontradas: [] };

  const registro = await db
    .select({
      id: schema.people.id,
      canonicalName: schema.people.canonicalName,
      aliases: schema.people.aliases,
      employmentType: schema.people.employmentType,
      activeStatus: schema.people.activeStatus,
    })
    .from(schema.people)
    .catch(() => []);

  const encontradas: PessoaDoTurno[] = [];
  const usados = new Set<string>();

  for (const candidato of candidatos) {
    const m = casarEntidades(
      candidato,
      registro.map((p) => ({ id: p.id, canonicalName: p.canonicalName, aliases: p.aliases ?? [] })),
    );
    if (m.length === 0) continue;
    // Empate entre pessoas diferentes NÃO funde ninguém: nomes parecidos podem
    // ser gente diferente. Sem vencedor claro, trata como não resolvido.
    if (m.length > 1 && m[0]!.tokens === m[1]!.tokens) continue;
    const achada = registro.find((p) => p.id === m[0]!.entidade.id)!;
    if (usados.has(achada.id)) continue;
    usados.add(achada.id);
    encontradas.push({
      id: achada.id,
      canonicalName: achada.canonicalName,
      employmentType: achada.employmentType,
      activeStatus: achada.activeStatus,
      relacoes: [],
    });
  }

  const naoEncontradas = candidatos.filter(
    (c) => !encontradas.some((p) => dobrar(p.canonicalName).includes(dobrar(c)) || dobrar(c).includes(dobrar(p.canonicalName))),
  );

  if (encontradas.length > 0) {
    const relacoes = await db
      .select({
        personId: schema.personClientRelations.personId,
        clientId: schema.personClientRelations.clientId,
        relationType: schema.personClientRelations.relationType,
        temporalStatus: schema.personClientRelations.temporalStatus,
        evidenceCount: schema.personClientRelations.evidenceCount,
        lastSeenAt: schema.personClientRelations.lastSeenAt,
        clientName: schema.clients.name,
      })
      .from(schema.personClientRelations)
      .innerJoin(schema.clients, eq(schema.clients.id, schema.personClientRelations.clientId))
      .where(inArray(schema.personClientRelations.personId, encontradas.map((p) => p.id)))
      .catch(() => []);

    for (const p of encontradas) {
      p.relacoes = relacoes
        .filter((r) => r.personId === p.id)
        .sort((a, b) => b.evidenceCount - a.evidenceCount)
        .slice(0, 12)
        .map((r) => ({
          clientId: r.clientId, clientName: r.clientName, relationType: r.relationType,
          temporalStatus: r.temporalStatus, evidenceCount: r.evidenceCount, lastSeenAt: r.lastSeenAt,
        }));
    }
  }

  return { encontradas, naoEncontradas };
}

/** Como cada tipo de relação PODE ser dito. O texto é o gate contra a promoção. */
const LEITURA_DA_RELACAO: Record<string, string> = {
  TASK_ASSIGNEE: 'está atribuída a tarefas deste cliente (NÃO significa que responde pela conta)',
  TASK_COMMENTER: 'comentou em tarefas deste cliente (NÃO significa que trabalha na conta)',
  MENTIONED_IN_DOCUMENT: 'é citada em documento deste cliente (NÃO significa vínculo de trabalho)',
  ACCOUNT_MANAGER: 'responde pela conta (relação registrada explicitamente na fonte)',
  CLIENT_OWNER: 'é do lado do cliente',
  CREATIVE_CONTRIBUTOR: 'contribuiu na criação de peças deste cliente',
};

export function formatPersonBlock(ctx: PersonTurnContext): string {
  if (ctx.encontradas.length === 0 && ctx.naoEncontradas.length === 0) return '';

  const linhas: string[] = ['PESSOAS CITADAS NESTE TURNO (registro derivado do ClickUp):'];

  for (const p of ctx.encontradas) {
    const vinculo =
      p.employmentType === 'agency_member'
        ? 'está no diretório do workspace'
        : 'aparece na operação, mas NÃO está no diretório do workspace';
    linhas.push('', `- ${p.canonicalName}: ${vinculo}.`);
    if (p.relacoes.length === 0) {
      linhas.push('  Nenhuma relação com cliente registrada. NÃO atribua nenhum cliente a esta pessoa.');
      continue;
    }
    for (const r of p.relacoes) {
      const leitura = LEITURA_DA_RELACAO[r.relationType] ?? `tem relação ${r.relationType} registrada`;
      const quando = r.temporalStatus === 'historical' ? ' [HISTÓRICO, sem atividade recente]' : '';
      linhas.push(`  · ${r.clientName}: ${leitura}; ${r.evidenceCount} evidência(s)${quando}.`);
    }
  }

  for (const nome of ctx.naoEncontradas) {
    linhas.push(
      '',
      `- ${nome}: NÃO EXISTE no registro de pessoas da operação.`,
      '  Diga isso claramente. NÃO invente função, cliente ou relação para esta pessoa, e NÃO a',
      '  associe a nenhuma conta. Se ela trabalha na agência sem estar no ClickUp, isso precisa ser',
      '  registrado na fonte antes de você poder afirmar qualquer coisa sobre ela.',
    );
  }

  linhas.push(
    '',
    'REGRA: só afirme que alguém responde por uma conta se houver relação ACCOUNT_MANAGER acima.',
    'Estar atribuído a tarefa, comentar ou ser citado NÃO é responsabilidade pela conta, e trabalho',
    'pontual NÃO é membro fixo do squad.',
  );
  return linhas.join('\n');
}
