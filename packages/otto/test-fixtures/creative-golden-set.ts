/**
 * GOLDEN SET — Otto Elite Phase 2, Fase 2.
 *
 * 15 briefs realistas pra avaliar qualidade criativa do Otto fora do caso
 * único da Cosentino. Todo client/produto aqui é FICTÍCIO de propósito: isto
 * é um fixture de código num repositório público, e client-context.ts já diz
 * por que dado real de cliente não entra no repo (vault separado, .gitignore).
 * Usar cliente inventado também evita o viés de o Brain real "ajudar demais"
 * um fixture que por acaso bate com um cliente que já tem BRAIN.md rico.
 *
 * NÃO É TEST FILE (sem describe/it) — é o dado que um runner de avaliação
 * (ao vivo, contra Ollama real, ou como fixture de teste estrutural) consome.
 * Não hard-codamos resposta ideal: o que se avalia é estrutura, completude,
 * grounding e estratégia do OUTPUT gerado contra os campos deste brief, não
 * comparação textual com um "gabarito".
 *
 * Rodar um destes ao vivo: nodes/otto-node/scripts/_live_run.ts, montando a
 * `message` como `${brief.message}\n\n---\nContexto:\n${brief.clientContext}`
 * (mesmo formato que packages/otto/src/brain/depth.ts::CONTEXT_BLOCK_MARKER
 * exige — client context DEPOIS do turno do usuário, nunca antes).
 */

export type DeliverableKind =
  | 'script'
  | 'shot_list'
  | 'caption'
  | 'carousel'
  | 'ad_copy'
  | 'landing_copy'
  | 'creative_brief'
  | 'headline'
  | 'rewrite';

export interface CreativeGoldenBrief {
  id: string;
  category:
    | 'reel_launch'
    | 'reel_top_funnel'
    | 'reel_authority'
    | 'reel_educational'
    | 'reel_storytelling'
    | 'carousel_educational'
    | 'carousel_sales'
    | 'carousel_positioning'
    | 'meta_ad_direct_response'
    | 'meta_ad_awareness'
    | 'instagram_caption'
    | 'landing_copy'
    | 'creative_brief_designer'
    | 'creative_brief_editor'
    | 'rewrite_after_feedback';
  /** A mensagem exatamente como um humano da conta digitaria no chat. */
  message: string;
  /**
   * Bloco de contexto que o worker injetaria depois do marcador
   * (CLIENTE DO TURNO + dossiê mínimo). Fictício.
   */
  clientContext: string;
  client: string;
  brand: { positioning: string; toneOfVoice: string };
  productOrOffer: string;
  audience: string;
  objective: string;
  platform: 'instagram_reels' | 'instagram_feed' | 'instagram_carousel' | 'meta_ads' | 'landing_page' | 'whatsapp';
  deliverablesRequested: DeliverableKind[];
  constraints: string[];
  /** Fatos que o modelo NÃO pode inventar — número, data, condição real. Usados pra checar hallucination. */
  factsThatCannotBeInvented: string[];
  /** Só presente pro caso 15 (rewrite): a peça anterior + o feedback recebido. */
  previousArtifact?: { deliverable: string; feedback: string };
}

