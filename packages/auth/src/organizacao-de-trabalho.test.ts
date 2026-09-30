import { describe, expect, it } from 'vitest';
import { decidirOrganizacaoDeTrabalho, type FatosDaEscolha } from './organizacao-de-trabalho';

const DESIGUAL = 'b534f65c-bbc6-4a95-8c53-d785a1b7839a';
const COSENTINO = 'fe737d1d-7b5e-4788-bc64-b96c31a8ca7e';
const TERCEIRA = '11111111-2222-3333-4444-555555555555';

function fatos(p: Partial<FatosDaEscolha> = {}): FatosDaEscolha {
  return { pedida: null, ativa: null, vinculos: [DESIGUAL], provedora: DESIGUAL, ehProvider: false, ...p };
}

describe('organização de trabalho', () => {
  /**
   * O CASO QUE QUEBROU EM PRODUÇÃO, e o motivo deste arquivo existir.
   *
   * A fábrica de empresas vincula quem cria à empresa criada. A regra antiga
   * contava vínculos e exigia exatamente um, então criar a segunda empresa
   * derrubava a tela de Clientes inteira de quem a criou — inclusive a carteira
   * antiga, que não tinha nada a ver com a empresa nova.
   */
  it('quem opera a plataforma e cria uma empresa cliente continua na plataforma', () => {
    const r = decidirOrganizacaoDeTrabalho(
      fatos({ vinculos: [DESIGUAL, COSENTINO], ativa: null, ehProvider: true }),
    );
    expect(r).toEqual({ ok: true, organizationId: DESIGUAL });
  });

  it('quem abriu uma empresa trabalha DENTRO dela, não na de origem', () => {
    const r = decidirOrganizacaoDeTrabalho(
      fatos({ vinculos: [DESIGUAL, COSENTINO], ativa: COSENTINO, ehProvider: true }),
    );
    expect(r).toEqual({ ok: true, organizationId: COSENTINO });
  });

  it('um vínculo só resolve sozinho — ninguém precisa escolher nada', () => {
    expect(decidirOrganizacaoDeTrabalho(fatos())).toEqual({ ok: true, organizationId: DESIGUAL });
  });

  it('sem vínculo nenhum não há onde trabalhar', () => {
    expect(decidirOrganizacaoDeTrabalho(fatos({ vinculos: [] }))).toEqual({
      ok: false,
      motivo: 'sem-vinculo',
    });
  });

  /**
   * O cabeçalho é um PEDIDO, nunca uma autorização. Se bastasse mandar o id,
   * a barra de endereço viraria a fronteira entre empresas.
   */
  it('o cabeçalho não entra numa empresa de que a pessoa não é membro', () => {
    expect(decidirOrganizacaoDeTrabalho(fatos({ pedida: COSENTINO }))).toEqual({
      ok: false,
      motivo: 'nao-pode-entrar',
    });
  });

  it('o provedor atende qualquer empresa, mesmo sem vínculo nela', () => {
    expect(
      decidirOrganizacaoDeTrabalho(fatos({ pedida: COSENTINO, ehProvider: true })),
    ).toEqual({ ok: true, organizationId: COSENTINO });
  });

  it('o cabeçalho manda mais que a empresa aberta — é o pedido daquela requisição', () => {
    const r = decidirOrganizacaoDeTrabalho(
      fatos({ pedida: DESIGUAL, ativa: COSENTINO, vinculos: [DESIGUAL, COSENTINO] }),
    );
    expect(r).toEqual({ ok: true, organizationId: DESIGUAL });
  });

  /**
   * A empresa ativa pode ter sido perdida entre a entrada e agora (a pessoa foi
   * removida da empresa). Nesse caso ela não vira o contexto de trabalho — cai
   * para os degraus seguintes em vez de virar permissão vencida guardada no banco.
   */
  it('empresa ativa sem vínculo atual não vale como contexto', () => {
    const r = decidirOrganizacaoDeTrabalho(fatos({ ativa: COSENTINO, vinculos: [DESIGUAL] }));
    expect(r).toEqual({ ok: true, organizationId: DESIGUAL });
  });

  /**
   * Duas empresas, nenhuma é a provedora, nenhuma aberta: aqui perguntar é a
   * resposta honesta. Chutar a primeira linha gravaria cliente na empresa
   * errada, em silêncio — que é pior que uma tela pedindo para escolher.
   */
  it('sem critério nenhum, pergunta em vez de chutar a primeira linha', () => {
    const r = decidirOrganizacaoDeTrabalho(
      fatos({ vinculos: [COSENTINO, TERCEIRA], provedora: DESIGUAL }),
    );
    expect(r).toEqual({ ok: false, motivo: 'precisa-escolher' });
  });

  /**
   * DEFAULT SEGURO, igual ao de `escopo-de-organizacao`: sem
   * `PROVIDER_ORGANIZATION_ID` configurado ninguém herda a provedora por
   * dedução. O degrau 4 simplesmente não acontece.
   */
  it('sem provedora configurada, o degrau da plataforma não existe', () => {
    const r = decidirOrganizacaoDeTrabalho(
      fatos({ vinculos: [DESIGUAL, COSENTINO], provedora: null }),
    );
    expect(r).toEqual({ ok: false, motivo: 'precisa-escolher' });
  });
});
