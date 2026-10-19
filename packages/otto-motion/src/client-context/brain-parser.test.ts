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

  /**
   * Este teste já afirmou o contrário — que as cores eram extraídas — e estava
   * codificando um defeito (08/10/2026).
   *
   * O brain da D. Carvalho hoje registra TRÊS pares de verde/amarelo vindos de
   * fontes diferentes, declara "nenhum escolhido" e instrui: "usar 'verde e
   * amarelo D. Carvalho' em texto sem fixar o hex em peça que dependa da cor
   * exata". O parser devolvia os cinco hex como se fossem cor da marca — três
   * errados por construção, qualquer um deles pronto pra pintar uma peça
   * publicitária. Enquanto o cliente não escolher, o certo é não ter cor.
   */
  it('não fixa hex quando o brain registra três pares e não escolhe nenhum', () => {
    expect(parsed.colors).toEqual([]);
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

describe('BRAIN.md real da Ibiza II — prosa com "ou"', () => {
  const parsed = parseBrain(brain('ibiza-ii'));

  it('separa "Alta Regular ou Georgia." em duas fontes, sem o ponto final', () => {
    expect(parsed.fonts).toEqual(['Alta Regular', 'Georgia']);
  });
});

describe('anotação editorial nunca vira dado', () => {
  const comPerguntaAberta = `- **Cores:** verde \`#367C2B\`\n  \`[CONFIRMAR: é #367C2B ou #367e33?]\``;

  it('bloco de cor com [CONFIRMAR] não entrega hex nenhum', () => {
    expect(extractColors(comPerguntaAberta)).toEqual([]);
  });

  it('hex citado DENTRO da anotação não vaza como cor', () => {
    expect(extractColors('- **Cores:** verde `#1B383E`\n- nota `[FALTA: e o #ABCDEF?]`')).toEqual(['#1B383E']);
  });

  it('prefixo em prosa antes do valor não vira nome de fonte', () => {
    expect(extractFonts('- **Tipografia:** já registrado neste brain: Inter (texto)')).toEqual(['Inter']);
  });

  it('comentário depois do ponto não vira fonte', () => {
    expect(extractFonts('- **Tipografia:** Inter e Georgia. Dossiê cita Trade Gothic como alternativa.')).toEqual([
      'Inter',
      'Georgia',
    ]);
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
