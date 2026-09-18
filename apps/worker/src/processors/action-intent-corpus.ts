/**
 * action-intent-corpus.ts — CORPUS VERSIONADO de classificação de intenção.
 *
 * Existe porque "melhorei o classificador" não é uma afirmação verificável. O
 * que é verificável: este conjunto de frases, esta expectativa por frase, este
 * número antes e depois. Cada frase de `tammy` saiu dos chats reais dela ou
 * dos briefs de operação; cada `adversarial` saiu de um jeito conhecido de o
 * classificador errar pra escrita — que é o erro caro.
 *
 * A assimetria é deliberada e está no dado: um falso positivo (escrever sem
 * ordem) custa uma task errada na conta de um cliente e a confiança da equipe;
 * um falso negativo (não escrever com ordem) custa uma frase repetida. Por
 * isso o conjunto adversarial é o maior, e a régua dele é ZERO.
 */

export type ExpectedIntent = 'ACT' | 'ANALYZE';

export interface CorpusCase {
  id: string;
  message: string;
  expected: ExpectedIntent;
  /** Por que esta frase está aqui — some no relatório quando um caso falha. */
  note: string;
  /** Quantas ações a mensagem contém, quando isso é o ponto do caso. */
  expectedActions?: number;
}

export const CORPUS_VERSION = '2026-09-18.1';

/**
 * TAMMY — como a operação fala. Todas são ordens inequívocas: se o Bento não
 * age em nenhuma destas, ele não serve pro trabalho dela.
 */
export const TAMMY_CASES: CorpusCase[] = [
  { id: 'T01', message: 'cria isso pro Gui', expected: 'ACT', note: 'ordem mínima com destinatário' },
  { id: 'T02', message: 'separa e lança pro Gui', expected: 'ACT', note: 'dois verbos de despacho, sem objeto explícito' },
  { id: 'T03', message: 'faz uma task disso', expected: 'ACT', note: '"faz" + objeto operacional' },
  { id: 'T04', message: 'essa fica pra Sofia', expected: 'ACT', note: 'atribuição declarativa, sem verbo no imperativo' },
  { id: 'T05', message: 'joga isso na D Carvalho', expected: 'ACT', note: 'destino é cliente, não pessoa' },
  { id: 'T06', message: 'faz o briefing e cria lá', expected: 'ACT', note: 'briefing + criação encadeados' },
  { id: 'T07', message: 'essa demanda é do Matheus', expected: 'ACT', note: 'posse declarativa define dono' },
  { id: 'T08', message: 'cria uma pro layout e outra pro texto', expected: 'ACT', expectedActions: 2, note: 'duas tasks, sem responsável' },
  { id: 'T09', message: 'o arquivo eu mando depois, já cria', expected: 'ACT', note: 'pendência declarada não bloqueia a ordem' },
  { id: 'T10', message: 'deixa pro Gui tocar', expected: 'ACT', note: '"deixa pro X" é despacho de trabalho' },
  { id: 'T11', message: 'coloca isso no ClickUp', expected: 'ACT', note: 'destino é a ferramenta' },
  { id: 'T12', message: 'separa essa demanda', expected: 'ACT', note: 'ordem sem destinatário nenhum' },
  { id: 'T13', message: 'lança isso no ClickUp', expected: 'ACT', note: 'verbo de lançamento' },
  { id: 'T14', message: 'cria uma demanda pra isso', expected: 'ACT', note: 'objeto é "demanda", não "task"' },
  { id: 'T15', message: 'bota essa no Gui', expected: 'ACT', note: '"bota" — regionalismo que faltava no léxico' },
  {
    id: 'T16',
    message: `precisamos desenvolver algumas placas seguindo o padrão visual e as diretrizes do MIV.

Bento, tenho a solicitação acima. Preciso que separe a demanda e lance pro Gui a criação do layout, no Clickup, na lista da D Carvalho.`,
    expected: 'ACT',
    note: 'o caso real de 17/09: texto colado + ordem no último parágrafo',
  },
];

/**
 * ANÁLISE — o freio. Estas seis são as que o incidente de 15/09 obrigou a
 * proteger, e continuam sendo a régua de que ampliar o vocabulário não
 * afrouxou o portão.
 */
export const ANALYSIS_CASES: CorpusCase[] = [
  { id: 'A01', message: 'analisa isso', expected: 'ANALYZE', note: 'pedido de análise puro' },
  { id: 'A02', message: 'me faz uma análise', expected: 'ANALYZE', note: '"faz" que NÃO é despacho' },
  { id: 'A03', message: 'o que você acha?', expected: 'ANALYZE', note: 'opinião' },
  { id: 'A04', message: 'veja isso e me diga o que devemos fazer', expected: 'ANALYZE', note: 'deliberação' },
  { id: 'A05', message: 'dá uma olhada nas peças e me fala', expected: 'ANALYZE', note: 'revisão informal' },
  {
    id: 'A06',
    message: "Analisa essas peças da campanha 'Peças que você confia, você tem'. Quero entender primeiro se elas estão boas e o que precisa mudar.",
    expected: 'ANALYZE',
    note: 'INCIDENTE 15/09: este pedido criou task na lista errada. Nunca mais.',
  },
];

