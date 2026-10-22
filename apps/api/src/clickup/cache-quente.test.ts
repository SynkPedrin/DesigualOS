import { describe, expect, it, vi } from 'vitest';
import { FRESCO_MS, VALIDADE_MS, criarCacheQuente, emHorarioDeTrabalho } from './cache-quente';

const esperar = () => new Promise((ok) => setTimeout(ok, 0));

describe('cache quente das consultas ao ClickUp', () => {
  it('primeira leitura busca; dentro de 1 min serve do cache sem buscar de novo', async () => {
    const c = criarCacheQuente<number>();
    const buscar = vi.fn(async () => 1);
    expect(await c.obter('k', buscar)).toBe(1);
    expect(await c.obter('k', buscar)).toBe(1);
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it('entre 1 e 10 min: serve NA HORA o valor guardado e relê por trás', async () => {
    const c = criarCacheQuente<number>();
    let versao = 1;
    const buscar = vi.fn(async () => versao);
    const t0 = Date.now();
    await c.obter('k', buscar, t0);
    versao = 2;
    expect(await c.obter('k', buscar, t0 + FRESCO_MS + 1)).toBe(1);
    await esperar();
    expect(await c.obter('k', buscar)).toBe(2);
  });

  it('webhook (marcarParaReler) não apaga: continua servindo e relê por trás', async () => {
    const c = criarCacheQuente<number>();
    let versao = 1;
    let liberar: () => void = () => undefined;
    const buscar = vi.fn(() => (versao === 1 ? Promise.resolve(1) : new Promise<number>((ok) => { liberar = () => ok(2); })));
    await c.obter('k', buscar);
    versao = 2;
    c.marcarParaReler();
    // releitura em andamento: quem pede agora recebe o valor anterior, sem esperar
    expect(await c.obter('k', buscar)).toBe(1);
    expect(buscar).toHaveBeenCalledTimes(2);
    liberar();
    await esperar();
    expect(await c.obter('k', buscar)).toBe(2);
  });

  it('duas releituras ao mesmo tempo viram uma só', async () => {
    const c = criarCacheQuente<number>();
    let chamadas = 0;
    const buscar = vi.fn(() => (++chamadas === 1 ? Promise.resolve(1) : new Promise<number>(() => undefined)));
    await c.obter('k', buscar);
    c.marcarParaReler();
    c.marcarParaReler();
    c.aquecer(Date.now() + FRESCO_MS + 1);
    // 1 leitura inicial + 1 releitura (as outras esperam a que já está em andamento)
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it('releitura que falha não apaga o valor e avisa', async () => {
    const falhou = vi.fn();
    const c = criarCacheQuente<number>(falhou);
    let falhar = false;
    const buscar = vi.fn(async () => { if (falhar) throw new Error('ClickUp fora'); return 1; });
    await c.obter('k', buscar);
    falhar = true;
    c.marcarParaReler();
    await esperar();
    expect(falhou).toHaveBeenCalledTimes(1);
    expect(await c.obter('k', buscar)).toBe(1);
  });

  it('aquecimento relê só o que alguém usou nas últimas 24 h e não está fresco', async () => {
    const c = criarCacheQuente<number>();
    const t0 = Date.now();
    const usada = vi.fn(async () => 1);
    const esquecida = vi.fn(async () => 1);
    await c.obter('usada', usada, t0);
    await c.obter('esquecida', esquecida, t0 - 25 * 60 * 60_000);
    c.aquecer(t0); // tudo fresco: ninguém relê
    expect(usada).toHaveBeenCalledTimes(1);
    c.aquecer(t0 + FRESCO_MS + 1);
    expect(usada).toHaveBeenCalledTimes(2);
    expect(esquecida).toHaveBeenCalledTimes(1);
  });

  it('depois de 10 min sem releitura, busca de verdade', async () => {
    const c = criarCacheQuente<number>();
    let versao = 1;
    const buscar = vi.fn(async () => versao);
    const t0 = Date.now() - VALIDADE_MS - 1;
    await c.obter('k', buscar, t0);
    versao = 2;
    expect(await c.obter('k', buscar)).toBe(2);
  });

  it('horário de trabalho em Brasília: 7h às 20h', () => {
    expect(emHorarioDeTrabalho(Date.parse('2026-10-22T10:00:00Z'))).toBe(true); // 7h
    expect(emHorarioDeTrabalho(Date.parse('2026-10-22T22:59:00Z'))).toBe(true); // 19h59
    expect(emHorarioDeTrabalho(Date.parse('2026-10-22T23:00:00Z'))).toBe(false); // 20h
    expect(emHorarioDeTrabalho(Date.parse('2026-10-22T09:59:00Z'))).toBe(false); // 6h59
  });
});
