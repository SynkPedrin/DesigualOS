/**
 * briefing-schema.ts — a FORMA do briefing muda com o tipo de entrega.
 *
 * O briefing anterior era um template fixo com frases de preenchimento
 * ("Executar a entrega descrita no título desta task"). Ele provava que o
 * comentário foi anexado e nada mais: não dizia o que produzir, pra quem, com
 * qual objetivo, nem o que estava faltando. Um reels e uma automação de CRM
 * recebiam exatamente o mesmo texto.
 *
 * Aqui a estrutura é derivada do TIPO de entrega e os campos são preenchidos
 * só com FATO recuperado — o que não existe vira pendência explícita, nunca
 * invenção. Classificação determinística e por vocabulário genérico: nada de
 * regra por cliente (isso falsificaria o teste e quebraria no cliente seguinte).
 */

export type DeliveryType = 'campaign' | 'video' | 'landing_page' | 'technical' | 'social_content' | 'generic';

export interface BriefingField {
  key: string;
  label: string;
  /** Sem este campo o briefing NÃO é executável. */
  critical?: boolean;
}

export interface BriefingSection {
  key: string;
  title: string;
  fields: BriefingField[];
}

const f = (key: string, label: string, critical = false): BriefingField =>
  critical ? { key, label, critical } : { key, label };

const IDENTIFICACAO: BriefingSection = {
  key: 'identificacao',
  title: 'IDENTIFICAÇÃO',
  fields: [f('cliente', 'Cliente', true), f('tipo_entrega', 'Tipo de entrega', true), f('responsavel', 'Responsável'), f('prazo', 'Prazo'), f('prioridade', 'Prioridade')],
};
const CONTEXTO: BriefingSection = {
  key: 'contexto',
  title: 'CONTEXTO',
  fields: [f('situacao', 'Situação', true), f('origem', 'De onde surgiu a demanda'), f('historico', 'Histórico relevante')],
};
const OBJETIVO: BriefingSection = {
  key: 'objetivo',
  title: 'OBJETIVO',
  fields: [f('objetivo', 'Objetivo principal', true), f('resultado', 'Resultado esperado')],
};
const PUBLICO: BriefingSection = {
  key: 'publico',
  title: 'PÚBLICO',
  fields: [f('publico', 'Público-alvo', true), f('dores', 'Dores'), f('desejos', 'Desejos'), f('objecoes', 'Objeções')],
};
const OFERTA: BriefingSection = {
  key: 'oferta',
  title: 'OFERTA / PRODUTO',
  fields: [f('produto', 'Produto/serviço', true), f('oferta', 'Oferta'), f('diferenciais', 'Diferenciais'), f('cta', 'CTA', true)],
};
const COMUNICACAO: BriefingSection = {
  key: 'comunicacao',
  title: 'DIREÇÃO DE COMUNICAÇÃO',
  fields: [f('tom', 'Tom', true), f('mensagem', 'Mensagem principal', true), f('angulo', 'Ângulo'), f('obrigatorios', 'Pontos obrigatórios'), f('proibidos', 'Pontos proibidos')],
};
const VISUAL: BriefingSection = {
  key: 'visual',
  title: 'DIREÇÃO VISUAL',
  fields: [f('estilo', 'Estilo'), f('referencias_visuais', 'Referências'), f('cores', 'Cores'), f('assets', 'Assets'), f('proibidos_visuais', 'Elementos proibidos')],
};
const CANAL: BriefingSection = {
  key: 'canal',
  title: 'CANAL / FORMATO',
  fields: [f('canal', 'Canal', true), f('formato', 'Formato/dimensão')],
};
const ENTREGAVEIS: BriefingSection = {
  key: 'entregaveis',
  title: 'ENTREGÁVEIS',
  fields: [f('entregaveis', 'Peças/arquivos esperados', true)],
};
const REFERENCIAS: BriefingSection = {
  key: 'referencias',
  title: 'REFERÊNCIAS',
  fields: [f('referencias', 'Links, arquivos, campanhas anteriores')],
};
const DEPENDENCIAS: BriefingSection = {
  key: 'dependencias',
  title: 'DEPENDÊNCIAS',
  fields: [f('dependencias', 'Aprovação, material, acesso, decisão')],
};
const APROVACAO: BriefingSection = {
  key: 'aprovacao',
  title: 'CRITÉRIOS DE APROVAÇÃO',
  fields: [f('aprovacao', 'O que define que está pronto', true)],
};
const METRICAS: BriefingSection = {
  key: 'metricas',
  title: 'MÉTRICAS',
  fields: [f('metricas', 'Indicador de sucesso')],
};

