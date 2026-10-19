import type { ClientMotionContext, MotionAsset } from '../client-context/types.js';
import type { CampaignBrief } from '../brief/schema.js';
import { renderLockedFactsBlock, type LockedFact, type LockedFactViolation } from '../brief/locked-facts.js';
import type { MotionSession } from '../types.js';

/**
 * O turno que o agente recebe: marca + material + pedido.
 *
 * O briefing bruto do cliente vai INTEIRO, sem resumo. Os BRAIN.md foram
 * escritos por gente da agência com a disciplina de marcar o que falta, e
 * resumi-los aqui jogaria fora exatamente a parte cara: o `[FALTA]` que
 * impede o modelo de inventar.
 */
export function buildCreationPrompt(params: {
  session: Pick<MotionSession, 'prompt' | 'durationSeconds' | 'fps' | 'width' | 'height' | 'format'>;
  context: ClientMotionContext;
  assets: readonly MotionAsset[];
  brief: CampaignBrief | null;
  lockedFacts: readonly LockedFact[];
}): string {
  const { session, context, assets, brief, lockedFacts } = params;
  const { brand } = context;

  /**
   * Quatro camadas, nesta ordem (§6). A ordem não é estética: o que vem
   * depois pesa mais na leitura, e LOCKED FACTS precisa vir perto do fim,
   * logo antes da direção do usuário — é o bloco que não pode ser esquecido
   * no meio de 3 mil palavras de contexto de marca.
   */
  return [
    `# BRAND CONTEXT — ${brand.name}`,
    line('Posicionamento', brand.positioning),
    line('Público', brand.audience),
    line('Tom de voz', brand.toneOfVoice),
    listLine('Paleta', brand.colors, 'a marca não tem paleta registrada — componha com neutros e a cor dominante das fotos do cliente'),
    listLine('Tipografia', brand.fonts, 'a marca não tem tipografia registrada — escolha uma que sirva ao tom e diga qual escolheu'),
    listLine('CTAs aprovados', brand.approvedCtas, 'nenhum CTA aprovado registrado'),
    listLine('Restrições', brand.restrictions, 'nenhuma restrição registrada'),
    listLine('Produtos', brand.products, 'nenhum produto listado'),
    '',
    assetsBlock(assets),
    '',
    briefBlock(brief),
    '',
    `# ESPECIFICAÇÃO DA PEÇA`,
    `- Formato: ${session.format} (${session.width}x${session.height})`,
    `- Duração: ${session.durationSeconds}s a ${session.fps}fps (${Math.round(session.durationSeconds * session.fps)} frames)`,
    `- Esses números já estão em src/config.ts. Importe de lá.`,
    '',
    context.missing.length > 0
      ? `# O QUE NÃO EXISTE NA FONTE\n${context.missing.map((item) => `- ${item}`).join('\n')}\n\nNão preencha nada disso por dedução. Contorne e relate.`
      : '',
    '',
    `# BRIEFING BRUTO DO CLIENTE`,
    context.briefing ?? '(não há briefing registrado para este cliente)',
    '',
    renderLockedFactsBlock(lockedFacts),
    '',
    `# USER DIRECTION`,
    session.prompt.trim(),
    '',
    `# SUA TAREFA`,
    `Escreva PENSAMENTO.md com o storyboard e o timing, depois escreva src/Motion.tsx (e os arquivos de apoio que quiser em src/).`,
  ]
    .filter((part) => part !== '')
    .join('\n');
}

/** §6 — a camada da campanha, separada da camada da marca. */
function briefBlock(brief: CampaignBrief | null): string {
  if (!brief) {
    return [
      '# CAMPAIGN BRIEF',
      '',
      '(não informado — a peça é institucional)',
      '',
      'Sem briefing, não invente oferta, preço, prazo nem promessa. Trabalhe com o que a marca é.',
    ].join('\n');
  }
  const offer = brief.offer;
  const linhas = [
    ['Campanha', brief.campaignName],
    ['Objetivo', brief.objective],
    ['Oferta', offer?.name],
    ['Condição', offer?.condition],
    ['CTA', brief.cta],
    ['Público', brief.audience],
    ['Plataforma', brief.platform],
    ['Tom', brief.tone],
  ]
    .filter((pair): pair is [string, string] => Boolean(pair[1]?.trim()))
    .map(([label, value]) => `- ${label}: ${value}`);

  return [
    '# CAMPAIGN BRIEF',
    ...(linhas.length > 0 ? linhas : ['(sem campos preenchidos)']),
    ...(brief.notes?.trim() ? ['', '**Observação de quem pediu:**', brief.notes.trim()] : []),
  ].join('\n');
}

