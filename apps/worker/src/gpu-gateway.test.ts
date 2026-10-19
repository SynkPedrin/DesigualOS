import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Teste de verdade contra dois servidores HTTP reais: o defeito que ele cobre
 * só existe no acoplamento entre socket do cliente, vaga do controle de
 * admissão e requisição de saída — nenhum mock reproduziria isso.
 */

/** Upstream que ACEITA e nunca responde: é assim que uma GPU ocupada se parece. */
let upstream: Server;
let upstreamPorta = 0;
let pedidosAbandonados = 0;

let gateway: Server;
let gatewayPorta = 0;
let controle: { telemetria: () => { emExecucao: number; naFila: number } };

/**
 * ESPERAR O SERVIDOR OUVIR, em vez de dormir 200ms torcendo.
 *
 * O preparo deste teste dormia um tempo fixo depois de subir o gateway e
 * seguia em frente. Em máquina ociosa 200ms sobram; em máquina carregada —
 * build, navegador e o resto da suíte disputando CPU — não, e o `beforeAll`
 * inteiro estourava o teto de 10s. Medido duas vezes em 08/10/2026, nas duas
 * execuções seguidas do portão de release, sempre num teste DIFERENTE: o
 * sintoma era aleatório porque a causa era contenção, não código.
 *
 * Teste que falha por ruído ensina a equipe a ignorar vermelho, e esse é o
 * dano que sobra depois — o próximo vermelho pode ser de verdade.
 *
 * Agora o preparo pergunta ao sistema operacional se a porta aceita conexão,
 * em vez de supor. Fica mais RÁPIDO na máquina ociosa (segue assim que o
 * servidor sobe, sem esperar os 200ms) e paciente na carregada. O teto do
 * hook subiu junto porque o `import()` dinâmico do orchestrator é pesado e
 * também compete por CPU.
 */
async function esperarOuvindo(porta: number, limiteMs = 15_000): Promise<void> {
  const ate = Date.now() + limiteMs;
  for (;;) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = connect({ port: porta, host: '127.0.0.1' });
      const encerrar = (valor: boolean) => {
        socket.destroy();
        resolve(valor);
      };
      socket.once('connect', () => encerrar(true));
      socket.once('error', () => encerrar(false));
      socket.setTimeout(500, () => encerrar(false));
    });
    if (ok) return;
    if (Date.now() > ate) throw new Error(`porta ${porta} não começou a ouvir em ${limiteMs}ms`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  upstream = createServer((req, res) => {
    req.on('close', () => {
      if (!res.writableEnded) pedidosAbandonados += 1;
    });
    // Sem res.end(): segura a conexão como uma geração longa seguraria.
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  upstreamPorta = (upstream.address() as AddressInfo).port;

  gatewayPorta = 20_000 + Math.floor(Math.random() * 20_000);
  process.env.GPU_UPSTREAM_URL = `http://127.0.0.1:${upstreamPorta}`;
  process.env.GPU_GATEWAY_PORT = String(gatewayPorta);
  process.env.MAX_GPU_STRONG_CONCURRENCY = '1';

  const { iniciarGpuGateway } = await import('./gpu-gateway.js');
  const { controleDeAdmissaoDaGpu } = await import('@desigual-os/orchestrator');
  controle = controleDeAdmissaoDaGpu();
  gateway = iniciarGpuGateway();
  await esperarOuvindo(gatewayPorta);
  await esperarOuvindo(upstreamPorta);
}, 30_000);

afterAll(async () => {
  gateway?.close();
  upstream?.close();
});

const corpoDeChat = JSON.stringify({ model: 'x', messages: [{ role: 'user', content: 'oi' }] });

describe('gpu_gateway_desistencia_devolve_vaga', () => {
  it('cliente que desiste não segura a única vaga da GPU', async () => {
    const abortar = new AbortController();

    const pedido = fetch(`http://127.0.0.1:${gatewayPorta}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Desigual-Caller': 'impaciente' },
      body: corpoDeChat,
      signal: abortar.signal,
    }).catch(() => 'abortado' as const);

    await new Promise((r) => setTimeout(r, 300));
    expect(controle.telemetria().emExecucao).toBe(1);

    abortar.abort();
    await pedido;
    await new Promise((r) => setTimeout(r, 300));

    // O ponto do teste: sem isto, a vaga ficaria presa até o teto de 240s do
    // proxy e a placa inteira ficaria bloqueada por quem já foi embora.
    expect(controle.telemetria().emExecucao).toBe(0);
    expect(pedidosAbandonados).toBeGreaterThan(0);
  }, 20_000);

  it('a vaga devolvida serve o próximo da fila em vez de expirar sozinha', async () => {
    const primeiro = new AbortController();
    const p1 = fetch(`http://127.0.0.1:${gatewayPorta}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Desigual-Caller': 'primeiro' },
      body: corpoDeChat,
      signal: primeiro.signal,
    }).catch(() => 'abortado' as const);

    await new Promise((r) => setTimeout(r, 200));

    const segundo = new AbortController();
    const p2 = fetch(`http://127.0.0.1:${gatewayPorta}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Desigual-Caller': 'segundo' },
      body: corpoDeChat,
      signal: segundo.signal,
    }).catch(() => 'abortado' as const);

    await new Promise((r) => setTimeout(r, 300));
    expect(controle.telemetria()).toMatchObject({ emExecucao: 1, naFila: 1 });

    primeiro.abort();
    await p1;
    await new Promise((r) => setTimeout(r, 400));

    expect(controle.telemetria()).toMatchObject({ emExecucao: 1, naFila: 0 });

    segundo.abort();
    await p2;
  }, 20_000);
});

describe('gpu_gateway_rotas', () => {
  it('rota desconhecida não entra na fila da GPU', async () => {
    const r = await fetch(`http://127.0.0.1:${gatewayPorta}/api/embeddings`, { method: 'POST', body: '{}' });
    expect(r.status).toBe(404);
    expect(controle.telemetria().emExecucao).toBe(0);
  });

  it('/admission responde sem consumir vaga', async () => {
    const r = await fetch(`http://127.0.0.1:${gatewayPorta}/admission`);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { status: string };
    expect(j.status).toBe('ok');
    expect(controle.telemetria().emExecucao).toBe(0);
  });
});
