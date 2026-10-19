/**
 * O ESTADO DO CONJUNTO DE INTEGRAÇÕES — e por que "saúde" aqui é delicado.
 *
 * O mockup (assets/TELASS - TUTORIAL/tela-integrações.png) mostra "Saúde das
 * integrações: Excelente · 100% operacionais" com quatro de doze conectadas.
 * Essa conta não fecha: 100% do quê? Se for das conectadas, é tautologia —
 * conectada está conectada. E numa tela de integração, verde por omissão é a
 * mentira mais fácil de contar, porque ninguém vai conferir.
 *
 * Aqui a saúde mede o que de fato tem conserto: entre as integrações que o
 * ambiente CONSEGUE conectar (configuradas), quantas estão conectadas. Uma
 * integração sem variável de ambiente não é "problema de saúde" — é trabalho
 * de administrador que ainda não aconteceu, e misturar as duas coisas esconde
 * as duas.
 */
export type EstadoDaIntegracao = { connected: boolean; configured: boolean } | undefined;

export interface SaudeDasIntegracoes {
  total: number;
  conectadas: number;
  /** Configuradas e ainda não conectadas: alguém clica e resolve. */
  prontas: number;
  /** Sem configuração no ambiente: depende de administrador, não de clique. */
  semConfiguracao: number;
  /** Fração das CONECTÁVEIS (conectadas + prontas) que estão conectadas. `null` quando não há nenhuma. */
  proporcao: number | null;
  rotulo: 'Tudo conectado' | 'Parcial' | 'Nada conectado' | 'Sem configuração';
}

export function saudeDasIntegracoes(estados: readonly EstadoDaIntegracao[]): SaudeDasIntegracoes {
  const conhecidos = estados.filter((e): e is NonNullable<EstadoDaIntegracao> => e !== undefined);
  const conectadas = conhecidos.filter((e) => e.connected);
  /**
   * Conectada conta como configurada mesmo se `configured` vier falso.
   *
   * O par (connected: true, configured: false) existe de verdade: basta alguém
   * tirar a variável de ambiente depois que a conexão já foi feita. Tratando
   * os dois campos como independentes, `prontas` virava -1 e a proporção
   * passava de 100% — a tela reportaria mais conectadas do que conectáveis.
   *
   * O que está conectado prova que era conectável, então ele entra no
   * denominador. A falta da variável segue aparecendo, mas como o que é:
   * configuração ausente numa integração que ainda funciona, não um número
   * negativo.
   */
  const prontas = conhecidos.filter((e) => e.configured && !e.connected);
  const conectaveis = conectadas.length + prontas.length;

  const proporcao = conectaveis > 0 ? conectadas.length / conectaveis : null;

  /**
   * O rótulo nunca é otimista por falta de dado. Sem nenhuma integração
   * configurada, a resposta é "Sem configuração" — não "Excelente", que é o
   * que uma média sobre conjunto vazio produziria.
   */
  const rotulo: SaudeDasIntegracoes['rotulo'] =
    proporcao === null ? 'Sem configuração' : proporcao === 1 ? 'Tudo conectado' : proporcao === 0 ? 'Nada conectado' : 'Parcial';

  return {
    total: conhecidos.length,
    conectadas: conectadas.length,
    prontas: prontas.length,
    semConfiguracao: conhecidos.filter((e) => !e.configured && !e.connected).length,
    proporcao,
    rotulo,
  };
}
