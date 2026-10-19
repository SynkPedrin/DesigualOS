import { describe, expect, it } from 'vitest';
import { ehPerguntaFactualSobreEntidade } from './pergunta-factual';

const COM_ENTIDADE = true;
const SEM_ENTIDADE = false;

describe('ehPerguntaFactualSobreEntidade — corpus de roteamento', () => {
  /**
   * AS CINCO DA BATERIA COSENTINO. Duas delas devolveram clarification em
   * runtime, com o cliente resolvido na própria requisição.
   */
  it.each([
    'Qual é o posicionamento da Cosentino?',
    'Como a Cosentino se posiciona em preço frente aos concorrentes?',
    'Que tipo de comunicação a Cosentino deve evitar?',
    'Há quantos anos a Cosentino atua?',
    'Qual é o segmento da Cosentino?',
  ])('é factual: %s', (q) => {
    expect(ehPerguntaFactualSobreEntidade(q, COM_ENTIDADE).ehFactual).toBe(true);
  });

  /**
   * ATRIBUTOS QUE NENHUMA LISTA PREVIU. É o teste que separa regra estrutural
   * de lista de palavras: se estes falharem, a lista voltou.
   */
  it.each([
    'Qual é a metodologia de aprovação da Colormaq?',
    'Quem assina os contratos da Elite?',
    'Qual o arquétipo principal da marca?',
    'Onde fica a sede da 3Net?',
    'Quando começou o contrato com a D. Carvalho?',
    'Me diz qual é a promessa central dessa conta',
    'O que distingue a Cosentino da concorrência?',
  ])('é factual sem nunca ter sido enumerado: %s', (q) => {
    expect(ehPerguntaFactualSobreEntidade(q, COM_ENTIDADE).ehFactual).toBe(true);
  });

  /**
   * SEM ENTIDADE, CLARIFICATION CONTINUA CERTA. Esta é a metade do requisito
   * que é fácil esquecer: o objetivo não é matar a clarification, é matá-la
   * onde ela não tinha o que fazer.
   */
  it.each([
    'Qual é o posicionamento?',
    'Quem é o decisor?',
    'E aquilo?',
    'Como está?',
  ])('NÃO decide sem entidade resolvida: %s', (q) => {
    const r = ehPerguntaFactualSobreEntidade(q, SEM_ENTIDADE);
    expect(r.ehFactual).toBe(false);
    expect(r.motivo).toBe('sem entidade resolvida');
  });

  /** Operacional tem fonte própria (ClickUp ao vivo) e não pode vir pro Brain. */
  it.each([
    'Qual o status da campanha de outubro da Cosentino?',
    'Quais tarefas da Cosentino estão atrasadas?',
    'Quando vence a entrega da Cosentino?',
    'Quais pendências existem na conta?',
  ])('operacional NÃO vira consulta ao Brain: %s', (q) => {
    const r = ehPerguntaFactualSobreEntidade(q, COM_ENTIDADE);
    expect(r.ehFactual).toBe(false);
    expect(r.motivo).toBe('pede estado operacional');
  });

  /** Mídia paga tem agente próprio. Mandar ao Bento já vazou dado de cliente. */
  it.each([
    'Qual foi o CPA da campanha da Cosentino?',
    'Quanto de investimento a Cosentino teve em anúncios?',
    'Qual o ROAS do mês?',
  ])('mídia paga NÃO vira consulta ao Brain: %s', (q) => {
    expect(ehPerguntaFactualSobreEntidade(q, COM_ENTIDADE).motivo).toBe('pede mídia paga');
  });

  /** Pedido de entrega não é consulta, mesmo em forma de pergunta. */
  it.each([
    'Qual legenda eu escrevo pra Cosentino?',
    'Que tipo de roteiro cria melhor resultado?',
    'Como faço um carrossel sobre isso?',
  ])('criação NÃO vira consulta ao Brain: %s', (q) => {
    expect(ehPerguntaFactualSobreEntidade(q, COM_ENTIDADE).motivo).toBe('pede criação');
  });

  it.each([
    'Cria um carrossel pra Cosentino',
    'Monta o briefing de outubro',
    'bom dia',
    'manda pro cliente',
  ])('imperativo não é pergunta factual: %s', (q) => {
    expect(ehPerguntaFactualSobreEntidade(q, COM_ENTIDADE).ehFactual).toBe(false);
  });
});
