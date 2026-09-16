import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { PALAVRA_FRACA } from './entity-matching.js';

/**
 * Resolução de cliente citado por NOME no texto da mensagem, não escolhido no seletor da UI.
 *
 * Lacuna real (09/09/2026): "Jarbas, como estão as campanhas da 3NET hoje?" sem o usuário ter
 * clicado no seletor de cliente do chat (client-selector.tsx, campo opcional) chegava ao agente
 * com `client_id: null` — nenhum contexto de cliente, nenhum dossiê, nenhuma métrica associada.
 * Não existia NENHUM mecanismo neste repo pra extrair um nome de cliente do texto livre; foi
 * verificado por busca no código antes de escrever isto. É provavelmente a causa mais comum do
 * "Jarbas não sabe responder sobre o cliente" quando o cliente claramente existe no sistema.
 */

export interface ClientMatch {
  id: string;
  name: string;
  slug: string;
}

interface ClientRow {
  id: string;
  name: string;
  slug: string;
}

/** Tira acento, emoji, ™/®, pontuação e normaliza espaço. Mesmo tratamento pro nome do cliente E
 * pro texto da mensagem, senão "3NET" no texto nunca bate com "3Net" no banco. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/[™®]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Palavra que NUNCA vira candidato de match sozinha, mesmo tendo tamanho suficiente: termo
 * genérico de razão social (não identifica o cliente) ou palavra comum do português que colide
 * com nome real de cliente na base. "teste" é o caso mais sério: existe um cliente chamado
 * literalmente "teste" (registro de sandbox) e sem esta lista qualquer mensagem contendo a
 * palavra comum "teste" ("isso foi só um teste") resolveria pra esse cliente.
 */
const PALAVRA_GENERICA_DEMAIS = new Set([
  'construtora', 'imobiliaria', 'incorporadora', 'gelateria', 'clinica', 'clinico',
  'enterprise', 'ltda', 'brasil', 'comercio', 'industria', 'servicos', 'diagnostico',
  'grupo', 'empresa', 'projeto', 'urbanismo', 'consultoria', 'imagem', 'painel', 'paineis',
  'club', 'componentes', 'seguros', 'calcados', 'sushibar', 'santa', 'maria', 'dra', 'dr',
  'teste', 'test', 'cliente', 'case', 'agencia', 'desigual',
]);

/**
 * Nomes reais no banco carregam decoração que não ajuda a casar ("🧪 Case #0 — Endrigo Almada /
 * CITÁVEL™", "Construtora e Imobiliária Cosentino Ltda. — Enterprise"). Corta sufixo depois de
 * travessão/pipe (normalmente é qualificador tipo "— Enterprise") e devolve a forma completa, a
 * forma curta, e cada PALAVRA distintiva isolada — porque na prática o time chama o cliente pelo
 * nome curto ("a Fratelli confirmou", não "a Gelateria Fratelli confirmou").
 */
function nameVariants(rawName: string): string[] {
  const full = normalize(rawName);
  const cortado = rawName.split(/[—|]/)[0] ?? rawName;
  const curto = normalize(cortado);
  const variantes = new Set([full, curto]);
  for (const palavra of curto.split(' ')) {
    if (palavra.length >= 5 && !PALAVRA_GENERICA_DEMAIS.has(palavra)) variantes.add(palavra);
  }
  variantes.delete('');
  return [...variantes];
}

/**
 * Nomes curtos ou genéricos demais pra confiar em match automático: "teste", "Da Mata" (bate com
 * qualquer frase que tenha essas duas palavras comuns em português), siglas de 2-3 letras que
 * colidem com português comum. Abaixo deste tamanho, exige o slug completo bater, não o nome.
 */
const MIN_CONFIDENT_NAME_LEN = 4;

/**
 * Distância de edição com corte: para de calcular assim que passa de `max`. Só é
 * usada em palavra única de 5+ caracteres (ver TIER 4), então a matriz é pequena.
 */
