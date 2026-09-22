import { defineConfig } from 'vitest/config';

/**
 * Único ajuste: o teto de tempo por teste.
 *
 * O default do vitest é 5s, dimensionado para um teste que já está carregado.
 * Vários testes daqui começam com `await import('./algum-processador.js')`, e
 * esse primeiro import puxa um grafo de módulos grande (database, orchestrator,
 * tool-gateway, context-engine). Rodando o pacote sozinho isso leva
 * milissegundos; rodando pelo turbo, com os 14 pacotes em paralelo na mesma
 * máquina, o mesmo import disputa CPU com todos os outros e passa dos 5s.
 *
 * Medido no portão de release de 18/09/2026:
 * `src/scheduler/integration-health.test.ts` falhou por "Test timed out in
 * 5000ms" dentro do `pnpm test` do repositório e passou TRÊS vezes seguidas
 * rodando `pnpm vitest run` só neste pacote. É um teste de puro mock, sem rede
 * nem banco - não havia nada de lento nele para consertar.
 *
 * Nenhuma asserção muda. O que muda é parar de reportar contenção de CPU do
 * agendador do sistema operacional como falha de produto: teste que pisca é
 * pior que teste que falta, porque ensina a equipe a ignorar vermelho.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
  },
});
