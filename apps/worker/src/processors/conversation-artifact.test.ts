import { describe, expect, it } from 'vitest';
import { conversationArtifact, looksLikeCreativeFeedback, requestsExternalTask } from './conversation-artifact';

/**
 * OTTO_GENERIC_FEEDBACK_IMPROVES — `looksLikeCreativeFeedback` é o desvio que
 * `execute-job.ts` usa pra NUNCA deixar "Ficou genérico."/"Agora gostei."
 * cair em `registrarConhecimentoDoTurno` quando o agente é o Otto. Ver
 * knowledge-statement.test.ts pro outro lado da armadilha: SEM esse desvio,
 * as duas frases seriam registradas como conhecimento permanente, e o Otto
 * nunca chegaria a reescrever o draft.
 */
describe('looksLikeCreativeFeedback', () => {
  it.each(['Ficou genérico.', 'Não gostei.', 'Troca o hook.', 'Ajusta o final.', 'Quero outra direção.'])(
    '%s é crítica de draft',
    (msg) => {
      expect(looksLikeCreativeFeedback(msg)).toBe(true);
    },
  );

  it.each(['Agora gostei.', 'Agora ficou bom.', 'Aprovado.', 'Essa ficou boa.', 'Perfeito.'])('%s é aprovação de draft', (msg) => {
    expect(looksLikeCreativeFeedback(msg)).toBe(true);
  });

  it('conversa comum não é feedback de draft', () => {
    expect(looksLikeCreativeFeedback('Bom dia, tudo bem?')).toBe(false);
    expect(looksLikeCreativeFeedback('Quantas tasks vencem hoje?')).toBe(false);
  });
});

describe('conversationArtifact', () => {
  const t = (role: string, content: string, agent: string | null = 'otto') => ({ role, content, agent });

  it('crítica de draft LIMPA a aprovação anterior — não reaproveita versão velha', () => {
    const turns = [
      t('user', 'Otto, crie um Reel sobre IA no atendimento.'),
      t('assistant', 'V1: '.padEnd(90, 'x')),
      t('user', 'Agora gostei.'),
      t('assistant', 'V2 (melhor ainda, depois de mais ajuste): '.padEnd(90, 'y')),
      t('user', 'Ficou genérico de novo.'),
    ];
    // A última crítica limpa `approved`; sem uma NOVA aprovação depois dela,
    // o artefato cai pro último draft mostrado (latest), não pro aprovado antigo.
    const artefato = conversationArtifact(turns, 'otto');
    expect(artefato).toBe(turns[3]!.content);
  });

  it('aprovação vincula ao draft CONCRETO anterior, não ao mais recente texto qualquer', () => {
    const turns = [
      t('assistant', 'V1: '.padEnd(90, 'x')),
      t('user', 'Agora gostei.'),
    ];
    expect(conversationArtifact(turns, 'otto')).toBe(turns[0]!.content);
  });
});

describe('requestsExternalTask', () => {
  it('"cria a task pro Pedro editar" é execução externa', () => {
    expect(requestsExternalTask('Cria a task pro Pedro Gabriel editar.')).toBe(true);
  });

  it('"agora gostei" sozinho NÃO é pedido de execução', () => {
    expect(requestsExternalTask('Agora gostei.')).toBe(false);
  });
});
