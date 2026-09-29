import { describe, expect, it } from 'vitest';
import {
  MCP_ROLES, MCP_SCOPES, papelDaMembership, scopesDoPapel, scopesEfetivos, temScope,
} from './scopes';
import { exigirMesmaOrganizacao, exigirScope, montarPrincipal, McpAuthorizationError } from './principal';

const membership = (role: string | null) => ({
  userId: 'u1', organizationId: 'org1', employeeId: 'emp1',
  email: 'a@b.com', name: 'Alguém', role,
});

describe('scopes e papéis — o teto é o papel, nunca o token', () => {
  it('SUPER_ADMIN alcança todos os scopes', () => {
    expect(scopesDoPapel('SUPER_ADMIN')).toHaveLength(MCP_SCOPES.length);
  });

  it('VIEWER não lê memória nem tráfego', () => {
    const v = scopesDoPapel('VIEWER');
    expect(v).not.toContain('memory.read');
    expect(v).not.toContain('traffic.read');
    expect(v).toContain('tasks.read');
  });

  it('só SUPER_ADMIN e MANAGER escrevem cliente', () => {
    for (const role of MCP_ROLES) {
      const escreve = scopesDoPapel(role).includes('clients.write');
      expect(escreve, role).toBe(role === 'SUPER_ADMIN' || role === 'MANAGER');
    }
  });

  it('nenhum papel além de SUPER_ADMIN tem admin.read fora de MANAGER', () => {
    const comAdmin = MCP_ROLES.filter((r) => scopesDoPapel(r).includes('admin.read'));
    expect(comAdmin.sort()).toEqual(['MANAGER', 'SUPER_ADMIN']);
  });

  it('TOKEN AMPLO COM PAPEL RESTRITO DÁ ACESSO RESTRITO — a regra central', () => {
    // O criativo pede o mundo; recebe o que o papel dele permite.
    const efetivos = scopesEfetivos('CREATIVE', [...MCP_SCOPES]);
    expect(efetivos).not.toContain('traffic.read');
    expect(efetivos).not.toContain('clients.write');
    expect(efetivos).not.toContain('admin.read');
    expect(efetivos).toContain('assets.write');
  });

  it('token restrito com papel amplo dá acesso restrito (a interseção vale nos dois lados)', () => {
    expect(scopesEfetivos('SUPER_ADMIN', ['tasks.read'])).toEqual(['tasks.read']);
  });

  it('scope desconhecido no token é descartado, não propagado', () => {
    expect(scopesEfetivos('MANAGER', ['tasks.read', 'inventado.total'])).toEqual(['tasks.read']);
  });

  it('o guarda-chuva desigual.read cobre as leituras que o papel permite', () => {
    const p = scopesEfetivos('TRAFFIC_MANAGER', ['desigual.read']);
    expect(temScope(p, 'traffic.read')).toBe(true);
    expect(temScope(p, 'tasks.read')).toBe(true);
    // ... e não vaza para escrita
    expect(temScope(p, 'tasks.write')).toBe(false);
  });

  it('desigual.write não abre clients.write para quem o papel não permite', () => {
    const p = scopesEfetivos('CREATIVE', ['desigual.write']);
    expect(temScope(p, 'clients.write')).toBe(false);
  });
});

describe('papelDaMembership — o default não pode trancar nem escancarar', () => {
  it('reconhece os papéis nomeados, em qualquer caixa', () => {
    expect(papelDaMembership('super_admin')).toBe('SUPER_ADMIN');
    expect(papelDaMembership('Traffic Manager')).toBe('TRAFFIC_MANAGER');
    expect(papelDaMembership('QA')).toBe('QA');
  });

  it('`collaborator`, o default histórico da coluna, não vira VIEWER nem SUPER_ADMIN', () => {
    // Trancar a equipe fora ou dar tudo a ela são os dois erros óbvios aqui.
    expect(papelDaMembership('collaborator')).toBe('CUSTOMER_SUCCESS');
  });

  it('papel desconhecido cai no mais restrito', () => {
    expect(papelDaMembership('diretor de sei la')).toBe('VIEWER');
    expect(papelDaMembership(null)).toBe('VIEWER');
  });
});

