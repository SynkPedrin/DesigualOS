import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarAutosave, type AutosaveStatus } from './autosave';


describe('autosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function montar(salvar: (dado: string, o: { keepalive: boolean }) => Promise<void>) {
    const status: AutosaveStatus[] = [];
    const erros: unknown[] = [];
    const a = criarAutosave<string>({ salvar, debounceMs: 1500, onStatus: (s) => status.push(s), onErro: (e) => erros.push(e) });
    return { a, status, erros };
  }

  it('agrupa alterações seguidas num envio só, com o último estado', async () => {
    const enviados: string[] = [];
    const { a } = montar(async (d) => { enviados.push(d); });
    a.agendar('v1');
    await vi.advanceTimersByTimeAsync(1000);
    a.agendar('v2');
    await vi.advanceTimersByTimeAsync(1000);
    expect(enviados).toEqual([]);
    await vi.advanceTimersByTimeAsync(600);
    expect(enviados).toEqual(['v2']);
  });

  /** O defeito nº1 do Gate 2.2: a barra dizia "Salvo" com alteração pendente. */
  it('agendar tira o status de "salvo" na hora', async () => {
    const { a, status } = montar(async () => {});
    a.agendar('v1');
    await vi.advanceTimersByTimeAsync(1600);
    expect(a.status()).toBe('salvo');

    a.agendar('v2');
    expect(a.status()).toBe('pendente');
    expect(status).toEqual(['pendente', 'salvando', 'salvo', 'pendente']);
  });

  /** O defeito nº2: o F5 matava o timer e a alteração sumia. */
  it('flush envia o pendente sem esperar o debounce', async () => {
    const enviados: { dado: string; keepalive: boolean }[] = [];
    const { a } = montar(async (dado, o) => { enviados.push({ dado, keepalive: o.keepalive }); });
    a.agendar('ultima-edicao');
    await a.flush({ keepalive: true });
    expect(enviados).toEqual([{ dado: 'ultima-edicao', keepalive: true }]);
    expect(a.status()).toBe('salvo');
  });

  it('flush sem nada pendente não chama a rede', async () => {
    const salvar = vi.fn(async () => {});
    const { a } = montar(salvar);
    await a.flush();
    expect(salvar).not.toHaveBeenCalled();
  });

  /**
   * Proteção contra sobrescrita por envio velho: com dois salvamentos
   * concorrentes, o que chegasse por último ao servidor venceria — e não há
   * garantia nenhuma de que seja o mais novo.
   */
  it('nunca mantém dois envios em voo, e o segundo leva o estado mais recente', async () => {
    const ordem: string[] = [];
    let liberar: (() => void) | null = null;
    const { a } = montar(async (dado) => {
      ordem.push(`inicio:${dado}`);
      if (dado === 'v1') await new Promise<void>((r) => { liberar = r; });
      ordem.push(`fim:${dado}`);
    });

    a.agendar('v1');
    await vi.advanceTimersByTimeAsync(1600);
    expect(ordem).toEqual(['inicio:v1']);

    // Chega uma alteração nova enquanto v1 ainda está gravando.
    a.agendar('v2');
    await vi.advanceTimersByTimeAsync(1600);
    // v2 NÃO saiu: v1 ainda está em voo. E o status é "pendente", não
    // "salvando": o que está gravando é a versão ANTERIOR, então dizer que
    // está salvando o estado atual seria a mesma mentira do defeito nº1.
    expect(ordem).toEqual(['inicio:v1']);
    expect(a.status()).toBe('pendente');

    liberar!();
    await vi.advanceTimersByTimeAsync(1600);
    expect(ordem).toEqual(['inicio:v1', 'fim:v1', 'inicio:v2', 'fim:v2']);
    expect(a.status()).toBe('salvo');
  });

  it('erro devolve o payload pra fila e o status volta a pendente', async () => {
    let falhar = true;
    const enviados: string[] = [];
    const { a, erros } = montar(async (d) => {
      if (falhar) { falhar = false; throw new Error('rede caiu'); }
      enviados.push(d);
    });
    a.agendar('v1');
    await vi.advanceTimersByTimeAsync(1600);
    expect(erros).toHaveLength(1);
    expect(a.status()).toBe('pendente');
    expect(a.temPendencia()).toBe(true);

    await a.flush();
    expect(enviados).toEqual(['v1']);
    expect(a.status()).toBe('salvo');
  });

  it('erro NÃO ressuscita um payload velho por cima de um mais novo', async () => {
    const enviados: string[] = [];
    const { a } = montar(async (d) => {
      if (d === 'v1') throw new Error('falhou');
      enviados.push(d);
    });
    a.agendar('v1');
    const emVoo = vi.advanceTimersByTimeAsync(1600);
    a.agendar('v2');
    await emVoo;
    await a.flush();
    expect(enviados).toEqual(['v2']);
  });

  it('encerrar grava o que estava pendente', async () => {
    const enviados: string[] = [];
    const { a } = montar(async (d) => { enviados.push(d); });
    a.agendar('v1');
    await a.encerrar();
    expect(enviados).toEqual(['v1']);
  });

  it('revisão avança a cada alteração agendada', () => {
    const { a } = montar(async () => {});
    expect(a.revisao()).toBe(0);
    a.agendar('v1');
    a.agendar('v2');
    expect(a.revisao()).toBe(2);
  });
});
