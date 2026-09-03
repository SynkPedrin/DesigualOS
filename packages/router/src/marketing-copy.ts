import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { FastifyBaseLogger } from 'fastify';

const currentDir = dirname(fileURLToPath(import.meta.url));
/** packages/router/src -> packages/router -> packages -> raiz do repo. */
const BRAIN_MARKETING_DIR = resolve(currentDir, '../../../Brain-Marketing');

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

const studioCopySchema = z.object({
  caption: z.string(),
  hashtags: z.array(z.string()).default([]),
  slides: z.array(z.object({ headline: z.string(), subtext: z.string().optional() })).min(1),
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

function buildSystemPrompt(numSlides: number): string {
  return `Você é um copywriter sênior de marketing digital, especialista em posts de redes sociais (Instagram/carrossel).
Use os frameworks de marketing fornecidos como referência para embasar a copy, mas escreva em português do Brasil, tom direto e persuasivo, sem jargão de manual.

Gere:
- "caption": a legenda do post (2 a 4 frases + call to action; pode usar 1-2 emojis se fizer sentido para a marca).
- "hashtags": 3 a 6 hashtags relevantes, sem o caractere #.
- "slides": exatamente ${numSlides} item(ns), na ordem em que aparecem no carrossel/imagem. Cada slide tem "headline" (curta, até 8 palavras — o texto principal sobreposto na imagem) e, opcionalmente, "subtext" (complemento curto, até 12 palavras).

Responda SOMENTE com o JSON abaixo, sem markdown, sem texto antes ou depois:
{"caption": string, "hashtags": string[], "slides": [{"headline": string, "subtext": string | null}]}`;
}

/**
 * Passo de copywriting do Studio (image/carousel): gera legenda + texto por slide usando
 * os frameworks de Brain-Marketing como contexto. Roda na API (não no node da RTX) porque
 * é aqui que temos o checkout completo do monorepo e a única chave Anthropic configurada
 * (mesmo padrão de classifier.ts). Retorna null em qualquer falha — o job de criação nunca
 * deve travar por causa da copy.
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

  const docs = pickRelevantDocs(brief, logger);
  const referenceBlock =
    docs.length > 0
      ? docs.map((doc) => `### ${doc.titulo}\n${doc.body}`).join('\n\n')
      : '(nenhum framework de marketing específico encontrado para este briefing — use seu critério de copywriter sênior.)';

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1536,
      system: buildSystemPrompt(numSlides),
      messages: [
        {
          role: 'user',
          content: `Referências de marketing:\n\n${referenceBlock}\n\n---\n\nBriefing da campanha:\n${brief}`,
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
