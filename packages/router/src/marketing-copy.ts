import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { FastifyBaseLogger } from 'fastify';

const currentDir = dirname(fileURLToPath(import.meta.url));
/** packages/router/src -> packages/router -> packages -> raiz do repo. */
const BRAIN_MARKETING_DIR = resolve(currentDir, '../../../Brain-Marketing');
const MODUS_OPERANDI_PATH = resolve(
  currentDir,
  '../../../.agents/skills/carrossel-cinema-impossivel/SKILL.md',
);

interface BrainMarketingDoc {
  titulo: string;
  intencoes: string[];
  body: string;
}

function parseFrontmatter(raw: string): { attrs: Record<string, string>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { attrs: {}, body: raw };
  const [, frontmatter, body] = match;
  const attrs: Record<string, string> = {};
  for (const line of (frontmatter ?? '').split('\n')) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) continue;
    attrs[line.slice(0, separatorIndex).trim()] = line.slice(separatorIndex + 1).trim();
  }
  return { attrs, body: (body ?? '').trim() };
}

function parseInlineList(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (!trimmed) return [];
  return trimmed
    .split(',')
    .map((item) => item.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
}

function unquote(value: string | undefined): string {
  if (!value) return '';
  return value.replace(/^"(.*)"$/, '$1');
}

let cachedDocs: BrainMarketingDoc[] | null = null;

/**
 * Frameworks de marketing (Brain-Marketing/*.md, frontmatter YAML simples) usados como
 * referência pela copy do Studio. Falha graciosamente se a pasta não existir nesta
 * máquina — nunca deve impedir a criação do job por falta desse contexto.
 */
function loadBrainMarketingDocs(logger?: FastifyBaseLogger): BrainMarketingDoc[] {
  if (cachedDocs) return cachedDocs;

  if (!existsSync(BRAIN_MARKETING_DIR)) {
    logger?.warn(
      { dir: BRAIN_MARKETING_DIR },
      'Brain-Marketing not found — studio copy will be generated without marketing framework context',
    );
    cachedDocs = [];
    return cachedDocs;
  }

  const files = readdirSync(BRAIN_MARKETING_DIR).filter((file) => file.endsWith('.md'));
  cachedDocs = files.map((file) => {
    const raw = readFileSync(resolve(BRAIN_MARKETING_DIR, file), 'utf-8');
    const { attrs, body } = parseFrontmatter(raw);
    return {
      titulo: unquote(attrs.titulo) || file,
      intencoes: parseInlineList(attrs.intencoes),
      body,
    };
  });
  return cachedDocs;
}

function pickRelevantDocs(brief: string, logger?: FastifyBaseLogger, max = 3): BrainMarketingDoc[] {
  const docs = loadBrainMarketingDocs(logger);
  if (docs.length === 0) return [];

  const briefLower = brief.toLowerCase();
  const scored = docs.map((doc) => {
    const keywords = [doc.titulo, ...doc.intencoes].join(' ').toLowerCase().split(/\s+/);
    const score = keywords.filter((word) => word.length > 3 && briefLower.includes(word)).length;
    return { doc, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const withMatches = scored.filter((entry) => entry.score > 0);
  return (withMatches.length > 0 ? withMatches : scored).slice(0, max).map((entry) => entry.doc);
}

let cachedModusOperandi: string | null | undefined;

/**
 * Modus operandi canônico do carrossel do Cinema Impossível (.agents/skills/.../SKILL.md).
 * É a fonte da verdade da copy do Studio: as leis duras (seções 3 e 10) vêm daqui.
 * Retorna o corpo do arquivo sem o frontmatter YAML. Falha graciosamente (warn + null)
 * se o arquivo não existir nesta máquina — mesmo padrão do loadBrainMarketingDocs.
 */
function loadModusOperandi(logger?: FastifyBaseLogger): string | null {
  if (cachedModusOperandi !== undefined) return cachedModusOperandi;

  if (!existsSync(MODUS_OPERANDI_PATH)) {
    logger?.warn(
      { path: MODUS_OPERANDI_PATH },
      'Modus operandi do carrossel não encontrado — studio copy seguirá sem o canon',
    );
    cachedModusOperandi = null;
    return cachedModusOperandi;
  }

  const raw = readFileSync(MODUS_OPERANDI_PATH, 'utf-8');
  cachedModusOperandi = parseFrontmatter(raw).body;
  return cachedModusOperandi;
}

const studioSlideSchema = z.object({
  headline: z.string(),
  subtext: z.string().optional(),
  kicker: z.string().optional(),
  tag: z.enum(['verso', 'segredo']).nullable().optional(),
  tagLabel: z.string().optional(),
  layout: z
    .enum(['capa', 'premissa', 'item', 'follow', 'golpe', 'diptico', 'tese', 'cta'])
    .optional(),
});

const studioCopySchema = z.object({
  caption: z.string(),
  hashtags: z.array(z.string()).default([]),
  slides: z.array(studioSlideSchema).min(1),
});

export type StudioCopyResult = z.infer<typeof studioCopySchema>;

function normalizeSlideCount(
  slides: StudioCopyResult['slides'],
  numSlides: number,
): StudioCopyResult['slides'] {
  if (slides.length === numSlides) return slides;
  if (slides.length > numSlides) return slides.slice(0, numSlides);
  const last = slides[slides.length - 1] ?? { headline: '' };
  return [...slides, ...Array.from({ length: numSlides - slides.length }, () => ({ ...last }))];
}

function buildSystemPrompt(numSlides: number, modusOperandi: string | null): string {
  const structureBlock =
    numSlides >= 8
      ? `Estrutura canônica dos layouts (obrigatória com ${numSlides} slides):
- 1º slide: "capa" (promessa numerada + headline de dois tempos)
- 2º slide: "premissa" (verso da canção entre aspas + 2 ou 3 frases)
- slides intermediários: "item" (um segredo ou verso por card, numeração corrida em tagLabel: "VERSO Nº 1", "SEGREDO Nº 2"...)
- 5º slide: "follow" (o pedido de seguir vive SÓ aqui, como respiro com promessa do que vem)
- 7º slide: "golpe" (revelação que recontextualiza e manda o leitor voltar os cards)
- penúltimo slide: "tese"
- último slide: "cta" (CTA emocional de rewatch)
- use "diptico" em um item intermediário quando o conteúdo pedir imagem + texto separados`
      : `Estrutura dos layouts (peça curta): 1º slide sempre "capa", último sempre "cta"; os intermediários usam "premissa", "item" e, se couber, "follow" e "tese" com bom senso.`;

  const canonBlock = modusOperandi
    ? `CANON INEGOCIÁVEL (modus operandi do carrossel — fonte da verdade da copy):

${modusOperandi}

`
    : '';

  return `Você é o copywriter oficial dos carrosséis de Instagram do Cinema Impossível (@endrigoalmada), canal do diretor Endrigo Almada que faz "clipes que nunca existiram" pra músicas brasileiras usando IA.

${canonBlock}As leis duras de copy (seções 3 e 10 do modus operandi) são INEGOCIÁVEIS, mesmo quando o canon não estiver anexado acima:
- Abrir com verso da canção entre aspas quando houver contexto de música: vale pra capa, premissa e caption. A tese vem depois, nunca antes.
- NUNCA usar travessão (—) em nenhum texto. Nem na caption, nem nos slides, nem nas hashtags.
- Nenhum emoji nos slides (headline, subtext, kicker, tagLabel). Na caption pode 1-2 emojis se fizer sentido.
- CTA emocional: pedir pra SALVAR e ENVIAR ("salva pra lembrar", "manda pra quem..."). Nunca "segue agora" nem "marca 5 amigos" na caption.
- O pedido de follow existe SÓ no slide 5 (layout "follow"), nunca na caption.
- Prometa N, entregue N-1: a capa promete N segredos/versos, os cards entregam N-1; o item que falta vive no comentário fixado (mencione isso na caption como laço aberto, sem entregar o item).
- Tom direto, primeira pessoa do diretor ("eu escondi", "eu joguei fora").
- Português do Brasil com acentos sempre.

Gere:
- "caption": a legenda do post (2 a 4 frases + CTA emocional de salvar/enviar; abre com o verso entre aspas quando houver contexto de música; NUNCA pede follow).
- "hashtags": 3 a 6 hashtags relevantes (nicho + série + artista), sem o caractere #.
- "slides": exatamente ${numSlides} item(ns), na ordem do carrossel. Cada slide tem:
  - "layout": um de capa|premissa|item|follow|golpe|diptico|tese|cta.
  - "headline": texto principal (curta, até 8 palavras).
  - "subtext": complemento curto (até 12 palavras), opcional.
  - "kicker": linha pequena de topo com nome da música e artista/ano, opcional.
  - "tag": "verso" ou "segredo" nos slides de item (null nos demais); "tagLabel": o rótulo numerado (ex: "SEGREDO Nº 3", "VERSO Nº 1").

${structureBlock}

As referências de Brain-Marketing na mensagem do usuário são camada ESTRATÉGICA secundária (posicionamento, funil, atribuição): use pra embasar, mas em qualquer conflito o modus operandi vence.

Responda SOMENTE com o JSON abaixo, sem markdown, sem texto antes ou depois:
{"caption": string, "hashtags": string[], "slides": [{"layout": string, "headline": string, "subtext": string | null, "kicker": string | null, "tag": "verso" | "segredo" | null, "tagLabel": string | null}]}`;
}

/**
 * Passo de copywriting do Studio (image/carousel): gera legenda + texto por slide usando
 * o modus operandi canônico do carrossel (.agents/skills/carrossel-cinema-impossivel) como
 * fonte da verdade e os frameworks de Brain-Marketing como camada estratégica secundária.
 * Roda na API (não no node da RTX) porque é aqui que temos o checkout completo do monorepo
 * e a única chave Anthropic configurada (mesmo padrão de classifier.ts). Retorna null em
 * qualquer falha — o job de criação nunca deve travar por causa da copy.
 */
export async function generateStudioCopy(params: {
  objective: string;
  briefing: string;
  numSlides: number;
  logger: FastifyBaseLogger;
}): Promise<StudioCopyResult | null> {
  const { objective, briefing, numSlides, logger } = params;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.warn('ANTHROPIC_API_KEY not configured, studio copy generation unavailable');
    return null;
  }

  const brief = [objective, briefing].filter((part) => part && part.trim().length > 0).join('. ');
  if (!brief.trim()) return null;

  const modusOperandi = loadModusOperandi(logger);
  const docs = pickRelevantDocs(brief, logger);
  const referenceBlock =
    docs.length > 0
      ? docs.map((doc) => `### ${doc.titulo}\n${doc.body}`).join('\n\n')
      : '(nenhum framework de marketing específico encontrado para este briefing — siga o modus operandi.)';

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1536,
      system: buildSystemPrompt(numSlides, modusOperandi),
      messages: [
        {
          role: 'user',
          content: `Referências estratégicas de marketing (camada secundária — em conflito, o modus operandi vence):\n\n${referenceBlock}\n\n---\n\nBriefing da campanha:\n${brief}`,
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') return null;

    const parsed: unknown = JSON.parse(textBlock.text);
    const result = studioCopySchema.parse(parsed);
    return { ...result, slides: normalizeSlideCount(result.slides, numSlides) };
  } catch (error) {
    logger.error({ error }, 'Studio copy generation failed');
    return null;
  }
}
