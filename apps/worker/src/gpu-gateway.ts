/**
 * gpu-gateway.ts — a porta única da RTX 4090.
 *
 * Cinco processos falavam direto com `100.107.198.50:11434`: Otto node (outra
 * máquina), Bento (outra máquina), o keeper de aquecimento, o marketing-copy e
 * — por outra porta, mas na mesma VRAM — o ComfyUI do Studio. Nenhum sabia dos
 * outros. Por isso o limite tinha que virar um só, e do lado do recurso.
 *
 * O gateway fala o dialeto do próprio Ollama (`/api/chat`, `/api/generate`,
 * `/api/tags`, `/api/ps`). Isso é de propósito: os dois chamadores remotos
 * passam a respeitar a fila trocando só a variável de ambiente da URL base,
 * sem alterar uma linha de código nas máquinas deles.
 *
 * ONDE ELE MORA E POR QUÊ: no worker, não na API. A API é publicada na
 * internet pelo Tailscale Funnel (`/` → 127.0.0.1:3001), e pendurar a GPU ali
 * seria abrir a placa pro mundo. Aqui ele escuta só na tailnet — a mesma
 * exposição que a RTX já tem hoje. E não cria acoplamento novo: todo pedido de
 * inferência nasce de um job do worker, então worker fora do ar já significava
 * nenhuma inferência.
 *
 * O que ele NÃO faz: enfileirar sem limite. Fila infinita transforma saturação
 * em timeout pra todo mundo; a recusa rápida e tipada é uma resposta melhor
 * que uma espera de três minutos que termina em erro.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { controleDeAdmissaoDaGpu, ErroDeCapacidade } from '@desigual-os/orchestrator';
import { createLogger } from '@desigual-os/logging';

const logger = createLogger({ service: 'gpu-gateway' });

const UPSTREAM = process.env.GPU_UPSTREAM_URL ?? 'http://100.107.198.50:11434';
const PORTA = Number(process.env.GPU_GATEWAY_PORT ?? 11500);
/**
 * Teto do proxy, não do chamador: cada cliente já traz o seu próprio timeout
 * (Otto 60s/120s, Bento 90s). Este existe só pra uma conexão pendurada não
 * segurar a vaga da GPU pra sempre.
 */
const TIMEOUT_UPSTREAM_MS = Number(process.env.GPU_UPSTREAM_TIMEOUT_MS ?? 240_000);

/** Rotas que geram token: passam pelo controle de admissão. */
const ROTAS_DE_GERACAO = new Set(['/api/chat', '/api/generate']);
/** Metadados baratos: passam direto. Enfileirar health check seria absurdo. */
const ROTAS_LIVRES = new Set(['/api/tags', '/api/ps', '/api/version']);

/**
 * Quem está pedindo. Serve pra telemetria por chamador — sem isso, "a GPU está
 * cheia" não diz de quem é a carga, e foi essa cegueira que fez o diagnóstico
 * demorar. Cliente que não se identifica ainda é admitido: barrar por falta de
 * cabeçalho quebraria o Bento e o Otto sem ganho nenhum.
 */
function chamadorDe(req: IncomingMessage): string {
  const cabecalho = req.headers['x-desigual-caller'];
  if (typeof cabecalho === 'string' && cabecalho.trim().length > 0) return cabecalho.trim().slice(0, 40);
  const ua = req.headers['user-agent'];
  if (typeof ua === 'string' && ua.length > 0) return `ua:${ua.slice(0, 30)}`;
  return 'desconhecido';
}

function lerCorpo(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    req.on('data', (c: Buffer) => partes.push(c));
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
  });
}

function responderJson(res: ServerResponse, status: number, corpo: unknown): void {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(texto) });
  res.end(texto);
}

async function encaminhar(
  caminho: string,
  metodo: string,
  corpo: Buffer | null,
  desistencia?: AbortSignal,
): Promise<Response> {
  const temCorpo = corpo !== null && corpo.length > 0;
  const sinais = [AbortSignal.timeout(TIMEOUT_UPSTREAM_MS)];
  if (desistencia) sinais.push(desistencia);
  return fetch(`${UPSTREAM}${caminho}`, {
    method: metodo,
    ...(temCorpo ? { headers: { 'Content-Type': 'application/json' }, body: corpo } : {}),
    signal: AbortSignal.any(sinais),
  });
}

