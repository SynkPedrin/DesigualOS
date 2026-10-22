import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToBuffer } from '@react-pdf/renderer';
import { acharAssetDoRelatorio, ClientReportDocument, corDoStatus, statusLegivel, variacao, type ClientReportData } from './client-report-document.js';

/**
 * A ARTE DO RELATÓRIO PRECISA CHEGAR AO CONTAINER.
 *
 * Até 22/10/2026 o PDF procurava o logo em `assets/` da raiz do repositório, que
 * não é copiada para a imagem do worker: todo relatório de produção saía sem a
 * marca da Desigual, só com o texto "DESIGUAL", e nenhum teste acusava. Estes
 * testes acusam: a arte existe, é leve (o arquivo vai por WhatsApp e e-mail para
 * o cliente) e o Dockerfile a copia.
 */
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function dados(): ClientReportData {
  return {
    clienteNome: 'Cliente Exemplo',
    periodoInicio: new Date('2026-10-01T00:00:00Z'),
    periodoFim: new Date('2026-10-21T00:00:00Z'),
    periodoDias: 21,
    geradoEm: new Date('2026-10-22T17:30:00Z'),
    meta: {
      conectado: true,
      atual: { spend: 12480.5, resultados: 342, ctr: 1.84, custoMedio: 36.49 },
      anterior: { spend: 9800, resultados: 280, ctr: 1.52, custoMedio: 35 },
      campanhas: [{ id: 'c1', name: 'Conversão | Leads', status: 'ACTIVE', spend: 6200, clicks: 3100, ctr: 2.1 }],
    },
    googleAds: null,
  };
}

describe('arte do relatório em PDF', () => {
  it('capa e logo existem no pacote do worker e são leves', () => {
    for (const nome of ['capa.jpg', 'logo.png']) {
      const caminho = acharAssetDoRelatorio(nome);
      expect(caminho, `${nome} não foi encontrado em apps/worker/assets/relatorio`).not.toBeNull();
      expect(statSync(caminho!).size).toBeLessThan(600 * 1024);
    }
  });

  it('o Dockerfile do worker copia a pasta de arte para a imagem', () => {
    const dockerfile = readFileSync(resolve(RAIZ, 'Dockerfile.prod'), 'utf8');
    expect(dockerfile).toMatch(/COPY --from=build \/app\/apps\/worker\/assets \.\/apps\/worker\/assets/);
  });

  it('o PDF com capa e logo é válido e leve o bastante para mandar ao cliente', async () => {
    const pdf = await renderToBuffer(ClientReportDocument({ data: dados() }));
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeLessThan(2 * 1024 * 1024);
  });
});

describe('leitura dos números no relatório', () => {
  it('variação: sinal, vírgula decimal e sem base de comparação honesta', () => {
    expect(variacao(110, 100)).toEqual({ texto: '+10,0%', positiva: true });
    expect(variacao(80, 100)).toEqual({ texto: '-20,0%', positiva: false });
    expect(variacao(10, 0)).toBeNull();
    expect(variacao(null, 100)).toBeNull();
    expect(variacao(100, null)).toBeNull();
  });

  it('status chega em português e a cor diz a situação', () => {
    expect(statusLegivel('ACTIVE')).toBe('Ativa');
    expect(statusLegivel('WITH_ISSUES')).toBe('Com problemas');
    expect(statusLegivel('STATUS_NOVO')).toBe('STATUS_NOVO');
    expect(corDoStatus('ACTIVE').texto).not.toBe(corDoStatus('WITH_ISSUES').texto);
    expect(corDoStatus('PAUSED').fundo).not.toBe(corDoStatus('ACTIVE').fundo);
  });
});
