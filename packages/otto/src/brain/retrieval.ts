import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Retrieval do vault de conhecimento do Otto (Brain-Marketing + STUDIO-BRAIN).
 * Evolui o padrão de packages/router/src/marketing-copy.ts (load de *.md com
 * frontmatter simples + scoring por keyword) pra cobrir o vault inteiro,
 * com cache invalidado por mtime e saída com snippets pro planner.
 */

export interface BrainFrontmatter {
  id?: string;
  titulo?: string;
  escopo?: string;
  dominio?: string;
  framework?: string;
  intencoes: string[];
}

export interface BrainDoc {
  /** Path relativo ao brainPath (estável entre máquinas). */
  path: string;
  titulo: string;
  frontmatter: BrainFrontmatter;
  headings: string[];
  body: string;
  mtimeMs: number;
  sizeBytes: number;
}

export interface BrainIndex {
  brainPath: string;
  docs: BrainDoc[];
  loadedAt: number;
}

export interface RetrievedKnowledge {
  doc: BrainDoc;
  score: number;
  /** Trecho do documento mais relevante pra query, pro prompt não explodir. */
  snippet: string;
}

export interface BrainHealth {
  status: 'ok' | 'missing' | 'unreadable' | 'empty';
  docCount: number;
  detail: string;
  brainPath: string;
}

/** Pastas/arquivos que nunca entram no índice (metadados de vault e lixo de SO). */
const IGNORED_DIRS = new Set(['.obsidian', '.git', 'node_modules', '.turbo']);
const IGNORED_FILES = new Set(['.DS_Store']);

/** Subvault do Studio indexado recursivamente, além dos *.md da raiz. */
const RECURSIVE_ROOTS = ['STUDIO-BRAIN'];

// ---------------------------------------------------------------------------
// Frontmatter (mesmo parser permissivo do marketing-copy: YAML simples linha
// a linha, sem dependência de lib YAML)
// ---------------------------------------------------------------------------

function parseFrontmatter(raw: string): { attrs: Record<string, string>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { attrs: {}, body: raw };
  const [, frontmatter, body] = match;
  const attrs: Record<string, string> = {};
  // Listas em bloco do YAML (`tags:\n  - a\n  - b`): o parser original só lia
  // `key: value` na mesma linha, então 154/155 docs do STUDIO-BRAIN tinham as
  // tags descartadas (achado BL-09 da auditoria forense de 12/09/2026). Os
  // itens viram lista inline na mesma chave e seguem pelo parseInlineList.
  let lastKey: string | null = null;
  const blockItems: string[] = [];
  const flushBlock = () => {
    if (lastKey && blockItems.length > 0) {
      attrs[lastKey] = blockItems.join(', ');
    }
    blockItems.length = 0;
  };
  for (const line of (frontmatter ?? '').split('\n')) {
    const blockItem = line.match(/^\s+-\s+(.+)$/);
    if (blockItem && lastKey) {
      blockItems.push(blockItem[1]!.trim());
      continue;
    }
    flushBlock();
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      lastKey = null;
      continue;
    }
    lastKey = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (value) {
      attrs[lastKey] = value;
      lastKey = null;
    }
  }
  flushBlock();
  return { attrs, body: (body ?? '').trim() };
}

function parseInlineList(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (!trimmed) return [];
  return trimmed
    .split(',')
    .map((item) => item.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'))
    .filter(Boolean);
}

function unquote(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const stripped = value.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').trim();
  return stripped.length > 0 ? stripped : undefined;
}

// ---------------------------------------------------------------------------
// Varredura do vault
// ---------------------------------------------------------------------------

interface BrainFileEntry {
  absolutePath: string;
  relativePath: string;
  mtimeMs: number;
  sizeBytes: number;
}

function collectMarkdownFiles(brainPath: string): BrainFileEntry[] {
  const entries: BrainFileEntry[] = [];

  const pushFile = (absolutePath: string): void => {
    const stat = statSync(absolutePath);
    // Arquivo de 0 bytes é nota vazia de vault; indexar só polui o retrieval.
    if (stat.size === 0) return;
    entries.push({
      absolutePath,
      relativePath: relative(brainPath, absolutePath),
      mtimeMs: stat.mtimeMs,
      sizeBytes: stat.size,
    });
  };

  for (const file of readdirSync(brainPath)) {
    if (IGNORED_FILES.has(file) || !file.endsWith('.md')) continue;
    const absolutePath = join(brainPath, file);
    if (statSync(absolutePath).isFile()) pushFile(absolutePath);
  }

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (IGNORED_DIRS.has(entry) || IGNORED_FILES.has(entry)) continue;
      const absolutePath = join(dir, entry);
      const stat = statSync(absolutePath);
      if (stat.isDirectory()) {
        walk(absolutePath);
      } else if (entry.endsWith('.md')) {
        pushFile(absolutePath);
      }
    }
  };

  for (const root of RECURSIVE_ROOTS) {
    const rootPath = join(brainPath, root);
    if (existsSync(rootPath) && statSync(rootPath).isDirectory()) walk(rootPath);
  }

  return entries;
}

