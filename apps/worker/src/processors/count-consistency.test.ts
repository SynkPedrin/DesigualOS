import { describe, expect, it } from 'vitest';
import { checkCountConsistency, expectedCount } from './count-consistency';

const BLOCO = [
  'DADOS AO VIVO DO CLICKUP (consultados agora, valem mais que qualquer memória sua):',
  '15 tarefa(s) aberta(s) (janela: hoje) em 5 cliente(s), de 50 cliente(s) consultado(s).',
  '1 sem responsável definido.',
].join('\n');

describe('expectedCount', () => {
  it('lê o total declarado pelo bloco', () => {
    expect(expectedCount(BLOCO)).toBe(15);
  });
  it('bloco sem total não inventa número', () => {
    expect(expectedCount('DADOS AO VIVO DO CLICKUP (consultados agora):\nNenhuma tarefa aberta.')).toBeNull();
  });
});

describe('checkCountConsistency', () => {
  it('pega a contagem ERRADA que passou no gate real ("5" com 15 no bloco)', () => {
    const r = checkCountConsistency('5 tarefas vencem hoje.', BLOCO);
    expect(r.ok).toBe(false);
    expect(r.expected).toBe(15);
    expect(r.claimed).toBe(5);
  });

  it('pega a NEGAÇÃO que passou no gate real ("Nenhuma tarefa vence hoje" com 15)', () => {
    const r = checkCountConsistency('Nenhuma tarefa vence hoje. As datas estão entre 15 e 21 de setembro.', BLOCO);
    expect(r.ok).toBe(false);
    expect(r.claimed).toBe(0);
  });

  it('"não há tarefas" também é negação', () => {
    expect(checkCountConsistency('Não há tarefas vencendo hoje.', BLOCO).ok).toBe(false);
  });

  it('a contagem CERTA passa', () => {
    const r = checkCountConsistency('15 tarefas vencem hoje, 1 sem responsável.', BLOCO);
    expect(r.ok).toBe(true);
  });

  it('pega contagem no MEIO da frase', () => {
    const r = checkCountConsistency('Hoje vão vencer 3 tarefas. Vêm do dado ao vivo.', BLOCO);
    expect(r.ok).toBe(false);
    expect(r.expected).toBe(15);
  });

  it('total certo junto de subcontagens passa', () => {
    expect(checkCountConsistency('São 15 tarefas hoje, sendo 6 tarefas da 3Net.', BLOCO).ok).toBe(true);
  });

  it('resposta sem afirmação de total não é julgada', () => {
    expect(checkCountConsistency('As entregas da 3Net concentram o dia.', BLOCO).ok).toBeNull();
  });

  it('negação é CORRETA quando o bloco diz zero — não pode virar falso positivo', () => {
    const vazio = 'DADOS AO VIVO DO CLICKUP (consultados agora):\n0 tarefa(s) aberta(s) (janela: hoje).';
    expect(checkCountConsistency('Nenhuma tarefa vence hoje.', vazio).ok).not.toBe(false);
  });

  it('sem bloco operacional, não opina', () => {
    expect(checkCountConsistency('5 tarefas vencem hoje.', '').ok).toBeNull();
  });
});
