import { describe, expect, it, vi } from 'vitest';
import { extractCitedClient, buildOperationalTitle } from './write-target';

/**
 * Regressão do caso real: a task foi criada na lista errada porque o destino
 * era fallback. A citação explícita do cliente tem que mandar, e "não sei"
 * precisa bloquear a escrita.
 */
describe('extractCitedClient', () => {
  it.each([
    ['Crie uma task para o cliente Colpar QA', 'Colpar QA'],
    ['revisar peças do cliente Elite', 'Elite'],
    ['task pro cliente 3Net', '3Net'],
    ['Analise e crie uma task para o cliente Colpar QA e depois me avise', 'Colpar QA'],
  ])('%s -> %s', (msg, esperado) => {
    expect(extractCitedClient(msg)).toBe(esperado);
  });

  it('sem citação explícita devolve null', () => {
    expect(extractCitedClient('Crie uma task de revisão de peças')).toBeNull();
  });
});

describe('task_title_is_semantic_not_raw_prompt', () => {
  it('o título NUNCA é a mensagem crua do caso real', () => {
    const t = buildOperationalTitle({
      message: "Analisa essas peças da campanha 'Peças que você confia, você tem' e cria a task dos ajustes",
      explicitName: null,
      clientName: 'Colpar',
    });
    expect(t).not.toBe('Peças que você confia, você tem');
    expect(t.startsWith('Revisar e ajustar')).toBe(true);
  });

  it('título sempre tem tamanho utilizável', () => {
    const t = buildOperationalTitle({ message: 'crie a task', explicitName: null, clientName: null });
    expect(t.length).toBeGreaterThanOrEqual(6);
  });
});