function editDistanceWithin(a: string, b: string, max: number): number | null {
  if (Math.abs(a.length - b.length) > max) return null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      curr.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return null;
    prev = curr;
  }
  const distance = prev[b.length]!;
  return distance <= max ? distance : null;
}

/**
 * Distância de edição tolerada, PROPORCIONAL ao tamanho da palavra.
 *
 * Distância fixa de 2 é frouxa demais em palavra curta: "olhar" (5 letras)
 * fica a 2 de "colpar", então a pergunta "o que eu deveria OLHAR primeiro?"
 * resolvia o escopo inteiro da operação para o cliente Colpar — e a resposta
 * saía confiante sobre o cliente errado, sem avisar ninguém. Medido ao vivo
 * em 15/09/2026.
 *
 * Com a régua proporcional, 2 erros só são aceitos quando sobra nome
 * suficiente para sustentar o palpite (8+ chars, como "consentino" ->
 * "Cosentino", que é o caso real que o fuzzy existe para resolver).
 */
function maxFuzzyDistance(word: string): number {
  return word.length >= 8 ? 2 : 1;
}

/**
 * Palavras comuns do português que aparecem em pedido operacional e NUNCA são
 * nome de cliente. Sem elas na lista, o fuzzy tenta casar verbo e advérbio com
 * a carteira inteira a cada turno.
 */
const PALAVRA_COMUM_PT = new Set([
  'olhar', 'olhando', 'pegando', 'primeiro', 'primeira', 'deveria', 'deveriamos',
  'preciso', 'precisa', 'precisamos', 'quero', 'queria', 'pode', 'podemos',
  'fazer', 'fazendo', 'criar', 'criando', 'analisar', 'analisando', 'revisar',
  'atencao', 'atrasado', 'atrasada', 'atrasados', 'atrasadas', 'prazo', 'prazos',
  'tarefa', 'tarefas', 'entrega', 'entregas', 'hoje', 'amanha', 'semana', 'ontem',
  'porque', 'poque', 'quando', 'onde', 'qual', 'quais', 'sobre', 'entao',
  'agora', 'ainda', 'depois', 'antes', 'melhor', 'pior', 'muito', 'pouco',
  'operacao', 'operacional', 'status', 'situacao', 'resumo', 'briefing',
  'campanha', 'campanhas', 'conteudo', 'conteudos', 'material', 'materiais',
  'responsavel', 'responsaveis', 'aprovacao', 'aprovado', 'pendente', 'pendencia',
]);

/** Palavras da mensagem que podem ser tentadas em fuzzy (TIER 4). */
function candidateWords(normalizedMessage: string): string[] {
  return [...new Set(
    normalizedMessage
      .split(' ')
      .filter((w) => w.length >= 5 && !PALAVRA_GENERICA_DEMAIS.has(w) && !PALAVRA_COMUM_PT.has(w)),
  )];
}

function buildMatchers(client: ClientRow): RegExp[] {
  const candidatos = new Set<string>([...nameVariants(client.name), normalize(client.slug.replace(/-/g, ' '))]);
  const out: RegExp[] = [];
  for (const cand of candidatos) {
    // Abaixo do tamanho mínimo, o risco de bater com uma palavra comum do português (ex: nome de
    // 2-3 letras) é maior que o valor de resolver automaticamente. Fica sem match pra esse
    // candidato específico; se o cliente tiver outro nome/slug mais longo, esse ainda pode bater.
    if (!cand || cand.length < MIN_CONFIDENT_NAME_LEN) continue;
    // Filtro de palavra genérica vale pro candidato inteiro, não só nas palavras isoladas do
    // loop em nameVariants: um cliente cujo NOME COMPLETO é ele próprio uma palavra genérica
    // (o caso real de "teste", cadastro de sandbox) tinha esse filtro pulado porque `full`/`curto`
    // entravam direto no Set sem passar pela checagem — só as palavras extras adicionadas no loop
    // eram filtradas.
    if (PALAVRA_GENERICA_DEMAIS.has(cand)) continue;
    const escaped = cand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out.push(new RegExp(`\\b${escaped}\\b`));
  }
  return out;
}

