import { dobrar, PALAVRA_FRACA } from './entity-matching.js';

/**
 * campaign-derivation.ts — de onde saem as campanhas.
 *
 * A operação já nomeia campanha; só ninguém tinha lido. A convenção real, que
 * está documentada e é usada nas duas maiores contas, é
 * `Cliente_Campanha_Peça`:
 *
 *   Cosentino_Europa V_Campanha de Aniversário_Motion_Painel Recepção
 *   DC_Operação Blindada_Layouts
 *
 * Derivar daí não é heurística frouxa: é ler o que o time escreveu. O que não
 * segue a convenção NÃO vira campanha inventada — fica de fora, e a ausência é
 * reportada em vez de preenchida.
 *
 * O alias é a outra metade. A fonte escreve "Europa V" no nome da task e
 * "Jardim Europa V" na descrição; a pessoa fala "Jardim Europa 5". Sem juntar as
 * três formas, a campanha existe e mesmo assim não é encontrada — que foi
 * exatamente o que aconteceu.
 */

export interface TaskParaDerivacao {
  id: string;
  name: string;
  description?: string;
  status?: string | null;
  closed: boolean;
  updatedAt?: Date | null;
}

/** Quantas tasks da campanha viajam junto como contexto. */
const TASKS_DE_CONTEXTO = 25;

/**
 * Quantas tasks precisam repetir a mesma frase para ela ser considerada
 * campanha na 2a convenção. Três é o mínimo que separa "campanha" de
 * "coincidência": duas tasks com a mesma palavra acontece o tempo todo.
 */
const REPETICOES_PARA_CAMPANHA = 3;

const MESES = new Set([
  'janeiro','fevereiro','marco','abril','maio','junho','julho','agosto',
  'setembro','outubro','novembro','dezembro',
]);

/** Segmento que descreve PEÇA ou ETAPA, nunca campanha. */
const SEGMENTO_NAO_E_CAMPANHA = new Set([
  ...MESES,
  'card','cards','reels','video','videos','story','stories','post','posts',
  'ajustes','ajuste','criacao','criar','editar','edicao','revisao','validar',
  'layout','layouts','arte','artes','texto','textos','legenda','legendas',
  'conteudo','conteudos','banner','banners','logo','feed','carrossel',
  'aprovacao','briefing','relatorio','calendario','pauta','spot','motion',
]);

export interface CampanhaDerivada {
  canonicalName: string;
  normalizedName: string;
  aliases: string[];
  taskRefs: string[];
  /** As mais recentes, com nome e status: é o contexto que o agente escreve em cima. */
  recentTasks: Array<{ id: string; name: string; status: string | null; closed: boolean; updatedAt: string | null }>;
  taskCount: number;
  openTaskCount: number;
  lastSourceUpdateAt: Date | null;
}

/** Segmento que é peça/etapa, não campanha. Aparece como 2o segmento por engano. */
const SEGMENTO_DE_PECA = new Set([
  'layout', 'layouts', 'edicao', 'edicoes', 'motion', 'card', 'cards', 'banner',
  'cartaz', 'conteudo', 'conteudos', 'texto', 'textos', 'bases', 'base',
  'alteracao', 'alteracoes', 'aprovacao', 'briefing', 'arte', 'artes',
]);

/**
 * Nome da campanha a partir do nome da task. Devolve null quando a task não
 * segue a convenção — preferimos campanha de menos a campanha inventada.
 */
export function campanhaDoNomeDaTask(nomeDaTask: string): string | null {
  const partes = nomeDaTask.split('_').map((p) => p.trim()).filter(Boolean);
  // Precisa de ao menos `Cliente_Campanha`: uma parte só é task avulsa.
  if (partes.length < 2) return null;
  const candidato = partes[1]!;
  const dobrado = dobrar(candidato);
  if (dobrado.length < 3) return null;
  // Segmento que é peça (ex.: "Cosentino_Layout") não é campanha.
  if (SEGMENTO_DE_PECA.has(dobrado)) return null;
  // Segmento de uma palavra fraca sozinha ("Digitais") é agrupamento de rotina,
  // não campanha nomeada: vira campanha sem identidade e polui a resolução.
  if (dobrado.split(' ').length === 1 && PALAVRA_FRACA.has(dobrado)) return null;
  return candidato;
}