function parseDoc(entry: BrainFileEntry): BrainDoc {
  const raw = readFileSync(entry.absolutePath, 'utf-8');
  const { attrs, body } = parseFrontmatter(raw);
  const headings = body
    .split('\n')
    .filter((line) => /^#{1,6}\s/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, '').trim());

  return {
    path: entry.relativePath,
    titulo: unquote(attrs.titulo) ?? unquote(attrs.topic) ?? unquote(attrs.title) ?? entry.relativePath,
    frontmatter: {
      ...(unquote(attrs.id) ? { id: unquote(attrs.id)! } : {}),
      ...(unquote(attrs.titulo) ? { titulo: unquote(attrs.titulo)! } : {}),
      ...(unquote(attrs.escopo) ? { escopo: unquote(attrs.escopo)! } : {}),
      // BL-09: o STUDIO-BRAIN usa o vocabulário type/domain/topic em vez de
      // titulo/escopo/dominio; os aliases leem os dois sem renomear nada no
      // vault.
      ...((unquote(attrs.dominio) ?? unquote(attrs.domain)) ? { dominio: (unquote(attrs.dominio) ?? unquote(attrs.domain))! } : {}),
      ...(unquote(attrs.framework) ? { framework: unquote(attrs.framework)! } : {}),
      intencoes: [...parseInlineList(attrs.intencoes), ...parseInlineList(attrs.tags)],
    },
    headings,
    body,
    mtimeMs: entry.mtimeMs,
    sizeBytes: entry.sizeBytes,
  };
}

// ---------------------------------------------------------------------------
// Cache em memória com invalidação por mtime: o vault muda com frequência
// (é um Obsidian vivo), então cache eterno serviria conhecimento velho.
// Reparseamos só os arquivos cujo mtime mudou; os demais são reutilizados.
// ---------------------------------------------------------------------------

const indexCache = new Map<string, BrainIndex>();

export function loadBrainIndex(brainPath: string): BrainIndex {
  const absoluteBrainPath = resolve(brainPath);
  const files = collectMarkdownFiles(absoluteBrainPath);
  const previous = indexCache.get(absoluteBrainPath);
  const previousDocs = new Map(previous?.docs.map((doc) => [doc.path, doc]) ?? []);

  const docs = files.map((entry) => {
    const cached = previousDocs.get(entry.relativePath);
    if (cached && cached.mtimeMs === entry.mtimeMs && cached.sizeBytes === entry.sizeBytes) {
      return cached;
    }
    return parseDoc(entry);
  });

  const index: BrainIndex = { brainPath: absoluteBrainPath, docs, loadedAt: Date.now() };
  indexCache.set(absoluteBrainPath, index);
  return index;
}

/** Força reindexação completa (útil em testes e em watchers futuros). */
export function invalidateBrainIndex(brainPath: string): void {
  indexCache.delete(resolve(brainPath));
}

// ---------------------------------------------------------------------------
// Scoring por relevância. Pesos decrescentes: frontmatter (titulo/intencoes)
// é declaração explícita de propósito do doc, headings resumem seções, corpo
// é sinal fraco (termo solto no meio de texto longo não quer dizer muito).
// ---------------------------------------------------------------------------

const WEIGHT_TITLE = 5;
const WEIGHT_INTENCAO = 4;
const WEIGHT_FRONTMATTER_FIELD = 3;
const WEIGHT_HEADING = 2;
const WEIGHT_BODY = 1;
/** Cap no match de corpo: doc longo não deve ganhar só por volume. */
const MAX_BODY_MATCHES_PER_TERM = 3;

function normalize(text: string): string {
  // pt-BR sem acento casa com acentuado ("atribuicao" ~ "atribuição"):
  // normalizar NFD e tirar diacrítico evita miss por grafia do briefing.
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3);
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const found = haystack.indexOf(needle, from);
    if (found === -1) return count;
    count += 1;
    from = found + needle.length;
  }
}

