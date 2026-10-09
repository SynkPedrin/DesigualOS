/**
 * endereco-de-retorno.ts — confere, ANTES de mandar a pessoa embora, que o
 * endereço de retorno do OAuth responde.
 *
 * O DEFEITO QUE ISTO EVITA (07/10/2026, relatado com print): clicar em
 * "Conectar" no ClickUp levava à tela de consentimento do ClickUp, e lá
 * aparecia "Opa! Não foi possível autorizar suas equipes. Tente novamente." A
 * pessoa fica num domínio que não é o nosso, com uma mensagem que não diz
 * nada, sem caminho de volta e sem ideia do que consertar.
 *
 * A causa era banal e invisível daqui: `CLICKUP_REDIRECT_URI` (e
 * `META_REDIRECT_URI`) apontavam para um túnel efêmero do Cloudflare —
 * `https://<palavras-aleatórias>.trycloudflare.com/...`. Um *quick tunnel*
 * ganha um hostname NOVO a cada vez que sobe, então o endereço registrado no
 * app do ClickUp morre junto com o processo do túnel. Dias depois, o endereço
 * não resolve mais e o provedor recusa a autorização logo de cara.
 *
 * O que mudou: a recusa passa a acontecer do NOSSO lado, na nossa tela, com o
 * host que falhou e o que fazer. Um erro que a pessoa consegue agir sobre vale
 * mais que um erro em domínio alheio.
 *
 * NÃO É VALIDAÇÃO DE SEGURANÇA: é diagnóstico. O que protege o fluxo continua
 * sendo o `state` assinado e o client_secret no servidor.
 */

/** Alto o bastante para um túnel lento, baixo o bastante para não travar o clique. */
const TETO_MS = 4_000;

/** Hospedagens cujo endereço é sabidamente efêmero — vale um recado específico. */
const EFEMEROS = ['trycloudflare.com', 'ngrok.io', 'ngrok-free.app', 'loca.lt', 'serveo.net'];

export interface EnderecoDeRetorno {
  ok: boolean;
  /** Mensagem pronta para a tela, em português, quando `ok` é falso. */
  motivo: string | null;
}

/**
 * "NÃO RESOLVE" E "NÃO RESPONDE" PEDEM CONSERTOS DIFERENTES, e confundir os
 * dois custa horas. Um host que não resolve é registro de DNS que não existe —
 * nenhum serviço, por mais no ar que esteja, conserta isso. Um host que
 * resolve e não responde é serviço fora do ar.
 *
 * O caso que motivou a distinção (07/10/2026): o endereço de retorno em uso
 * para o Notion era `https://api.agenciadesigual.com.br/...`, e esse subdomínio
 * não tinha registro nenhum — o domínio existe (o apex aponta para a Vercel), o
 * `api.` não. A mensagem genérica "confira se o serviço está no ar" mandaria a
 * pessoa procurar no lugar errado.
 *
 * `fetch` do Node embrulha o erro de rede num TypeError e guarda o código real
 * em `cause`.
 */
function ehFalhaDeDns(erro: unknown): boolean {
  const causa = (erro as { cause?: { code?: string } })?.cause;
  return causa?.code === 'ENOTFOUND' || causa?.code === 'EAI_AGAIN';
}

function ehEfemero(host: string): boolean {
  return EFEMEROS.some((dominio) => host === dominio || host.endsWith(`.${dominio}`));
}

export async function conferirEnderecoDeRetorno(
  redirectUri: string,
  provedor: string,
  variavel: string,
): Promise<EnderecoDeRetorno> {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return { ok: false, motivo: `${variavel} não é um endereço válido: "${redirectUri}".` };
  }

  /**
   * `localhost` não é conferido: em desenvolvimento quem responde ali é esta
   * mesma API, e uma requisição do processo para ele mesmo durante o
   * tratamento de outra requisição é um jeito fácil de prender o event loop
   * sem necessidade. O erro, se houver, é de registro no provedor — e esse
   * nenhuma sonda daqui detecta.
   */
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1') {
    return { ok: true, motivo: null };
  }

  try {
    // HEAD na ORIGEM, não no caminho do callback: o que se quer saber é se o
    // host existe e atende, não o que a nossa própria rota responderia a uma
    // chamada sem `code`. `redirect: 'manual'` porque qualquer resposta —
    // inclusive 301, 404 ou 500 — já prova que o host está de pé.
    await fetch(url.origin, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(TETO_MS) });
    return { ok: true, motivo: null };
  } catch (erro) {
    const abertura = `O endereço de retorno configurado para o ${provedor} não está alcançável: ${url.host}. O ${provedor} recusa a autorização antes de qualquer coisa quando isso acontece.`;

    /**
     * A ORDEM IMPORTA, e eu errei isto uma vez (07/10/2026): um túnel efêmero
     * morto falha JUSTAMENTE no DNS, então checar DNS primeiro fazia a
     * mensagem dizer "crie o registro de DNS apontando
     * <palavras>.trycloudflare.com" — conselho impossível de seguir, porque
     * esse domínio não é de ninguém aqui. Túnel conhecido tem diagnóstico
     * próprio e vem antes.
     */
    if (ehEfemero(url.hostname)) {
      return {
        ok: false,
        motivo:
          `${abertura} Esse é um túnel temporário, e ele ganha um endereço novo toda vez que sobe, o que estava registrado morreu junto com o túnel anterior. ` +
          `Suba o túnel de novo e atualize ${variavel} E o endereço registrado no app do ${provedor} com o hostname novo, ou aponte os dois para um endereço estável.`,
      };
    }

    if (ehFalhaDeDns(erro)) {
      return {
        ok: false,
        motivo:
          `${abertura} Esse hostname não existe no DNS, não resolve para lugar nenhum, então nem chega a ser uma questão de o serviço estar no ar. ` +
          `Crie o registro apontando ${url.hostname} para onde esta API roda, ou troque ${variavel} por um endereço que já exista.`,
      };
    }

    return {
      ok: false,
      motivo: `${abertura} O hostname resolve, mas ninguém atendeu. Confira se o serviço nesse endereço está no ar e se ${variavel} bate exatamente com o endereço registrado no app do ${provedor}.`,
    };
  }
}
