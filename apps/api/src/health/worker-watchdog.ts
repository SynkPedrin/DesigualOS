import { createLogger } from '@desigual-os/logging';
import { FILA_ALTA, readWorkerHealth, sendOpsAlert, type SaudeDoWorker } from '@desigual-os/orchestrator';

const logger = createLogger({ service: 'worker-watchdog' });

/**
 * worker-watchdog.ts — quem percebe que o worker morreu.
 *
 * Mora na API DE PROPÓSITO. Um worker morto não consegue avisar que morreu; qualquer vigia
 * dentro dele morre junto. A API é o outro processo que fica de pé (ela só enfileira, não
 * executa), então é dela a responsabilidade de gritar.
 *
 * Defeito que isto fecha (10/09/2026): worker fora do ar por 10 minutos sem UM aviso. A fila
 * empilhava, o chat aceitava mensagem, e a única evidência era a bolha de erro genérica na cara
 * do usuário — que ainda por cima culpava a pergunta dele.
 *
 * Regras pra não virar ruído (alerta que grita toda hora deixa de ser lido):
 *   - só alerta na TRANSIÇÃO de saudável pra doente, não a cada checagem;
 *   - re-alerta a cada REALERTA_MS enquanto continuar doente, pra não sumir num incidente longo;
 *   - avisa também a RECUPERAÇÃO, senão quem foi acordado não sabe que pode voltar a dormir.
 */

const INTERVALO_MS = 20_000;
const REALERTA_MS = 10 * 60 * 1000;

type Estado = 'saudavel' | 'doente';

let estado: Estado = 'saudavel';
let ultimoAlerta = 0;
let timer: NodeJS.Timeout | null = null;

/** Doente = worker fora do ar, OU de pé mas com a fila acumulando sem dreno. */
function estaDoente(saude: SaudeDoWorker): boolean {
  if (!saude.online) return true;
  return saude.jobsAguardando > FILA_ALTA;
}

async function checar(): Promise<void> {
  let saude: SaudeDoWorker;
  try {
    saude = await readWorkerHealth();
  } catch (error) {
    // Não conseguir LER a saúde já é sintoma (Redis fora), mas não é o mesmo que worker morto.
    // Registra e sai: o alerta de worker é sobre worker, não sobre o vigia.
    logger.error({ error }, 'Watchdog não conseguiu ler a saúde do worker');
    return;
  }

  const doente = estaDoente(saude);
  const agora = Date.now();

  if (doente) {
    const primeiraVez = estado === 'saudavel';
    const hora_de_repetir = agora - ultimoAlerta > REALERTA_MS;
    estado = 'doente';

    if (primeiraVez || hora_de_repetir) {
      ultimoAlerta = agora;
      logger.error(
        { jobsAguardando: saude.jobsAguardando, online: saude.online },
        'Worker doente',
      );
      void sendOpsAlert({
        severity: 'critical',
        title: saude.online ? 'Fila do orquestrador acumulando' : 'Worker do orquestrador FORA DO AR',
        detail: [
          saude.diagnostico,
          `Pedidos esperando: ${saude.jobsAguardando} | em execução: ${saude.jobsAtivos}`,
          saude.lastBeatAt
            ? `Último sinal de vida: ${saude.lastBeatAt} (${saude.segundosDesdeUltimoBatimento}s atrás)`
            : 'Nenhum sinal de vida registrado.',
          '',
          'Enquanto isso, toda mensagem no chat fica parada na fila e o usuário vê erro.',
        ].join('\n'),
      });
    }
    return;
  }

  if (estado === 'doente') {
    estado = 'saudavel';
    ultimoAlerta = 0;
    logger.info({ jobsAguardando: saude.jobsAguardando }, 'Worker recuperado');
    // `warning` e não `info`: sendOpsAlert só aceita warning|critical, e a recuperação precisa
    // chegar no mesmo canal do alerta — avisar que caiu e não avisar que voltou deixa quem foi
    // acordado sem saber se ainda tem incidente aberto.
    void sendOpsAlert({
      severity: 'warning',
      title: 'Worker do orquestrador voltou',
      detail: `${saude.diagnostico}\nPedidos esperando: ${saude.jobsAguardando}.`,
    });
  }
}

export function startWorkerWatchdog(): () => void {
  if (timer) return () => {};
  // Primeira checagem com folga: logo depois de um restart da API o worker pode ainda estar
  // subindo, e alertar nesse instante seria alarme falso toda vez que a infra reinicia.
  const inicial = setTimeout(() => void checar(), 60_000);
  inicial.unref?.();

  timer = setInterval(() => void checar(), INTERVALO_MS);
  timer.unref?.();
  logger.info({ INTERVALO_MS }, 'Watchdog do worker armado');

  return () => {
    clearTimeout(inicial);
    if (timer) clearInterval(timer);
    timer = null;
  };
}
