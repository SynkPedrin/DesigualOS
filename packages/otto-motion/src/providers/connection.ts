import { spawn } from 'node:child_process';
import { MIN_CLAUDE_CODE_VERSION, MOTION_MODEL_ID, versionAtLeast } from '../model.js';
import { childEnv } from './claude-code.js';
import { QUOTA_UNAVAILABLE_MESSAGE, clearQuotaState, readQuotaState, recordQuotaUnavailable } from './quota-state.js';

/** §8 — os estados que a UI precisa distinguir. */
export const PROVIDER_STATES = [
  'DISCONNECTED',
  'CONNECTING',
  'CONNECTED',
  'SESSION_EXPIRED',
  'ACCESS_DENIED',
  'OPUS_UNAVAILABLE',
  'ERROR',
] as const;

export type ProviderState = (typeof PROVIDER_STATES)[number];

export interface ProviderConnection {
  provider: 'claude' | 'chatgpt';
  state: ProviderState;
  /** Frase curta pro card. Já em português, já apresentável. */
  message: string;
  /** Instrução EXATA que resolve, quando existe. */
  remedy: string | null;
  account: string | null;
  model: string | null;
  /** Só o Claude habilita o Motion Engine (§9). */
  motionCapable: boolean;
  details: Record<string, string | boolean | null>;
  checkedAt: string;
}

const CLAUDE_BIN = process.env.OTTO_MOTION_CLAUDE_BIN ?? 'claude';

function runClaude(args: string[], timeoutMs = 20_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, args, { env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: '', stderr: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

interface AuthStatus {
  loggedIn?: boolean;
  authMethod?: string;
  apiProvider?: string;
  email?: string;
  orgName?: string;
  subscriptionType?: string;
}

/**
 * Estado da conexão do Claude SEM gastar token.
 *
 * `claude auth status` devolve JSON com loggedIn/authMethod/email/org e não
 * chama a API — é a checagem que pode rodar em carregamento de tela. A
 * verificação de que o Opus 5.5 responde de verdade custa dinheiro, então ela
 * é separada (`probeOpusModel`) e só roda quando a pessoa pede.
 *
 * A checagem de VERSÃO é a que mais importa na prática: foi exatamente ela
 * que faltava nesta máquina em 24/09/2026 (CLI 2.1.263 com conta perfeitamente
 * válida). Sem ela, o usuário veria "Conectado" e o motion falharia depois,
 * no meio do job, sem ninguém entender por quê.
 */
export async function checkClaudeConnection(options: { ignoreQuotaState?: boolean } = {}): Promise<ProviderConnection> {
  const checkedAt = new Date().toISOString();
  const base = { provider: 'claude' as const, model: MOTION_MODEL_ID, checkedAt };

  const versionRun = await runClaude(['--version']);
  if (versionRun.code !== 0) {
    return {
      ...base,
      state: 'DISCONNECTED',
      message: 'O Claude Code não está instalado neste worker.',
      remedy: 'Instale o Claude Code na máquina do worker e faça login com a conta da agência.',
      account: null,
      motionCapable: false,
      details: { installed: false },
    };
  }

  const version = versionRun.stdout.trim();
  const authRun = await runClaude(['auth', 'status']);
  let auth: AuthStatus = {};
  try {
    auth = JSON.parse(authRun.stdout.trim()) as AuthStatus;
  } catch {
    auth = {};
  }

  if (auth.loggedIn !== true) {
    return {
      ...base,
      state: 'DISCONNECTED',
      message: 'O Claude Code está instalado, mas sem nenhuma conta conectada.',
      remedy: 'Na máquina do worker, rode `claude auth login` e entre com a conta da agência.',
      account: null,
      motionCapable: false,
      details: { installed: true, version, loggedIn: false },
    };
  }

  if (!versionAtLeast(version, MIN_CLAUDE_CODE_VERSION)) {
    return {
      ...base,
      state: 'OPUS_UNAVAILABLE',
      message: `Conta conectada, mas esta versão do Claude Code (${version}) não fala com o Claude Opus 5.5.`,
      remedy: `Rode \`claude update\` na máquina do worker — o Opus 5.5 exige a ${MIN_CLAUDE_CODE_VERSION} ou mais nova.`,
      account: auth.email ?? null,
      motionCapable: false,
      details: { installed: true, version, loggedIn: true, minimumVersion: MIN_CLAUDE_CODE_VERSION },
    };
  }

  // Limite de uso gravado por uma sessão anterior (ver quota-state.ts): a
  // conta está OK, a CLI está OK, mas o Opus 5.5 não responde até o reset.
  // Falhar fechado AQUI — antes de o guard do chat abrir sessão — é o que
  // impede uma fila de jobs de bater na mesma parede um por um. O probe
  // (ignoreQuotaState) pula este atalho de propósito: ele É a prova de que a
  // quota voltou.
  if (!options.ignoreQuotaState) {
    const quota = await readQuotaState();
    if (quota) {
      return {
        ...base,
        state: 'OPUS_UNAVAILABLE',
        message: quota.message,
        remedy:
          'Aguarde a liberação do limite da conta (o detalhe informa a data de reset) e depois use "Testar conexão" para reabilitar o Motion Engine.',
        account: auth.email ?? null,
        motionCapable: false,
        details: { installed: true, version, loggedIn: true, quotaDetail: quota.detail, quotaRecordedAt: quota.recordedAt },
      };
    }
  }

  return {
    ...base,
    state: 'CONNECTED',
    message: 'Claude Opus 5.5 disponível para o Motion Engine.',
    remedy: null,
    account: auth.email ?? null,
    motionCapable: true,
    details: {
      installed: true,
      version,
      loggedIn: true,
      authMethod: auth.authMethod ?? null,
      organization: auth.orgName ?? null,
      plan: auth.subscriptionType ?? null,
    },
  };
}

/**
 * Prova cara: manda um turno real no Opus 5.5 e confirma pelo `modelUsage`.
 *
 * Só roda quando a pessoa clica em "Testar conexão" — a sessão cria cache de
 * prompt e custa alguns centavos, o que é barato uma vez e caro a cada
 * carregamento de tela.
 */
export async function probeOpusModel(): Promise<ProviderConnection> {
  // ignoreQuotaState: o probe é o caminho de REABILITAÇÃO. Se ele respeitasse
  // o estado gravado, "Testar conexão" nunca rodaria o turno real e a quota
  // jamais seria limpa — o motor ficaria travado até alguém apagar o arquivo.
  const connection = await checkClaudeConnection({ ignoreQuotaState: true });
  if (connection.state !== 'CONNECTED') return connection;

  const run = await new Promise<{ stdout: string; stderr: string }>((resolve) => {
    const child = spawn(
      CLAUDE_BIN,
      [
        '--print',
        '--output-format',
        'json',
        '--model',
        MOTION_MODEL_ID,
        '--restricted',
        '--permission-prompts',
        'none',
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--disable-slash-commands',
        '--tools',
        'Read',
      ],
      { env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ stdout: '', stderr: error.message });
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve({ stdout, stderr });
    });
    child.stdin.write('Responda exatamente: ok');
    child.stdin.end();
  });

  let parsed: { is_error?: boolean; result?: string; modelUsage?: Record<string, unknown> } = {};
  try {
    parsed = JSON.parse(run.stdout.trim()) as typeof parsed;
  } catch {
    return {
      ...connection,
      state: 'ERROR',
      message: 'O Claude respondeu em um formato que eu não entendi.',
      remedy: 'Tente de novo; se persistir, rode `claude doctor` na máquina do worker.',
      motionCapable: false,
    };
  }

  const usedOpus = Object.keys(parsed.modelUsage ?? {}).includes(MOTION_MODEL_ID);
  if (parsed.is_error === true || !usedOpus) {
    const message = parsed.result ?? 'sem detalhe';
    // Limite de uso detectado no turno real: grava o estado pra que TODAS as
    // leituras seguintes (guard do chat, card de settings) falhem fechado sem
    // gastar outra chamada, e responde com a frase exata que a UI espera.
    if (/(weekly|daily|usage|rate) limit|quota exceeded|credit balance/i.test(message)) {
      await recordQuotaUnavailable(message.slice(0, 500)).catch(() => undefined);
      return {
        ...connection,
        state: 'OPUS_UNAVAILABLE',
        message: QUOTA_UNAVAILABLE_MESSAGE,
        remedy: 'Aguarde a liberação do limite da conta (o detalhe informa a data de reset).',
        motionCapable: false,
        details: { ...connection.details, quotaDetail: message.slice(0, 500) },
      };
    }
    const expired = /expired|unauthorized|401|log ?in/i.test(message);
    const denied = /forbidden|403|access denied|not allowed|permission/i.test(message);
    return {
      ...connection,
      state: expired ? 'SESSION_EXPIRED' : denied ? 'ACCESS_DENIED' : 'OPUS_UNAVAILABLE',
      message: expired
        ? 'A sessão do Claude expirou neste worker.'
        : denied
          ? 'Esta conta não tem acesso ao Claude Opus 5.5.'
          : 'O Claude respondeu, mas não pelo Opus 5.5.',
      remedy: expired ? 'Rode `claude auth login` na máquina do worker.' : 'Verifique o acesso ao Opus 5.5 nesta conta.',
      motionCapable: false,
    };
  }

  // Sucesso real no Opus 5.5: se havia quota gravada, ela acabou de ser
  // refutada por um fato — apaga e o motor volta a operar sozinho.
  await clearQuotaState().catch(() => undefined);
  return connection;
}

