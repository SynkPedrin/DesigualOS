/**
 * Autosave do editor — uma transação de salvamento, determinística.
 *
 * Existe por causa de um defeito medido no Gate 2.2: reordenar uma camada
 * mudava a tela, o painel e a artboard, e o F5 trazia a ordem antiga de
 * volta. A forense (use-canva-editor.reorder.test.tsx) provou que o editor
 * entregava o payload CERTO ao autosave em todas as etapas — o que se perdia
 * era o próprio salvamento:
 *
 *  1. O status ficava em "Salvo" para sempre depois do primeiro save bem
 *     sucedido. Quem agendava uma alteração nova não mexia no status, então
 *     a barra dizia "Salvo" durante os 1500ms em que a alteração ainda
 *     estava só na memória. O usuário (e o teste) liam "Salvo" e recarregavam.
 *  2. Não havia nenhum flush no descarregamento da página. O timer do
 *     debounce simplesmente morria junto com a aba: toda edição feita nos
 *     últimos 1500ms antes do F5 era perdida em silêncio.
 *
 * Os dois juntos dão exatamente o sintoma relatado, e de forma intermitente
 * — dependia de quanto tempo passava entre a última edição e o F5.
 *
 * Além disso, aqui os envios são SERIALIZADOS: nunca há dois PATCH de página
 * em voo ao mesmo tempo. Sem isso, duas gravações concorrentes podem chegar
 * ao servidor fora de ordem e uma versão velha sobrescrever a nova. Como
 * cada envio leva sempre o ESTADO MAIS RECENTE, uma revisão antiga não tem
 * como chegar depois de uma nova.
 */

export type AutosaveStatus = 'idle' | 'pendente' | 'salvando' | 'salvo';

export interface AutosaveOpcoes<T> {
  /** Grava de verdade. `keepalive` pede um envio que sobreviva ao unload. */
  salvar: (dado: T, opcoes: { keepalive: boolean }) => Promise<void>;
  debounceMs: number;
  onStatus?: (status: AutosaveStatus) => void;
  onErro?: (erro: unknown) => void;
}

export interface Autosave<T> {
  /** Registra uma alteração e (re)arma o debounce. */
  agendar: (dado: T) => void;
  /** Envia agora o que estiver pendente. Resolve quando a gravação terminar. */
  flush: (opcoes?: { keepalive?: boolean }) => Promise<void>;
  /** Cancela o timer e envia o pendente (usar no unmount). */
  encerrar: () => Promise<void>;
  temPendencia: () => boolean;
  /** Número da revisão agendada mais recente — instrumentação/diagnóstico. */
  revisao: () => number;
  status: () => AutosaveStatus;
}

export function criarAutosave<T>({ salvar, debounceMs, onStatus, onErro }: AutosaveOpcoes<T>): Autosave<T> {
  let pendente: { dado: T; revisao: number } | null = null;
  let revisao = 0;
  let emVoo: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let status: AutosaveStatus = 'idle';

  function mudarStatus(novo: AutosaveStatus) {
    if (status === novo) return;
    status = novo;
    onStatus?.(novo);
  }

  function cancelarTimer() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  async function enviar(keepalive: boolean): Promise<void> {
    // Um envio de cada vez. O que chegar durante este aqui sai no próximo
    // ciclo, já com o estado mais novo — nunca em paralelo.
    if (emVoo) {
      await emVoo;
      if (!pendente) return;
      return enviar(keepalive);
    }
    if (!pendente) return;

    const enviando = pendente;
    pendente = null;
    mudarStatus('salvando');

    emVoo = (async () => {
      try {
        await salvar(enviando.dado, { keepalive });
        // Se algo novo foi agendado enquanto este salvava, o documento no
        // servidor JÁ está desatualizado: dizer "Salvo" aqui seria mentira.
        mudarStatus(pendente ? 'pendente' : 'salvo');
      } catch (erro) {
        // Devolve o payload pra fila, a menos que um mais novo já tenha
        // chegado — nesse caso o mais novo é que vale.
        if (!pendente) pendente = enviando;
        mudarStatus('pendente');
        onErro?.(erro);
      }
    })();

    try {
      await emVoo;
    } finally {
      emVoo = null;
    }

    if (pendente && !keepalive) {
      cancelarTimer();
      timer = setTimeout(() => void enviar(false), debounceMs);
    }
  }

  return {
    agendar(dado: T) {
      revisao += 1;
      pendente = { dado, revisao };
      // O ponto 1 do comentário do topo: agendar SEMPRE tira o status de
      // "Salvo". Enquanto o dado está só na memória, a barra não pode dizer
      // que está gravado.
      mudarStatus('pendente');
      cancelarTimer();
      timer = setTimeout(() => void enviar(false), debounceMs);
    },
    flush(opcoes) {
      cancelarTimer();
      return enviar(opcoes?.keepalive ?? false);
    },
    async encerrar() {
      cancelarTimer();
      await enviar(false);
    },
    temPendencia: () => pendente !== null || emVoo !== null,
    revisao: () => revisao,
    status: () => status,
  };
}
