import { describe, expect, it, vi } from 'vitest';
import { elaboracaoAceitavel, elaborarBriefingSenior, costurar } from './briefing-senior';

type Escritor = (prompt: string, opts?: { maxTokens?: number }) => Promise<string | null>;
import type { ComposedBriefing } from './briefing-composer';

/**
 * Relato da operação (28/09/2026): "o conteúdo é básico, não aprofunda; somos
 * uma das maiores empresas de mídia digital do país e todo funcionário é
 * sênior".
 *
 * O que estes testes protegem NÃO é a qualidade do raciocínio — isso é
 * julgamento de gente. É o contrário: que análise rasa, genérica ou pela
 * metade NÃO seja anexada. Briefing com cara de pensado e conteúdo vazio é
 * pior que a ficha seca, porque ninguém confere o que parece pronto.
 */

const fakeLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as import('@desigual-os/logging').Logger;

const ANALISE_BOA = `## LEITURA DA DEMANDA
A Colormaq fala com dona de lavanderia industrial que já perdeu produção por parada de máquina. A peça não vende lavadora, reduz o medo de parar. Se sair genérica, vira mais um post de fabricante e some no feed.

## ÂNGULO
A tensão real não é o preço da manutenção, é o custo do dia parado. O ângulo óbvio a evitar é "qualidade e durabilidade" — todo concorrente diz isso e ninguém acredita.

## O QUE DERRUBA ESTA ENTREGA
- Falar de especificação técnica antes de nomear a dor da parada
- Usar foto de máquina nova em vez de operação rodando
- CTA genérico de "saiba mais" quando o objetivo é orçamento no WhatsApp
- Prometer prazo de assistência sem o dado do dossiê

## CRITÉRIO DE PRONTO
- O primeiro slide nomeia a parada de produção, não o produto
- Existe um CTA único e ele é WhatsApp
- Nenhum número de prazo aparece sem estar no dossiê`;

describe('o que NÃO pode ser anexado', () => {
  it('análise curta demais é legenda, não leitura', () => {
    expect(elaboracaoAceitavel('## LEITURA DA DEMANDA\nFazer um bom carrossel.')).toBe(false);
  });

  it.each([
    'conteúdo alinhado com a marca',
    'material de alta qualidade',
    'seguir o padrão da agência',
    'garantir a qualidade da entrega',
  ])('enchimento conhecido reprova: %s', (frase) => {
    expect(elaboracaoAceitavel(`${ANALISE_BOA}\n\nObservação: ${frase}.`)).toBe(false);
  });

  it('meia elaboração reprova — pior que a ficha seca', () => {
    const semCriterio = ANALISE_BOA.split('## CRITÉRIO DE PRONTO')[0]!;
    expect(elaboracaoAceitavel(semCriterio)).toBe(false);
  });

  it('a análise completa e específica passa', () => {
    expect(elaboracaoAceitavel(ANALISE_BOA)).toBe(true);
  });
});

const composto = {
  markdown: '# Briefing: Carrossel\n\n## IDENTIFICAÇÃO\n- Cliente: Colormaq\n\n## PENDENTE DE CONFIRMAÇÃO\n- Prioridade',
  deliveryType: 'social_content',
  missingCritical: ['Prioridade'],
} as unknown as ComposedBriefing;

describe('elaboração: tenta de novo, e desiste em silêncio', () => {
  it('pede raciocínio com teto ALTO — 700 tokens era a causa do briefing raso', async () => {
    const escritor = vi.fn<Escritor>(async () => ANALISE_BOA);
    await elaborarBriefingSenior({ composto, mensagem: 'cria o carrossel', clientName: 'Colormaq', escritor, logger: fakeLogger });
    expect(escritor.mock.calls[0]?.[1]).toMatchObject({ maxTokens: 1800 });
  });

  it('primeira volta rasa vira UMA retentativa mais exigente', async () => {
    const escritor = vi.fn<Escritor>()
      .mockResolvedValueOnce('## LEITURA DA DEMANDA\nraso')
      .mockResolvedValueOnce(ANALISE_BOA);
    const r = await elaborarBriefingSenior({ composto, mensagem: 'x', clientName: 'Colormaq', escritor, logger: fakeLogger });
    expect(r?.tentativas).toBe(2);
    expect(escritor.mock.calls[1]?.[0]).toContain('voltou rasa');
  });

  it('duas voltas ruins: não anexa nada — a ficha já é entregável sozinha', async () => {
    const escritor = vi.fn<Escritor>(async () => 'conteúdo alinhado com a marca');
    expect(await elaborarBriefingSenior({ composto, mensagem: 'x', clientName: 'C', escritor, logger: fakeLogger })).toBeNull();
  });

  it('escritor que falha não derruba o briefing', async () => {
    const escritor = vi.fn<Escritor>(async () => { throw new Error('timeout'); });
    expect(await elaborarBriefingSenior({ composto, mensagem: 'x', clientName: 'C', escritor, logger: fakeLogger })).toBeNull();
  });

  it('o modelo só pode raciocinar sobre os fatos apurados, e é instruído a declarar lacuna', async () => {
    const escritor = vi.fn<Escritor>(async () => ANALISE_BOA);
    await elaborarBriefingSenior({ composto, mensagem: 'x', clientName: 'Colormaq', escritor, logger: fakeLogger });
    const prompt = escritor.mock.calls[0]![0];
    expect(prompt).toContain('NÃO tem informação nova sobre o cliente');
    expect(prompt).toContain('[CONFIRMAR:');
    expect(prompt).toContain('SÊNIOR');
  });
});

describe('costura: fato em cima, leitura no meio, pendência embaixo', () => {
  it('a leitura entra ANTES das pendências', () => {
    const r = costurar(composto, { markdown: ANALISE_BOA, tentativas: 1 });
    expect(r.indexOf('## IDENTIFICAÇÃO')).toBeLessThan(r.indexOf('## LEITURA DA DEMANDA'));
    expect(r.indexOf('## LEITURA DA DEMANDA')).toBeLessThan(r.indexOf('## PENDENTE DE CONFIRMAÇÃO'));
  });

  it('sem elaboração, o briefing sai exatamente como era — nada regride', () => {
    expect(costurar(composto, null)).toBe(composto.markdown);
  });

  it('briefing sem seção de pendência recebe a leitura no fim', () => {
    const semPendencia = { ...composto, markdown: '# Briefing\n\n## IDENTIFICAÇÃO\n- Cliente: Colormaq' } as ComposedBriefing;
    expect(costurar(semPendencia, { markdown: ANALISE_BOA, tentativas: 1 })).toContain('## LEITURA DA DEMANDA');
  });
});