/**
 * §9 — ChatGPT.
 *
 * Existe como provider de primeira classe na UI e no adapter, e NUNCA como
 * substituto do Opus 5.5 no Motion Engine (`motionCapable` é `false` por
 * construção, não por configuração).
 *
 * Sobre "conectar": não há, neste ambiente, nenhum mecanismo OFICIAL de login
 * de conta ChatGPT que um worker de servidor possa usar — não existe CLI da
 * OpenAI instalada nem fluxo OAuth suportado aqui. A DoD prevê exatamente
 * esse caso ("caso não exista mecanismo oficial no ambiente, a UI/adapter
 * fica pronta sem autenticação falsa"), então o que se reconhece é a
 * credencial oficial que a plataforma de fato aceita: `OPENAI_API_KEY`.
 * Inventar um endpoint de OAuth aqui seria autenticação falsa.
 */
export function checkChatGptConnection(env: NodeJS.ProcessEnv = process.env): ProviderConnection {
  const key = env.OPENAI_API_KEY?.trim();
  const checkedAt = new Date().toISOString();

  if (!key) {
    return {
      provider: 'chatgpt',
      state: 'DISCONNECTED',
      message: 'Nenhuma credencial da OpenAI configurada.',
      remedy: 'Defina OPENAI_API_KEY no ambiente do worker. O Motion Engine não usa este provider de qualquer forma.',
      account: null,
      model: null,
      motionCapable: false,
      details: { credential: false },
      checkedAt,
    };
  }

  return {
    provider: 'chatgpt',
    state: 'CONNECTED',
    message: 'Conectado. Não participa da geração de motion — isso é do Claude Opus 5.5.',
    remedy: null,
    account: null,
    model: null,
    motionCapable: false,
    details: { credential: true },
    checkedAt,
  };
}
