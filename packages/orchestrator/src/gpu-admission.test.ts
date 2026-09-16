import { describe, expect, it, vi } from 'vitest';
import {
  ControleDeAdmissao,
  ErroDeCapacidade,
  configDoAmbiente,
  type ConfigDeAdmissao,
} from './gpu-admission.js';

const cfg = (p: Partial<ConfigDeAdmissao> = {}): ConfigDeAdmissao => ({
  concorrencia: 1,
  profundidadeMaxima: 2,
  esperaMaximaMs: 1_000,
  ...p,
});

/** Promessa que só resolve quando mandarmos, pra segurar a vaga de propósito. */
function segurar(): { p: Promise<string>; soltar: () => void } {
  let soltar!: () => void;
  const p = new Promise<string>((r) => {
    soltar = () => r('ok');
  });
  return { p, soltar };
}

describe('gpu_lease_limite_global', () => {
  it('nunca deixa passar mais que a concorrência configurada', async () => {
    const c = new ControleDeAdmissao(cfg({ concorrencia: 1, profundidadeMaxima: 5 }));
    const a = segurar();
    const b = segurar();
    let bComecou = false;

    const p1 = c.executar('otto', () => a.p);
    const p2 = c.executar('bento', () => {
      bComecou = true;
      return b.p;
    });

    await Promise.resolve();
    expect(bComecou).toBe(false);
    expect(c.telemetria()).toMatchObject({ emExecucao: 1, naFila: 1 });

    a.soltar();
    await p1;
    expect(bComecou).toBe(true);

    b.soltar();
    await p2;
    expect(c.telemetria()).toMatchObject({ emExecucao: 0, naFila: 0 });
  });

  it('o limite é do recurso, não do agente: chamadores diferentes disputam a MESMA vaga', async () => {
    const c = new ControleDeAdmissao(cfg({ concorrencia: 1, profundidadeMaxima: 5 }));
    const a = segurar();
    let segundoEntrou = false;

    const p1 = c.executar('otto', () => a.p);
    const p2 = c.executar('bento', async () => {
      segundoEntrou = true;
      return 'ok';
    });

    await Promise.resolve();
    // Se cada agente tivesse o seu próprio limite de 1, os dois estariam
    // gerando agora — que é exatamente como a placa saturava.
    expect(segundoEntrou).toBe(false);

    a.soltar();
    await Promise.all([p1, p2]);
    expect(segundoEntrou).toBe(true);
  });
});

describe('gpu_lease_fila_limitada', () => {
  it('recusa RÁPIDO quando a fila está cheia em vez de pendurar', async () => {
    const c = new ControleDeAdmissao(cfg({ concorrencia: 1, profundidadeMaxima: 1 }));
    const a = segurar();
    const b = segurar();

    const p1 = c.executar('otto', () => a.p);
    const p2 = c.executar('bento', () => b.p); // ocupa a única vaga de espera

    await expect(c.executar('keeper', async () => 'nunca')).rejects.toBeInstanceOf(ErroDeCapacidade);

    const erro: ErroDeCapacidade = await c
      .executar('keeper', async () => 'nunca')
      .then(() => { throw new Error('deveria ter sido recusado'); })
      .catch((e: unknown) => e as ErroDeCapacidade);
    expect(erro.tipo).toBe('INFERENCE_CAPACITY_TIMEOUT');
    expect(erro.motivo).toBe('fila_cheia');

    a.soltar();
    await p1;
    b.soltar();
    await p2;
  });

  it('recusa quem esperou além do teto, em vez de virar timeout de 180s', async () => {
    vi.useFakeTimers();
    try {
      const c = new ControleDeAdmissao(cfg({ concorrencia: 1, profundidadeMaxima: 5, esperaMaximaMs: 1_000 }));
      const a = segurar();
      const p1 = c.executar('otto', () => a.p);
      const p2 = c.executar('bento', async () => 'nunca');

      const capturado: Promise<ErroDeCapacidade> = p2
        .then(() => { throw new Error('deveria ter sido recusado'); })
        .catch((e: unknown) => e as ErroDeCapacidade);
      await vi.advanceTimersByTimeAsync(1_100);

      const erro = await capturado;
      expect(erro).toBeInstanceOf(ErroDeCapacidade);
      expect(erro.motivo).toBe('espera_excedida');
      expect(c.telemetria().naFila).toBe(0);

      a.soltar();
      await p1;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('gpu_lease_libera_em_falha', () => {
  it('devolve a vaga quando a chamada falha — senão a GPU perde capacidade pra sempre', async () => {
    const c = new ControleDeAdmissao(cfg({ concorrencia: 1 }));

    await expect(
      c.executar('otto', async () => {
        throw new Error('upstream 500');
      }),
    ).rejects.toThrow('upstream 500');

    expect(c.telemetria().emExecucao).toBe(0);
    await expect(c.executar('bento', async () => 'passou')).resolves.toBe('passou');
  });
});

describe('gpu_lease_ordem_fifo', () => {
  it('atende na ordem de chegada', async () => {
    const c = new ControleDeAdmissao(cfg({ concorrencia: 1, profundidadeMaxima: 5 }));
    const a = segurar();
    const ordem: string[] = [];

    const p1 = c.executar('otto', () => a.p);
    const p2 = c.executar('bento', async () => {
      ordem.push('bento');
      return 'ok';
    });
    const p3 = c.executar('keeper', async () => {
      ordem.push('keeper');
      return 'ok';
    });

    a.soltar();
    await Promise.all([p1, p2, p3]);
    expect(ordem).toEqual(['bento', 'keeper']);
  });
});

describe('gpu_lease_telemetria', () => {
  it('contabiliza admitidos e recusados por chamador', async () => {
    const c = new ControleDeAdmissao(cfg({ concorrencia: 1, profundidadeMaxima: 0 }));
    const a = segurar();
    const p1 = c.executar('otto', () => a.p);
    await c.executar('keeper', async () => 'x').catch(() => undefined);

    const t = c.telemetria();
    expect(t.porChamador.otto).toEqual({ admitidos: 1, recusados: 0 });
    expect(t.porChamador.keeper).toEqual({ admitidos: 0, recusados: 1 });
    expect(t.recusadosFilaCheia).toBe(1);

    a.soltar();
    await p1;
  });
});

describe('gpu_lease_configuracao', () => {
  it('começa em concorrência 1: subir é decisão de medição, não default', () => {
    expect(configDoAmbiente({}).concorrencia).toBe(1);
  });

  it('lê o ambiente e ignora valor inválido em vez de virar NaN', () => {
    expect(configDoAmbiente({ MAX_GPU_STRONG_CONCURRENCY: '2' }).concorrencia).toBe(2);
    expect(configDoAmbiente({ MAX_GPU_STRONG_CONCURRENCY: 'muito' }).concorrencia).toBe(1);
    expect(configDoAmbiente({ GPU_QUEUE_MAX_DEPTH: '0' }).profundidadeMaxima).toBe(6);
  });
});