/**
 * Aliases da campanha aprendidos do TEXTO das tasks: a fonte costuma escrever a
 * forma longa na descrição ("Lançamento Jardim Europa V") e a curta no nome
 * ("Europa V"). Captura até duas palavras próprias imediatamente antes do nome
 * canônico e devolve a forma estendida.
 */
export function aliasesDoTexto(canonical: string, textos: string[]): string[] {
  const alvo = dobrar(canonical);
  if (alvo.length === 0) return [];
  const encontrados = new Set<string>();

  for (const texto of textos) {
    if (!texto) continue;
    const tokensOriginais = texto.split(/\s+/).filter(Boolean);
    const dobrados = tokensOriginais.map((t) => dobrar(t));
    const alvoTokens = alvo.split(' ');

    for (let i = 0; i + alvoTokens.length <= dobrados.length; i += 1) {
      let bate = true;
      for (let j = 0; j < alvoTokens.length; j += 1) {
        if (dobrados[i + j] !== alvoTokens[j]) { bate = false; break; }
      }
      if (!bate) continue;

      for (let extra = 1; extra <= 2; extra += 1) {
        const inicio = i - extra;
        if (inicio < 0) break;
        const prefixo = tokensOriginais.slice(inicio, i);
        // Só palavra própria (inicial maiúscula) vira alias. "da Europa V" e
        // "para Europa V" não são nomes; "Jardim Europa V" é.
        if (!prefixo.every((p) => /^[A-ZÀ-Ý]/.test(p))) break;
        const candidato = [...prefixo, ...tokensOriginais.slice(i, i + alvoTokens.length)].join(' ');
        if (dobrar(candidato) !== alvo) encontrados.add(candidato.replace(/[^\p{L}\p{N}\s.-]/gu, '').trim());
      }
    }
  }
  return [...encontrados].filter((a) => a.length > 0).slice(0, 8);
}

/**
 * Segunda convenção, medida na base real: a maioria das contas não usa
 * underscore e escreve `Cliente - Assunto - PERÍODO` ou `Card DD/MM - Tema -
 * Cliente`. Dentro disso existe campanha de verdade repetida entre tasks
 * ("Evento inauguração", "Apae em movimento", "Conteúdos de aniversário").
 *
 * A regra é de DADOS, não de lista fixa: uma frase que o time repete em várias
 * tasks do mesmo cliente é campanha; frase que aparece uma vez é assunto
 * daquela peça. Data, mês, nome do cliente e palavra de peça ficam de fora.
 */
export function segmentosCandidatos(nomeDaTask: string, clientName?: string): string[] {
  const clienteDobrado = clientName ? dobrar(clientName) : '';
  const clienteTokens = new Set(clienteDobrado.split(' ').filter(Boolean));

  const proibido = (tk: string) =>
    SEGMENTO_NAO_E_CAMPANHA.has(tk) || PALAVRA_FRACA.has(tk) || clienteTokens.has(tk) || /^\d+$/.test(tk);

  const saida = new Set<string>();
  for (const segmento of nomeDaTask.split(/\s+[-\u2013\u2014]\s+/)) {
    const original = segmento.trim().split(/\s+/).filter(Boolean);
    const dobrados = original.map((t) => dobrar(t));

    // N-gramas de 2 a 4 palavras. A campanha aparece DENTRO do segmento
    // ("BANNERS p/ Evento inauguração"), não como o segmento inteiro — por isso
    // contar segmento fechado não achava nada.
    for (let n = 2; n <= 4; n += 1) {
      for (let i = 0; i + n <= dobrados.length; i += 1) {
        const janela = dobrados.slice(i, i + n);
        if (janela.some((tk) => tk.length === 0)) continue;
        // Borda fraca faz a frase deixar de ser nome ("p/ Evento", "Evento de").
        if (proibido(janela[0]!) || proibido(janela[n - 1]!)) continue;
        // Data no meio quebra o nome.
        if (janela.some((tk) => /\d{1,2}\/\d{1,2}/.test(tk))) continue;
        const frase = original.slice(i, i + n).join(' ');
        if (dobrar(frase).length >= 8) saida.add(frase);
      }
    }
  }
  return [...saida];
}

