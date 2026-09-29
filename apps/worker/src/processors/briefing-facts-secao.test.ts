import { describe, expect, it } from 'vitest';
import { extractSectionFacts, extractLabeledFacts, mergeFacts } from './briefing-facts';

/**
 * 28/09/2026 — a causa do briefing vazio para cliente REAL.
 *
 * A 3Net tem 12.000 caracteres de dossiê no vault ("## Quem é", "## Tom de
 * voz", "## O que evitar") e o briefing dela saía com TUDO em PENDENTE DE
 * CONFIRMAÇÃO. O extrator só lia "Rótulo: valor" numa linha; o conhecimento
 * mora em prosa embaixo de um título. Conhecimento rico entrando, campo vazio
 * saindo — e o agente parecendo não conhecer o cliente.
 */

const DOSSIE = `---
tipo: dossie-cliente
cliente: "3Net"
---

# 3NET — CONTEXTO COMPLETO

## Quem é

Provedor de internet fibra de Birigui, São Paulo. Mercado local com pelo menos
dez concorrentes regionais.

## Público

Mercado residencial de Birigui e entorno imediato.

## O que evitar

- **Não comunicar para fora da área de cobertura.** Servir anúncio fora de
  Birigui já foi problema real e custou verba.
- **Não citar concorrente.**

## Planos

| Produto | Para quem | Observações |
|---|---|---|
| Fibra residencial | Residencial Birigui | Com streaming |

## Seção vazia

## Contato
x
`;

describe('dossiê em prosa vira fato', () => {
  const fatos = extractSectionFacts(DOSSIE, 'dossiê do cliente', 'm1');
  const campo = (f: string) => fatos.find((x) => x.field === f)?.value ?? null;

  it('título + prosa viram campo do briefing', () => {
    expect(campo('produto')).toContain('Provedor de internet fibra de Birigui');
    expect(campo('publico')).toContain('residencial de Birigui');
  });

  it('a restrição que custou verba chega ao briefing', () => {
    expect(campo('proibidos')).toContain('fora da área de cobertura');
    expect(campo('proibidos')).toContain('Não citar concorrente');
  });

  it('negrito de markdown não polui o valor', () => {
    expect(campo('proibidos')).not.toContain('**');
  });

  it('tabela vira texto legível, sem a linha separadora', () => {
    const oferta = campo('oferta') ?? '';
    expect(oferta).toContain('Fibra residencial · Residencial Birigui');
    expect(oferta).not.toContain('|---|');
  });

  it('seção vazia e seção de uma palavra não viram fato', () => {
    expect(fatos.some((f) => f.value.trim().length < 12)).toBe(false);
  });

  it('front matter YAML não vira corpo de seção', () => {
    expect(fatos.some((f) => f.value.includes('dossie-cliente'))).toBe(false);
  });

  it('título numerado é reconhecido ("## 1. IDENTIDADE")', () => {
    const r = extractSectionFacts('## 1. Identidade\nAgência de mídia digital do interior paulista.', 's');
    expect(r[0]?.field).toBe('produto');
  });

  it('cada campo aparece uma vez — o primeiro título vence', () => {
    const r = extractSectionFacts('## Público\nDonas de lavanderia.\n\n## Personas\nOutra coisa qualquer aqui.', 's');
    expect(r.filter((f) => f.field === 'publico')).toHaveLength(1);
    expect(r[0]?.value).toContain('Donas de lavanderia');
  });
});

describe('as duas formas convivem, e a mais específica vence', () => {
  it('rótulo de linha ganha da seção para o mesmo campo', () => {
    const texto = '- Público: gestores de lavanderia industrial\n\n## Público\n\nAlgo mais genérico escrito em prosa.';
    const juntos = mergeFacts(
      extractLabeledFacts(texto, 'linha'),
      extractSectionFacts(texto, 'secao'),
    );
    const publico = juntos.find((f) => f.field === 'publico');
    expect(publico?.source).toBe('linha');
    expect(publico?.value).toContain('gestores de lavanderia');
  });

  it('a seção preenche o que o rótulo não cobriu', () => {
    const texto = '- Público: X industrial\n\n## O que evitar\n\nNunca prometer prazo de assistência.';
    const juntos = mergeFacts(extractLabeledFacts(texto, 'linha'), extractSectionFacts(texto, 'secao'));
    expect(juntos.map((f) => f.field).sort()).toEqual(['proibidos', 'publico']);
  });
});
