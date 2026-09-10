/**
 * Regra de ouro de craft da Desigual: NUNCA usar travessão (—) em texto,
 * UI ou resposta de bot. Como os cérebros dos agentes rodam nas máquinas
 * deles (prompts fora deste repo), a garantia é aplicada na borda: todo
 * texto vindo de agente passa por aqui antes de ser persistido ou postado.
 *
 * Conversões: "— " no início de linha vira marcador "- "; " — " no meio da
 * frase vira vírgula (leitura natural em pt-BR); "—" grudado vira hífen.
 * Cobre travessão (—, U+2014), meia-risca (–, U+2013) e hífen ASCII
 * espaçado. Escapes unicode de propósito: o arquivo já perdeu os caracteres
 * literais uma vez e a função virou no-op sem ninguém perceber.
 */
export function stripEmDashes(text: string): string {
  return text
    // Marcador no início da linha, INCLUSIVE indentado ("  - item"): a indentação é preservada.
    // Antes o padrão exigia o marcador na coluna 0, então lista aninhada não casava aqui e caía
    // na regra de baixo.
    .replace(/^([ \t]*)[-–—][ \t]+/gm, '$1- ')
    // Travessão no MEIO da frase vira vírgula. Dois cuidados, os dois por defeito real medido na
    // resposta do briefing da Fratelli (08/09/2026), onde uma lista virou uma fila de vírgulas
    // ("**Ações:**, Criar guias..., Produzir vídeos..."):
    //   1. (?<=\S) exige caractere visível ANTES, senão o próprio recuo de um bullet indentado
    //      ("  - item") casaria como se fosse travessão no meio de frase;
    //   2. [^\S\n] em vez de \s pra NUNCA atravessar quebra de linha, senão "\n  - item" casa e
    //      o item de lista é absorvido pela frase anterior.
    .replace(/(?<=\S)[^\S\n]+[-–—][^\S\n]+/g, ', ')
    .replace(/[–—]/g, '-');
}

/**
 * Marcadores de bloco dos prompts de personalidade (pacote v1.0): os agentes
 * emitem [FIM_BLOCO] pra fatiar a resposta em mensagens separadas, o que só
 * faz sentido no WhatsApp. No chat web e no ClickUp o marcador cru vira lixo
 * visual, então na borda ele vira quebra de parágrafo. Também cobre os blocos
 * de protocolo ([AGUARDA_APROVACAO], [HANDOFF]): o CONTEÚDO deles é
 * informação útil pro usuário, então só as cercas de marcação saem.
 */
export function stripBlockMarkers(text: string): string {
  return text
    .replace(/\[FIM_BLOCO\]/g, '\n\n')
    .replace(/\[\/?AGUARDA_APROVACAO\]/g, '')
    .replace(/\[\/?HANDOFF\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Sintaxe markdown que nenhum canal do agente renderiza (WhatsApp, ClickUp,
 * chat web deste projeto exibem a resposta como texto puro): cabeçalho (#,
 * ##, ###) e negrito/itálico (**, __) apareciam como caractere literal na
 * resposta em vez de virar formatação. Medido ao vivo com o Otto (LLM local,
 * sem controle de formatação garantido só pelo prompt): mesmo pedindo
 * explicitamente "sem markdown" no system prompt, o modelo às vezes ainda
 * gera "### Título" e "**termo**". Backstop na borda, mesma filosofia do
 * stripEmDashes acima - a regra da casa não pode depender só do prompt
 * remoto obedecer 100% das vezes.
 */
export function stripMarkdownArtifacts(text: string): string {
  return text
    // Cabeçalho no início de linha ("### Título", "## Título"): fica só o
    // texto do título, a linha em branco ao redor já vem da própria quebra
    // de parágrafo do modelo.
    .replace(/^[ \t]*#{1,6}[ \t]+(.+)$/gm, '$1')
    // Negrito/itálico ** ou __ ao redor de um trecho: mantém o conteúdo, tira
    // os marcadores (nenhum canal do agente sabe renderizar negrito mesmo).
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const APPROVAL_BLOCK = /\[AGUARDA_APROVACAO\]([\s\S]*?)\[\/AGUARDA_APROVACAO\]/;

/**
 * Extrai o conteúdo de um bloco [AGUARDA_APROVACAO]...[/AGUARDA_APROVACAO]
 * emitido por Jarbas/Suzy (packages/types/src/personalities.ts) quando o
 * prompt manda esperar confirmação humana antes de mexer em budget de Meta
 * Ads ou publicar no Instagram. Até 08/09/2026 esse marcador só era apagado
 * do texto (stripBlockMarkers) - texto de instrução pro LLM, sem nenhuma
 * barreira técnica correspondente. Esta função é o primeiro passo pra
 * transformar isso numa barreira real: quem despacha a resposta usa o
 * retorno pra decidir se segura a ação num tool_call pendente (ver
 * packages/tool-gateway) em vez de deixar a resposta seguir como se a
 * aprovação já tivesse acontecido.
 */
export function extractApprovalProposal(text: string): string | null {
  const match = text.match(APPROVAL_BLOCK);
  const proposal = match?.[1]?.trim();
  return proposal ? proposal : null;
}
