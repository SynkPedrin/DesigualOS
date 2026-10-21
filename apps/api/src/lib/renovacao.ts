/**
 * RENOVAÇÃO EM SEGUNDO PLANO dos caches curtos por pessoa (acesso, vínculos,
 * empresa ativa, módulos).
 *
 * Antes: passou o TTL, a próxima requisição daquela pessoa esperava a releitura
 * — de 2 a 7 consultas, ~0,5 a 1,3 s até o Supabase em us-east-1 — e isso
 * acontecia em TODA rota, a cada 20–30 s. Era o p95 da Comunicação (medido no
 * Hub 2.1: envio p50 265 ms, p95 1,3 s só por causa disto).
 *
 * Agora: passou o TTL, a requisição usa o valor que já tinha e dispara a
 * releitura sem esperar. O prazo para uma mudança valer continua o mesmo TTL
 * (mais uma requisição); acima de `LIMITE_DO_VALOR_VELHO_MS` sem uso, a entrada
 * não serve mais e a leitura volta a ser síncrona. Mudança feita por esta API
 * (papel, vínculo, workspace, desativação) continua apagando a entrada na hora —
 * e uma releitura que estava em andamento NÃO grava por cima do apagamento.
 */
export const LIMITE_DO_VALOR_VELHO_MS = 2 * 60_000;

const emAndamento = new Set<string>();

/**
 * Roda `releitura` uma vez por chave (duas requisições ao mesmo tempo não
 * disparam duas releituras). Falha é silenciosa: o valor velho continua até o
 * limite, e depois disso a leitura síncrona mostra o erro de verdade.
 */
export function renovarEmSegundoPlano(chave: string, releitura: () => Promise<void>): void {
  if (emAndamento.has(chave)) return;
  emAndamento.add(chave);
  void releitura().catch(() => undefined).finally(() => emAndamento.delete(chave));
}