/**
 * ADVERSARIAL — as formas conhecidas de arrancar uma escrita indevida do
 * classificador: negação, citação, passado, hipótese, pergunta, explicação,
 * e o texto de terceiro colado sem ordem nenhuma.
 */
export const ADVERSARIAL_CASES: CorpusCase[] = [
  // Negação
  { id: 'X01', message: 'não cria ainda', expected: 'ANALYZE', note: 'negação direta' },
  { id: 'X02', message: 'não separa isso ainda, quero ver antes', expected: 'ANALYZE', note: 'negação + justificativa' },
  { id: 'X03', message: 'não mexe no ClickUp por enquanto', expected: 'ANALYZE', note: 'negação sobre a ferramenta' },
  { id: 'X04', message: 'só analisa, não cria task', expected: 'ANALYZE', note: 'restrição explícita' },
  { id: 'X05', message: 'apenas analisa por enquanto', expected: 'ANALYZE', note: '"apenas" restringe' },
  { id: 'X06', message: 'sem criar task, me diz o que você faria', expected: 'ANALYZE', note: '"sem + infinitivo"' },
  { id: 'X07', message: 'não precisa lançar no ClickUp', expected: 'ANALYZE', note: 'dispensa explícita' },
  { id: 'X08', message: 'nem cria nem atribui, só me fala', expected: 'ANALYZE', note: 'dupla negação' },
  // Citação / relato
  { id: 'X09', message: 'ontem eu disse "cria uma task pro Gui" e não aconteceu nada', expected: 'ANALYZE', note: 'fala citada' },
  { id: 'X10', message: 'a Sté pediu pra criar uma task, mas ainda não confirmamos', expected: 'ANALYZE', note: 'relato de terceiro' },
  { id: 'X11', message: 'ontem eu criei uma task pro Gui e ele já entregou', expected: 'ANALYZE', note: 'passado, primeira pessoa' },
  { id: 'X12', message: 'o Matheus já lançou isso no ClickUp semana passada', expected: 'ANALYZE', note: 'passado, terceiro' },
  // Hipótese / condicional
  { id: 'X13', message: 'se eu criar uma task pro Gui, ele consegue entregar hoje?', expected: 'ANALYZE', note: 'condicional' },
  { id: 'X14', message: 'caso a gente separe essa demanda, quanto tempo leva?', expected: 'ANALYZE', note: 'hipótese' },
  { id: 'X15', message: 'seria melhor criar duas tasks ou uma só?', expected: 'ANALYZE', note: 'comparação hipotética' },
  // Pergunta / explicação
  { id: 'X16', message: 'me explica como criar uma task no ClickUp', expected: 'ANALYZE', note: 'pedido de explicação' },
  { id: 'X17', message: 'por que você criou essa task?', expected: 'ANALYZE', note: 'pergunta sobre o passado' },
  { id: 'X18', message: 'quem deveria ficar com isso?', expected: 'ANALYZE', note: 'pergunta de alocação' },
  { id: 'X19', message: 'quantas tarefas o Gui tem?', expected: 'ANALYZE', note: 'consulta operacional' },
  { id: 'X20', message: 'quem está sobrecarregado?', expected: 'ANALYZE', note: 'consulta de carga' },
  { id: 'X21', message: 'vale a pena criar uma task pra isso?', expected: 'ANALYZE', note: 'deliberação' },
  { id: 'X22', message: 'me diga se devemos criar uma task', expected: 'ANALYZE', note: 'deliberação explícita' },
  // Texto colado sem ordem
  {
    id: 'X23',
    message: `Bom dia! Segue o briefing da campanha. Precisamos criar 3 posts essa semana e lançar até sexta.

Atenciosamente, Marina`,
    expected: 'ANALYZE',
    note: 'e-mail de cliente colado, sem endereçar o Bento',
  },
  {
    id: 'X24',
    message: `O cliente mandou: "separa isso pro Gui e lança no ClickUp".

Bento, o que você acha dessa demanda?`,
    expected: 'ANALYZE',
    note: 'ordem DENTRO de citação + pergunta ao Bento',
  },
  { id: 'X25', message: 'quando se encerra o contrato da DCarvalho?', expected: 'ANALYZE', note: 'consulta factual' },
  { id: 'X26', message: 'quem é o atendimento responsável pela conta da D Carvalho?', expected: 'ANALYZE', note: 'consulta de pessoa' },
  // Regressão medida em 18/09/2026: a V2.0 lia "atualiza" + "aí" como ordem de
  // escrita e tentou CRIAR task num panorama. "aí/lá" são locativos.
  { id: 'X27', message: 'Bento, me atualiza aí.', expected: 'ANALYZE', note: '"atualiza aí" é pedido de panorama, não UPDATE' },
  { id: 'X28', message: 'me atualiza sobre a operação', expected: 'ANALYZE', note: 'atualizar EU é informação, não escrita' },
  { id: 'X29', message: 'atualiza pra mim o que tá rolando na D Carvalho', expected: 'ANALYZE', note: 'mesmo verbo, direção oposta' },
  { id: 'X30', message: 'Bento, me atualiza aí. O que tá pegando?', expected: 'ANALYZE', note: 'a frase exata do smoke que falhou' },
];