/** §42 — o patch recebe projeto atual + contexto do motion + pedido, nada mais. */
export function buildPatchPrompt(params: {
  instruction: string;
  session: Pick<MotionSession, 'prompt' | 'durationSeconds' | 'fps' | 'width' | 'height' | 'format'>;
  context: ClientMotionContext;
  assets: readonly MotionAsset[];
  /** Resumo do que a passada anterior entregou, pro agente não reler tudo às cegas. */
  previousSummary: string | null;
  lockedFacts: readonly LockedFact[];
}): string {
  const { instruction, session, context, assets, previousSummary, lockedFacts } = params;
  return [
    `# AJUSTE PEDIDO`,
    instruction.trim(),
    '',
    `# O QUE JÁ EXISTE`,
    previousSummary ?? 'O projeto está em src/. Leia antes de mudar.',
    '',
    `# ESPECIFICAÇÃO (inalterada)`,
    `- ${session.format} · ${session.width}x${session.height} · ${session.durationSeconds}s · ${session.fps}fps`,
    `- Pedido original: ${session.prompt.trim()}`,
    '',
    `# MARCA: ${context.brand.name}`,
    listLine('Paleta', context.brand.colors, 'sem paleta registrada'),
    listLine('Tipografia', context.brand.fonts, 'sem tipografia registrada'),
    '',
    assetsBlock(assets),
    '',
    renderLockedFactsBlock(lockedFacts),
    '',
    `# SUA TAREFA`,
    `Aplique SÓ o ajuste pedido, na menor superfície possível. Não recrie a peça.`,
    `Os LOCKED FACTS continuam valendo: "mais agressivo" muda peso, escala, tempo e entrada — nunca o valor.`,
  ]
    .filter((part) => part !== '')
    .join('\n');
}

/**
 * §24 — a passada de QA visual.
 *
 * Os frames são arquivos PNG no workspace e o agente os LÊ com a ferramenta
 * Read, que enxerga imagem. É o que torna o QA visual uma inspeção de
 * verdade em vez de o modelo opinando sobre o próprio código.
 */
export function buildVisualQaPrompt(params: {
  frames: { file: string; timeSeconds: number }[];
  session: Pick<MotionSession, 'durationSeconds' | 'width' | 'height' | 'format'>;
  brandName: string;
  colors: readonly string[];
  lockedFacts?: readonly LockedFact[] | undefined;
}): string {
  const lockedFacts = params.lockedFacts ?? [];
  return [
    `# REVISÃO VISUAL`,
    `Você vai olhar o preview do motion que você mesmo fez e reprovar o que estiver errado. Seja o revisor mais chato da agência — é mais barato ser duro agora do que depois de publicado.`,
    '',
    `Peça: ${params.brandName} · ${params.session.format} · ${params.session.width}x${params.session.height} · ${params.session.durationSeconds}s`,
    params.colors.length > 0 ? `Paleta da marca: ${params.colors.join(', ')}` : 'A marca não tem paleta registrada.',
    '',
    `# FRAMES (leia CADA UM com a ferramenta Read)`,
    ...params.frames.map((frame) => `- \`${frame.file}\` — ${frame.timeSeconds.toFixed(2)}s`),
    '',
    `# CONFIRA, EM CADA FRAME`,
    `- Texto cortado, sobreposto ou estourando o container`,
    `- Elemento fora da tela sem querer`,
    `- Contraste insuficiente entre texto e fundo`,
    `- Hierarquia: dá pra dizer em meio segundo o que é mais importante?`,
    `- Espaçamento e alinhamento inconsistentes`,
    `- Logo distorcido, cortado ou com fundo errado`,
    `- Cor fora da marca`,
    `- Imagem esticada, pixelada ou mal enquadrada`,
    `- Safe area: nada crítico a menos de 8% da borda; em 9:16, nada nos 14% de baixo`,
    `- CTA presente, legível e com tempo de leitura`,
    `- Consistência entre as cenas`,
    `- Frame preto ou vazio que não seja intencional`,
    // Preço errado lido no quadro é o defeito que a varredura de código não
    // alcança (valor montado em runtime); o revisor visual é a segunda rede.
    ...(lockedFacts.length > 0
      ? [`- Preço, porcentagem, datas e CTA batem EXATAMENTE com os LOCKED FACTS abaixo — dígito por dígito`]
      : []),
    '',
    ...(lockedFacts.length > 0 ? [renderLockedFactsBlock(lockedFacts), ''] : []),
    `# RESPOSTA`,
    `Escreva o veredito em QA.md no projeto, neste formato exato:`,
    '',
    '```',
    'VEREDITO: QUALITY_PASS',
    'ou',
    'VEREDITO: REQUIRES_FIX',
    '',
    'PROBLEMAS:',
    '- [frame 3.5s] o headline encosta na borda direita',
    '- [geral] o CTA some antes de dar pra ler',
    '',
    'SCORES:',
    'visual: 78',
    'brand: 90',
    'legibility: 62',
    'composition: 80',
    '```',
    '',
    `Se for REQUIRES_FIX, **corrija o código agora**, na menor superfície possível, e explique em uma linha o que mudou.`,
    `Se estiver realmente bom, diga QUALITY_PASS e não mexa em nada. Não invente problema pra parecer criterioso, e não aprove peça ruim pra encerrar logo.`,
  ].join('\n');
}

