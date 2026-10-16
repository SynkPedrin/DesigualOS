/**
 * Transcrição de áudio recebido. O projeto NÃO tinha nenhuma (conferido em
 * 16/10/2026: nem STT nem TTS em api, worker ou packages).
 *
 * Por isso o padrão é 'none': o Bento responde que ainda não ouve áudio. O
 * adaptador OpenAI está pronto, mas ligar é decisão de custo — é uma linha de
 * cobrança nova na conta OpenAI que já existe — e precisa de autorização
 * (`BENTO_WHATSAPP_TRANSCRIPTION=openai`).
 *
 * A interface é o ponto de troca: outro provedor (local, por exemplo) entra
 * implementando `Transcritor`, sem mexer no gateway.
 */

export interface Transcricao {
  texto: string;
  /** 0..1 quando o provedor informa; null quando não informa. */
  confianca: number | null;
}

export interface Transcritor {
  transcrever(audio: Buffer, mimetype: string): Promise<Transcricao>;
}

/** Abaixo disto, o canal pede para repetir em vez de agir. */
export const CONFIANCA_MINIMA = 0.55;

function extensaoDoAudio(mimetype: string): string {
  if (mimetype.includes('ogg')) return 'ogg';
  if (mimetype.includes('mpeg') || mimetype.includes('mp3')) return 'mp3';
  if (mimetype.includes('mp4') || mimetype.includes('m4a') || mimetype.includes('aac')) return 'm4a';
  if (mimetype.includes('wav')) return 'wav';
  if (mimetype.includes('webm')) return 'webm';
  return 'ogg';
}

interface SegmentoWhisper {
  avg_logprob?: number;
  no_speech_prob?: number;
}

/**
 * Confiança a partir do `avg_logprob` dos segmentos (verbose_json do Whisper):
 * exp(média) fica em 0..1 e cai rápido quando o modelo está chutando.
 */
export function confiancaDosSegmentos(segmentos: SegmentoWhisper[] | undefined): number | null {
  const validos = (segmentos ?? []).filter((s) => typeof s.avg_logprob === 'number');
  if (!validos.length) return null;
  const media = validos.reduce((soma, s) => soma + (s.avg_logprob as number), 0) / validos.length;
  const semFala = validos.reduce((soma, s) => soma + (s.no_speech_prob ?? 0), 0) / validos.length;
  return Math.max(0, Math.min(1, Math.exp(media) * (1 - semFala)));
}

export function transcritorOpenAI(opcoes: { modelo?: string; fetchImpl?: typeof fetch } = {}): Transcritor {
  const modelo = opcoes.modelo ?? process.env.BENTO_WHATSAPP_TRANSCRIPTION_MODEL ?? 'whisper-1';
  const fetchImpl = opcoes.fetchImpl ?? fetch;
  return {
    async transcrever(audio, mimetype) {
      // Import tardio: o pacote do provedor carrega o banco na importação, e o
      // gateway (que importa este arquivo) precisa continuar testável sem banco.
      const { resolveOpenAICredential } = await import('@desigual-os/openai-provider');
      const { apiKey } = resolveOpenAICredential();
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(audio)], { type: mimetype }), `audio.${extensaoDoAudio(mimetype)}`);
      form.append('model', modelo);
      form.append('language', 'pt');
      form.append('response_format', modelo === 'whisper-1' ? 'verbose_json' : 'json');
      const resposta = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      if (!resposta.ok) throw new Error(`transcrição falhou: HTTP ${resposta.status}`);
      const corpo = (await resposta.json()) as { text?: string; segments?: SegmentoWhisper[] };
      return { texto: (corpo.text ?? '').trim(), confianca: confiancaDosSegmentos(corpo.segments) };
    },
  };
}

/**
 * Pedido que mexe em tarefa. Vindo de áudio, ele passa por uma confirmação do
 * texto transcrito antes de chegar ao Brain — um "apaga" que era "acha" não
 * pode virar ação. Pergunta e consulta seguem direto.
 */
export function pareceAcaoDeEscrita(texto: string): boolean {
  return /\b(cri[aeo]|apag|exclu|delet|remov|mud[aeo]|alter|atualiz|mov[aeo]|atribu|conclu|finaliz|marc[aeo]|adicion|coment|reagend|prorrog|arquiv)/i.test(
    texto,
  );
}