function extractSnippet(doc: BrainDoc, terms: string[], maxLength = 400): string {
  const normalizedBody = normalize(doc.body);
  let bestPosition = -1;
  for (const term of terms) {
    const position = normalizedBody.indexOf(term);
    if (position !== -1 && (bestPosition === -1 || position < bestPosition)) {
      bestPosition = position;
    }
  }
  if (bestPosition === -1) {
    return doc.body.slice(0, maxLength).trim();
  }
  // Snippet centrado no primeiro termo casado, em coordenadas do corpo
  // original (normalize não muda comprimento pra NFD->strip em texto comum).
  const start = Math.max(0, bestPosition - Math.floor(maxLength / 3));
  return doc.body.slice(start, start + maxLength).trim();
}

export interface RetrieveOptions {
  /** Quantos docs entram no resultado (e, portanto, no prompt). */
  maxDocs?: number;
  /** Tamanho do snippet de cada doc. Direto proporcional ao prompt eval. */
  snippetLength?: number;
  /**
   * Se os docs do subvault STUDIO-BRAIN participam da busca. `false` restringe
   * ao núcleo de marketing da raiz do vault.
   *
   * Por que isso existe: o STUDIO-BRAIN é 155 dos 161 docs do vault e trata de
   * engine de geração (ComfyUI, FLUX) e de peças de clientes específicos. Num
   * pedido pequeno de copy ele não ajuda e ATRAPALHA - na medição de baseline
   * (10/09/2026) um pedido de headline pra uma pizzaria voltou citando o
   * padrão de marca de outro cliente que só existe no STUDIO-BRAIN.
   *
   * Ressalva honesta de custo: isto NÃO é uma economia de IO relevante. A
   * varredura completa do vault custou 7,0 ms a frio e 1,9 ms com o cache por
   * mtime quente (medido no vault real, 161 docs). O ganho aqui é de
   * relevância e de tokens de prompt, não de wall clock de disco - por isso o
   * filtro é aplicado na BUSCA e o índice segue único (um só cache, uma só
   * cópia dos docs em memória).
   */
  includeStudioBrain?: boolean;
  /**
   * CERCA DE CLIENTE. Quando o turno é de um cliente resolvido, documento de
   * OUTRO cliente não é elegível — nem com a maior pontuação lexical.
   *
   * Por que isso precisa existir: o vault é um corpo único e a busca é
   * lexical, então "tom de voz" casa igualmente bem no material de qualquer
   * cliente. Medido pelo frontend em 18/09/2026: num turno sobre a Elite o
   * Otto passou a descrever o tom de voz e a persona da APAE. O README do
   * próprio módulo já registrava o mesmo padrão em 10/09 (headline de pizzaria
   * voltando com padrão de marca de outro cliente) e a correção de então foi
   * parcial: desligou o STUDIO-BRAIN em turno raso, o que reduz a chance mas
   * não fecha a porta.
   *
   * Similaridade é palpite; cliente resolvido pelo orquestrador é fato. Fato
   * filtra palpite, nunca o contrário.
   *
   * `null`/ausente = turno sem cliente: vale o conhecimento geral, e só ele —
   * material de cliente nenhum entra por falta de dono.
   */
  clientSlug?: string | null;
}

/**
 * Pastas do vault que guardam material DE CLIENTE. Um doc aqui dentro pertence
 * a alguém, e só esse alguém pode recebê-lo.
 */
const RAIZES_DE_CLIENTE = ['STUDIO-BRAIN/06_CLIENTS', 'STUDIO-BRAIN/07_PROJECTS', 'clientes', 'CLIENTES'];

/** O doc é material de cliente? Se for, devolve o segmento que identifica o dono. */
export function donoDoDocumento(path: string): string | null {
  for (const raiz of RAIZES_DE_CLIENTE) {
    if (!path.startsWith(`${raiz}/`)) continue;
    const resto = path.slice(raiz.length + 1);
    const dono = resto.split('/')[0];
    if (dono) return normalize(dono);
  }
  return null;
}

