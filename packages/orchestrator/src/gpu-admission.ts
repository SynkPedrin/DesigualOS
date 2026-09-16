/**
 * gpu-admission.ts — controle de admissão CENTRAL da GPU forte.
 *
 * O problema medido em 16/09/2026: cinco chamadores disparam contra a mesma
 * RTX 4090 (Otto node, Bento, keeper de aquecimento, marketing-copy e o
 * ComfyUI do Studio), cada um com seu próprio timeout e nenhum sabendo da
 * existência dos outros. Sob carga real a placa satura, gerar 5 tokens passa
 * de 60s e uma execução ficou 438s em `queued`. Cada chamador, isolado,
 * concluía "o servidor está lento" e tentava de novo — somando carga à causa.
 *
 * Admission control por agente NÃO resolve isso: dois limites de 1 ainda são
 * 2 na placa. O limite tem que ser único e global, do lado da GPU, e é por
 * isso que este módulo existe como porta única em vez de regra copiada em
 * cada chamador.
 *
 * Duas garantias, nesta ordem:
 *
 *   1. Nunca mais que MAX_GPU_STRONG_CONCURRENCY gerações simultâneas.
 *   2. Quem não couber na fila é RECUSADO RÁPIDO, não pendurado. Fila infinita
 *      transforma saturação em timeout de todo mundo; fila curta transforma em
 *      "agora não dá, tente em instantes" — que é uma resposta útil e honesta.
 *
 * A recusa é tipada (`INFERENCE_CAPACITY_TIMEOUT`) justamente pra ser
 * classificada como falha de INFRAESTRUTURA lá no agente e não disparar
 * replanejamento: replanejar por falta de capacidade é a avalanche de novo.
 *
 * Por que semáforo em processo e não lease no Redis: o gateway é um só
 * (a invariante `exatamente_uma_api` garante isso) e todos os chamadores
 * passam por ele. Lease distribuído acrescentaria um modo de falha que não
 * temos como pagar — lease órfão de um processo morto trava a GPU inteira
 * até expirar, e o TTL que evita isso é o mesmo que permite dois donos
 * simultâneos na janela de renovação.
 */

/** Motivo da recusa, para telemetria e para a mensagem ao usuário. */
export type MotivoDeRecusa = 'fila_cheia' | 'espera_excedida';

export class ErroDeCapacidade extends Error {
  readonly tipo = 'INFERENCE_CAPACITY_TIMEOUT' as const;
  readonly motivo: MotivoDeRecusa;
  readonly esperouMs: number;

  constructor(motivo: MotivoDeRecusa, esperouMs: number, detalhe: string) {
    super(`[INFERENCE_CAPACITY_TIMEOUT] ${detalhe}`);
    this.name = 'ErroDeCapacidade';
    this.motivo = motivo;
    this.esperouMs = esperouMs;
  }
}

export interface ConfigDeAdmissao {
  /** Gerações simultâneas permitidas na GPU. Começa em 1 e só sobe com medição. */
  concorrencia: number;
  /** Quantos podem ESPERAR além dos que estão gerando. Acima disso, recusa imediata. */
  profundidadeMaxima: number;
  /** Teto de espera na fila. Estourou, recusa — em vez de virar timeout de 180s. */
  esperaMaximaMs: number;
}

export function configDoAmbiente(env: NodeJS.ProcessEnv = process.env): ConfigDeAdmissao {
  const num = (v: string | undefined, padrao: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : padrao;
  };
  return {
    concorrencia: num(env.MAX_GPU_STRONG_CONCURRENCY, 1),
    profundidadeMaxima: num(env.GPU_QUEUE_MAX_DEPTH, 6),
    esperaMaximaMs: num(env.GPU_QUEUE_MAX_WAIT_MS, 45_000),
  };
}

export interface TelemetriaDeAdmissao {
  emExecucao: number;
  naFila: number;
  admitidos: number;
  recusadosFilaCheia: number;
  recusadosEsperaExcedida: number;
  esperaMaxObservadaMs: number;
  esperaMediaMs: number;
  porChamador: Record<string, { admitidos: number; recusados: number }>;
}

interface Espera {
  chamador: string;
  entrouEm: number;
  liberar: () => void;
  recusar: (e: ErroDeCapacidade) => void;
  prazo: ReturnType<typeof setTimeout>;
}

