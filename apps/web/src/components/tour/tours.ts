/**
 * TUTORIAIS GUIADOS — o registro. Cada tutorial é uma lista de etapas que
 * apontam para elementos REAIS da tela pelo atributo `data-tour-id` (estável;
 * nunca classe CSS, que muda com o estilo). O motor (tour-provider.tsx) navega
 * até a rota da etapa, espera o elemento aparecer e o destaca.
 *
 * Elemento que não existe (tela de celular sem sidebar, permissão diferente,
 * conversa ainda carregando) não trava: a etapa aparece centralizada, com o
 * mesmo texto, e a pessoa segue.
 *
 * Mudou o roteiro de um jeito que vale reapresentar? Suba `versao` aqui e o
 * `tutorial_version` do anúncio.
 */

export type Posicao = 'top' | 'bottom' | 'left' | 'right' | 'auto';

export interface EtapaDoTour {
  id: string;
  titulo: string;
  descricao: string;
  /** Rota onde a etapa acontece. Sem rota: na tela em que a pessoa está. */
  rota?: string;
  /** `data-tour-id` do elemento a destacar. Sem alvo: etapa centralizada. */
  alvo?: string;
  posicao?: Posicao;
  /** `data-tour-id` de um botão que precisa estar aberto (menu) para o alvo aparecer. Fecha ao sair da etapa. */
  abrir?: string;
  /** Etapa só faz sentido quando isto é verdade (ex.: tela larga). Falso = pula. */
  disponivel?: () => boolean;
  /** Alvo ausente: 'centralizar' (padrão) mostra a etapa no meio da tela; 'pular' segue para a próxima. */
  aoFaltar?: 'centralizar' | 'pular';
  /** Botão final da etapa (só na última): rótulo e destino. */
  acaoFinal?: { rotulo: string; href: string };
}

export interface Tour {
  id: string;
  /** Anúncio a que este tutorial pertence (o progresso é gravado nele). */
  anuncio?: string;
  versao: number;
  etapas: EtapaDoTour[];
}

export const TOURS: Record<string, Tour> = {
  communication_hub_v1: {
    id: 'communication_hub_v1',
    anuncio: 'communication_hub_launch_v1',
    versao: 1,
    etapas: [
      {
        id: 'menu',
        titulo: 'Tudo começa aqui',
        descricao: 'Acesse Comunicação pelo menu lateral para encontrar as conversas da sua equipe.',
        alvo: 'nav-comunicacao',
        // No celular o menu lateral é uma gaveta fechada: sem alvo visível, a etapa aparece centralizada.
        posicao: 'right',
      },
      {
        id: 'geral',
        titulo: 'Converse com toda a equipe',
        descricao: 'Use o canal Geral para compartilhar avisos, ideias e informações importantes com seus colegas.',
        rota: '/comunicacao?lista=1',
        alvo: 'comunicacao-geral',
        posicao: 'right',
      },
      {
        id: 'nova-conversa',
        titulo: 'Fale diretamente com seus colegas',
        descricao: 'Inicie conversas privadas ou crie grupos para organizar assuntos específicos.',
        rota: '/comunicacao?lista=1',
        alvo: 'comunicacao-nova-conversa',
        posicao: 'bottom',
      },
      {
        id: 'anexos',
        titulo: 'Compartilhe arquivos com facilidade',
        descricao: 'Envie imagens, PDFs, apresentações e vídeos diretamente nas conversas.',
        rota: '/comunicacao?c=geral',
        alvo: 'comunicacao-anexos',
        posicao: 'top',
      },
      {
        id: 'compartilhar',
        titulo: 'Conecte conversas ao trabalho',
        descricao: 'Compartilhe tarefas, clientes, campanhas e relatórios sem sair do Desigual OS.',
        rota: '/comunicacao?c=geral',
        abrir: 'comunicacao-anexos',
        alvo: 'comunicacao-compartilhar',
        posicao: 'top',
      },
      {
        id: 'fim',
        titulo: 'Tudo pronto para começar!',
        descricao: 'Sua equipe agora tem um espaço próprio para conversar, colaborar e acompanhar o trabalho.',
        acaoFinal: { rotulo: 'Abrir Comunicação', href: '/comunicacao' },
      },
    ],
  },
};

/** O tutorial de um anúncio (o link da notificação traz a chave do anúncio). */
export function tourDoAnuncio(chave: string): Tour | null {
  return Object.values(TOURS).find((t) => t.anuncio === chave) ?? null;
}

