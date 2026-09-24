/**
 * Erros do Motion Engine que a UI sabe traduzir (§26).
 *
 * Todo erro daqui carrega um `code` estável e uma `userMessage` em português
 * que pode ir DIRETO pro chat. O chat do Otto nunca mostra "Error 500": quem
 * não tiver tradução cai em MotionError genérico, que já nasce com texto
 * apresentável.
 */
export type MotionErrorCode =
  | 'MOTION_DISABLED'
  | 'OPUS_UNAVAILABLE'
  | 'PROVIDER_DISCONNECTED'
  | 'NO_CLIENT'
  | 'NO_ASSETS'
  | 'WORKSPACE_LOCKED'
  | 'CODEGEN_FAILED'
  | 'BUILD_FAILED'
  | 'RENDER_FAILED'
  | 'QA_FAILED'
  | 'SESSION_NOT_FOUND'
  | 'CANCELLED'
  | 'INTERNAL';

export interface MotionErrorAction {
  /** Rótulo do botão que a UI desenha ao lado da mensagem. */
  label: string;
  /** Identificador da ação; a UI decide o que fazer com ele. */
  action: 'add_files' | 'reconnect_claude' | 'retry' | 'open_settings';
}

export class MotionError extends Error {
  readonly code: MotionErrorCode;
  readonly userMessage: string;
  readonly actions: MotionErrorAction[];
  /** Detalhe técnico pro log. NUNCA vai pro chat. */
  readonly detail: string | undefined;

  constructor(
    code: MotionErrorCode,
    userMessage: string,
    options: { actions?: MotionErrorAction[]; detail?: string; cause?: unknown } = {},
  ) {
    super(`${code}: ${userMessage}`, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'MotionError';
    this.code = code;
    this.userMessage = userMessage;
    this.actions = options.actions ?? [];
    this.detail = options.detail;
  }
}

/**
 * §5, regra absoluta: sem Opus 5.5 o motor PARA. Não existe caminho neste
 * módulo que troque o modelo por um menor — o erro é o único desfecho.
 */
export class MotionModelUnavailableError extends MotionError {
  constructor(detail: string) {
    super(
      'OPUS_UNAVAILABLE',
      'O Claude está conectado, mas o Claude Opus 5.5 não está disponível neste worker. ' +
        'Sem ele eu não gero o motion — um modelo menor entregaria outra coisa, e esconder isso seria pior.',
      {
        actions: [{ label: 'Reconectar Claude', action: 'reconnect_claude' }],
        detail,
      },
    );
    this.name = 'MotionModelUnavailableError';
  }
}

export function isMotionError(error: unknown): error is MotionError {
  return error instanceof MotionError;
}

/** Texto apresentável pra QUALQUER erro, inclusive os que não são MotionError. */
export function userMessageFor(error: unknown): string {
  if (isMotionError(error)) return error.userMessage;
  return 'O motion apresentou um problema que eu não consegui contornar sozinho. O projeto ficou salvo — posso tentar de novo.';
}