export class ControleDeAdmissao {
  private readonly cfg: ConfigDeAdmissao;
  private readonly agora: () => number;
  private emExecucao = 0;
  private readonly fila: Espera[] = [];
  private admitidos = 0;
  private recusadosFilaCheia = 0;
  private recusadosEsperaExcedida = 0;
  private esperaMax = 0;
  private esperaSoma = 0;
  private esperaCont = 0;
  private readonly porChamador = new Map<string, { admitidos: number; recusados: number }>();

  constructor(cfg: ConfigDeAdmissao = configDoAmbiente(), agora: () => number = Date.now) {
    this.cfg = cfg;
    this.agora = agora;
  }

  private contar(chamador: string, campo: 'admitidos' | 'recusados'): void {
    const atual = this.porChamador.get(chamador) ?? { admitidos: 0, recusados: 0 };
    atual[campo] += 1;
    this.porChamador.set(chamador, atual);
  }

  /**
   * Espera uma vaga. Resolve quando há capacidade; rejeita com
   * `ErroDeCapacidade` se a fila já está cheia ou se a espera estourou.
   */
  private adquirir(chamador: string): Promise<void> {
    if (this.emExecucao < this.cfg.concorrencia) {
      this.emExecucao += 1;
      this.admitidos += 1;
      this.contar(chamador, 'admitidos');
      return Promise.resolve();
    }

    if (this.fila.length >= this.cfg.profundidadeMaxima) {
      this.recusadosFilaCheia += 1;
      this.contar(chamador, 'recusados');
      return Promise.reject(
        new ErroDeCapacidade(
          'fila_cheia',
          0,
          `fila da GPU cheia (${this.fila.length}/${this.cfg.profundidadeMaxima} esperando, ${this.emExecucao} gerando)`,
        ),
      );
    }

    const entrouEm = this.agora();
    return new Promise<void>((resolve, reject) => {
      const espera: Espera = {
        chamador,
        entrouEm,
        liberar: () => {
          clearTimeout(espera.prazo);
          const esperou = this.agora() - entrouEm;
          this.esperaMax = Math.max(this.esperaMax, esperou);
          this.esperaSoma += esperou;
          this.esperaCont += 1;
          this.emExecucao += 1;
          this.admitidos += 1;
          this.contar(chamador, 'admitidos');
          resolve();
        },
        recusar: (e) => {
          clearTimeout(espera.prazo);
          const i = this.fila.indexOf(espera);
          if (i >= 0) this.fila.splice(i, 1);
          this.recusadosEsperaExcedida += 1;
          this.contar(chamador, 'recusados');
          reject(e);
        },
        prazo: setTimeout(() => {
          espera.recusar(
            new ErroDeCapacidade(
              'espera_excedida',
              this.cfg.esperaMaximaMs,
              `esperei ${Math.round(this.cfg.esperaMaximaMs / 1000)}s por uma vaga na GPU e ela não abriu`,
            ),
          );
        }, this.cfg.esperaMaximaMs),
      };
      // `unref` para o timer da fila não segurar o processo vivo no shutdown.
      espera.prazo.unref?.();
      this.fila.push(espera);
    });
  }

  private liberar(): void {
    this.emExecucao -= 1;
    const proximo = this.fila.shift();
    if (proximo) proximo.liberar();
  }

  /**
   * Roda `fn` com uma vaga da GPU garantida. A vaga é devolvida mesmo se `fn`
   * falhar — senão um erro qualquer vaza uma vaga e a GPU fica permanentemente
   * com menos capacidade do que tem.
   */
  async executar<T>(chamador: string, fn: () => Promise<T>): Promise<T> {
    await this.adquirir(chamador);
    try {
      return await fn();
    } finally {
      this.liberar();
    }
  }

  telemetria(): TelemetriaDeAdmissao {
    return {
      emExecucao: this.emExecucao,
      naFila: this.fila.length,
      admitidos: this.admitidos,
      recusadosFilaCheia: this.recusadosFilaCheia,
      recusadosEsperaExcedida: this.recusadosEsperaExcedida,
      esperaMaxObservadaMs: this.esperaMax,
      esperaMediaMs: this.esperaCont === 0 ? 0 : Math.round(this.esperaSoma / this.esperaCont),
      porChamador: Object.fromEntries(this.porChamador),
    };
  }
}

let instancia: ControleDeAdmissao | null = null;

/** Porta única do processo. Duas instâncias seriam dois limites — o bug original. */
export function controleDeAdmissaoDaGpu(): ControleDeAdmissao {
  instancia ??= new ControleDeAdmissao();
  return instancia;
}
