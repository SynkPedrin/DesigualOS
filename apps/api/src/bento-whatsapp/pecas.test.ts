import { describe, expect, it, vi } from 'vitest';

// O provedor OpenAI carrega o banco na importação; aqui nenhum teste usa banco.
vi.mock('@desigual-os/database', () => ({ db: {}, schema: {} }));
import { interpretarAtalho } from './commands';
import { dividirEmPartes, markdownParaWhatsapp } from './format';
import {
  extrairCodigoDeVinculo,
  gerarCodigoDeVinculo,
  hashDoCodigo,
  telefoneDoJid,
  telefoneLegivel,
  telefoneMascarado,
} from './identity';
import { OpenwaClient, OpenwaError } from './openwa/client';
import { assinarComoOpenwa, assinaturaOpenwaValida } from './openwa/signature';
import { confiancaDosSegmentos, pareceAcaoDeEscrita, transcritorOpenAI } from './transcription';

describe('formatação para WhatsApp', () => {
  it('converte sintaxe sem mexer no conteúdo', () => {
    const md = [
      '# Panorama',
      '',
      '**3 tarefas** vencem hoje:',
      '* Post da Cosentino — __Tammy__',
      '1. Revisar ~~LP~~ campanha',
      '[ClickUp](https://app.clickup.com/t/abc)',
      '---',
      '```',
      '**não mexe aqui**',
      '```',
    ].join('\n');
    expect(markdownParaWhatsapp(md)).toBe(
      [
        '*Panorama*',
        '',
        '*3 tarefas* vencem hoje:',
        '- Post da Cosentino — *Tammy*',
        '1. Revisar ~LP~ campanha',
        'ClickUp (https://app.clickup.com/t/abc)',
        '',
        '```',
        '**não mexe aqui**',
        '```',
      ].join('\n'),
    );
  });

  it('tabela vira linhas legíveis', () => {
    const md = '| Tarefa | Prazo |\n|---|---|\n| Post | 14/10 |';
    expect(markdownParaWhatsapp(md)).toBe('Tarefa · Prazo\nPost · 14/10');
  });

  it('corta em parágrafo e nunca perde texto', () => {
    const paragrafos = Array.from({ length: 30 }, (_, i) => `Parágrafo ${i} ` + 'x'.repeat(200));
    const texto = paragrafos.join('\n\n');
    const partes = dividirEmPartes(texto, 1_000);
    expect(partes.length).toBeGreaterThan(1);
    expect(partes.length).toBeLessThanOrEqual(5);
    expect(partes.join('').replace(/\s/g, '')).toBe(texto.replace(/\s/g, ''));
    expect(partes.slice(0, -1).every((p) => p.length <= 1_000)).toBe(true);
  });

  it('texto curto fica numa mensagem só', () => {
    expect(dividirEmPartes('oi')).toEqual(['oi']);
  });
});