export const CREATIVE_GOLDEN_SET: CreativeGoldenBrief[] = [
  {
    id: 'reel-launch-imobiliario',
    category: 'reel_launch',
    message:
      'Preciso de um reels anunciando a abertura de vendas do empreendimento no dia 24/09, com roteiro, ' +
      'sugestão de imagem e legenda. Pode usar emojis na legenda.',
    clientContext:
      'CLIENTE DO TURNO: Vertice Empreendimentos\nIncorporadora. Residencial Aurora, fase de pré-lançamento. ' +
      'Público final: famílias compradoras de primeiro imóvel. Tom: direto, confiável, sem jargão técnico.',
    client: 'Vertice Empreendimentos',
    brand: { positioning: 'Incorporadora acessível para primeira casa própria', toneOfVoice: 'direto, confiável, sem jargão' },
    productOrOffer: 'Residencial Aurora — abertura de vendas 24/09',
    audience: 'Famílias buscando o primeiro imóvel próprio',
    objective: 'Gerar agendamento de visita no dia da abertura',
    platform: 'instagram_reels',
    deliverablesRequested: ['script', 'shot_list', 'caption'],
    constraints: ['sem jargão de construção civil', 'sem promessa de financiamento específico'],
    factsThatCannotBeInvented: ['data: 24/09', 'sem taxa de juros/condição de financiamento não fornecida'],
  },
  {
    id: 'reel-top-funil-ia',
    category: 'reel_top_funnel',
    message: 'Cria um reels de topo de funil sobre como IA está mudando o setor, sem falar de produto ainda.',
    clientContext:
      'CLIENTE DO TURNO: Numera Analytics\nSoftware de BI para varejo. Ainda não lançou o produto novo de IA ' +
      'preditiva, este conteúdo é institucional/autoridade. Tom: técnico mas acessível, sem hype vazio.',
    client: 'Numera Analytics',
    brand: { positioning: 'BI para varejo com rigor analítico, sem hype', toneOfVoice: 'técnico mas acessível' },
    productOrOffer: 'Nenhum produto específico — awareness institucional',
    audience: 'Gestores de varejo que ouvem falar de IA mas não sabem aplicar',
    objective: 'Awareness de marca como autoridade em dados de varejo',
    platform: 'instagram_reels',
    deliverablesRequested: ['script', 'caption'],
    constraints: ['não mencionar produto ainda não lançado', 'não usar "revolucionar"/"transformar" como clichê vazio'],
    factsThatCannotBeInvented: ['nenhum dado estatístico específico sem fonte'],
  },
  {
    id: 'reel-autoridade',
    category: 'reel_authority',
    message: 'Quero um reels de autoridade da nossa sócia fundadora falando sobre os 10 anos de empresa.',
    clientContext:
      'CLIENTE DO TURNO: Estúdio Cravo\nEscritório de arquitetura, 10 anos de mercado. Fundadora: [FALTA — nome ' +
      'não consta no dossiê, marcar CONFIRMAR]. Tom: sofisticado, autoral, sem arrogância.',
    client: 'Estúdio Cravo',
    brand: { positioning: 'Arquitetura autoral, projetos residenciais de alto padrão', toneOfVoice: 'sofisticado, autoral' },
    productOrOffer: 'Institucional — aniversário de 10 anos',
    audience: 'Clientes em potencial de alto padrão + rede de arquitetura',
    objective: 'Fortalecer autoridade e reforçar posicionamento premium',
    platform: 'instagram_reels',
    deliverablesRequested: ['script', 'caption'],
    constraints: ['nome da fundadora não está no dossiê — testa se o Otto marca [CONFIRMAR] em vez de inventar'],
    factsThatCannotBeInvented: ['nome da sócia fundadora (ausente do dossiê de propósito)'],
  },
  {
    id: 'reel-educacional',
    category: 'reel_educational',
    message: 'Cria um reels educativo explicando 3 erros comuns na hora de contratar o serviço.',
    clientContext:
      'CLIENTE DO TURNO: Zelo Jurídico\nEscritório de advocacia trabalhista. Público: trabalhadores que não ' +
      'sabem seus direitos. Tom: acolhedor, didático, nunca alarmista.',
    client: 'Zelo Jurídico',
    brand: { positioning: 'Advocacia trabalhista acessível e didática', toneOfVoice: 'acolhedor, didático' },
    productOrOffer: 'Consultoria trabalhista',
    audience: 'Trabalhadores em dúvida sobre seus direitos',
    objective: 'Educar e gerar primeiro contato via DM',
    platform: 'instagram_reels',
    deliverablesRequested: ['script', 'caption'],
    constraints: ['não prometer resultado de processo específico (compliance jurídico)', 'não citar lei de cabeça sem marcar CONFIRMAR'],
    factsThatCannotBeInvented: ['número de lei/artigo específico', 'promessa de vitória em processo'],
  },
  {
    id: 'reel-storytelling',
    category: 'reel_storytelling',
    message: 'Quero um reels contando a história de como a marca nasceu, tom emocional.',
    clientContext:
      'CLIENTE DO TURNO: Padaria Trigo Nosso\nPadaria de bairro, fundada pelos avós dos donos atuais em 1978. ' +
      'Tom: caloroso, nostálgico, família.',
    client: 'Padaria Trigo Nosso',
    brand: { positioning: 'Padaria de bairro tradicional, 3 gerações', toneOfVoice: 'caloroso, nostálgico' },
    productOrOffer: 'Institucional — história da marca',
    audience: 'Moradores do bairro, clientes antigos e novos',
    objective: 'Conexão emocional e fortalecimento de comunidade local',
    platform: 'instagram_reels',
    deliverablesRequested: ['script', 'caption'],
    constraints: ['ano de fundação é 1978, não pode ser trocado'],
    factsThatCannotBeInvented: ['ano de fundação: 1978', 'nome dos fundadores (não fornecido — deve marcar lacuna)'],
  },
  {
    id: 'carrossel-educativo',
    category: 'carousel_educational',
    message: 'Preciso de um carrossel educativo em 10 slides sobre como escolher o piso certo pra obra.',
    clientContext:
      'CLIENTE DO TURNO: Colpar Pisos\nFabricante de pisos vinílicos B2B (arquitetos e construtoras). Tom: ' +
      'técnico, direto, sem se vender demais no meio do conteúdo educativo.',
    client: 'Colpar Pisos',
    brand: { positioning: 'Piso vinílico técnico para especificação profissional', toneOfVoice: 'técnico, direto' },
    productOrOffer: 'Linha de pisos vinílicos técnicos',
    audience: 'Arquitetos e especificadores de obra',
    objective: 'Autoridade técnica + geração de lead qualificado (especificador)',
    platform: 'instagram_carousel',
    deliverablesRequested: ['carousel', 'caption'],
    constraints: ['10 a 16 slides (lei do carrossel canônico)', 'não inventar norma técnica/NBR específica sem marcar CONFIRMAR'],
    factsThatCannotBeInvented: ['número de norma técnica (NBR)', 'dado de resistência/desempenho específico'],
  },
  {
    id: 'carrossel-venda',
    category: 'carousel_sales',
    message: 'Cria um carrossel de venda pro nosso curso, com oferta e CTA forte no final.',
    clientContext:
      'CLIENTE DO TURNO: Órbita Cursos\nCurso online de gestão financeira pessoal. Oferta ativa: R$ 297 por ' +
      'tempo limitado (até dia 30). Tom: motivador, direto, sem prometer enriquecimento fácil.',
    client: 'Órbita Cursos',
    brand: { positioning: 'Educação financeira acessível, sem fórmula mágica', toneOfVoice: 'motivador, direto' },
    productOrOffer: 'Curso de gestão financeira pessoal — R$ 297 até dia 30',
    audience: 'Pessoas endividadas ou sem controle financeiro querendo mudar',
    objective: 'Conversão direta (compra do curso)',
    platform: 'instagram_carousel',
    deliverablesRequested: ['carousel', 'caption'],
    constraints: ['preço é R$ 297, prazo até dia 30 — não pode variar', 'não prometer "ficar rico" ou resultado garantido'],
    factsThatCannotBeInvented: ['preço: R$ 297', 'prazo: até dia 30'],
  },
  {
    id: 'carrossel-posicionamento',
    category: 'carousel_positioning',
    message: 'Quero um carrossel institucional que deixe claro o que nos diferencia da concorrência, sem citar concorrente.',
    clientContext:
      'CLIENTE DO TURNO: Verde Nativa Paisagismo\nPaisagismo com foco em espécies nativas (vs. concorrência que ' +
      'usa exóticas). Tom: consciente, técnico, sem ser professoral.',
    client: 'Verde Nativa Paisagismo',
    brand: { positioning: 'Paisagismo com espécies nativas, sustentável', toneOfVoice: 'consciente, técnico' },
    productOrOffer: 'Serviço de paisagismo residencial e corporativo',
    audience: 'Clientes de alto padrão preocupados com sustentabilidade',
    objective: 'Diferenciação de posicionamento sem falar mal de concorrente',
    platform: 'instagram_carousel',
    deliverablesRequested: ['carousel', 'caption'],
    constraints: ['nunca nomear ou descrever concorrente específico'],
    factsThatCannotBeInvented: ['nenhum dado de concorrente (não fornecido)'],
  },
  {
    id: 'meta-ad-direct-response',
    category: 'meta_ad_direct_response',
    message: 'Preciso de uma copy de anúncio Meta pra gerar cadastro na lista de espera do produto.',
    clientContext:
      'CLIENTE DO TURNO: Fluxo App\nApp de controle de assinaturas recorrentes, em fase de lista de espera ' +
      '(produto ainda não lançado). Tom: prático, sem hype de startup.',
    client: 'Fluxo App',
    brand: { positioning: 'App simples de controle de assinaturas', toneOfVoice: 'prático, direto' },
    productOrOffer: 'Lista de espera do app (pré-lançamento)',
    audience: 'Pessoas que perdem dinheiro com assinaturas esquecidas',
    objective: 'Cadastro na lista de espera (CPL)',
    platform: 'meta_ads',
    deliverablesRequested: ['ad_copy', 'headline'],
    constraints: ['produto ainda não está disponível — não prometer acesso imediato', 'sem "revolucionário"/"disruptivo"'],
    factsThatCannotBeInvented: ['data de lançamento (não definida)', 'preço (não definido)'],
  },
  {
    id: 'meta-ad-awareness',
    category: 'meta_ad_awareness',
    message: 'Cria uma copy de anúncio de awareness pra apresentar a marca pra quem nunca ouviu falar.',
    clientContext:
      'CLIENTE DO TURNO: Raiz Café Especial\nTorrefação de café especial, marca nova na região. Tom: sensorial, ' +
      'sem jargão de barista pra quem não entende de café.',
    client: 'Raiz Café Especial',
    brand: { positioning: 'Café especial torrado localmente, acessível', toneOfVoice: 'sensorial, acessível' },
    productOrOffer: 'Institucional — apresentação da marca',
    audience: 'Consumidores de café que não conhecem "café especial" como categoria',
    objective: 'Awareness e primeira impressão de marca',
    platform: 'meta_ads',
    deliverablesRequested: ['ad_copy'],
    constraints: ['não usar jargão técnico de torra sem explicar'],
    factsThatCannotBeInvented: ['nenhum prêmio/certificação não fornecida'],
  },
  {
    id: 'instagram-caption-simples',
    category: 'instagram_caption',
    message: 'Faz uma legenda pra um post mostrando o produto novo chegando no estoque.',
    clientContext:
      'CLIENTE DO TURNO: Lumen Iluminação\nLoja de iluminação decorativa. Produto: luminária pendente modelo ' +
      'Orbe, chegou essa semana. Tom: elegante, direto.',
    client: 'Lumen Iluminação',
    brand: { positioning: 'Iluminação decorativa de design', toneOfVoice: 'elegante, direto' },
    productOrOffer: 'Luminária pendente Orbe — chegada de estoque',
    audience: 'Clientes interessados em decoração de design',
    objective: 'Gerar interesse e visitas à loja/perfil de vendas',
    platform: 'instagram_feed',
    deliverablesRequested: ['caption'],
    constraints: ['pedido simples — testa se o Otto responde direto, sem pipeline pesado desnecessário'],
    factsThatCannotBeInvented: ['nome do produto: Orbe'],
  },
  {
    id: 'landing-copy-produto',
    category: 'landing_copy',
    message: 'Preciso da copy da landing page do nosso novo plano anual, com headline, bloco de benefícios e CTA.',
    clientContext:
      'CLIENTE DO TURNO: Estudio Fit Online\nPlataforma de treino online. Plano anual: R$ 39/mês faturado ' +
      'anualmente (R$ 468/ano), 20% de desconto vs. mensal. Tom: energético, sem intimidar iniciante.',
    client: 'Estudio Fit Online',
    brand: { positioning: 'Treino online acessível para todos os níveis', toneOfVoice: 'energético, acolhedor' },
    productOrOffer: 'Plano anual — R$ 39/mês (R$ 468/ano), 20% off vs. mensal',
    audience: 'Pessoas que já usam o app no plano mensal ou trial',
    objective: 'Conversão para o plano anual',
    platform: 'landing_page',
    deliverablesRequested: ['landing_copy', 'headline'],
    constraints: ['preço e desconto exatos não podem variar'],
    factsThatCannotBeInvented: ['R$ 39/mês', 'R$ 468/ano', '20% de desconto'],
  },
  {
    id: 'briefing-designer',
    category: 'creative_brief_designer',
    message: 'Monta um briefing criativo completo pro designer executar um banner de campanha de Dia das Mães.',
    clientContext:
      'CLIENTE DO TURNO: Flora & Cia\nFloricultura. Campanha Dia das Mães, foco em entrega no mesmo dia. Tom: ' +
      'afetivo, sem clichê batido de "mãe é tudo".',
    client: 'Flora & Cia',
    brand: { positioning: 'Floricultura com entrega rápida e curadoria', toneOfVoice: 'afetivo, contemporâneo' },
    productOrOffer: 'Campanha Dia das Mães — entrega no mesmo dia',
    audience: 'Filhos(as) adultos comprando para a mãe',
    objective: 'Vendas da campanha sazonal',
    platform: 'instagram_feed',
    deliverablesRequested: ['creative_brief'],
    constraints: ['briefing precisa ser executável por um designer sem retrabalho de dúvida'],
    factsThatCannotBeInvented: ['nenhuma data de Dia das Mães específica fornecida — não assumir sem marcar'],
  },
  {
    id: 'briefing-editor',
    category: 'creative_brief_editor',
    message: 'Preciso de um briefing pro editor de vídeo cortar o depoimento bruto de um cliente em um Reels de prova social.',
    clientContext:
      'CLIENTE DO TURNO: Ortho Excellence\nClínica odontológica. Gravação bruta de depoimento de paciente já ' +
      'existe (15 minutos, sem edição). Tom: confiável, humano, sem parecer propaganda.',
    client: 'Ortho Excellence',
    brand: { positioning: 'Clínica odontológica premium, foco em experiência do paciente', toneOfVoice: 'confiável, humano' },
    productOrOffer: 'Depoimento de paciente — prova social',
    audience: 'Pacientes em potencial pesquisando clínica',
    objective: 'Prova social para reduzir objeção de confiança',
    platform: 'instagram_reels',
    deliverablesRequested: ['creative_brief', 'shot_list'],
    constraints: ['depoimento é gravação real existente — o briefing organiza corte, não inventa fala nova do paciente'],
    factsThatCannotBeInvented: ['conteúdo do depoimento (não fornecido no brief — instrução deve tratar como fonte externa, não inventar o que o paciente disse)'],
  },
  {
    id: 'rewrite-feedback-generico',
    category: 'rewrite_after_feedback',
    message: 'Refaz a legenda, ficou genérico.',
    clientContext:
      'CLIENTE DO TURNO: Vértice Empreendimentos\nMesmo contexto do brief reel-launch-imobiliario. Turno anterior ' +
      'entregou a legenda referenciada em previousArtifact.',
    client: 'Vertice Empreendimentos',
    brand: { positioning: 'Incorporadora acessível para primeira casa própria', toneOfVoice: 'direto, confiável, sem jargão' },
    productOrOffer: 'Residencial Aurora — abertura de vendas 24/09',
    audience: 'Famílias buscando o primeiro imóvel próprio',
    objective: 'Testar se o rewrite muda ÂNGULO (não só sinônimo) após feedback "genérico"',
    platform: 'instagram_reels',
    deliverablesRequested: ['rewrite', 'caption'],
    constraints: ['a reescrita precisa ter distância real da v1, não troca de adjetivo'],
    factsThatCannotBeInvented: ['data: 24/09 (deve sobreviver à reescrita)'],
    previousArtifact: {
      deliverable:
        'Chegou o dia de conhecer seu novo lar! 🏡 Dia 24/09 abrimos as portas do Residencial Aurora. ' +
        'Realize o sonho da casa própria com atendimento ágil e sem burocracia. Vem com a gente!',
      feedback: 'ficou genérico',
    },
  },
];