/**
 * Resultado completo da resolução de entidades de cliente numa mensagem.
 *
 * Existe porque `resolveClientFromText` devolve `null` tanto pra "nenhum cliente" quanto pra
 * "vários clientes possíveis", e quem chama não conseguia distinguir os dois — era essa
 * indistinção que fazia o sistema perguntar "de qual cliente?" mesmo quando o usuário tinha
 * nomeado TRÊS clientes ("analisa 3net, cosentino e d carvalho"), e não tinha como fazer a
 * pergunta certa ("Cosentino ou Construtora Cosentino?") quando o caso era ambiguidade real.
 */
export interface ClientResolution {
  /** Clientes distintos resolvidos com confiança, na ordem em que aparecem na mensagem. */
  matches: ClientMatch[];
  /** Termos que bateram em 2+ clientes no MESMO nível de precisão — ambiguidade real. */
  ambiguous: Array<{ term: string; candidates: ClientMatch[] }>;
  /** Nível que resolveu (para log/observabilidade, nunca pra mostrar ao usuário). */
  tier: 'exact' | 'short' | 'word' | 'fuzzy' | 'none';
}

/**
 * NÍVEIS DE PRECISÃO (o primeiro nível que produzir resultado ganha; níveis abaixo são
 * ignorados). Mesmo princípio já usado no matcher de listas do ClickUp no bento-qa
 * ("exato primeiro, substring só se for único"), agora aplicado a nome de cliente.
 *
 * Por que tiering em vez de "bateu em 2 => desiste": o banco real tem duplicata legítima
 * ("Cosentino" E "Construtora e Imobiliária Cosentino Ltda. — Enterprise"; "Biofit" E
 * "BIO FIT"). Sem níveis, a palavra "cosentino" batia nos dois e o cliente ficava
 * PERMANENTEMENTE irresolvível — medido em 10/09/2026, era o comportamento em produção. Com
 * níveis, "cosentino" é match EXATO do cliente chamado exatamente "Cosentino", e o outro só
 * apareceria se o usuário escrevesse o nome longo dele. Isso não é adivinhar: nome exato é
 * evidência mais forte que palavra contida num nome maior.
 *
 * TIER 1 exact  — mensagem contém o nome completo normalizado, ou o slug.
 * TIER 2 short  — contém a forma curta (antes de travessão/pipe), ex. "citavel".
 * TIER 3 word   — contém uma palavra distintiva (>=5 chars, fora da lista de genéricas).
 * TIER 4 fuzzy  — erro de digitação: distância PROPORCIONAL (1 até 7 chars, 2 a partir
 *                 de 8), fora da lista de palavras comuns do português
 *                 ("consentino" -> "Cosentino"). Só aceita se UM cliente ficar mais perto.
 */
/**
 * A palavra casou, mas o TEXTO a estende num nome que não é deste cliente?
 *
 * Caso real (16/09/2026): pediram a "campanha de aniversário do Jardim Europa 5"
 * e o TIER 3 casou a palavra "jardim" com o cliente "Jardim do Lago" — com
 * confiança total, sem marcar ambiguidade. O Otto então escreveu a legenda de
 * um empreendimento em Penápolis para uma campanha da Cosentino. Cliente
 * errado, campanha errada, conteúdo inventado.
 *
 * A palavra seguinte no texto era "europa", que não existe no nome do cliente.
 * Quando isso acontece, o texto está nomeando OUTRA entidade que só começa
 * igual, e casar pela primeira palavra é ignorar justamente a que diferencia.
 *
 * Vale para qualquer nome composto: "Costa Azul" x "Costa Rica",
 * "Areia Branca" x "Areia Preta".
 */
