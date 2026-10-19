import { describe, expect, it } from 'vitest';
import { detectKnowledgeStatement } from './knowledge-statement';

/**
 * Regressão de 16/09/2026: "Decidimos que a comunicação da Cosentino vai
 * priorizar legado e permanência, não preço." caía no loop operacional do Bento
 * e morria em replan_exhausted em 11 segundos — o agente tentava responder
 * operacionalmente uma frase que não perguntava nada.
 *
 * ENSINAR é o fluxo de que a memória inteira depende. Se a frase que registra
 * uma decisão devolve erro, ninguém ensina o sistema duas vezes.
 */
describe('detectKnowledgeStatement', () => {
  it('a frase que quebrou a produção agora é registrada', () => {
    const r = detectKnowledgeStatement(
      'Decidimos que a comunicação da Cosentino vai priorizar legado e permanência, não preço.',
      'Cosentino',
    );
    expect(r).not.toBeNull();
    expect(r!.tipos).toContain('decision');
    expect(r!.answer).toContain('Registrado para Cosentino');
    expect(r!.answer).toContain('legado');
  });

  it('preferência durável também registra', () => {
    const r = detectKnowledgeStatement('Daqui pra frente as legendas desse cliente precisam ser mais diretas.', null);
    expect(r!.tipos).toContain('preference');
  });

  it('PERGUNTA não é registro, mesmo com verbo de decisão', () => {
    expect(detectKnowledgeStatement('O que a gente decidiu ontem sobre a Cosentino?', null)).toBeNull();
    expect(detectKnowledgeStatement('Quais decisões mudaram a operação?', null)).toBeNull();
  });

  it('PEDIDO de entrega não é registro', () => {
    // Sem isto, "crie uma legenda sempre mais direta" viraria confirmação em
    // vez de peça — o agente pararia de trabalhar e passaria a anotar.
    expect(detectKnowledgeStatement('Crie uma legenda sempre mais direta para esse cliente.', null)).toBeNull();
    expect(detectKnowledgeStatement('Me mostra o que mudou nessa campanha.', null)).toBeNull();
  });

  it('conversa comum não vira registro', () => {
    expect(detectKnowledgeStatement('bom dia', null)).toBeNull();
    expect(detectKnowledgeStatement('', null)).toBeNull();
  });

  it('a confirmação diz que fica valendo, sem prometer o que não faz', () => {
    const r = detectKnowledgeStatement('Ficou definido que esse cliente não usa emoji.', null)!;
    expect(r.answer).toMatch(/fica valendo/i);
    expect(r.answer).toMatch(/me corrige/i);
  });

  /**
   * OTTO_GENERIC_FEEDBACK_IMPROVES — a ARMADILHA de 22/09/2026 ("Ficou
   * genérico." e "Agora gostei." viravam "Registrado: ..." e o Otto nunca
   * reescrevia o draft) hoje tem DUAS defesas:
   *
   * 1. Na fonte (26/09/2026, F-20): o filtro de relevância do
   *    extractEpisodeCandidates exige 2 termos de conteúdo além do marcador —
   *    feedback vazio assim nem chega a ser candidato, então ESTA função
   *    devolve null.
   * 2. No caller (a original): `execute-job.ts` checa `looksLikeCreativeFeedback`
   *    ANTES de chamar `registrarConhecimentoDoTurno` quando o agente é o Otto
   *    (ver conversation-artifact.test.ts). Continua necessária: feedback COM
   *    conteúdo ("Ficou genérico, refaz com outro ângulo.") passa pelo filtro
   *    e deve ir pra revisão do draft, não pro registro.
   */
  it('feedback vazio não registra nem aqui (filtro de relevância na fonte); o desvio do caller segue pra feedback com conteúdo', () => {
    expect(detectKnowledgeStatement('Ficou genérico.', 'Cliente Teste 7')).toBeNull();
    expect(detectKnowledgeStatement('Agora gostei.', 'Cliente Teste 7')).toBeNull();
    // Com conteúdo, a frase ainda SERIA registrada aqui — é por isso que o
    // caller continua precisando desviar antes.
    expect(detectKnowledgeStatement('Ficou genérico, refaz com outro ângulo.', 'Cliente Teste 7')).not.toBeNull();
  });

  /**
   * Achado real no E2E de release (22/09/2026, gate de CRUD contra "Cliente
   * Teste 7"): "troca o título dessa task pra 'X'" e "muda a prioridade
   * dessa task pra alta" não têm verbo de pedido reconhecido acima ("troca"/
   * "muda" são comuns demais pra excluir sozinhos, quebrariam o próprio caso
   * "Decidimos que a comunicação vai mudar..."), então CAÍAM aqui e viravam
   * "Registrado: ..." — o comando nunca chegava no guard determinístico do
   * Bento (execute-job.ts chama esta função ANTES de tryBentoActionGuard). O
   * que distingue os dois: comando operacional cita um CAMPO da task junto
   * com referência à task ("dessa task"); quem só ensina um fato não faz as
   * duas coisas ao mesmo tempo.
   */
  it('comando operacional sobre uma task ("dessa task" + campo) não é registro — precisa chegar no guard', () => {
    expect(detectKnowledgeStatement("troca o título dessa task pra 'Novo nome'", null)).toBeNull();
    expect(detectKnowledgeStatement('muda a prioridade dessa task pra alta', null)).toBeNull();
    expect(detectKnowledgeStatement("adiciona um comentário nessa task dizendo 'ok'", null)).toBeNull();
  });

  it('mas "decidimos que" sem referência a uma task específica continua registrando (o caso original preservado)', () => {
    const r = detectKnowledgeStatement('Decidimos que a prioridade agora é o cliente Cosentino.', null);
    expect(r).not.toBeNull();
  });
});
