import { createServer, type Server } from 'node:http';
import { cpus, freemem, totalmem } from 'node:os';
import { statfsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { createLogger } from '@desigual-os/logging';

const logger = createLogger({ service: 'studio-node-metrics' });

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Endpoint de métricas da máquina da GPU.
 *
 * O studio-node é um worker BullMQ puro e não expõe HTTP nenhum, então a
 * sonda do Orchestrator não tinha como ler CPU/disco/temperatura de verdade
 * (o ComfyUI só informa RAM/VRAM/fila). Este servidor mínimo existe só pra
 * isso: GET /metrics devolve a máquina inteira em um JSON.
 */

interface MachineMetrics {
  cpu: number;
  ram: number;
  disk: number;
  gpu: number | null;
  temperature: number | null;
}

interface CpuTicks {
  idle: number;
  total: number;
}

function sampleCpuTicks(): CpuTicks {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

function measureCpuPercent(sampleWindowMs: number): Promise<number> {
  const start = sampleCpuTicks();
  return new Promise((resolvePromise) => {
    setTimeout(() => {
      const end = sampleCpuTicks();
      const idleDelta = end.idle - start.idle;
      const totalDelta = end.total - start.total;
      const usedPercent = totalDelta === 0 ? 0 : (1 - idleDelta / totalDelta) * 100;
      resolvePromise(Math.round(Math.max(0, Math.min(100, usedPercent))));
    }, sampleWindowMs);
  });
}

function measureRamPercent(): number {
  const used = totalmem() - freemem();
  return Math.round((used / totalmem()) * 100);
}

function measureDiskPercent(path = '/'): number {
  const stats = statfsSync(path);
  const used = stats.blocks - stats.bfree;
  return Math.round((used / stats.blocks) * 100);
}

/**
 * Utilização de GPU e temperatura via nvidia-smi. Qualquer falha (driver
 * fora, timeout, saída inesperada) vira null nos dois campos: uma leitura
 * de GPU quebrada não pode derrubar o endpoint de métricas inteiro.
 */
function readGpu(): Promise<{ gpu: number | null; temperature: number | null }> {
  return new Promise((resolvePromise) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=utilization.gpu,temperature.gpu', '--format=csv,noheader,nounits'],
      { timeout: 3000 },
      (error, stdout) => {
        if (error) {
          resolvePromise({ gpu: null, temperature: null });
          return;
        }
        const parts = stdout.trim().split(',').map((value) => Number(value.trim()));
        const gpuRaw = parts[0];
        const tempRaw = parts[1];
        resolvePromise({
          gpu: typeof gpuRaw === 'number' && Number.isFinite(gpuRaw) ? gpuRaw : null,
          temperature: typeof tempRaw === 'number' && Number.isFinite(tempRaw) ? tempRaw : null,
        });
      },
    );
  });
}

async function collectMachineMetrics(): Promise<MachineMetrics> {
  const [cpu, gpu] = await Promise.all([measureCpuPercent(100), readGpu()]);
  return { cpu, ram: measureRamPercent(), disk: measureDiskPercent(), ...gpu };
}

export function startMetricsServer(): Server {
  const port = Number(process.env.METRICS_PORT ?? 4100);

  const nodeSecret = process.env.NODE_SECRET;

  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/metrics') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    // Mesmo segredo compartilhado usado por todo node -> Orchestrator (ver
    // nodes/desigual-node/src/security/index.ts): sem isso, qualquer host
    // que alcance a porta 4100 lia uso de CPU/GPU/fila sem credencial.
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!nodeSecret || !token || !safeEqual(token, nodeSecret)) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'Invalid or missing node credentials' }));
      return;
    }
    void collectMachineMetrics()
      .then((metrics) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(metrics));
      })
      .catch((error: unknown) => {
        logger.error({ error }, 'Falha ao coletar métricas da máquina');
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'metrics collection failed' }));
      });
  });

  server.listen(port, '0.0.0.0', () => {
    logger.info({ port }, 'Metrics server listening');
  });

  return server;
}
