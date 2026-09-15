/**
 * briefing-facts.ts — FATOS do briefing, com procedência.
 *
 * Regra de ouro aplicada ao briefing: o que não foi recuperado de uma fonte
 * real não entra. Cada valor carrega de onde veio (dossiê do cliente, brand
 * kit, memória, comentário da task, pedido do usuário), e o que falta vira
 * pendência explícita — nunca "homens de 25 a 40 anos" inventado pra fechar o
 * template.
 *
 * A extração é por RÓTULO, genérica: o dossiê do cliente é markdown com linhas
 * "- Público: ...", e o mesmo parser serve pra comentário de task e pro texto
 * do pedido. Nada aqui conhece cliente específico.
 */

export interface BriefingFact {
  field: string;
  value: string;
  /** Fonte legível (vai pro rastro interno, não polui o briefing). */
  source: string;
  sourceId?: string | null;
}

/**
 * Rótulo encontrado no texto -> campo do briefing. Sinônimos porque dossiê,
 * comentário e pedido humano nomeiam a mesma coisa de formas diferentes.
 */
const ROTULOS: Array<{ field: string; re: RegExp }> = [
  { field: 'publico', re: /^(p[úu]blico(-alvo)?|target|audi[êe]ncia|persona)$/i },
  { field: 'oferta', re: /^(oferta|promo[çc][ãa]o|pre[çc]o|condi[çc][ãa]o|desconto)$/i },
  { field: 'produto', re: /^(produto|servi[çc]o|neg[óo]cio|segmento|o que [ée])$/i },
  { field: 'objetivo', re: /^(objetivo|meta|goal|objetivo principal)$/i },
  { field: 'tom', re: /^(tom|tom de voz|voz|linguagem)$/i },
  { field: 'posicionamento', re: /^(posicionamento|positioning)$/i },
  { field: 'mensagem', re: /^(mensagem|mensagem principal|proposta de valor|promessa)$/i },
  { field: 'canal', re: /^(canal|canais|m[íi]dia|plataforma)$/i },
  { field: 'formato', re: /^(formato|dimens[ãa]o|propor[çc][ãa]o|tamanho)$/i },
  { field: 'diferenciais', re: /^(diferenciais?|vantagens?|benef[íi]cios?)$/i },
  { field: 'dores', re: /^(dores?|problemas?|dor)$/i },
  { field: 'desejos', re: /^(desejos?|aspira[çc][õo]es)$/i },
  { field: 'objecoes', re: /^(obje[çc][õo]es|barreiras)$/i },
  { field: 'cta', re: /^(cta|chamada para a[çc][ãa]o|call to action)$/i },
  { field: 'prazo', re: /^(prazo|deadline|data|entrega)$/i },
  { field: 'entregaveis', re: /^(entreg[áa]veis?|pe[çc]as?|arquivos?)$/i },
  { field: 'referencias', re: /^(refer[êe]ncias?|inspira[çc][ãa]o|benchmark)$/i },
  { field: 'proibidos', re: /^(proibid[oa]s?|n[ãa]o usar|evitar|restri[çc][õo]es)$/i },
  { field: 'obrigatorios', re: /^(obrigat[óo]ri[oa]s?|must have|incluir)$/i },
  { field: 'metricas', re: /^(m[ée]tricas?|kpis?|indicadores?)$/i },
  { field: 'localizacao', re: /^(localiza[çc][ãa]o|cidade|regi[ãa]o|endere[çc]o)$/i },
  { field: 'trigger', re: /^(trigger|gatilho|disparo|quando)$/i },
  { field: 'input', re: /^(input|entrada|dados de entrada)$/i },
  { field: 'output', re: /^(output|sa[íi]da|resultado)$/i },
  { field: 'integracoes', re: /^(integra[çc][õo]es|sistemas?|ferramentas?)$/i },
  // Rótulos que existiam nas fontes reais e não tinham destino: o fato era
  // recuperado e descartado, e o campo aparecia como pendência mesmo estando
  // escrito no dossiê (achado na bateria de briefing, 15/09/2026).
  { field: 'aprovacao', re: /^(aprova[çc][ãa]o|crit[ée]rios? de aprova[çc][ãa]o|valida[çc][ãa]o|quem aprova)$/i },
  { field: 'situacao', re: /^(situa[çc][ãa]o|contexto|cen[áa]rio)$/i },
  { field: 'historico', re: /^(hist[óo]rico|antecedentes)$/i },
  { field: 'prioridade', re: /^(prioridade|urg[êe]ncia)$/i },
  { field: 'angulo', re: /^([âa]ngulo|abordagem|conceito)$/i },
  { field: 'estilo', re: /^(estilo|dire[çc][ãa]o visual|refer[êe]ncia visual)$/i },
  { field: 'resultado', re: /^(resultado|resultado esperado|expectativa)$/i },
  { field: 'secoes', re: /^(se[çc][õo]es|estrutura da p[áa]gina|blocos)$/i },
  { field: 'conversao', re: /^(convers[ãa]o|crit[ée]rio de convers[ãa]o|meta de convers[ãa]o)$/i },
  { field: 'hook', re: /^(hook|gancho|abertura)$/i },
  { field: 'estrutura', re: /^(estrutura|roteiro|storyboard)$/i },
  { field: 'duracao', re: /^(dura[çc][ãa]o|tempo)$/i },
  { field: 'trigger', re: /^(trigger|gatilho|disparo|quando)$/i },
  { field: 'regras', re: /^(regras?|regras? de neg[óo]cio|l[óo]gica)$/i },
  { field: 'fallback', re: /^(fallback|plano b|quando falhar)$/i },
  { field: 'credenciais', re: /^(credenciais|acessos?|tokens?)$/i },
  { field: 'dependencias', re: /^(depend[êe]ncias?|bloqueios?|pr[ée]-requisitos?)$/i },
  { field: 'assets', re: /^(assets?|materiais?|arquivos de apoio)$/i },
];

