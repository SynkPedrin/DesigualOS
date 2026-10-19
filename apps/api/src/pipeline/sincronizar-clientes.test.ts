import { describe, expect, it } from 'vitest';
import { clientesSemCartao } from './routes';

/**
 * SINCRONIZAR CLIENTES NUM QUADRO — a lógica pura, sem banco (mesmo padrão de
 * visibilidade.test.ts/acesso.test.ts): dado quem é carteira real e quais
 * client_id já viraram cartão, quem falta. Fixture/interno são filtrados
 * ANTES de chegar aqui (via separarCarteira, na rota) — esta função só decide
 * "já tem cartão ou não", nunca "é cliente de verdade ou não".
 */
describe('clientesSemCartao', () => {
  const colormaq = { id: 'cliente-colormaq', name: 'Colormaq' };
  const fratelli = { id: 'cliente-fratelli', name: 'Fratelli' };
  const elite = { id: 'cliente-elite', name: 'Elite' };

  it('devolve só quem ainda não tem cartão no quadro', () => {
    const faltando = clientesSemCartao([colormaq, fratelli, elite], new Set([fratelli.id]));
    expect(faltando).toEqual([colormaq, elite]);
  });

  it('quadro vazio: todo mundo da carteira falta', () => {
    expect(clientesSemCartao([colormaq, fratelli], new Set())).toEqual([colormaq, fratelli]);
  });

  it('quadro já sincronizado: reimportar não duplica ninguém (idempotente)', () => {
    const jaTodos = new Set([colormaq.id, fratelli.id, elite.id]);
    expect(clientesSemCartao([colormaq, fratelli, elite], jaTodos)).toEqual([]);
  });

  it('carteira vazia nunca lança, só devolve lista vazia', () => {
    expect(clientesSemCartao([], new Set(['algo']))).toEqual([]);
  });
});
