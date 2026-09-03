/**
 * Bento já tem um serviço de Q&A real em produção: o pacote `bento-qa`,
 * rodando no próprio Mac Mini do Bento (100.93.182.83:8791), que a Susy já
 * usa no WhatsApp (ver agents/suzy/services/bentoAsk.js no susy-service).
 * Ele responde SÓ com o que está no vault e SEMPRE com fonte (barreira
 * aplicada dentro do próprio Bento, em src/answerFormat.js).
 *
 * O cliente HTTP em si vive em @desigual-os/tool-gateway (askBentoQA):
 * compartilhado com apps/worker, que precisa do MESMO caminho pra
 * despachar o Chat central pro Bento (ver apps/worker/src/processors/
 * execute-job.ts) — sem isso teria duas implementações divergindo.
 */
import { askBentoQA, BentoQAError } from '@desigual-os/tool-gateway';

function bentoQAConfig(): { url: string; token: string } {
  const url = process.env.BENTO_QA_URL ?? 'http://100.93.182.83:8791';
  const token = process.env.BENTO_QA_TOKEN;
  if (!token) throw new BentoQAError('BENTO_QA_TOKEN not configured on the Orchestrator', 'config');
  return { url, token };
}

/** Pergunta ao Bento e devolve o texto já formatado, pronto pra postar. */
export async function askBento(question: string): Promise<string> {
  const { text } = await askBentoQA(bentoQAConfig(), question);
  return text;
}

/**
 * Ponto de entrada chamado pelo webhook do ClickUp (ver routes.ts): busca o
 * texto real do comentário que mencionou @Bento e repassa pro bento-qa.
 */
export async function respondAsBento(params: { taskId: string; commentId: string }): Promise<string | null> {
  const question = await fetchClickUpCommentText(params.taskId, params.commentId);
  try {
    return await askBento(question);
  } catch (error) {
    const err = error as BentoQAError;

    // Antes de admitir derrota, tenta o vault direto: melhor entregar o
    // material real com fonte do que só um aviso de erro.
    const doVault = await searchBentoBrain(question);
    if (doVault) return doVault;

    return [
      'Não consegui trazer a resposta do Bento agora.',
      `Motivo: ${err.message}.`,
      'Isso é falha técnica minha ou da máquina dele, não quer dizer que a informação não exista. Não vou chutar nada.',
    ].join('\n');
  }
}

/**
 * Busca direta no brain do Bento (memory-api, POST /memory/search).
 *
 * Existe porque o bento-qa depende de um modelo de linguagem pra REDIGIR a
 * resposta, que pode estar indisponível (ex: sem crédito de API, medido em
 * 03/09/2026). A BUSCA no vault, porém, é independente disso.
 *
 * Então em vez de devolver só "deu erro", devolve o material real do vault
 * com os caminhos dos arquivos. Não é o Bento redigindo — e o texto diz
 * isso com todas as letras, pra ninguém confundir trecho de vault com
 * resposta pensada.
 */
async function searchBentoBrain(question: string): Promise<string | null> {
  const url = process.env.BENTO_MEMORY_API_URL;
  const token = process.env.BENTO_MEMORY_API_TOKEN;
  if (!url || !token) return null;

  try {
    const response = await fetch(`${url}/memory/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: question, top_k: 4 }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return null;

    const body = (await response.json()) as { results?: { path?: string; content?: string }[] };
    const results = body.results ?? [];
    if (results.length === 0) return null;

    const trechos = results
      .map((r, i) => `[${i + 1}] ${r.path ?? 'sem caminho'}\n${(r.content ?? '').slice(0, 400).trim()}`)
      .join('\n\n');

    return [
      'O Bento não conseguiu REDIGIR a resposta agora (o modelo de linguagem dele está indisponível),',
      'mas achei no vault dele o material que responde isso. Trechos reais, sem interpretação minha:',
      '',
      trechos,
    ].join('\n');
  } catch {
    return null;
  }
}

export async function fetchClickUpCommentText(taskId: string, commentId: string): Promise<string> {
  const apiKey = process.env.CLICKUP_API_KEY;
  if (!apiKey) return '(não foi possível carregar o texto do comentário: CLICKUP_API_KEY ausente)';

  const response = await fetch(`https://api.clickup.com/api/v2/task/${taskId}/comment`, { headers: { Authorization: apiKey } });
  if (!response.ok) return '(não foi possível carregar o texto do comentário)';

  const data = (await response.json()) as { comments?: { id: string; comment_text?: string }[] };
  const comment = data.comments?.find((c) => c.id === commentId);
  return comment?.comment_text ?? '(comentário não encontrado)';
}