/**
 * Cancelar quando quem pediu foi embora.
 *
 * Medido aqui mesmo, 16/09/2026: o Bento desiste aos 90s (timeout dele), mas a
 * chamada ao Ollama seguia viva até os 240s do proxy — segurando a ÚNICA vaga
 * da GPU por mais de dois minutos para uma resposta que ninguém receberia. Com
 * concorrência 1, um cliente impaciente bloqueava a placa inteira. O controle
 * de admissão teria piorado a situação que veio consertar.
 *
 * `res.on('close')` dispara tanto no fim normal quanto na desistência; por isso
 * a checagem de `writableEnded` — só é abandono se a resposta NÃO terminou.
 */
function sinalDeDesistencia(res: ServerResponse): AbortSignal {
  const controle = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controle.abort(new Error('cliente desistiu antes da resposta'));
  });
  return controle.signal;
}

async function repassar(res: ServerResponse, upstream: Response): Promise<void> {
  const texto = await upstream.text();
  res.writeHead(upstream.status, {
    'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    'Content-Length': Buffer.byteLength(texto),
  });
  res.end(texto);
}

async function tratar(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const caminho = (req.url ?? '/').split('?')[0] ?? '/';
  const controle = controleDeAdmissaoDaGpu();

  if (caminho === '/admission' || caminho === '/health') {
    responderJson(res, 200, { status: 'ok', upstream: UPSTREAM, ...controle.telemetria() });
    return;
  }

  if (ROTAS_LIVRES.has(caminho)) {
    const r = await encaminhar(caminho, req.method ?? 'GET', null).catch(() => null);
    if (!r) {
      responderJson(res, 502, { error: 'não alcancei o servidor de inferência' });
      return;
    }
    await repassar(res, r);
    return;
  }

  if (!ROTAS_DE_GERACAO.has(caminho)) {
    responderJson(res, 404, { error: `rota não suportada pelo gateway: ${caminho}` });
    return;
  }

  const chamador = chamadorDe(req);
  const corpo = await lerCorpo(req);
  const desistencia = sinalDeDesistencia(res);
  const t0 = performance.now();

  try {
    const upstream = await controle.executar(chamador, () => encaminhar(caminho, 'POST', corpo, desistencia));
    logger.info(
      { chamador, caminho, status: upstream.status, totalMs: Math.round(performance.now() - t0), ...controle.telemetria() },
      'inferência concluída',
    );
    await repassar(res, upstream);
  } catch (erro) {
    if (erro instanceof ErroDeCapacidade) {
      /**
       * 503 e não 429: para o chamador isto é indisponibilidade temporária de
       * um recurso, e é assim que a taxonomia de falhas já classifica —
       * infraestrutura, que encerra o turno com mensagem honesta em vez de
       * replanejar e somar carga à causa.
       */
      logger.warn({ chamador, motivo: erro.motivo, ...controle.telemetria() }, 'recusado por capacidade');
      responderJson(res, 503, { error: erro.message, motivo: erro.motivo });
      return;
    }
    if (desistencia.aborted) {
      logger.warn(
        { chamador, caminho, totalMs: Math.round(performance.now() - t0), ...controle.telemetria() },
        'cliente desistiu; vaga da GPU devolvida',
      );
      return;
    }
    const detalhe = erro instanceof Error ? erro.message : String(erro);
    logger.error({ chamador, caminho, erro: detalhe }, 'falha ao falar com a GPU');
    if (!res.writableEnded) responderJson(res, 502, { error: `não alcancei o servidor de inferência: ${detalhe}` });
  }
}

export function iniciarGpuGateway(): Server {
  const server = createServer((req, res) => {
    tratar(req, res).catch((erro: unknown) => {
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      logger.error({ erro: detalhe }, 'erro não tratado no gateway');
      if (!res.headersSent) responderJson(res, 500, { error: detalhe });
    });
  });
  // `0.0.0.0` para Otto node e Bento alcançarem pela tailnet; o Funnel só
  // publica a 3001, então esta porta não sai da rede privada.
  server.listen(PORTA, '0.0.0.0', () => {
    logger.info({ porta: PORTA, upstream: UPSTREAM }, 'GPU gateway ouvindo (porta única da RTX)');
  });
  return server;
}
