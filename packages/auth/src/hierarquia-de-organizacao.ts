/**
 * hierarquia-de-organizacao.ts — AGÊNCIA → SUBCONTAS.
 *
 * A segunda metade da fronteira entre empresas. `escopo-de-organizacao.ts`
 * responde "de quais empresas esta pessoa é membro"; este arquivo responde
 * "quais empresas ela pode ENXERGAR por causa da posição dela na árvore" —
 * a regra do white label, em que uma agência administra as contas dos
 * próprios clientes.
 *
 * Mora em packages/auth pelo mesmo motivo do escopo: a regra precisa valer
 * igual na API, no worker e no MCP, e o MCP não importa de dentro de outro
 * app. O que depende de banco (buscar os filhos de uma empresa) fica em
 * `apps/api/src/lib/escopo-de-organizacao.ts` (`descendentesDe`).
 *
 * ---
 *
 * A REGRA INTEIRA, numa frase: **leitura desce, escrita não atravessa.**
 *
 *   LEITURA — quem RESPONDE por uma empresa (owner/admin) lê a empresa e
 *   todas as subcontas dela, diretas e transitivas. É o que permite à
 *   agência ver o custo consolidado da carteira. Filho não lê pai nem irmão:
   * a agência enxerga o cliente, o cliente nunca enxerga a agência — a
   * assimetria é o produto, não um acidente.
 *
 *   ESCRITA — não muda. Nunca. Gravar continua exigindo a empresa ATIVA,
 *   exatamente como antes de existir hierarquia (organizacao-da-escrita.ts).
 *   Um administrador de agência que pudesse ESCREVER na subconta sem entrar
 *   nela criaria linhas atribuídas a uma empresa em que ele nem consta como
 *   membro — rastreabilidade quebrada por construção. Quer escrever no
 *   cliente? Entre na subconta (POST /organizations/ativa), onde a troca é
 *   validada e auditada.
 *
 * POR QUE PURO: a regra que separa "ler a carteira" de "ler um tenant" não
 * pode depender de subir banco para ser verificada — mesmo critério de
 * `decidirEscopo`. Recebe a árvore já carregada, devolve decisão.
 */

/** Um elo da árvore: a empresa e o pai dela (`null` = raiz). */
export interface NoDaArvore {
  id: string;
  parentId: string | null;
}

/**
 * Papéis que RESPONDEM por uma empresa — os mesmos que podem configurá-la
 * (PAPEIS_QUE_RESPONDEM em apps/api/src/organizations/ficha.ts). Comparados
 * sem caixa porque a base tem as duas convenções ('owner' e 'SUPER_ADMIN')
 * vindas de épocas diferentes.
 */
const PAPEIS_QUE_ADMINISTRAM = new Set([
  'owner',
  'admin',
  'master',
  'super_admin',
  'provider_owner',
  'provider_admin',
]);

export function administraOrganizacao(papel: string | null | undefined): boolean {
  return papel !== null && papel !== undefined && PAPEIS_QUE_ADMINISTRAM.has(papel.toLowerCase());
}

/**
 * Os descendentes DIRETOS E TRANSITIVOS de uma empresa, numa árvore já
 * carregada. BFS com conjunto de visitados: `parent_id` só é escrito na
 * criação, o que torna ciclo impossível por construção — mas a guarda custa
 * uma linha e um ciclo corrompido viraria loop infinito em vez de erro.
 */
export function descendentesTransitivos(arvore: readonly NoDaArvore[], orgId: string): string[] {
  const filhosPorPai = new Map<string, string[]>();
  for (const no of arvore) {
    if (no.parentId === null) continue;
    const filhos = filhosPorPai.get(no.parentId) ?? [];
    filhos.push(no.id);
    filhosPorPai.set(no.parentId, filhos);
  }

  const visitados = new Set<string>([orgId]);
  const descendentes: string[] = [];
  const fila = [orgId];
  while (fila.length > 0) {
    const atual = fila.shift()!;
    for (const filho of filhosPorPai.get(atual) ?? []) {
      if (visitados.has(filho)) continue;
      visitados.add(filho);
      descendentes.push(filho);
      fila.push(filho);
    }
  }
  return descendentes;
}

/**
 * O QUE A PESSOA PODE LER a partir da empresa em que está trabalhando.
 *
 *   - PROVEDOR ou quem administra a empresa ativa: a ativa + toda a subárvore
 *     (filhos, netos, ...). É a visão de agência.
 *   - qualquer outro membro: só a ativa. Colaborador de agência não vê a
 *     carteira inteira por trabalhar nela — quem responde pela conta é que a
 *     enxerga por inteiro.
 *
 * Quem chama e é provider normalmente nem aplica recorte (o SQL dele tem a
 * branch `ehProvider` que dispensa lista); a subárvore está aqui para o caso
 * do provider querer recortar POR uma empresa específica.
 */
export function orgsVisiveisParaLeitura(entrada: {
  orgAtiva: string;
  papelNaAtiva: string | null;
  ehProvider: boolean;
  arvore: readonly NoDaArvore[];
}): string[] {
  const { orgAtiva, papelNaAtiva, ehProvider, arvore } = entrada;
  if (!ehProvider && !administraOrganizacao(papelNaAtiva)) return [orgAtiva];
  return [orgAtiva, ...descendentesTransitivos(arvore, orgAtiva)];
}

/**
 * A fronteira de ESCRITA, dita em voz alta para ninguém "otimizar" depois:
 * só se escreve na empresa ativa. A hierarquia alarga o que se LÊ e nunca o
 * que se GRAVA — esta função existe justamente para o dia em que alguém
 * quiser reusar `orgsVisiveisParaLeitura` para autorizar escrita e encontrar
 * aqui a resposta pronta: não.
 */
export function podeEscreverNaOrganizacao(orgAtiva: string, alvo: string): boolean {
  return alvo === orgAtiva;
}

/**
 * QUEM PODE CRIAR SUBCONTA de uma empresa: o provedor (que cria qualquer
 * empresa) ou quem administra o PAI. Um membro comum da agência não abre
 * subconta — criar tenant é decisão comercial de quem responde por ele, não
 * de quem só trabalha nele.
 */
export function podeCriarSubconta(entrada: {
  ehProvider: boolean;
  papelNoPai: string | null;
}): boolean {
  return entrada.ehProvider || administraOrganizacao(entrada.papelNoPai);
}
