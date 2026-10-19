/**
 * organizacao-de-trabalho.ts — em qual empresa esta requisição está trabalhando.
 *
 * Três perguntas parecidas convivem no sistema, e trocar uma pela outra é o
 * defeito mais caro que existe num produto multiempresa:
 *
 *   escopo-de-organizacao   quais empresas eu posso VER.     Pode ser várias.
 *   organizacao-da-escrita  de quem é a linha sendo GRAVADA. Pode ser nula.
 *   organizacao-de-trabalho onde eu ESTOU agora.             É exatamente uma.
 *
 * Esta é a terceira. Ela devolve o `organization_id` que vai ser carimbado no
 * cliente novo e usado para filtrar a tela de Clientes — e "várias" não é uma
 * resposta possível quando o destino é uma coluna só.
 *
 * ---
 *
 * O DEFEITO QUE ORIGINOU O ARQUIVO, medido em 30/09/2026:
 *
 * A regra anterior vivia dentro do middleware e resolvia por CONTAGEM: um
 * vínculo, segue; mais de um, 403 `Select an organization` — sem nunca dizer
 * como se seleciona, porque não havia como. Enquanto todo mundo pertencia só à
 * Desigual, isso passou por regra correta.
 *
 * Aí a fábrica de empresas entrou em produção, e ela vincula quem cria à
 * empresa criada. Resultado: a conta que criou a segunda empresa perdeu a tela
 * de Clientes inteira — não o acesso à empresa nova, a tela toda, inclusive a
 * carteira antiga de 58 clientes. O ato que transforma isto em produto
 * multiempresa era exatamente o ato que derrubava a tela principal de quem o
 * fizesse.
 *
 * A causa não foi a contagem: foram DUAS respostas para a mesma pergunta. A
 * migração 0047 criou a autoridade de verdade (`users.organizacao_ativa_id`,
 * escrita pelo servidor depois de validar) e o middleware continuou decidindo
 * sozinho, por ordem de linha. Por isso a regra virou função pura: para existir
 * num lugar só, e para poder ser conferida sem subir banco.
 */

export interface FatosDaEscolha {
  /** `x-organization-id`, quando a requisição pediu uma empresa explicitamente. */
  pedida: string | null;
  /** `users.organizacao_ativa_id`, já revalidada. `null` = contexto do provedor. */
  ativa: string | null;
  /** Empresas em que a pessoa tem vínculo ATIVO. */
  vinculos: readonly string[];
  /** A organização que opera a plataforma, ou `null` se não configurada. */
  provedora: string | null;
  /** Se a pessoa opera no nível da plataforma (atende todas as empresas). */
  ehProvider: boolean;
}

export type EscolhaDeTrabalho =
  | { ok: true; organizationId: string }
  | { ok: false; motivo: 'sem-vinculo' | 'nao-pode-entrar' | 'precisa-escolher' };

/**
 * A ORDEM É DE AUTORIDADE, do mais explícito ao mais implícito. Cada degrau só
 * existe porque o anterior não respondeu — e nenhum deles é ordem de linha do
 * banco, que foi o que quebrou antes.
 */
export function decidirOrganizacaoDeTrabalho(f: FatosDaEscolha): EscolhaDeTrabalho {
  if (f.vinculos.length === 0) return { ok: false, motivo: 'sem-vinculo' };

  const podeEntrarEm = (org: string) => f.vinculos.includes(org) || f.ehProvider;

  // 1. O cabeçalho da requisição. É o pedido mais explícito que existe, e
  //    continua sendo CONFERIDO: aceitar o que o navegador mandou sem checar
  //    faria do cabeçalho uma superfície de autorização — o bypass exato que a
  //    fronteira entre empresas existe para impedir.
  if (f.pedida !== null) {
    return podeEntrarEm(f.pedida)
      ? { ok: true, organizationId: f.pedida }
      : { ok: false, motivo: 'nao-pode-entrar' };
  }

  // 2. A empresa aberta na tela de Empresas. Validada na entrada, revalidada na
  //    leitura, e persistida — é o que faz "entrei na Cosentino" sobreviver a
  //    recarregar a página.
  if (f.ativa !== null && podeEntrarEm(f.ativa)) return { ok: true, organizationId: f.ativa };

  // 3. Um vínculo só: não há o que escolher, e perguntar seria burocracia. É o
  //    caso de quase todo mundo, e o que preserva o comportamento de hoje.
  if (f.vinculos.length === 1) return { ok: true, organizationId: f.vinculos[0]! };

  // 4. Vários vínculos e nenhuma empresa aberta. Pela 0047, `null` significa
  //    "estou no contexto do provedor" — então a casa é a provedora, quando a
  //    pessoa é de lá. É o caso de quem opera a Desigual e criou uma empresa
  //    cliente: continua na Desigual até entrar na outra de propósito.
  if (f.provedora !== null && f.vinculos.includes(f.provedora)) {
    return { ok: true, organizationId: f.provedora };
  }

  // 5. Acabaram os critérios: a pessoa pertence a várias empresas, nenhuma é a
  //    provedora, e ela não abriu nenhuma. Aqui perguntar é honesto — chutar a
  //    primeira linha seria gravar cliente na empresa errada em silêncio.
  return { ok: false, motivo: 'precisa-escolher' };
}
