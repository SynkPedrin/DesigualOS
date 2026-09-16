import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { caminhoDoVault, escreverNoVault, lerDoVault } from './vault-writer';

/**
 * O vault é representação, não verdade. As três garantias abaixo existem por
 * experiência ruim: consolidação roda todo dia, e append cego transformaria uma
 * regra em vinte linhas iguais em três semanas.
 */
let raiz: string;
const destino = (environment = 'production', secao = 'Preferências consolidadas') => ({
  raiz, clienteSlug: 'cliente-teste', environment, secao,
});
const regra = (chave: string, conteudo: string, dia = '2026-09-16') => ({
  chave, conteudo, sourceRefs: ['episode:abc'], atualizadoEm: new Date(`${dia}T12:00:00Z`),
});

beforeEach(async () => { raiz = await mkdtemp(join(tmpdir(), 'vault-')); });
afterEach(async () => { await rm(raiz, { recursive: true, force: true }); });

describe('escreverNoVault', () => {
  it('cria o arquivo com a seção e a regra', async () => {
    const r = await escreverNoVault(destino(), regra('legenda', 'copies mais diretas'));
    expect(r.acao).toBe('criado');
    const texto = await lerDoVault(destino());
    expect(texto).toContain('## Preferências consolidadas');
    expect(texto).toContain('copies mais diretas');
  });

  it('IDEMPOTÊNCIA: gravar o mesmo conhecimento não duplica', async () => {
    await escreverNoVault(destino(), regra('legenda', 'copies mais diretas'));
    const segunda = await escreverNoVault(destino(), regra('legenda', 'copies mais diretas'));
    const terceira = await escreverNoVault(destino(), regra('legenda', 'copies mais diretas'));
    expect(segunda.acao).toBe('inalterado');
    expect(terceira.acao).toBe('inalterado');
    const texto = await lerDoVault(destino());
    expect((texto.match(/copies mais diretas/g) ?? [])).toHaveLength(1);
  });

  it('SUPERSESSÃO: regra nova substitui e a antiga vai para o histórico', async () => {
    await escreverNoVault(destino(), regra('tom', 'tom descontraído', '2026-09-01'));
    const r = await escreverNoVault(destino(), regra('tom', 'tom institucional', '2026-09-16'));
    expect(r.acao).toBe('atualizado');
    const texto = await lerDoVault(destino());
    // A seção corrente tem só a regra atual...
    const corrente = texto.split('## Histórico de regras substituídas')[0]!;
    expect(corrente).toContain('tom institucional');
    expect(corrente).not.toContain('tom descontraído');
    // ...e a antiga continua rastreável, com a data da troca.
    expect(texto).toContain('[substituída em 2026-09-16]');
    expect(texto).toContain('tom descontraído');
  });

  it('duas regras de aspectos DIFERENTES convivem', async () => {
    await escreverNoVault(destino(), regra('legenda', 'copies mais diretas'));
    await escreverNoVault(destino(), regra('tom', 'tom institucional'));
    const texto = await lerDoVault(destino());
    expect(texto).toContain('copies mais diretas');
    expect(texto).toContain('tom institucional');
  });

  it('ISOLAMENTO: QA escreve em namespace separado da produção', async () => {
    expect(caminhoDoVault(destino('qa'))).toContain('/_qa/');
    expect(caminhoDoVault(destino('production'))).not.toContain('/_qa/');

    await escreverNoVault(destino('qa'), regra('legenda', 'REGRA DE TESTE'));
    const prod = await lerDoVault(destino('production'));
    expect(prod).toBe('');
  });

  it('a linha carrega proveniência, para poder auditar depois', async () => {
    await escreverNoVault(destino(), { chave: 'tom', conteudo: 'institucional', sourceRefs: ['episode:1', 'episode:2'], atualizadoEm: new Date('2026-09-16T12:00:00Z') });
    const texto = await lerDoVault(destino());
    expect(texto).toContain('episode:1');
    expect(texto).toContain('2026-09-16');
  });

  it('seções diferentes não se sobrescrevem', async () => {
    await escreverNoVault(destino('production', 'Preferências consolidadas'), regra('legenda', 'diretas'));
    await escreverNoVault(destino('production', 'Decisões importantes'), regra('posicionamento', 'legado, não preço'));
    const texto = await readFile(caminhoDoVault(destino()), 'utf8');
    expect(texto).toContain('## Preferências consolidadas');
    expect(texto).toContain('## Decisões importantes');
    expect(texto).toContain('diretas');
    expect(texto).toContain('legado, não preço');
  });
});
