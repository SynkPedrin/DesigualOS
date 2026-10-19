/**
 * O ROTEIRO DO TUTORIAL, separado da animação.
 *
 * Cada cena aponta para UM mockup real de `public/tutorial/` e descreve o que
 * aquela tela resolve. Os destaques usam coordenadas em PORCENTAGEM da imagem,
 * não pixels: os mockups têm 1672 de largura e a composição roda em 1920, então
 * porcentagem é o que sobrevive a essa diferença e a um mockup trocado depois.
 *
 * O que está escrito aqui foi lido das imagens, nunca deduzido do nome do
 * arquivo. Quem trocar um mockup precisa reler o texto da cena junto.
 */
export interface Destaque {
  /** Retângulo em % da imagem: [esquerda, topo, largura, altura]. */
  area: [number, number, number, number];
  rotulo: string;
  /** De que lado do retângulo o rótulo aparece. */
  lado: 'acima' | 'abaixo';
  /** Segundo, dentro da cena, em que o destaque entra. */
  entraEm: number;
}

export interface Cena {
  imagem: string;
  titulo: string;
  /** Uma frase. Se precisar de duas, a cena está fazendo trabalho demais. */
  resumo: string;
  destaques: Destaque[];
  duracaoSegundos: number;
}

export const CENAS: Cena[] = [
  {
    imagem: 'hoje.png',
    titulo: 'Hoje',
    resumo: 'A tela que abre com você. Mostra o que precisa de atenção agora, antes de você procurar.',
    duracaoSegundos: 9,
    destaques: [
      { area: [14.5, 19, 71, 11], rotulo: 'Os quatro números do dia: conversas, tarefas, reuniões e aprovações', lado: 'abaixo', entraEm: 1.6 },
      { area: [14.5, 32, 51, 45], rotulo: 'Prioridades de hoje, já filtradas pelo que é seu', lado: 'abaixo', entraEm: 4.2 },
      { area: [38, 7, 47, 11], rotulo: 'O Bento resume sua semana sem você pedir', lado: 'abaixo', entraEm: 6.4 },
    ],
  },
  {
    imagem: 'visao-geral.png',
    titulo: 'Visão geral',
    resumo: 'A operação inteira em números: quem usa a inteligência, quanto pedem a ela e o que falhou.',
    duracaoSegundos: 9,
    destaques: [
      { area: [14.5, 21, 71, 14], rotulo: 'Carteira, uso da equipe, pedidos à IA e taxa de falha', lado: 'abaixo', entraEm: 1.6 },
      { area: [14.5, 37, 51, 31], rotulo: 'Uso dia a dia. A faixa escura embaixo é o que falhou', lado: 'abaixo', entraEm: 4.0 },
      { area: [79, 46, 19, 32], rotulo: 'Recomendações do Bento a partir da operação real', lado: 'acima', entraEm: 6.2 },
    ],
  },
  {
    imagem: 'tarefas.png',
    titulo: 'Tarefas',
    resumo: 'Tudo que vem do ClickUp, com cliente, responsável, prazo e prioridade, sem precisar abrir o ClickUp.',
    duracaoSegundos: 9,
    destaques: [
      { area: [15, 23, 84, 12], rotulo: 'Total, abertas, as que vencem hoje e as atrasadas', lado: 'abaixo', entraEm: 1.6 },
      { area: [15, 35, 36, 6], rotulo: 'Alterne entre todas as tarefas e só as suas', lado: 'abaixo', entraEm: 4.0 },
      { area: [69, 9, 30, 12], rotulo: 'O Bento diz o que priorizar nesta semana', lado: 'abaixo', entraEm: 6.2 },
    ],
  },
  {
    imagem: 'pipelines.png',
    titulo: 'Pipeline',
    resumo: 'Um quadro por tipo de trabalho. Arraste o cartão de coluna e o status acompanha.',
    duracaoSegundos: 9,
    destaques: [
      { area: [14.5, 16, 71, 12], rotulo: 'Quantos cartões, quanto vale cada etapa e a taxa de conversão', lado: 'abaixo', entraEm: 1.6 },
      { area: [14.5, 34, 44, 55], rotulo: 'Novo Lead, Em andamento e Em aprovação. Arraste entre elas', lado: 'acima', entraEm: 4.0 },
      { area: [82, 36, 16, 30], rotulo: 'O Bento aponta o que está travado há mais tempo', lado: 'acima', entraEm: 6.4 },
    ],
  },
  {
    imagem: 'automacoes.png',
    titulo: 'Automações',
    resumo: 'Trabalho que se repete vira rotina do sistema, com agente responsável e horário.',
    duracaoSegundos: 9,
    destaques: [
      { area: [14.5, 26, 71, 12], rotulo: 'Quantas rodam, quanto tempo pouparam e a taxa de sucesso', lado: 'abaixo', entraEm: 1.6 },
      { area: [35, 42, 40, 14], rotulo: 'As próximas execuções, em ordem', lado: 'abaixo', entraEm: 3.8 },
      { area: [76, 7, 23, 60], rotulo: 'Abrindo uma, você vê gatilho, histórico e pode executar na hora', lado: 'acima', entraEm: 6.0 },
    ],
  },
  {
    imagem: 'criar-automacao.png',
    titulo: 'Criar uma automação',
    resumo: 'Três passos: o que pedir e para quem, quando disparar, e em que condições.',
    duracaoSegundos: 10,
    destaques: [
      { area: [14, 16, 28, 60], rotulo: 'Passo 1: o que pedir, qual agente responde e para qual cliente', lado: 'acima', entraEm: 1.6 },
      { area: [42, 16, 28, 65], rotulo: 'Passo 2: hora fixa, recorrente ou disparada por evento', lado: 'acima', entraEm: 4.4 },
      { area: [70, 55, 29, 30], rotulo: 'A prévia mostra o que o agente vai responder antes de valer', lado: 'acima', entraEm: 7.0 },
    ],
  },
  {
    imagem: 'integracoes.png',
    titulo: 'Integrações',
    resumo: 'Onde a inteligência ganha acesso aos seus sistemas. Sem conexão, ela responde no vazio.',
    duracaoSegundos: 9,
    destaques: [
      { area: [14, 25, 85, 12], rotulo: 'Quantos sistemas estão ligados e quando sincronizaram', lado: 'abaixo', entraEm: 1.6 },
      { area: [14, 38, 85, 22], rotulo: 'O caminho: a IA fala com o MCP, e o MCP fala com seus sistemas', lado: 'abaixo', entraEm: 4.0 },
      { area: [14, 75, 85, 23], rotulo: 'Cada cartão mostra o estado real e abre o ajuste dele', lado: 'acima', entraEm: 6.4 },
    ],
  },
  {
    imagem: 'atividade.png',
    titulo: 'Atividade',
    resumo: 'O que aconteceu na operação: quem fez, em qual cliente, por qual ferramenta e quando.',
    duracaoSegundos: 9,
    destaques: [
      { area: [15, 17, 84, 10], rotulo: 'Quanto veio do ClickUp, do Bento e do Claude', lado: 'abaixo', entraEm: 1.6 },
      { area: [15, 38, 62, 50], rotulo: 'A linha do tempo, hora a hora, com o autor de cada ação', lado: 'acima', entraEm: 4.0 },
      { area: [78, 50, 21, 20], rotulo: 'Quais clientes mais consumiram a operação no período', lado: 'acima', entraEm: 6.4 },
    ],
  },
];

export const FPS = 30;
export const ABERTURA_SEGUNDOS = 4;
export const FECHO_SEGUNDOS = 6;

export const DURACAO_TOTAL_EM_FRAMES =
  Math.round(
    (ABERTURA_SEGUNDOS + CENAS.reduce((total, c) => total + c.duracaoSegundos, 0) + FECHO_SEGUNDOS) * FPS,
  );
