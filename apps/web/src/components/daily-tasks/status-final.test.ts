import { describe, expect, it } from 'vitest';
import { statusDeConclusao, statusDeReabertura } from './status-final';

const s = (name: string, category: string, isInitial = false) => ({ id: name, name, category, isInitial });
// O fluxo real do "Espaço DESIGUAL" em produção, na ordem de posição.
const desigual = [s('pendente', 'todo', true), s('em progresso', 'active'), s('concluído', 'done'), s('Open', 'todo'), s('pronto', 'done'), s('encerrado', 'done'), s('aberto', 'todo'), s('aguardando aprovação', 'active')];

describe('status de conclusão e de reabertura', () => {
  it('Concluir leva a "encerrado", nunca ao "concluído" que vem antes na fila nem a "pronto"', () => {
    expect(statusDeConclusao(desigual)?.name).toBe('encerrado');
  });
  it('sem "encerrado": concluído/complete; "pronto" e cancelado só como último recurso', () => {
    expect(statusDeConclusao([s('to do', 'todo'), s('cancelled', 'done'), s('complete', 'done')])?.name).toBe('complete');
    expect(statusDeConclusao([s('pronto', 'done'), s('cancelado', 'done'), s('feito', 'done')])?.name).toBe('feito');
    expect(statusDeConclusao([s('cancelado', 'done'), s('pronto', 'done')])?.name).toBe('pronto');
    expect(statusDeConclusao([s('a', 'todo')])).toBeUndefined();
  });
  it('Reabrir volta ao "aberto" do fluxo real, não ao "pendente" padrão', () => {
    expect(statusDeReabertura(desigual)?.name).toBe('aberto');
    expect(statusDeReabertura([s('Open', 'todo'), s('x', 'todo', true)])?.name).toBe('Open');
    expect(statusDeReabertura([s('to do', 'todo', true), s('complete', 'done')])?.name).toBe('to do');
  });
});