/**
 * "Campanha Operação Blindada" e "Operação Blindada" são a MESMA campanha: a
 * primeira só carrega a palavra-categoria na frente. Sem normalizar, o registro
 * ganha duas linhas concorrentes para a mesma coisa e a contagem de tasks fica
 * partida entre elas.
 */
function semPalavraCategoria(nome: string): string {
  const limpo = nome.replace(/^\s*(campanhas?|a[çc][ãa]o|projeto)\s+/i, '').trim();
  return limpo.length >= 4 ? limpo : nome;
}

/** Agrupa as tasks de UM cliente nas campanhas que a fonte nomeia. */
export function derivarCampanhas(
  tasks: TaskParaDerivacao[],
  opcoes: { clientName?: string } = {},
): CampanhaDerivada[] {
  const porCampanha = new Map<string, { canonical: string; tasks: TaskParaDerivacao[] }>();

  for (const t of tasks) {
    const bruto = campanhaDoNomeDaTask(t.name);
    if (!bruto) continue;
    const nome = semPalavraCategoria(bruto);
    const chave = dobrar(nome);
    const atual = porCampanha.get(chave);
    if (atual) atual.tasks.push(t);
    else porCampanha.set(chave, { canonical: nome, tasks: [t] });
  }

  // 2a convenção: só entra o que a fonte REPETE, e nunca sobrescreve campanha
  // já derivada da convenção explícita.
  const porRepeticao = new Map<string, { canonical: string; tasks: TaskParaDerivacao[] }>();
  for (const t of tasks) {
    if (campanhaDoNomeDaTask(t.name)) continue;
    for (const bruto of new Set(segmentosCandidatos(t.name, opcoes.clientName))) {
      const seg = semPalavraCategoria(bruto);
      const chave = dobrar(seg);
      if (porCampanha.has(chave)) continue;
      const atual = porRepeticao.get(chave);
      if (atual) atual.tasks.push(t);
      else porRepeticao.set(chave, { canonical: seg, tasks: [t] });
    }
  }
  const aprovadas = [...porRepeticao.entries()].filter(([, g]) => g.tasks.length >= REPETICOES_PARA_CAMPANHA);
  for (const [chave, grupo] of aprovadas) {
    // Descarta a frase que está contida em outra frase aprovada com a MESMA
    // contagem: as duas descrevem a mesma campanha e a mais longa é a que o
    // time realmente escreve.
    const contidaEmOutra = aprovadas.some(
      ([outraChave, outroGrupo]) =>
        outraChave !== chave &&
        outraChave.includes(chave) &&
        outroGrupo.tasks.length === grupo.tasks.length,
    );
    if (!contidaEmOutra) porCampanha.set(chave, grupo);
  }

  const saida: CampanhaDerivada[] = [];
  for (const [normalizedName, { canonical, tasks: doGrupo }] of porCampanha) {
    const datas = doGrupo.map((t) => t.updatedAt).filter((d): d is Date => d instanceof Date);
    saida.push({
      canonicalName: canonical,
      normalizedName,
      aliases: aliasesDoTexto(canonical, doGrupo.flatMap((t) => [t.name, t.description ?? ''])),
      taskRefs: doGrupo.map((t) => t.id).slice(0, 500),
      recentTasks: [...doGrupo]
        .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0))
        .slice(0, TASKS_DE_CONTEXTO)
        .map((t) => ({
          id: t.id, name: t.name, status: t.status ?? null, closed: t.closed,
          updatedAt: t.updatedAt ? t.updatedAt.toISOString() : null,
        })),
      taskCount: doGrupo.length,
      openTaskCount: doGrupo.filter((t) => !t.closed).length,
      lastSourceUpdateAt: datas.length > 0 ? new Date(Math.max(...datas.map((d) => d.getTime()))) : null,
    });
  }
  return saida.sort((a, b) => b.taskCount - a.taskCount);
}