/**
 * VARIAÇÕES NATURAIS — a mesma ordem dita de jeitos diferentes. É aqui que se
 * vê se o léxico virou família semântica ou continua sendo lista de palavras.
 */
export const NATURAL_CASES: CorpusCase[] = [
  { id: 'N01', message: 'Bento, abre uma task disso pro Gui', expected: 'ACT', note: 'endereçado + "abre"' },
  { id: 'N02', message: 'passa essa pro Matheus, por favor', expected: 'ACT', note: 'cortesia não muda a ordem' },
  { id: 'N03', message: 'manda essa demanda pra Sofia', expected: 'ACT', note: '"manda"' },
  { id: 'N04', message: 'poe o layout na conta da Elite', expected: 'ACT', note: 'sem acento, como se digita correndo' },
  { id: 'N05', message: 'PÕE ISSO PRO GUI', expected: 'ACT', note: 'caixa alta' },
  { id: 'N06', message: 'cria ai uma task pro Gui', expected: 'ACT', note: '"ai" sem acento' },
  { id: 'N07', message: 'separa essas duas demandas pro Gui e pra Sofia', expected: 'ACT', expectedActions: 2, note: 'duas pessoas' },
  { id: 'N08', message: 'muda o responsável dessa pra Jamile', expected: 'ACT', note: 'família UPDATE' },
  { id: 'N09', message: 'atualiza a descrição dessa task', expected: 'ACT', note: 'família UPDATE' },
  { id: 'N10', message: 'troca o responsável pro Gui', expected: 'ACT', note: '"troca"' },
  { id: 'N11', message: 'e essa aqui, deixa com o Gui', expected: 'ACT', note: 'ordem no meio da frase' },
  { id: 'N12', message: 'beleza, então cria pro Gui', expected: 'ACT', note: 'marcador de discurso antes' },
];

/**
 * MULTI-AÇÃO — uma mensagem, N demandas. O executor já sabe criar várias; o
 * que precisa ser provado aqui é que o PARSER enxerga várias.
 */
export const MULTI_ACTION_CASES: CorpusCase[] = [
  {
    id: 'M01',
    message: `separa pro Gui:
- Placa "Estacione de Ré"
- Placa "Confiança"
- Placa "Troca de óleo"
- Placa "Revisão"`,
    expected: 'ACT',
    expectedActions: 4,
    note: 'CASO REAL DAS QUATRO PLACAS: lista com bullets',
  },
  {
    id: 'M02',
    message: `Bento, lança essas quatro pro Gui na D Carvalho:
1. Placa "Estacione de Ré"
2. Placa "Confiança"
3. Placa "Troca de óleo"
4. Placa "Revisão"`,
    expected: 'ACT',
    expectedActions: 4,
    note: 'lista numerada',
  },
  {
    id: 'M03',
    message: 'separa essas quatro pro Gui: Estacione de Ré, Confiança, Troca de óleo e Revisão',
    expected: 'ACT',
    expectedActions: 4,
    note: 'lista inline com vírgulas e "e" final',
  },
  {
    id: 'M04',
    message: 'cria o layout pro Gui e o texto pra Sofia',
    expected: 'ACT',
    expectedActions: 2,
    note: 'dois entregáveis, duas pessoas',
  },
  {
    id: 'M05',
    message: `Placa "Estacione de Ré"
Placa "Confiança"
Placa "Troca de óleo"

Bento, separa essas pro Gui.`,
    expected: 'ACT',
    expectedActions: 3,
    note: 'itens acima, ordem embaixo',
  },
];

export const ALL_CASES: CorpusCase[] = [
  ...TAMMY_CASES,
  ...ANALYSIS_CASES,
  ...ADVERSARIAL_CASES,
  ...NATURAL_CASES,
  ...MULTI_ACTION_CASES,
];

export const CORPUS_SETS = {
  tammy: TAMMY_CASES,
  analysis: ANALYSIS_CASES,
  adversarial: ADVERSARIAL_CASES,
  natural: NATURAL_CASES,
  multi: MULTI_ACTION_CASES,
} as const;
