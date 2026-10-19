import { describe, expect, it } from 'vitest';
import {
  avaliarAusencia,
  coberturaDoTopico,
  respostaDeUltimoRecurso,
  topicosDaPergunta,
  trechosDeAusencia,
} from './guarda-de-ausencia';
import type { RegistroDeEvidencia } from './context-assembler';

/**
 * As frases abaixo NÃO são inventadas: são as respostas que o Bento produziu
 * nas execuções medidas em 01/10/2026, com o dossiê da Cosentino no prompt.
 */
const DOSSIE_COSENTINO: RegistroDeEvidencia = {
  fonte: 'cliente',
  sourceType: 'memory',
  sourceId: 'mem-cosentino-brain',
  clientId: 'cli-cosentino',
  confidence: 0.9,
  citavel: true,
  texto: [
    '# BRAIN — COSENTINO (JARDIM EUROPA V)',
    '> Última atualização: 14/09/2026 · Responsável: `[FALTA]`',
    '',
    '## 2. POSICIONAMENTO',
    'Este é o brain com posicionamento mais bem definido da carteira.',
    'Imobiliário premium regional. Preço no mínimo 10% acima da concorrência,',
    'sustentado pelo legado de 47 anos. Nada de urgência, desconto ou apelo de preço.',
  ].join('\n'),
};

function evidenciaDeTarefas(): RegistroDeEvidencia {
  return {
    fonte: 'campanha',
    sourceType: 'clickup',
    sourceId: 'lista-123',
    clientId: 'cli-cosentino',
    confidence: 1,
    citavel: true,
    texto: 'DADOS AO VIVO DO CLICKUP: 14 tarefas atrasadas, 19 sem responsável.',
  };
}

describe('trechosDeAusencia — reconhece a negativa que de fato aconteceu', () => {
  it.each([
    'Não tenho dados no briefing sobre posicionamento da Cosentino.',
    'O dado não traz o posicionamento oficial nem a diretriz de comunicação.',
    'O Dossiê Real listado como [REGISTRO CRIATIVO] está vazio e marcado com [FALTA].',
    'Não encontrei isso nas fontes. Registrei a lacuna para a curadoria.',
    'Impossível responder. Não há informação sobre o decisor disponível.',
    'Não há dados no sistema sobre Tom de voz ou Mensagem principal.',
  ])('acusa: %s', (frase) => {
    expect(trechosDeAusencia(frase).length).toBeGreaterThan(0);
  });

  /**
   * NEGATIVA DE CONTEÚDO NÃO É NEGATIVA DE REGISTRO. "A marca não usa
   * urgência" é exatamente o que o dossiê manda responder — se o guarda
   * acusasse isso, ele bloquearia a resposta certa.
   */
  it.each([
    'A comunicação premium exclui urgência: a marca não usa contagem regressiva.',
    'O posicionamento é premium regional, com preço 10% acima da concorrência.',
    'Nada de urgência, desconto ou apelo de preço.',
  ])('não acusa resposta legítima: %s', (frase) => {
    expect(trechosDeAusencia(frase)).toEqual([]);
  });
});

describe('topicosDaPergunta — regra estrutural, não lista de palavras', () => {
  it('extrai o atributo perguntado sem precisar conhecê-lo de antemão', () => {
    expect(topicosDaPergunta('Qual é o posicionamento da Cosentino?')).toEqual(['posicionamento']);
    expect(topicosDaPergunta('Quem é o decisor do Cliente Teste 7?')).toEqual(['decisor']);
    expect(topicosDaPergunta('Qual a praça da 3Net?')).toEqual(['praca']);
  });

  /**
   * O ponto da regra estrutural: um atributo que NINGUÉM enumerou numa lista
   * precisa funcionar igual, senão a lista volta a crescer para sempre.
   */
  it('funciona para atributo que nenhuma lista previu', () => {
    expect(topicosDaPergunta('Qual é a metodologia de aprovação da Colormaq?')).toContain('metodologia');
    expect(topicosDaPergunta('Qual o arquétipo principal da marca?')).toContain('arquetipo');
  });

  it('pergunta não-factual não produz tópico, e o guarda não opina sobre ela', () => {
    expect(topicosDaPergunta('Cria um carrossel pra Cosentino')).toEqual([]);
    expect(topicosDaPergunta('bom dia')).toEqual([]);
  });

  it('descarta palavra genérica demais, que casaria com qualquer dossiê', () => {
    expect(topicosDaPergunta('Qual é o cliente da vez?')).not.toContain('cliente');
  });
});

