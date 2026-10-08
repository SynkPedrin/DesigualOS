import { describe, expect, it } from 'vitest';
import { chaveDaConsulta, type ConsultaDeWorkspace } from './routes';

/**
 * A CHAVE DO CACHE É A FRONTEIRA ENTRE EMPRESAS.
 *
 * `/clickup/tasks/agency` levava 7,71s em produção (mediana de três chamadas,
 * 08/10/2026) e passou a ser servido de cache. Cache compartilhado é rápido
 * pelo mesmo motivo que é perigoso: se duas consultas diferentes colidirem na
 * chave, uma empresa recebe as tarefas da outra — e recebe rápido.
 *
 * O que entra na chave é tudo que muda a RESPOSTA DO CLICKUP: workspace,
 * credencial e listas pedidas. O recorte por pessoa não entra porque não
 * acontece aqui: ele é aplicado depois, no `wireOperationTask`, com o mapa de
 * clientes de quem perguntou.
 */
function consulta(parcial: Partial<ConsultaDeWorkspace> = {}): ConsultaDeWorkspace {
  return { config: { apiKey: 'pk_aaa', teamId: 'team-1' }, listIds: undefined, ...parcial };
}

describe('chaveDaConsulta', () => {
  it('mesma consulta, mesma chave (é isto que faz o cache acertar)', () => {
    expect(chaveDaConsulta(consulta())).toBe(chaveDaConsulta(consulta()));
  });

  it('workspace diferente nunca compartilha entrada', () => {
    expect(chaveDaConsulta(consulta({ config: { apiKey: 'pk_aaa', teamId: 'team-1' } })))
      .not.toBe(chaveDaConsulta(consulta({ config: { apiKey: 'pk_aaa', teamId: 'team-2' } })));
  });

  it('credencial diferente nunca compartilha entrada, mesmo no mesmo workspace', () => {
    expect(chaveDaConsulta(consulta({ config: { apiKey: 'pk_aaa', teamId: 'team-1' } })))
      .not.toBe(chaveDaConsulta(consulta({ config: { apiKey: 'pk_bbb', teamId: 'team-1' } })));
  });

  it('workspace inteiro e recorte por listas são consultas diferentes', () => {
    expect(chaveDaConsulta(consulta({ listIds: undefined })))
      .not.toBe(chaveDaConsulta(consulta({ listIds: ['900'] })));
  });

  it('conjuntos de listas diferentes não colidem', () => {
    expect(chaveDaConsulta(consulta({ listIds: ['900', '901'] })))
      .not.toBe(chaveDaConsulta(consulta({ listIds: ['900', '902'] })));
  });

  /** A ORDEM das listas é acidente de montagem do plano, não diferença real. */
  it('a mesma lista em ordem diferente é a MESMA consulta', () => {
    expect(chaveDaConsulta(consulta({ listIds: ['901', '900'] })))
      .toBe(chaveDaConsulta(consulta({ listIds: ['900', '901'] })));
  });

  /** Chave de cache não é lugar de carregar segredo, nem em memória. */
  it('a credencial não aparece em texto na chave', () => {
    expect(chaveDaConsulta(consulta({ config: { apiKey: 'pk_segredo_literal', teamId: 'team-1' } })))
      .not.toContain('pk_segredo_literal');
  });
});