describe('portas de autorização', () => {
  it('exigirScope lança com código legível em vez de devolver booleano ignorável', () => {
    const p = montarPrincipal(membership('CREATIVE'), ['desigual.read'], 's1');
    expect(() => exigirScope(p, 'traffic.read')).toThrow(McpAuthorizationError);
    try {
      exigirScope(p, 'traffic.read');
    } catch (e) {
      expect((e as McpAuthorizationError).code).toBe('SCOPE_MISSING');
      expect((e as McpAuthorizationError).message).toContain('CREATIVE');
    }
  });

  it('recurso de outra organização responde "não encontrei", nunca "sem permissão"', () => {
    // Confirmar a EXISTÊNCIA de um recurso de outro tenant já é vazamento.
    const p = montarPrincipal(membership('SUPER_ADMIN'), ['desigual.read'], 's1');
    try {
      exigirMesmaOrganizacao(p, 'org-de-outra-empresa');
      throw new Error('deveria ter lançado');
    } catch (e) {
      expect((e as McpAuthorizationError).code).toBe('OUT_OF_ORGANIZATION');
      expect((e as McpAuthorizationError).message).toBe('Não encontrei esse recurso.');
      expect((e as McpAuthorizationError).message).not.toMatch(/permiss/i);
    }
  });

  it('nem SUPER_ADMIN atravessa a fronteira de organização', () => {
    const p = montarPrincipal(membership('SUPER_ADMIN'), [...MCP_SCOPES], 's1');
    expect(() => exigirMesmaOrganizacao(p, 'outra')).toThrow(McpAuthorizationError);
    expect(() => exigirMesmaOrganizacao(p, 'org1')).not.toThrow();
  });

  it('o papel vem do BANCO, não do token — é o que faz revogação valer na hora', () => {
    // Mesmo token, papel rebaixado no banco: o acesso encolhe no próximo turno.
    const antes = montarPrincipal(membership('MANAGER'), ['clients.write'], 's1');
    const depois = montarPrincipal(membership('VIEWER'), ['clients.write'], 's1');
    expect(temScope(antes.scopes, 'clients.write')).toBe(true);
    expect(temScope(depois.scopes, 'clients.write')).toBe(false);
  });
});

/**
 * A INVARIANTE DA CASA, varrida à força bruta.
 *
 * O furo que este arquivo já pegou uma vez (guarda-chuva `desigual.read`
 * atravessando o teto de CREATIVE para alcançar `traffic.read`) não seria pego
 * por nenhum teste de exemplo — só por este, que não confia em ninguém lembrar
 * de escrever o caso certo.
 */
describe('INVARIANTE: nenhum token alcança fora do teto do papel', () => {
  it('para todo papel × todo pedido possível, o efetivo cabe no teto', () => {
    for (const role of MCP_ROLES) {
      const teto = new Set(scopesDoPapel(role));
      // Todo subconjunto seria 2^12; varre-se o pior caso (tudo) e cada scope
      // sozinho, que é onde guarda-chuva e expansão podem escapar.
      const pedidos: string[][] = [[...MCP_SCOPES], ...MCP_SCOPES.map((s) => [s])];
      for (const pedido of pedidos) {
        for (const efetivo of scopesEfetivos(role, pedido)) {
          expect(teto.has(efetivo), `${role} não deveria alcançar ${efetivo} pedindo ${pedido.join('+')}`).toBe(true);
        }
      }
    }
  });

  it('e temScope nunca aprova nada fora do efetivo', () => {
    for (const role of MCP_ROLES) {
      const efetivos = scopesEfetivos(role, [...MCP_SCOPES]);
      for (const scope of MCP_SCOPES) {
        expect(temScope(efetivos, scope), `${role} / ${scope}`).toBe(efetivos.includes(scope));
      }
    }
  });

  it('a saída é estável — o principal vai para log e para asserção', () => {
    const a = scopesEfetivos('MANAGER', ['tasks.read', 'desigual.read', 'memory.read']);
    const b = scopesEfetivos('MANAGER', ['memory.read', 'desigual.read', 'tasks.read']);
    expect(a).toEqual(b);
  });
});
