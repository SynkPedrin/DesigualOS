/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Comentário do ClickUp (blocos tipo Quill) → markdown simples que a tela sabe mostrar, SEM perder os links:
 * texto com link, anexos, imagens, vídeos, documentos, menções de tarefa, listas, negrito e código.
 * Só leitura do que o ClickUp mandou; nada é inventado — bloco desconhecido cai no próprio texto.
 */
type Bloco = any;

const limpar = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const ehHttp = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u);
const rotulo = (s: string) => s.replace(/[\[\]]/g, '').trim() || 'arquivo';

export function comentarioEmMarkdown(c: { comment?: Bloco[]; comment_text?: string }, linkDaTarefa?: (clickupTaskId: string) => { href: string; chave: string } | undefined): string {
  const blocos = Array.isArray(c.comment) ? c.comment : [];
  if (!blocos.length) return limpar(String(c.comment_text ?? '')).trim();
  const linhas: string[] = [];
  let linha = '';
  const fecha = (lista?: string) => {
    const prefixo = lista === 'bullet' ? '- ' : lista === 'ordered' ? '1. ' : lista === 'checked' ? '- [x] ' : lista === 'unchecked' ? '- [ ] ' : '';
    linhas.push(prefixo + linha);
    linha = '';
  };
  for (const b of blocos) {
    const at = (b.attributes ?? {}) as Record<string, any>;
    const tipo = b.type as string | undefined;
    if (tipo === 'tag') { linha += `@${b.user?.username ?? String(b.text ?? '').replace(/^@/, '')}`; continue; }
    if (tipo === 'emoticon') { linha += String(b.text ?? ''); continue; }
    if (tipo === 'divider' || at.divider || b.divider) { if (linha) fecha(); linhas.push('---'); continue; }
    if (tipo === 'task_mention') {
      const id = String(b.task_mention?.task_id ?? b.text ?? '');
      const alvo = linkDaTarefa?.(id);
      linha += alvo ? `[${alvo.chave}](${alvo.href})` : id ? `[tarefa ${id}](https://app.clickup.com/t/${id})` : '';
      continue;
    }
    const arquivo = tipo === 'attachment' ? b.attachment : tipo === 'image' ? b.image : tipo === 'frame' ? b.frame : null;
    if (arquivo) {
      const url = [arquivo.url_w_query, arquivo.url, arquivo.src].find(ehHttp);
      const nome = rotulo(String(arquivo.title ?? arquivo.name ?? b.text ?? 'arquivo'));
      if (url) { linha += `${tipo === 'image' ? '🖼' : tipo === 'frame' ? '🎬' : '📎'} [${nome}](${url})`; continue; }
    }
    if (tipo === 'bookmark' || tipo === 'link_mention' || tipo === 'link_preview') {
      const url = [b[tipo]?.url, b[tipo]?.id].find(ehHttp);
      if (url) { linha += `[${url}](${url})`; continue; }
    }
    if (tipo === 'chat_comment_embed' || tipo === 'table-embed') { linha += tipo === 'table-embed' ? '[tabela do ClickUp]' : ''; continue; }
    const txt = limpar(String(b.text ?? ''));
    if (txt === '') continue;
    if (txt === '\n') { fecha((at.list as any)?.list); continue; }
    const partes = txt.split('\n');
    partes.forEach((p, i) => {
      if (i > 0) fecha();
      let t = p;
      if (t === '') return;
      if (ehHttp(at.link)) t = at.link === t ? t : `[${t.replace(/[\[\]]/g, '')}](${at.link})`;
      else if (at.bold) t = `**${t.trim()}** `;
      else if (at.code) t = `\`${t}\``;
      linha += t;
    });
  }
  if (linha) fecha();
  return linhas.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