// --- específicas de vídeo ---
const VIDEO: BriefingSection = {
  key: 'video',
  title: 'ESTRUTURA DO VÍDEO',
  fields: [f('hook', 'Hook (primeiros 3s)', true), f('estrutura', 'Estrutura/roteiro', true), f('angulos', 'Ângulos'), f('duracao', 'Duração'), f('trilha', 'Trilha/áudio')],
};
// --- específicas de landing page ---
const LP: BriefingSection = {
  key: 'lp',
  title: 'ESTRUTURA DA PÁGINA',
  fields: [f('secoes', 'Seções necessárias', true), f('prova_social', 'Prova social'), f('mobile', 'Comportamento mobile'), f('tracking', 'Tracking/analytics'), f('conversao', 'Critério de conversão', true)],
};
// --- específicas de técnico/automação ---
const TECNICO: BriefingSection = {
  key: 'tecnico',
  title: 'ESPECIFICAÇÃO TÉCNICA',
  fields: [
    f('trigger', 'Trigger/gatilho', true),
    f('input', 'Entrada de dados', true),
    f('output', 'Saída esperada', true),
    f('integracoes', 'Integrações/sistemas', true),
    f('regras', 'Regras de negócio'),
    f('fallback', 'Fallback quando falhar'),
    f('logs', 'Logs/observabilidade'),
    f('erros', 'Tratamento de erro'),
    f('credenciais', 'Credenciais/acessos necessários'),
  ],
};

/**
 * Vocabulário GENÉRICO por tipo. Nada de nome de cliente aqui — o que decide é
 * o que está sendo produzido, e isso vale pra qualquer cliente da carteira.
 */
const SINAIS: Array<{ type: DeliveryType; re: RegExp }> = [
  { type: 'technical', re: /\b(automatiz|automa[çc][ãa]o|integra[çc][ãa]o|integrar|api|webhook|crm|zapier|n8n|make|script|sistema|banco de dados|sincroniz|pipeline|bot)\b/i },
  { type: 'landing_page', re: /\b(landing\s*page|\blp\b|p[áa]gina de (venda|captura|convers[ãa]o)|hotsite|site de campanha)\b/i },
  { type: 'video', re: /\b(reels?|v[íi]deo|videos|tiktok|shorts|motion|vt\b|roteiro de v[íi]deo|captação)\b/i },
  { type: 'campaign', re: /\b(campanha|lan[çc]amento|meta ads|google ads|tr[áa]fego|an[úu]ncio|ads\b|m[íi]dia paga|promo[çc][ãa]o)\b/i },
  { type: 'social_content', re: /\b(post|carrossel|stories|feed|legenda|conte[úu]do|social)\b/i },
];

/** Tipo da entrega a partir do texto do pedido + nome da task. */
export function classifyDeliveryType(...textos: Array<string | null | undefined>): DeliveryType {
  const texto = textos.filter(Boolean).join(' ');
  for (const { type, re } of SINAIS) if (re.test(texto)) return type;
  return 'generic';
}

/** Seções que o briefing deste tipo precisa ter. */
export function sectionsFor(type: DeliveryType): BriefingSection[] {
  switch (type) {
    case 'technical':
      // Sem público/oferta/direção visual: briefing técnico que fala de headline
      // é ruído, e ruído faz o executor ignorar o briefing inteiro.
      return [IDENTIFICACAO, CONTEXTO, OBJETIVO, TECNICO, ENTREGAVEIS, DEPENDENCIAS, APROVACAO, METRICAS];
    case 'video':
      return [IDENTIFICACAO, CONTEXTO, OBJETIVO, PUBLICO, OFERTA, COMUNICACAO, VIDEO, VISUAL, CANAL, ENTREGAVEIS, REFERENCIAS, DEPENDENCIAS, APROVACAO, METRICAS];
    case 'landing_page':
      return [IDENTIFICACAO, CONTEXTO, OBJETIVO, PUBLICO, OFERTA, COMUNICACAO, LP, VISUAL, ENTREGAVEIS, REFERENCIAS, DEPENDENCIAS, APROVACAO, METRICAS];
    case 'campaign':
      return [IDENTIFICACAO, CONTEXTO, OBJETIVO, PUBLICO, OFERTA, COMUNICACAO, VISUAL, CANAL, ENTREGAVEIS, REFERENCIAS, DEPENDENCIAS, APROVACAO, METRICAS];
    case 'social_content':
      return [IDENTIFICACAO, CONTEXTO, OBJETIVO, PUBLICO, COMUNICACAO, VISUAL, CANAL, ENTREGAVEIS, REFERENCIAS, APROVACAO];
    default:
      return [IDENTIFICACAO, CONTEXTO, OBJETIVO, ENTREGAVEIS, DEPENDENCIAS, APROVACAO];
  }
}

export const DELIVERY_LABEL: Record<DeliveryType, string> = {
  campaign: 'Campanha',
  video: 'Vídeo / Reels',
  landing_page: 'Landing page',
  technical: 'Automação / desenvolvimento',
  social_content: 'Conteúdo social',
  generic: 'Entrega operacional',
};