/**
 * Este documento pode ir para um turno deste cliente?
 *
 * Três respostas, e a do meio é a que importa:
 *   - não é material de cliente  -> sim, é conhecimento geral;
 *   - é de OUTRO cliente         -> NÃO, em nenhuma hipótese;
 *   - turno sem cliente resolvido -> só conhecimento geral.
 */
export function documentoPermitido(path: string, clientSlug: string | null | undefined): boolean {
  const dono = donoDoDocumento(path);
  if (dono === null) return true;
  if (!clientSlug) return false;
  const alvo = normalize(clientSlug);
  // Comparação por contenção nos dois sentidos: a pasta pode ser "elite" e o
  // slug "elite-construtora", ou o inverso. Igualdade estrita descartaria
  // material legítimo do próprio dono.
  return dono === alvo || dono.includes(alvo) || alvo.includes(dono);
}

/** Um doc pertence ao subvault do Studio quando seu path começa na raiz dele. */
function isStudioBrainDoc(doc: BrainDoc): boolean {
  return RECURSIVE_ROOTS.some((root) => doc.path.startsWith(root));
}

export function retrieveRelevantKnowledge(
  index: BrainIndex,
  query: string,
  /**
   * Number aceito por compatibilidade com os chamadores antigos
   * (`retrieveRelevantKnowledge(index, query, 5)`), que continuam valendo e
   * significando "só maxDocs, resto no default".
   */
  options: number | RetrieveOptions = {},
): RetrievedKnowledge[] {
  const opts: RetrieveOptions = typeof options === 'number' ? { maxDocs: options } : options;
  const maxDocs = opts.maxDocs ?? 5;
  const snippetLength = opts.snippetLength ?? 400;
  const includeStudioBrain = opts.includeStudioBrain ?? true;

  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const semStudio = includeStudioBrain ? index.docs : index.docs.filter((doc) => !isStudioBrainDoc(doc));
  // A cerca de cliente é aplicada ANTES da pontuação: documento fora do
  // cliente do turno não concorre, então não há como ele vencer por score.
  const candidates = semStudio.filter((doc) => documentoPermitido(doc.path, opts.clientSlug));

  const scored = candidates.map((doc) => {
    let score = 0;
    const titulo = normalize(doc.titulo);
    const intencoes = normalize(doc.frontmatter.intencoes.join(' '));
    const fields = normalize(
      [doc.frontmatter.escopo, doc.frontmatter.dominio, doc.frontmatter.framework]
        .filter(Boolean)
        .join(' '),
    );
    const headings = normalize(doc.headings.join(' '));
    const body = normalize(doc.body);

    const termosCasados: string[] = [];
    for (const term of terms) {
      let doTermo = 0;
      if (titulo.includes(term)) doTermo += WEIGHT_TITLE;
      if (intencoes.includes(term)) doTermo += WEIGHT_INTENCAO;
      if (fields.includes(term)) doTermo += WEIGHT_FRONTMATTER_FIELD;
      if (headings.includes(term)) doTermo += WEIGHT_HEADING;
      doTermo += Math.min(countOccurrences(body, term), MAX_BODY_MATCHES_PER_TERM) * WEIGHT_BODY;
      if (doTermo > 0) termosCasados.push(term);
      score += doTermo;
    }
    return { doc, score, termosCasados };
  });

  scored.sort((a, b) => b.score - a.score);

  /**
   * PISO DE RELEVÂNCIA (10/09/2026). O filtro anterior era `score > 0`: bastava UMA palavra
   * em comum pro documento entrar no prompt. Num vault de agência isso é fatal, porque
   * "automação", "carrossel", "roteiro" e "campanha" aparecem em quase todo documento
   * interno. Defeito medido em produção: "copy para um carrossel de 5 slides sobre IA na
   * China" foi respondido com a rotina interna da agência ("nossa rotina de criação e
   * validação de layouts por quinzena", "nossa equipe de análise de campanha") — o Brain
   * contaminou um tema que não tem nada a ver com ele.
   *
   * A primeira tentativa foi exigir 2+ termos casados por documento. O próprio teste desta
   * função reprovou: pra consulta "marca funil carrossel metricas" (tópicos DISTINTOS, cada
   * documento cobre um) isso zerava o resultado — o filtro matava o caso legítimo junto com
   * o ruído. Contar termos era a métrica errada.
   *
   * O que separa os dois casos é quão SELETIVO o termo é neste vault: "automação" aparece
   * em quase todo documento (não distingue nada), "funil" em poucos (distingue muito).
   * Então o critério é frequência de documento (IDF simples, calculada sobre o índice já em
   * memória, custo desprezível):
   *  - o documento precisa casar ao menos UM termo SELETIVO (presente em <= 40% do vault);
   *  - se NENHUM termo da consulta é seletivo, o filtro de seletividade é dispensado e vale
   *    só o piso relativo — senão uma consulta feita inteira de termos comuns não retornaria
   *    nada, o que é pior que retornar o mais próximo.
   *  - piso relativo de 25% da melhor pontuação, pra cortar a cauda de menções fracas.
   */
  const totalDocs = candidates.length;
  const frequenciaPorTermo = new Map<string, number>();
  for (const term of terms) {
    const emQuantos = scored.filter((e) => e.termosCasados.includes(term)).length;
    frequenciaPorTermo.set(term, totalDocs > 0 ? emQuantos / totalDocs : 0);
  }

  const LIMITE_SELETIVIDADE = 0.4;
  const MIN_DOCS_PRA_ESTATISTICA = 20;

  // Termo que casa em NADA não é discriminador (df=0 não significa "muito seletivo", que foi
  // o meu erro na primeira versão: ele virava exigência impossível e filtrava tudo).
  const termosSeletivos = terms.filter((t) => {
    const df = frequenciaPorTermo.get(t) ?? 0;
    return df > 0 && df <= LIMITE_SELETIVIDADE;
  });
  const temTermoSemCobertura = terms.some((t) => (frequenciaPorTermo.get(t) ?? 0) === 0);

  const melhorScore = scored[0]?.score ?? 0;
  const pisoRelativo = melhorScore * 0.25;

  // Vault pequeno (teste, brain recém-criado): estatística de frequência não diz nada quando
  // todo termo casado aparece em 100% de 1 documento. Mantém o comportamento histórico.
  const estatisticaConfiavel = totalDocs >= MIN_DOCS_PRA_ESTATISTICA;

  return scored
    .filter((entry) => {
      if (entry.score <= 0) return false;
      if (!estatisticaConfiavel) return true;
      if (entry.score < pisoRelativo) return false;
      // Existe termo seletivo: o documento precisa casar ao menos um deles.
      if (termosSeletivos.length > 0) {
        return entry.termosCasados.some((t) => termosSeletivos.includes(t));
      }
      // Nenhum termo seletivo E a consulta tem termo que o vault não cobre: é o caso "IA na
      // China" — o assunto está fora do Brain e o que casou foi só palavra comum. Injetar
      // aqui é exatamente a contaminação que este filtro existe pra impedir.
      if (temTermoSemCobertura) return false;
      return true;
    })
    .slice(0, maxDocs)
    .map((entry) => ({
      doc: entry.doc,
      score: entry.score,
      snippet: extractSnippet(entry.doc, terms, snippetLength),
    }));
}

// ---------------------------------------------------------------------------
// Health do vault: o Otto precisa saber dizer "estou criativo mas cego"
// (LLM ok, brain ausente) em vez de falhar silenciosamente com plano genérico.
// ---------------------------------------------------------------------------

export function checkBrainHealth(brainPath: string): BrainHealth {
  const absoluteBrainPath = resolve(brainPath);
  const base = { brainPath: absoluteBrainPath };

  if (!existsSync(absoluteBrainPath)) {
    return { ...base, status: 'missing', docCount: 0, detail: `Brain path not found: ${absoluteBrainPath}` };
  }

  let files: BrainFileEntry[];
  try {
    files = collectMarkdownFiles(absoluteBrainPath);
  } catch (error) {
    return {
      ...base,
      status: 'unreadable',
      docCount: 0,
      detail: `Brain path not readable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (files.length === 0) {
    return { ...base, status: 'empty', docCount: 0, detail: 'Brain path has no indexable markdown docs' };
  }

  return {
    ...base,
    status: 'ok',
    docCount: files.length,
    detail: `${files.length} markdown docs indexable`,
  };
}