const VAZIO = /^(n[ãa]o informado|a definir|n\/a|-|\?|sem informa[çc][ãa]o|desconhecido)$/i;

/** Extrai pares "Rótulo: valor" de qualquer texto (markdown, comentário, pedido). */
export function extractLabeledFacts(texto: string, source: string, sourceId?: string | null): BriefingFact[] {
  const fatos: BriefingFact[] = [];
  for (const linhaCrua of texto.split('\n')) {
    const linha = linhaCrua.replace(/^[\s*\-•#]+/, '').trim();
    const sep = linha.indexOf(':');
    if (sep <= 0 || sep > 40) continue;
    const rotulo = linha.slice(0, sep).trim();
    const valor = linha
      .slice(sep + 1)
      .replace(/^[`*\s]+|[`*\s]+$/g, '')
      .trim();
    if (!valor || VAZIO.test(valor) || valor.length < 2) continue;
    const alvo = ROTULOS.find((r) => r.re.test(rotulo));
    if (!alvo) continue;
    // Primeiro que chega vence: as fontes entram por ordem de autoridade.
    if (fatos.some((x) => x.field === alvo.field)) continue;
    fatos.push({ field: alvo.field, value: valor.slice(0, 400), source, sourceId: sourceId ?? null });
  }
  return fatos;
}

/**
 * Junta fatos de várias fontes respeitando PRECEDÊNCIA: o primeiro a declarar
 * um campo ganha. O caller passa as fontes já na ordem certa (pedido do humano
 * agora > comentário da task > memória > dossiê), porque dado dito agora vale
 * mais que dossiê de meses atrás.
 */
export function mergeFacts(...grupos: BriefingFact[][]): BriefingFact[] {
  const porCampo = new Map<string, BriefingFact>();
  for (const grupo of grupos) {
    for (const fato of grupo) {
      if (!porCampo.has(fato.field)) porCampo.set(fato.field, fato);
    }
  }
  return [...porCampo.values()];
}

export function factFor(fatos: BriefingFact[], field: string): BriefingFact | null {
  return fatos.find((f) => f.field === field) ?? null;
}
