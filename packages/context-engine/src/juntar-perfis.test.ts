import { describe, expect, it } from 'vitest';
import { juntarPerfis } from './build-context';

/**
 * O QUE CHEGA AO BENTO SOBRE UM CLIENTE.
 *
 * Guarda de um defeito medido em 30/09/2026 que contradizia uma regra escrita
 * do projeto. O CLAUDE.md diz, sobre o registro criativo (brain) e o
 * operacional (dossiê): "Cada cliente tem até dois registros, que NÃO SE
 * SUBSTITUEM". O construtor de contexto fazia `.limit(1)` ordenado por data —
 * então o mais recente substituía o outro, em silêncio.
 *
 * Medido no Cosentino: três perfis ativos, 21.441 caracteres somados. Chegavam
 * 3.000, todos de UMA fonte. O dossiê — onde mora pendência, conta de mídia e
 * quem decide — nunca entrou num turno.
 */
const brain = { content: 'Tom de voz: direto. Não usar humor.', metadata: { subject: 'cliente:abc:brain' } };
const dossie = { content: 'Decisor: Marina. Conta de mídia 123.', metadata: { subject: 'cliente:abc:dossie' } };

describe('juntarPerfis', () => {
  it('sem registro nenhum devolve null, não string vazia', () => {
    // `null` faz o bloco inteiro sumir do prompt; '' empurraria um cabeçalho
    // "O que sabemos deste cliente:" seguido de nada, que parece ausência de
    // conhecimento quando é ausência de registro.
    expect(juntarPerfis([])).toBeNull();
  });

  /** O caso que motivou tudo: as duas fontes convivem. */
  it('brain e dossiê chegam JUNTOS, nenhum substitui o outro', () => {
    const texto = juntarPerfis([brain, dossie])!;

    expect(texto).toContain('Não usar humor');
    expect(texto).toContain('Decisor: Marina');
  });

  /**
   * Sem rótulo, uma restrição criativa ("não usar humor") e uma regra
   * operacional ("decisor é a Marina") viram o mesmo tipo de afirmação para
   * quem lê. São naturezas diferentes e o modelo precisa saber qual é qual.
   */
  it('cada fonte chega nomeada', () => {
    const texto = juntarPerfis([brain, dossie])!;

    expect(texto).toContain('Perfil criativo (brain)');
    expect(texto).toContain('Ficha operacional (dossiê)');
  });

  it('reconhece o que foi aprendido com a equipe', () => {
    const texto = juntarPerfis([{ content: 'x', metadata: { subject: 'cliente:abc:aprendizado:decisor' } }])!;

    expect(texto).toContain('Aprendido com a equipe');
  });

  it('registro sem subject não vira palpite de fonte', () => {
    const texto = juntarPerfis([{ content: 'x', metadata: null }])!;

    expect(texto).toContain('Registro do cliente');
  });

  /**
   * A REGRA QUE MAIS IMPORTA. Um modelo que lê um dossiê cortado sem aviso
   * responde com a confiança de quem leu tudo — e é assim que "não sei" vira
   * uma afirmação errada dita com segurança.
   */
  it('quando corta, AVISA que cortou', () => {
    const gigante = { content: 'a'.repeat(20_000), metadata: { subject: 'cliente:abc:brain' } };
    const texto = juntarPerfis([gigante])!;

    expect(texto).toContain('cortado por tamanho');
    expect(texto).toContain('há mais registrado');
  });

  /**
   * Quando a segunda fonte não cabe, ela é ANUNCIADA em vez de sumir. Some é
   * pior: o modelo conclui que não existe dossiê, quando existe e não coube.
   */
  it('fonte que não coube é declarada, não some', () => {
    const gigante = { content: 'a'.repeat(20_000), metadata: { subject: 'cliente:abc:brain' } };
    const texto = juntarPerfis([gigante, dossie])!;

    expect(texto).toContain('Ficha operacional (dossiê)');
    expect(texto).toContain('não coube neste turno');
  });

  /** O orçamento é compartilhado: duas fontes não podem somar o dobro do teto. */
  it('respeita o teto somando todas as fontes', () => {
    const texto = juntarPerfis([
      { content: 'a'.repeat(5000), metadata: { subject: 'cliente:abc:brain' } },
      { content: 'b'.repeat(5000), metadata: { subject: 'cliente:abc:dossie' } },
    ])!;

    // 7000 de conteúdo + rótulos. O que não pode é passar de 10k, que seria os
    // dois inteiros — sinal de que o orçamento não foi compartilhado.
    expect(texto.length).toBeLessThan(8000);
  });
});