describe('identidade', () => {
  it('telefone só sai de JID de pessoa', () => {
    expect(telefoneDoJid('5518997987295@c.us')).toBe('5518997987295');
    expect(telefoneDoJid('5518997987295:12@s.whatsapp.net')).toBe('5518997987295');
    expect(telefoneDoJid('99887766@lid')).toBeNull();
    expect(telefoneDoJid('120363@g.us')).toBeNull();
  });

  it('formata e mascara número brasileiro', () => {
    expect(telefoneLegivel('5518997987295')).toBe('+55 18 99798-7295');
    expect(telefoneMascarado('5518997987295')).toBe('+55 18 9****-7295');
  });

  it('código: formato, aleatoriedade e extração tolerante', () => {
    const codigos = new Set(Array.from({ length: 500 }, () => gerarCodigoDeVinculo()));
    expect(codigos.size).toBe(500);
    for (const c of codigos) expect(c).toMatch(/^BENTO-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(extrairCodigoDeVinculo('oi, meu código é bento-ab3k-9xqp!')).toBe('BENTO-AB3K-9XQP');
    expect(extrairCodigoDeVinculo('BENTO AB3K 9XQP')).toBe('BENTO-AB3K-9XQP');
    expect(extrairCodigoDeVinculo('bento, quais tarefas?')).toBeNull();
  });

  it('hash do código ignora forma (hífen, caixa) e não é o próprio código', () => {
    expect(hashDoCodigo('BENTO-AB3K-9XQP')).toBe(hashDoCodigo('bento ab3k9xqp'));
    expect(hashDoCodigo('BENTO-AB3K-9XQP')).not.toContain('AB3K');
    expect(hashDoCodigo('BENTO-AB3K-9XQP')).not.toBe(hashDoCodigo('BENTO-AB3K-9XQR'));
  });
});

describe('assinatura do webhook', () => {
  const corpo = '{"event":"message.received","data":{"id":"x"}}';
  const segredo = 'segredo-de-teste-com-16+';

  it('aceita a assinatura no formato do OpenWA', () => {
    expect(assinaturaOpenwaValida(corpo, assinarComoOpenwa(corpo, segredo), segredo)).toBe(true);
  });

  it('recusa corpo alterado, segredo errado, cabeçalho ausente ou malformado', () => {
    const sig = assinarComoOpenwa(corpo, segredo);
    expect(assinaturaOpenwaValida(corpo.replace('x', 'y'), sig, segredo)).toBe(false);
    expect(assinaturaOpenwaValida(corpo, sig, 'outro-segredo-qualquer')).toBe(false);
    expect(assinaturaOpenwaValida(corpo, undefined, segredo)).toBe(false);
    expect(assinaturaOpenwaValida(corpo, 'sha256=zz', segredo)).toBe(false);
    expect(assinaturaOpenwaValida(corpo, sig, '')).toBe(false);
  });
});

describe('cliente OpenWA (contrato HTTP)', () => {
  function fetchGravado(respostas: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
    const chamadas: Array<{ url: string; init: RequestInit }> = [];
    const impl = (async (url: string, init: RequestInit) => {
      chamadas.push({ url, init });
      const r = respostas.shift()!;
      const corpo = typeof r.body === 'string' || Buffer.isBuffer(r.body) ? r.body : JSON.stringify(r.body);
      return new Response(corpo as ConstructorParameters<typeof Response>[0], { status: r.status, ...(r.headers ? { headers: r.headers } : {}) });
    }) as unknown as typeof fetch;
    return { impl, chamadas };
  }

  it('envia texto pela sessão configurada, com X-API-Key e Idempotency-Key', async () => {
    const { impl, chamadas } = fetchGravado([{ status: 201, body: { messageId: 'true_55@c.us_ABC', timestamp: 1 } }]);
    const cliente = new OpenwaClient({ baseUrl: 'http://openwa:2785', apiKey: 'owa_k1_x', sessionId: 'sess-1', fetchImpl: impl });
    const r = await cliente.sendText({ chatId: '5518@c.us', text: 'oi', idempotencyKey: 'k1' });
    expect(r.messageId).toBe('true_55@c.us_ABC');
    expect(chamadas[0]!.url).toBe('http://openwa:2785/api/sessions/sess-1/messages/send-text');
    const headers = chamadas[0]!.init.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('owa_k1_x');
    expect(headers['Idempotency-Key']).toBe('k1');
    expect(JSON.parse(String(chamadas[0]!.init.body))).toEqual({ chatId: '5518@c.us', text: 'oi', linkPreview: false });
  });

  it('erro 4xx não é repetível; 429/5xx e rede são', async () => {
    const { impl } = fetchGravado([
      { status: 400, body: { statusCode: 400, message: ['chatId must be a string'] } },
      { status: 429, body: { statusCode: 429, message: 'slow down', code: 'SEND_PACING_LIMITED' } },
    ]);
    const cliente = new OpenwaClient({ baseUrl: 'http://o', apiKey: 'k', sessionId: 's', fetchImpl: impl });
    const e1 = await cliente.sendText({ chatId: 'x', text: 'y', idempotencyKey: 'a' }).catch((e) => e);
    expect(e1).toBeInstanceOf(OpenwaError);
    expect(e1.retryable).toBe(false);
    expect(e1.message).toBe('chatId must be a string');
    const e2 = await cliente.sendText({ chatId: 'x', text: 'y', idempotencyKey: 'a' }).catch((e) => e);
    expect(e2.retryable).toBe(true);
    expect(e2.code).toBe('SEND_PACING_LIMITED');

    const quebrado = new OpenwaClient({
      baseUrl: 'http://o', apiKey: 'k', sessionId: 's',
      fetchImpl: (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch,
    });
    const e3 = await quebrado.getSession().catch((e) => e);
    expect(e3.retryable).toBe(true);
    expect(e3.code).toBe('NETWORK');
  });

  it('download de mídia respeita o limite de tamanho', async () => {
    const { impl } = fetchGravado([{ status: 200, body: Buffer.alloc(2_000), headers: { 'content-length': '2000' } }]);
    const cliente = new OpenwaClient({ baseUrl: 'http://o', apiKey: 'k', sessionId: 's', fetchImpl: impl });
    const e = await cliente.downloadMedia({ chatId: 'c@c.us', messageId: 'm', maxBytes: 1_000 }).catch((x) => x);
    expect(e.code).toBe('TOO_LARGE');
  });
});

describe('atalhos', () => {
  it('reconhece só os atalhos conhecidos', () => {
    expect(interpretarAtalho('/ajuda')).toEqual({ tipo: 'ajuda' });
    expect(interpretarAtalho('/novo')).toEqual({ tipo: 'nova_conversa' });
    expect(interpretarAtalho('/tarefas da Cosentino')?.tipo).toBe('pergunta');
    expect(interpretarAtalho('/rm -rf')).toBeNull();
    expect(interpretarAtalho('quais tarefas?')).toBeNull();
  });
});

describe('transcrição', () => {
  it('confiança cai quando o modelo chuta ou não há fala', () => {
    expect(confiancaDosSegmentos([{ avg_logprob: -0.1, no_speech_prob: 0.01 }])!).toBeGreaterThan(0.85);
    expect(confiancaDosSegmentos([{ avg_logprob: -1.5, no_speech_prob: 0.1 }])!).toBeLessThan(0.3);
    expect(confiancaDosSegmentos([{ avg_logprob: -0.1, no_speech_prob: 0.9 }])!).toBeLessThan(0.2);
    expect(confiancaDosSegmentos(undefined)).toBeNull();
  });

  it('detecta pedido de ação (para confirmar antes) e deixa pergunta passar', () => {
    expect(pareceAcaoDeEscrita('cria uma tarefa para a Suzy')).toBe(true);
    expect(pareceAcaoDeEscrita('apaga aquela tarefa')).toBe(true);
    expect(pareceAcaoDeEscrita('muda o prazo para sexta')).toBe(true);
    expect(pareceAcaoDeEscrita('quais são minhas tarefas para amanhã?')).toBe(false);
    expect(pareceAcaoDeEscrita('qual a mais urgente?')).toBe(false);
  });

  it('adaptador OpenAI manda o áudio e lê texto + confiança (sem chamada real)', async () => {
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test';
    try {
      let recebido: FormData | null = null;
      const fetchImpl = (async (_url: string, init: RequestInit) => {
        recebido = init.body as FormData;
        return new Response(JSON.stringify({ text: ' minhas tarefas ', segments: [{ avg_logprob: -0.05, no_speech_prob: 0 }] }), { status: 200 });
      }) as unknown as typeof fetch;
      const r = await transcritorOpenAI({ fetchImpl }).transcrever(Buffer.from('ogg'), 'audio/ogg; codecs=opus');
      expect(r.texto).toBe('minhas tarefas');
      expect(r.confianca!).toBeGreaterThan(0.9);
      expect(recebido!.get('language')).toBe('pt');
    } finally {
      process.env.OPENAI_API_KEY = original;
    }
    // Folga de tempo: o transcritor faz `import()` tardio do pacote do provedor (carrega o
    // banco). Frio custa ~0,2 s sozinho e passa de 1 s com a CPU ocupada; com a suíte inteira
    // em paralelo estourava o limite padrão de 5 s, de forma intermitente (20/10/2026).
  }, 30_000);
});
