import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A LISTA DO LOG NÃO PODE DIVERGIR DA FILA REGISTRADA.
 *
 * `JOBS_REPETIVEIS` existe porque a mensagem "Scheduler armado" trazia uma
 * lista escrita à mão que anunciava CINCO jobs enquanto NOVE estavam armados —
 * alguém acrescentava um `queue.add` e ninguém lembrava do texto ao lado.
 *
 * Trocar aquela lista por OUTRA lista escrita à mão não conserta nada: só move
 * o mesmo defeito de lugar. Este teste é o que faz a nova lista valer alguma
 * coisa — ele lê o próprio arquivo e compara com os `queue.add` que existem
 * lá, então esquecer de atualizá-la reprova aqui em vez de virar log errado.
 */
const FONTE = resolve(dirname(fileURLToPath(import.meta.url)), 'index.ts');

function lerFonte(): string {
  return readFileSync(FONTE, 'utf8');
}

/** Os nomes realmente enfileirados, extraídos das chamadas `queue.add('...')`. */
function jobsEnfileirados(fonte: string): string[] {
  return [...fonte.matchAll(/queue\.add\('([a-z0-9-]+)'/g)].map((m) => m[1]!);
}

/** Os nomes declarados na constante que o log usa. */
function jobsDeclarados(fonte: string): string[] {
  const bloco = /const JOBS_REPETIVEIS = \[([\s\S]*?)\] as const;/.exec(fonte);
  if (!bloco) throw new Error('JOBS_REPETIVEIS sumiu de scheduler/index.ts');
  return [...bloco[1]!.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]!);
}

describe('a lista do log acompanha a fila de verdade', () => {
  it('declara exatamente os jobs que são registrados, na mesma ordem', () => {
    const fonte = lerFonte();

    expect(jobsDeclarados(fonte)).toEqual(jobsEnfileirados(fonte));
  });

  it('o vigia de conexão de MCP está entre eles', () => {
    // Guarda específica: é o job novo, e é o que ninguém sentiria falta.
    expect(jobsEnfileirados(lerFonte())).toContain('aviso-conexao-mcp');
  });

  /**
   * Cada job registrado precisa de um braço no `if` do worker. Registrar sem
   * tratar é a falha mais silenciosa possível: o job roda, cai em nenhum ramo,
   * é marcado como `completed` e o Redis mostra sucesso pra trabalho que nunca
   * aconteceu.
   */
  it('todo job registrado tem quem o execute', () => {
    const fonte = lerFonte();
    const tratados = [...fonte.matchAll(/job\.name === '([a-z0-9-]+)'/g)].map((m) => m[1]!);

    expect([...jobsEnfileirados(fonte)].sort()).toEqual([...tratados].sort());
  });
});