function palavraEstendidaNoTexto(
  palavra: string,
  mensagemNormalizada: string,
  nomeCurto: string,
  proprios: Set<string>,
): boolean {
  const doNome = new Set(nomeCurto.split(' ').filter(Boolean));
  const re = new RegExp(`\\b${palavra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+([a-z0-9]+)`, 'g');
  for (const m of mensagemNormalizada.matchAll(re)) {
    const seguinte = m[1] ?? '';
    // Token curto ("do", "da", "de") não diferencia nada.
    if (seguinte.length < 3) continue;
    if (doNome.has(seguinte)) continue;
    // SÓ conta como outra entidade quando a palavra seguinte é ela própria um
    // NOME PRÓPRIO no texto original ("Jardim Europa"), não uma palavra comum
    // ("a Fratelli confirmou"). Sem esta checagem a regra rejeitava frase
    // legítima e o cliente deixava de ser resolvido — pior que o bug original.
    if (proprios.has(seguinte)) return true;
  }
  return false;
}

/** Tokens escritos com inicial maiúscula na mensagem original, já dobrados. */
function nomesPropriosDoTexto(message: string): Set<string> {
  const saida = new Set<string>();
  for (const bruto of message.split(/\s+/)) {
    const limpo = bruto.replace(/[^\p{L}\p{N}]/gu, '');
    if (limpo.length < 3) continue;
    if (!/^[A-ZÀ-Ý]/.test(limpo)) continue;
    saida.add(normalize(limpo));
  }
  return saida;
}

