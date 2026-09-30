import { describe, expect, it } from 'vitest';
import { decidirOrganizacao } from './organizacao-da-escrita';

/**
 * A ordem de precedência de quem é dono de uma linha nova.
 *
 * Contexto medido em 30/09/2026: a migração 0045 pôs `organization_id` nas seis
 * tabelas de conteúdo e fez o backfill. Poucas horas depois, `messages` já
 * tinha ido de 2 para 22 linhas sem organização — porque as escritas novas não
 * preenchiam o campo. Sem esta regra, cada dia de uso recria o problema que a
 * migração acabou de arrumar.
 */
const ORG_CLIENTE = 'org-cosentino';
const ORG_PESSOA = 'org-desigual';

describe('de quem é a linha que está sendo gravada', () => {
  /**
   * O CLIENTE VENCE, e não é detalhe: uma memória sobre a Cosentino é da
   * Cosentino mesmo quando quem escreveu é da Desigual — o caso do consultor
   * que atende a conta. Se a pessoa vencesse, o conhecimento do cliente ficaria
   * registrado na empresa do prestador.
   */
  it('cliente vence pessoa', () => {
    expect(decidirOrganizacao(ORG_CLIENTE, ORG_PESSOA)).toBe(ORG_CLIENTE);
  });

  it('sem cliente, vale a empresa de quem escreveu', () => {
    expect(decidirOrganizacao(null, ORG_PESSOA)).toBe(ORG_PESSOA);
  });

  it('só cliente também resolve', () => {
    expect(decidirOrganizacao(ORG_CLIENTE, null)).toBe(ORG_CLIENTE);
  });

  /**
   * NULO É RESPOSTA, NÃO FALHA. Existem 47 memórias legitimamente sem vínculo
   * (checklist diário, menção do ClickUp respondida). Carimbá-las com a
   * organização única de hoje seria gravar um palpite como fato — e no dia em
   * que existirem duas empresas, ninguém teria como distinguir o que foi
   * resolvido do que foi chutado.
   */
  it('sem vínculo nenhum, devolve null em vez de chutar', () => {
    expect(decidirOrganizacao(null, null)).toBeNull();
  });
});
