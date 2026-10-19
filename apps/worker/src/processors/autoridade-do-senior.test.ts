import { describe, expect, it } from 'vitest';
import { decidirEmpresaDoSenior, explicarFaltaDeAutoridade } from './senior-runtime-context';

/**
 * "BENTO FINALIZE TODAS AS TASKS ATRIBUIDAS A PEDRO GABRIEL" respondia
 * "Não consegui confirmar sua permissão pra essa ação agora", em 08/10/2026.
 * A pessoa confirmou de novo, em maiúsculas, e recebeu a mesma frase.
 *
 * A permissão estava inteira. Faltava EMPRESA: a conta pertence a duas,
 * nenhuma estava aberta, e o pedido não citava cliente. A escada parava em
 * "vínculo único" e desistia — e a desistência era relatada como permissão.
 */
const CASA = 'org-provedora';
const CLIENTE = 'org-cliente';
const OUTRA = 'org-outra';

const base = {
  empresaDoCliente: null,
  organizacaoAtivaId: null,
  vinculos: [CASA, OUTRA],
  ehPapelDePlataforma: false,
  provedora: CASA,
};

describe('decidirEmpresaDoSenior', () => {
  it('cliente da execução manda: quem fala de um cliente fala da empresa dele', () => {
    expect(decidirEmpresaDoSenior({ ...base, empresaDoCliente: CLIENTE, vinculos: [CASA, CLIENTE] })).toBe(CLIENTE);
  });

  it('sem cliente, a empresa ABERTA decide', () => {
    expect(decidirEmpresaDoSenior({ ...base, organizacaoAtivaId: OUTRA })).toBe(OUTRA);
  });

  it('vínculo único não tem o que decidir', () => {
    expect(decidirEmpresaDoSenior({ ...base, vinculos: [OUTRA] })).toBe(OUTRA);
  });

  /** O caso exato do relato. */
  it('duas empresas, nenhuma aberta, papel de plataforma: age pela casa', () => {
    expect(decidirEmpresaDoSenior({ ...base, ehPapelDePlataforma: true })).toBe(CASA);
  });

  /**
   * A cerca que impede o degrau 4 de virar porta dos fundos: sem papel de
   * plataforma, pertencer à provedora NÃO basta. Senão qualquer colaborador
   * com vínculo na casa escreveria em nome dela sem que ninguém decidisse
   * isso.
   */
  it('duas empresas, nenhuma aberta, papel comum: continua ambíguo', () => {
    expect(decidirEmpresaDoSenior({ ...base, ehPapelDePlataforma: false })).toBeNull();
  });

  it('empresa ativa que a pessoa NÃO é mais membro é ignorada', () => {
    // Vínculo removido depois de a pessoa ter aberto a empresa: o que está
    // salvo no banco vira permissão vencida se for aceito sem conferir.
    expect(decidirEmpresaDoSenior({ ...base, organizacaoAtivaId: 'org-que-sai', ehPapelDePlataforma: true })).toBe(CASA);
  });

  it('cliente de empresa alheia não autoriza, mesmo vindo da execução', () => {
    expect(decidirEmpresaDoSenior({ ...base, empresaDoCliente: 'org-alheia', vinculos: [OUTRA] })).toBe(OUTRA);
  });

  it('plataforma sem vínculo na provedora não inventa autorização', () => {
    expect(decidirEmpresaDoSenior({ ...base, ehPapelDePlataforma: true, vinculos: [OUTRA, 'org-x'] })).toBeNull();
  });
});

describe('explicarFaltaDeAutoridade', () => {
  /**
   * O motivo da frase existir: "sem permissão" manda procurar um
   * administrador; "escolha a empresa" se resolve em dois cliques. A mensagem
   * precisa dizer QUAL dos dois é.
   */
  it('empresa ambígua diz o que fazer, e não fala em permissão', () => {
    const frase = explicarFaltaDeAutoridade('empresa-ambigua');
    expect(frase).toMatch(/mais de uma empresa/i);
    expect(frase).toMatch(/Empresas|cliente/);
    expect(frase).not.toMatch(/permiss/i);
  });

  it('cada motivo tem frase própria — nenhum cai num texto genérico', () => {
    const motivos = ['execucao-desconhecida', 'agente-sem-escrita', 'pessoa-inativa', 'sem-vinculo', 'empresa-ambigua'] as const;
    const frases = motivos.map(explicarFaltaDeAutoridade);
    expect(new Set(frases).size).toBe(motivos.length);
    for (const f of frases) expect(f.length).toBeGreaterThan(20);
  });
});
