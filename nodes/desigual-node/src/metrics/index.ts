import { cpus, freemem, totalmem } from 'node:os';
import { statfsSync } from 'node:fs';

export interface SystemMetrics {
  cpu: number;
  ram: number;
  disk: number;
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

export async function collectMetrics(): Promise<SystemMetrics> {
  const cpu = await measureCpuPercent(100);
  return {
    cpu,
    ram: measureRamPercent(),
    disk: measureDiskPercent(),
  };
}
