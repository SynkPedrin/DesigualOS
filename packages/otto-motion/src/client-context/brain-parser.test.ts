import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractColors, extractFonts, isPlaceholder, parseBrain, section } from './brain-parser.js';

const BRAINS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../.claude/skills/otto/brains',
);

function brain(slug: string): string {
  return fs.readFileSync(path.join(BRAINS, slug, 'BRAIN.md'), 'utf8');
}

describe('placeholders do brain nunca viram dado', () => {
  it.each(['[FALTA]', '`[FALTA]`', '[CONFIRMAR]', '- `[FALTA]` — topo, meio e fundo', ''])(
    'reconhece "%s" como lacuna',
    (valor) => {
      expect(isPlaceholder(valor)).toBe(true);
    },
  );

  it('uma frase real com ressalva no fim continua sendo informação', () => {
    expect(isPlaceholder('R$ 192.280,00 para agosto–dezembro [CONFIRMAR: vigente?]')).toBe(false);
  });
});

describe('BRAIN.md real da D. Carvalho (John Deere)', () => {
  const parsed = parseBrain(brain('d-carvalho'));

  it('lê as cores confirmadas da marca', () => {
    expect(parsed.colors).toEqual(expect.arrayContaining(['#367C2B', '#FFDE00']));
  });

  it('lê as tipografias, separando a prosa "X (display) e Y (texto)"', () => {
    expect(parsed.fonts).toEqual(expect.arrayContaining(['Big Shoulders Display', 'Work Sans']));
  });
});

describe('BRAIN.md real da Envu — o caso das lacunas', () => {
  const parsed = parseBrain(brain('envu'));

  it('não inventa cor onde a fonte diz [FALTA]', () => {
    expect(parsed.colors).toEqual([]);
  });

  it('não inventa fonte onde a fonte diz [FALTA]', () => {
    expect(parsed.fonts).toEqual([]);
  });

  it('não inventa CTA — a seção inteira é [FALTA]', () => {
    expect(parsed.approvedCtas).toEqual([]);
  });

  it('ainda assim extrai o posicionamento, que existe de verdade', () => {
    expect(parsed.positioning).toContain('controle de pragas');
  });

  it('repassa as lacunas declaradas em vez de escondê-las', () => {
    expect(parsed.gaps.length).toBeGreaterThan(0);
  });
});

describe('utilitários', () => {
  it('section devolve null pra seção inexistente', () => {
    expect(section('# só um título\n\ntexto', 'IDENTIDADE VISUAL')).toBeNull();
  });

  it('extractColors normaliza e desduplica', () => {
    expect(extractColors('usa #abc123 e também #ABC123 com #fff')).toEqual(['#ABC123', '#FFF']);
  });

  it('extractFonts devolve vazio sem seção', () => {
    expect(extractFonts(null)).toEqual([]);
  });
});