describe('coberturaDoTopico — confere contra o que foi ENTREGUE ao modelo', () => {
  it('acha o tópico no dossiê e guarda o trecho para poder citá-lo', () => {
    const c = coberturaDoTopico('posicionamento', [DOSSIE_COSENTINO]);
    expect(c.coberto).toBe(true);
    expect(c.fonte).toBe('memory');
    expect(c.trecho).toMatch(/POSICIONAMENTO/i);
  });

  it('tópico ausente das evidências não é coberto', () => {
    expect(coberturaDoTopico('orcamento', [DOSSIE_COSENTINO]).coberto).toBe(false);
  });
});

describe('avaliarAusencia — o veredicto', () => {
  /**
   * O CASO COSENTINO. Esta é a combinação exata que aconteceu cinco vezes em
   * nove: a resposta nega, e a evidência entregue contém o que ela nega.
   */
  it('REPROVA quando a resposta nega e a evidência entregue cobre o tópico', () => {
    const v = avaliarAusencia({
      pergunta: 'Qual é o posicionamento da Cosentino?',
      resposta: 'Não tenho dados no briefing sobre posicionamento da Cosentino.',
      evidencias: [DOSSIE_COSENTINO, evidenciaDeTarefas()],
    });
    expect(v.aprovada).toBe(false);
    expect(v.afirmacoesDeAusencia.length).toBeGreaterThan(0);
    expect(v.cobertos.map((c) => c.topico)).toEqual(['posicionamento']);
  });

  it('APROVA a resposta correta sobre o mesmo tópico e a mesma evidência', () => {
    const v = avaliarAusencia({
      pergunta: 'Qual é o posicionamento da Cosentino?',
      resposta:
        'O posicionamento é imobiliário premium regional, com preço 10% acima da concorrência e legado de 47 anos.',
      evidencias: [DOSSIE_COSENTINO],
    });
    expect(v.aprovada).toBe(true);
  });

  /**
   * AUSÊNCIA HONESTA CONTINUA PASSANDO. Sem isto o guarda forçaria o modelo a
   * inventar quando de fato não há fonte — trocaria falsa ausência por
   * invenção, que é pior.
   */
  it('APROVA negativa quando NÃO há evidência sobre o tópico', () => {
    const v = avaliarAusencia({
      pergunta: 'Qual é o orçamento de mídia da Cosentino?',
      resposta: 'Não tenho dados sobre o orçamento de mídia desta conta.',
      evidencias: [DOSSIE_COSENTINO],
    });
    expect(v.aprovada).toBe(true);
    expect(v.descobertos).toContain('orcamento');
  });

  it('não opina sobre pergunta que não é factual', () => {
    const v = avaliarAusencia({
      pergunta: 'Cria três títulos pra Cosentino',
      resposta: 'Não tenho dados suficientes.',
      evidencias: [DOSSIE_COSENTINO],
    });
    expect(v.aprovada).toBe(true);
  });
});

describe('respostaDeUltimoRecurso', () => {
  it('cita o registro sem reescrever, e diz de onde veio', () => {
    const c = coberturaDoTopico('posicionamento', [DOSSIE_COSENTINO]);
    const texto = respostaDeUltimoRecurso([c]);
    expect(texto).toMatch(/POSICIONAMENTO/i);
    expect(texto).toMatch(/premium regional/i);
    expect(trechosDeAusencia(texto)).toEqual([]);
  });
});