export async function resolveClientsFromText(message: string): Promise<ClientResolution> {
  const normalizedMessage = ` ${normalize(message)} `; // espaços nas pontas pra \b casar no início/fim
  const propriosDoTexto = nomesPropriosDoTexto(message);
  if (normalizedMessage.trim().length < MIN_CONFIDENT_NAME_LEN) {
    return { matches: [], ambiguous: [], tier: 'none' };
  }

  const clients = await db
    .select({ id: schema.clients.id, name: schema.clients.name, slug: schema.clients.slug })
    .from(schema.clients);

  /** Para cada nível, o termo que bateu por cliente (o termo alimenta a pergunta de desambiguação). */
  const tiers: Array<{ tier: ClientResolution['tier']; hits: Map<string, { client: ClientRow; term: string }> }> = [
    { tier: 'exact', hits: new Map() },
    { tier: 'short', hits: new Map() },
    { tier: 'word', hits: new Map() },
  ];

  for (const client of clients) {
    const full = normalize(client.name);
    const slugAsText = normalize(client.slug.replace(/-/g, ' '));
    const shortForm = normalize(client.name.split(/[—|]/)[0] ?? client.name);

    const matchesTerm = (candidate: string): boolean => {
      if (!candidate || candidate.length < MIN_CONFIDENT_NAME_LEN) return false;
      if (PALAVRA_GENERICA_DEMAIS.has(candidate)) return false;
      const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`).test(normalizedMessage);
    };

    if (matchesTerm(full)) {
      tiers[0]!.hits.set(client.id, { client, term: full });
      continue;
    }
    if (matchesTerm(slugAsText)) {
      tiers[0]!.hits.set(client.id, { client, term: slugAsText });
      continue;
    }
    if (matchesTerm(shortForm)) {
      tiers[1]!.hits.set(client.id, { client, term: shortForm });
      continue;
    }
    const distinctive = shortForm
      .split(' ')
      .filter((w) => w.length >= 5 && !PALAVRA_GENERICA_DEMAIS.has(w) && !PALAVRA_FRACA.has(w));
    const hitWord = distinctive.find((w) => matchesTerm(w) && !palavraEstendidaNoTexto(w, normalizedMessage, shortForm, propriosDoTexto));
    if (hitWord) tiers[2]!.hits.set(client.id, { client, term: hitWord });
  }

  const matches: ClientMatch[] = [];
  const ambiguous: ClientResolution['ambiguous'] = [];
  /** Termos já explicados por um match estrutural — o fuzzy não deve tentar de novo neles. */
  const consumedTerms = new Set<string>();
  let winningTier: ClientResolution['tier'] = 'none';

  // A unidade de decisão é o TERMO, não o nível. Duas propriedades têm que valer juntas:
  //  (a) pro MESMO termo, o nível mais preciso ganha — é isso que faz "cosentino" resolver
  //      o cliente chamado "Cosentino" em vez de empatar com "Construtora ... Cosentino";
  //  (b) termos DIFERENTES podem resolver em níveis diferentes na mesma frase — sem isso,
  //      "analisa 3net, consentino e d carvalho" resolvia só os dois nomes exatos e
  //      descartava calado o terceiro (com erro de digitação).
  // Agrupar por termo e só então escolher o melhor nível daquele termo entrega as duas.
  const tierRank: Record<string, number> = { exact: 0, short: 1, word: 2 };
  const byTerm = new Map<string, Array<{ client: ClientRow; tier: ClientResolution['tier'] }>>();
  for (const { tier, hits } of tiers) {
    for (const { client, term } of hits.values()) {
      const list = byTerm.get(term) ?? [];
      list.push({ client, tier });
      byTerm.set(term, list);
    }
  }

  for (const [term, candidates] of byTerm) {
    const bestRank = Math.min(...candidates.map((c) => tierRank[c.tier] ?? 99));
    const winners = candidates.filter((c) => (tierRank[c.tier] ?? 99) === bestRank);
    const unique = [...new Map(winners.map((w) => [w.client.id, w.client])).values()];

    consumedTerms.add(term);
    for (const word of term.split(' ')) consumedTerms.add(word);

    const bestTier = winners[0]!.tier;
    if (winningTier === 'none' || (tierRank[bestTier] ?? 99) < (tierRank[winningTier] ?? 99)) {
      winningTier = bestTier;
    }

    if (unique.length === 1) {
      const c = unique[0]!;
      if (!matches.some((m) => m.id === c.id)) matches.push({ id: c.id, name: c.name, slug: c.slug });
    } else {
      ambiguous.push({
        term,
        candidates: unique.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
      });
    }
  }

  // TIER 4 — erro de digitação. Roda SEMPRE (não só quando nada foi resolvido): uma
  // mensagem pode citar três clientes em níveis diferentes ao mesmo tempo. Caso real:
  // "analisa 3net, consentino e d carvalho" — dois nomes exatos e um com erro de
  // digitação. Quando o fuzzy só rodava como último recurso, o nome errado era
  // silenciosamente descartado e a resposta cobria dois clientes de três, sem avisar.
  const words = candidateWords(normalizedMessage.trim()).filter((w) => !consumedTerms.has(w));
  const fuzzyMatches: ClientMatch[] = [];
  const fuzzyAmbiguous: ClientResolution['ambiguous'] = [];
  for (const word of words) {
    // Mesma precedência por precisão do caminho exato, aplicada ao fuzzy: errar a digitação do
    // NOME do cliente ("consentino" -> "Cosentino") é evidência mais forte que errar a
    // digitação de uma palavra que só aparece DENTRO do nome de outro cliente (o mesmo
    // "cosentino" dentro de "Construtora e Imobiliária Cosentino Ltda."). Sem esse
    // desempate os dois empatavam em distância 1 e o cliente voltava a ser irresolvível.
    let best: { distance: number; rank: number; clients: ClientRow[] } | null = null;
    for (const client of clients) {
      const full = normalize(client.name);
      const shortForm = normalize(client.name.split(/[—|]/)[0] ?? '');
      const alvos: Array<{ text: string; rank: number }> = [
        { text: full, rank: 0 },
        { text: shortForm, rank: 1 },
        ...shortForm
          .split(' ')
          .filter((w) => w.length >= 5 && !PALAVRA_GENERICA_DEMAIS.has(w))
          .map((w) => ({ text: w, rank: 2 })),
      ];
      for (const alvo of alvos) {
        if (alvo.text.length < 5 || PALAVRA_GENERICA_DEMAIS.has(alvo.text)) continue;
        const distance = editDistanceWithin(word, alvo.text, maxFuzzyDistance(word));
        if (distance === null || distance === 0) continue;
        const melhor = !best || distance < best.distance || (distance === best.distance && alvo.rank < best.rank);
        if (melhor) {
          best = { distance, rank: alvo.rank, clients: [client] };
        } else if (best && distance === best.distance && alvo.rank === best.rank && !best.clients.includes(client)) {
          best.clients.push(client);
        }
      }
    }
    if (!best) continue;
    const unique = [...new Map(best.clients.map((c) => [c.id, c])).values()];
    if (unique.length === 1) {
      const c = unique[0]!;
      if (!fuzzyMatches.some((m) => m.id === c.id)) {
        fuzzyMatches.push({ id: c.id, name: c.name, slug: c.slug });
      }
    } else {
      fuzzyAmbiguous.push({ term: word, candidates: unique.map((c) => ({ id: c.id, name: c.name, slug: c.slug })) });
    }
  }

  // Une o fuzzy ao que os níveis estruturais já resolveram, sem duplicar cliente nem
  // reabrir ambiguidade de termo já resolvido.
  for (const fuzzy of fuzzyMatches) {
    if (!matches.some((m) => m.id === fuzzy.id)) matches.push(fuzzy);
  }
  for (const amb of fuzzyAmbiguous) {
    if (amb.candidates.every((c) => !matches.some((m) => m.id === c.id))) ambiguous.push(amb);
  }

  const tier: ClientResolution['tier'] =
    winningTier !== 'none' ? winningTier : fuzzyMatches.length || fuzzyAmbiguous.length ? 'fuzzy' : 'none';

  return { matches, ambiguous, tier };
}

/**
 * @param message texto livre digitado pelo usuário
 * @returns o cliente, se exatamente UM cliente foi resolvido; `null` se nenhum bateu OU se o
 *   caso é ambíguo/multi-cliente. Mantida com esta assinatura porque é o que as rotas de chat
 *   já consomem; quem precisa distinguir "nenhum" de "vários" usa `resolveClientsFromText`.
 */
export async function resolveClientFromText(message: string): Promise<ClientMatch | null> {
  const { matches, ambiguous } = await resolveClientsFromText(message);
  if (ambiguous.length > 0) return null;
  return matches.length === 1 ? matches[0]! : null;
}

/** Só usado por rota que já tem um conversationId: aplica a mesma resolução, mas nunca sobrescreve
 * um clientId que a conversa já tenha (isolamento entre clientes é mais importante que herdar
 * contexto de uma mensagem posterior). */
export async function resolveClientForConversation(
  conversationId: string,
  message: string,
): Promise<ClientMatch | null> {
  const [conversation] = await db
    .select({ clientId: schema.conversations.clientId })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId));
  if (conversation?.clientId) return null;
  return resolveClientFromText(message);
}

/**
 * Projeto "casa" de um cliente — a pasta que aparece na barra lateral do chat (client-selector,
 * conversation-sidebar.tsx). Pedido real (09/09/2026): perguntar sobre a 3NET deveria deixar a
 * pergunta e a resposta salvas dentro do projeto 3NET, pra reabrir o projeto e ver tudo. O dado
 * já existia pra isso (cada cliente tem exatamente 1 projeto homônimo, `projects.clientId`), só
 * faltava a conversa herdar o `projectId` quando só o cliente foi resolvido (seletor OU detecção
 * por nome) — a barra lateral agrupa por `projectId`, não por `clientId` direto
 * (conversation-sidebar.tsx: `conversationsByProject.get(conversation.projectId)`), então uma
 * conversa com só `clientId` setado nunca aparecia dentro da pasta do cliente.
 *
 * Só resolve quando existe EXATAMENTE UM projeto pra aquele cliente — nunca adivinha entre
 * vários (mesmo princípio de isolamento do resolveClientFromText: ambíguo é melhor que errado).
 */
export async function resolveDefaultProjectForClient(clientId: string): Promise<string | null> {
  const rows = await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.clientId, clientId));
  if (rows.length !== 1) return null;
  return rows[0]?.id ?? null;
}
