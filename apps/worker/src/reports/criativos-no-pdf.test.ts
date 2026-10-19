import { describe, expect, it } from 'vitest';
import { renderToBuffer } from '@react-pdf/renderer';
import { ClientReportDocument, type ClientReportData, type ReportCreative } from './client-report-document.js';

/**
 * O PDF PRECISA SAIR COM A ARTE DENTRO — e precisa sair mesmo quando ela falta.
 *
 * Duas coisas tornam esta suíte necessária, e nenhuma delas aparece em
 * typecheck. A primeira é que `@react-pdf/renderer` é exigente com o que
 * aceita em `<Image src>`: um buffer malformado não dá erro de tipo, dá
 * exceção na renderização — e o relatório de um cliente não pode morrer por
 * causa de uma miniatura.
 *
 * A segunda é a razão de a imagem ser BYTES e não URL. As `thumbnail_url` do
 * Meta são assinadas e expiram em horas. Um PDF que as referenciasse nasceria
 * certo e apodreceria: o cliente abre na semana seguinte e encontra retângulo
 * quebrado. Como o arquivo fica guardado no Storage para sempre, a arte tem
 * que estar embutida no momento da geração.
 */

/** PNG 1x1 válido — o menor arquivo que prova que o pipeline de imagem anda. */
const PNG_MINIMO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function criativo(extra: Partial<ReportCreative> = {}): ReportCreative {
  return { id: 'ad-1', name: 'Criativo Verão', spend: 1200, ctr: 1.4, imagem: PNG_MINIMO, ...extra };
}

function dados(criativos: ReportCreative[]): ClientReportData {
  return {
    clienteNome: 'Colormaq',
    periodoInicio: new Date('2026-09-08'),
    periodoFim: new Date('2026-10-08'),
    periodoDias: 30,
    geradoEm: new Date('2026-10-08T12:00:00Z'),
    meta: {
      conectado: true,
      atual: { spend: 12000, resultados: 340, ctr: 1.4, custoMedio: 2.1 },
      anterior: { spend: 9000, resultados: 280, ctr: 1.2, custoMedio: 2.4 },
      campanhas: [{ id: 'c1', name: 'Sempre ativa', status: 'ACTIVE', spend: 12000, clicks: 800, ctr: 1.4 }],
      criativos,
    },
    googleAds: null,
  };
}

/** Assinatura de arquivo PDF: os quatro primeiros bytes são sempre `%PDF`. */
function ehPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 4).toString() === '%PDF';
}

describe('criativos no relatório PDF', () => {
  it('rende o PDF com a imagem embutida', async () => {
    const pdf = await renderToBuffer(ClientReportDocument({ data: dados([criativo()]) }));

    expect(ehPdf(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1000);
  });

  /** Download que falhou vira `imagem: null`. O criativo ainda vale: nome e
   *  números continuam sendo informação. O que não pode é o PDF morrer. */
  it('criativo sem arte não derruba o documento', async () => {
    const pdf = await renderToBuffer(ClientReportDocument({ data: dados([criativo({ imagem: null })]) }));

    expect(ehPdf(pdf)).toBe(true);
  });

  it('mistura de criativos com e sem arte sai inteira', async () => {
    const pdf = await renderToBuffer(
      ClientReportDocument({
        data: dados([criativo(), criativo({ id: 'ad-2', imagem: null }), criativo({ id: 'ad-3' })]),
      }),
    );

    expect(ehPdf(pdf)).toBe(true);
  });

  /** O relatório existia antes dos criativos e precisa continuar existindo
   *  sem eles — canal sem galeria é o estado de todo cliente até agora. */
  it('sem criativo nenhum, o relatório sai como sempre saiu', async () => {
    const pdf = await renderToBuffer(ClientReportDocument({ data: dados([]) }));

    expect(ehPdf(pdf)).toBe(true);
  });

  /** Oito é o teto: relatório não é catálogo, e cada imagem pesa no anexo. */
  it('mais de oito criativos não explodem o documento', async () => {
    const muitos = Array.from({ length: 20 }, (_, i) => criativo({ id: `ad-${i}` }));
    const pdf = await renderToBuffer(ClientReportDocument({ data: dados(muitos) }));

    expect(ehPdf(pdf)).toBe(true);
  });
});
