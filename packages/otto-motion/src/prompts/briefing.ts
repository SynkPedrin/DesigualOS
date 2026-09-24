import type { ClientMotionContext, MotionAsset } from '../client-context/types.js';
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
}): string {
  const { session, context, assets } = params;
  const { brand } = context;

  return [
    `# PEDIDO`,
    session.prompt.trim(),
    '',
    `# ESPECIFICAÇÃO DA PEÇA`,
    `- Formato: ${session.format} (${session.width}x${session.height})`,
    `- Duração: ${session.durationSeconds}s a ${session.fps}fps (${Math.round(session.durationSeconds * session.fps)} frames)`,
    `- Esses números já estão em src/config.ts. Importe de lá.`,
    '',
    `# MARCA: ${brand.name}`,
    line('Posicionamento', brand.positioning),
    line('Público', brand.audience),
    line('Tom de voz', brand.toneOfVoice),
    listLine('Paleta', brand.colors, 'a marca não tem paleta registrada — componha com neutros e a cor dominante das fotos do cliente'),
    listLine('Tipografia', brand.fonts, 'a marca não tem tipografia registrada — escolha uma que sirva ao tom e diga qual escolheu'),
    listLine('CTAs aprovados', brand.approvedCtas, 'nenhum CTA aprovado — use um neutro, nunca uma promessa'),
    listLine('Restrições', brand.restrictions, 'nenhuma restrição registrada'),
    listLine('Produtos', brand.products, 'nenhum produto listado'),
    '',
    assetsBlock(assets),
    '',
    context.missing.length > 0
      ? `# O QUE NÃO EXISTE NA FONTE\n${context.missing.map((item) => `- ${item}`).join('\n')}\n\nNão preencha nada disso por dedução. Contorne e relate.`
      : '',
    '',
    `# BRIEFING BRUTO DO CLIENTE`,
    context.briefing ?? '(não há briefing registrado para este cliente)',
    '',
    `# SUA TAREFA`,
    `Escreva PENSAMENTO.md com o storyboard e o timing, depois escreva src/Motion.tsx (e os arquivos de apoio que quiser em src/).`,
  ]
    .filter((part) => part !== '')
    .join('\n');
}

/** §42 — o patch recebe projeto atual + contexto do motion + pedido, nada mais. */
export function buildPatchPrompt(params: {
  instruction: string;
  session: Pick<MotionSession, 'prompt' | 'durationSeconds' | 'fps' | 'width' | 'height' | 'format'>;
  context: ClientMotionContext;
  assets: readonly MotionAsset[];
  /** Resumo do que a passada anterior entregou, pro agente não reler tudo às cegas. */
  previousSummary: string | null;
}): string {
  const { instruction, session, context, assets, previousSummary } = params;
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
    `# SUA TAREFA`,
    `Aplique SÓ o ajuste pedido, na menor superfície possível. Não recrie a peça.`,
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
}): string {
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
    '',
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