/** §22 — a build falhou; o agente conserta com o erro na mão. */
export function buildFixPrompt(params: { error: string; attempt: number; maxAttempts: number }): string {
  return [
    `# A BUILD FALHOU (tentativa ${params.attempt} de ${params.maxAttempts})`,
    '',
    'Erro real do bundler/renderer:',
    '',
    '```',
    params.error.slice(0, 6000),
    '```',
    '',
    `Conserte a causa. Não contorne desligando funcionalidade, não apague a cena que estava dando erro, e não reescreva a peça.`,
    `Lembre: nenhuma dependência nova pode ser instalada, e os assets vivem em public/assets via staticFile().`,
  ].join('\n');
}

/**
 * §16 — a varredura programática achou valor comercial fora do briefing.
 *
 * Prompt separado do de build de propósito: "A BUILD FALHOU" ensinaria o
 * agente a procurar erro de compilação onde o problema é copy. A instrução
 * lista cada violação com o valor travado ao lado, porque "há um preço errado"
 * sem dizer QUAL preço e qual o certo produz passada de fix às cegas.
 */
export function buildLockedFactFixPrompt(params: {
  violations: readonly LockedFactViolation[];
  facts: readonly LockedFact[];
  attempt: number;
  maxAttempts: number;
}): string {
  return [
    `# LOCKED FACTS VIOLADOS (tentativa ${params.attempt} de ${params.maxAttempts})`,
    '',
    'A verificação automática comparou o texto da peça com os valores travados no briefing e encontrou divergência:',
    '',
    ...params.violations.map((violation) => `- ${violation.detail}`),
    '',
    'Os valores corretos são exatamente estes:',
    '',
    ...params.facts.map((fact) => `- **${fact.label}:** \`${fact.value}\``),
    '',
    'Corrija o texto na tela para bater dígito por dígito com os valores acima, **sem alterar mais nada**:',
    'mesma composição, mesmo timing, mesmas cores. Se um fato estiver certo, não toque nele.',
  ].join('\n');
}

function line(label: string, value: string | null): string {
  return `- ${label}: ${value ?? '`[FALTA]` — não existe na fonte'}`;
}

function listLine(label: string, values: readonly string[], emptyNote: string): string {
  return values.length > 0 ? `- ${label}: ${values.join(', ')}` : `- ${label}: \`[FALTA]\` — ${emptyNote}`;
}

function assetsBlock(assets: readonly MotionAsset[]): string {
  if (assets.length === 0) {
    return `# MATERIAL DISPONÍVEL\n(nenhum arquivo do cliente. A peça precisa se sustentar em tipografia, cor e composição.)`;
  }
  const byKind = new Map<string, MotionAsset[]>();
  for (const asset of assets) {
    const list = byKind.get(asset.kind) ?? [];
    list.push(asset);
    byKind.set(asset.kind, list);
  }
  const lines: string[] = ['# MATERIAL DISPONÍVEL (em public/assets/)'];
  for (const [kind, list] of byKind) {
    lines.push(`\n**${kind}**`);
    for (const asset of list) {
      const dimensions = asset.width && asset.height ? ` · ${asset.width}x${asset.height}` : '';
      lines.push(`- \`${asset.projectPath ?? asset.filename}\`${dimensions} · origem: ${asset.origin}`);
    }
  }
  lines.push('\nAbra as imagens com Read antes de decidir onde usar cada uma. Uma foto mal enquadrada em tela cheia derruba a peça.');
  return lines.join('\n');
}
