import { afterEach, describe, expect, it, vi } from 'vitest';
import { conferirEnderecoDeRetorno } from './endereco-de-retorno';

/**
 * A ARMADILHA, em uma frase: `CLICKUP_REDIRECT_URI` apontava para um túnel
 * efêmero do Cloudflare que já tinha morrido, e o sintoma aparecia no domínio
 * do ClickUp ("Opa! Não foi possível autorizar suas equipes") — longe daqui,
 * sem dizer nada e sem volta. Estes testes travam o que passou a acontecer no
 * lugar disso.
 */

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

function fetchQueFalha(code?: string) {
  const erro = new TypeError('fetch failed');
  if (code) (erro as { cause?: unknown }).cause = { code };
  globalThis.fetch = vi.fn().mockRejectedValue(erro) as typeof fetch;
}

function fetchQueResponde(status = 404) {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status })) as typeof fetch;
}

describe('conferirEnderecoDeRetorno', () => {
  it('host que responde: segue o fluxo', async () => {
    fetchQueResponde(200);
    const r = await conferirEnderecoDeRetorno('https://app.desigual.com/cb', 'ClickUp', 'CLICKUP_REDIRECT_URI');
    expect(r.ok).toBe(true);
  });

  /** Qualquer resposta prova que o host está de pé — inclusive 404 ou 500. O
   *  que se quer saber é se existe alguém atendendo, não o que ele responde. */
  it('404 na origem ainda conta como alcançável', async () => {
    fetchQueResponde(404);
    const r = await conferirEnderecoDeRetorno('https://app.desigual.com/cb', 'ClickUp', 'CLICKUP_REDIRECT_URI');
    expect(r.ok).toBe(true);
  });

  it('host morto: recusa com o host e a variável na mensagem', async () => {
    fetchQueFalha('ECONNREFUSED');
    const r = await conferirEnderecoDeRetorno('https://api.desigual.com/cb', 'ClickUp', 'CLICKUP_REDIRECT_URI');
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('api.desigual.com');
    expect(r.motivo).toContain('CLICKUP_REDIRECT_URI');
  });

  /** O caso real: o recado tem que dizer que o endereço MUDA, senão a pessoa
   *  sobe o túnel de novo e não entende por que continua quebrado. */
  /**
   * Um túnel morto falha JUSTAMENTE no DNS — por isso este teste manda
   * ENOTFOUND de propósito. O diagnóstico de túnel tem que vencer o de DNS,
   * senão a mensagem manda criar registro para um domínio que não é nosso.
   */
  it('túnel efêmero morto: explica que o endereço muda, e NÃO manda criar DNS', async () => {
    fetchQueFalha('ENOTFOUND');
    const r = await conferirEnderecoDeRetorno(
      'https://expiration-cigarettes-throat-grass.trycloudflare.com/integrations/clickup/callback',
      'ClickUp',
      'CLICKUP_REDIRECT_URI',
    );
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('túnel temporário');
    expect(r.motivo).toContain('endereço novo');
    expect(r.motivo).not.toContain('Crie o registro');
  });

  /**
   * O caso real do Notion (07/10/2026): `api.agenciadesigual.com.br` não tinha
   * registro de DNS nenhum. O apex do domínio existia (apontando para a
   * Vercel), o `api.` não. Dizer "confira se o serviço está no ar" mandaria a
   * pessoa olhar o servidor quando o que falta é uma linha de DNS.
   */
  it('hostname que não resolve: fala de DNS, não de serviço fora do ar', async () => {
    fetchQueFalha('ENOTFOUND');

    const r = await conferirEnderecoDeRetorno(
      'https://api.agenciadesigual.com.br/integrations/notion/callback',
      'Notion',
      'NOTION_REDIRECT_URI',
    );

    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('não existe no DNS');
    expect(r.motivo).toContain('api.agenciadesigual.com.br');
    expect(r.motivo).not.toContain('está no ar');
  });

  it('host que resolve mas recusa conexão: fala de serviço, não de DNS', async () => {
    fetchQueFalha('ECONNREFUSED');

    const r = await conferirEnderecoDeRetorno('https://api.desigual.com/cb', 'Notion', 'NOTION_REDIRECT_URI');

    expect(r.ok).toBe(false);
    expect(r.motivo).not.toContain('DNS');
    expect(r.motivo).toContain('ninguém atendeu');
  });

  it('ngrok também é reconhecido como efêmero', async () => {
    fetchQueFalha('ENOTFOUND');
    const r = await conferirEnderecoDeRetorno('https://abc.ngrok-free.app/cb', 'Meta', 'META_REDIRECT_URI');
    expect(r.motivo).toContain('túnel temporário');
    expect(r.motivo).toContain('Meta');
  });

  /** Nome parecido não é o mesmo domínio: `trycloudflare.com.golpe.io` não
   *  pode ser tratado como túnel conhecido. */
  it('sufixo parecido não conta como efêmero', async () => {
    fetchQueFalha('ENOTFOUND');
    const r = await conferirEnderecoDeRetorno('https://trycloudflare.com.outro.io/cb', 'ClickUp', 'CLICKUP_REDIRECT_URI');
    expect(r.motivo).not.toContain('túnel temporário');
  });

  /** Em dev quem atende ali é esta própria API: sondar a si mesma no meio de
   *  outra requisição é prender o event loop à toa. */
  it('localhost passa sem sondar', async () => {
    const espiao = vi.fn();
    globalThis.fetch = espiao as unknown as typeof fetch;
    const r = await conferirEnderecoDeRetorno('http://localhost:3001/cb', 'ClickUp', 'CLICKUP_REDIRECT_URI');
    expect(r.ok).toBe(true);
    expect(espiao).not.toHaveBeenCalled();
  });

  it('endereço inválido é recusado sem rede', async () => {
    const espiao = vi.fn();
    globalThis.fetch = espiao as unknown as typeof fetch;
    const r = await conferirEnderecoDeRetorno('isso não é url', 'ClickUp', 'CLICKUP_REDIRECT_URI');
    expect(r.ok).toBe(false);
    expect(espiao).not.toHaveBeenCalled();
  });
});
