import { describe, expect, it } from 'vitest';
import { aceitaContextoNaMensagem } from './agentic-dispatch.js';

describe('contexto_vai_no_canal_que_o_node_entende', () => {
  it('Otto lê contexto dentro da mensagem', () => {
    expect(aceitaContextoNaMensagem('otto')).toBe(true);
  });

  it('Bento NÃO: a mensagem inteira é sinal de intenção e consulta vetorial dele', () => {
    expect(aceitaContextoNaMensagem('bento')).toBe(false);
  });

  it('node desconhecido recebe contexto apartado — o padrão seguro', () => {
    expect(aceitaContextoNaMensagem('node-novo')).toBe(false);
  });
});
