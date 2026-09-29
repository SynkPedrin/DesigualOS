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

/**
 * Rótulos que só aparecem como TÍTULO DE SEÇÃO, nunca como "chave: valor".
 *
 * Medido em 28/09/2026: a 3Net tem 12.000 caracteres de dossiê no vault —
 * "## Quem é", "## Tom de voz", "## Concorrência" — e o briefing dela saía com
 * TUDO em PENDENTE DE CONFIRMAÇÃO. O extrator por rótulo lia o dossiê inteiro
 * e devolvia zero fatos, porque o conhecimento está em prosa embaixo de um
 * título, não numa linha "Público: ...". Conhecimento rico entrando, campo
 * vazio saindo — era esta a causa do briefing raso, junto com o modelo.
 */
/**
 * Seções que existem no vault e NÃO são conhecimento de briefing.
 *
 * "Lacunas a preencher" aparece em 45 dossiês e lista o que FALTA — vira
 * pendência, não fato; mapeá-la por acidente injetaria "falta público, falta
 * tom" no briefing como se fosse informação. "Fontes", "Automações" e
 * "Serviços prestados pela Desigual" descrevem a relação comercial e a
 * infraestrutura, não o cliente que a peça precisa entender.
 */
const SECOES_IGNORADAS =
  /^(lacunas?( a preencher)?|fontes?|[úu]ltima atualiza[çc][ãa]o|servi[çc]os prestados pela desigual|ias? e agentes( envolvidos)?|automa[çc][õo]es|integra[çc][õo]es|pend[êe]ncias|evid[êe]ncias encontradas|riscos problemas|solu[çc][õo]es implementadas|identifica[çc][ãa]o)$/i;

const ROTULOS_DE_SECAO: Array<{ field: string; re: RegExp }> = [
  { field: 'produto', re: /^(quem [ée]|sobre|identidade|o neg[óo]cio|neg[óo]cio|empresa|cliente|contexto do cliente|o que o cliente faz|resumo|resumo executivo)$/i },
  { field: 'publico', re: /^(p[úu]blico|p[úu]blico-alvo|para quem|personas?|audi[êe]ncia|quem compra)$/i },
  { field: 'tom', re: /^(tom de voz|voz da marca|voz verbal|como falamos|linguagem)$/i },
  { field: 'posicionamento', re: /^(posicionamento|como nos posicionamos|concorr[êe]ncia|concorrentes|mercado)$/i },
  { field: 'dores', re: /^(dores|dor do cliente|problemas|o que incomoda|principais necessidades|necessidades)$/i },
  { field: 'desejos', re: /^(desejos|o que querem|aspira[çc][õo]es)$/i },
  { field: 'objecoes', re: /^(obje[çc][õo]es|barreiras|por que n[ãa]o compram)$/i },
  { field: 'diferenciais', re: /^(diferenciais|vantagens|por que n[óo]s|benef[íi]cios)$/i },
  { field: 'proibidos', re: /^(o que evitar|evitar|n[ãa]o fazer|proibido|restri[çc][õo]es|nunca|anti-?patterns?( espec[íi]ficos)?)$/i },
  { field: 'obrigatorios', re: /^(obrigat[óo]rio|sempre|must have|o que n[ãa]o pode faltar|provas e dados autorizados|provas autorizadas)$/i },
  { field: 'oferta', re: /^(oferta|planos?|produtos? e pre[çc]os?|portf[óo]lio|servi[çc]os contratados)$/i },
  { field: 'objetivo', re: /^(objetivo|objetivos|meta|metas|o que buscamos)$/i },
  { field: 'canal', re: /^(canais|canal|onde publicamos|m[íi]dias)$/i },
  { field: 'cta', re: /^(ctas?( aprovados?)?|chamada para a[çc][ãa]o|como convertemos)$/i },
  { field: 'mensagem', re: /^(mensagem|mensagem principal|promessa|proposta de valor)$/i },
  { field: 'historico', re: /^(hist[óo]rico.*|campanhas anteriores|o que j[áa] rodou|projetos e hist[óo]rico|projetos atuais)$/i },
  { field: 'estilo', re: /^(estilo|dire[çc][ãa]o visual|identidade visual|refer[êe]ncias visuais|padr[ãa]o-?ouro)$/i },
  { field: 'localizacao', re: /^(pra[çc]a|regi[ãa]o|cidades?|onde atuamos|cobertura)$/i },
  { field: 'aprovacao', re: /^(aprova[çc][ãa]o|quem aprova|fluxo de aprova[çc][ãa]o)$/i },
];

const VAZIO = /^(n[ãa]o informado|a definir|n\/a|-|\?|sem informa[çc][ãa]o|desconhecido)$/i;

/** Tira numeração, emoji e pontuação de um título: "## 1. IDENTIDADE" -> "identidade". */
function tituloLimpo(bruto: string): string {
  return bruto
    .replace(/[#*`>]/g, ' ')
    .replace(/^\s*\d+[.)\-]?\s*/, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Prosa de uma seção vira valor: sem marcador de lista, sem régua, e com
 * tabela de markdown legível.
 *
 * A tabela importa porque os dossiês reais usam uma pra listar planos e
 * produtos, e concatenar os pipes crus produzia
 * `| Produto | Para quem | |---|---|` dentro do briefing — ruído com cara de
 * dado. A linha separadora some e as células viram "a · b · c".
 */
function corpoLimpo(linhas: string[]): string {
  return linhas
    .map((l) => l.replace(/^[\s*\-•>]+/, '').replace(/\*\*/g, '').trim())
    .filter((l) => l.length > 0 && !/^[-=_]{3,}$/.test(l))
    // Separador de tabela (|---|---|) não é conteúdo.
    .filter((l) => !/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(l))
    .map((l) => (l.startsWith('|') ? l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).filter(Boolean).join(' · ') : l))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Corpo de seção é prosa: cabe mais que um "chave: valor" de uma linha. */
const LIMITE_SECAO = 700;

/**
 * Extrai fatos de um markdown ESTRUTURADO POR SEÇÃO — o formato real dos
 * dossiês do vault. Complementa `extractLabeledFacts`, não o substitui: o
 * mesmo documento costuma ter as duas formas, e um dossiê com "Público: X" na
 * linha e "## Público" mais abaixo deve render o fato uma vez só (o primeiro
 * que chegar vence, como no resto do sistema).
 */
export function extractSectionFacts(texto: string, source: string, sourceId?: string | null): BriefingFact[] {
  const fatos: BriefingFact[] = [];
  const linhas = texto.split('\n');
  let tituloAtual: string | null = null;
  let corpo: string[] = [];

  const fechar = (): void => {
    if (!tituloAtual) return;
    const alvo = SECOES_IGNORADAS.test(tituloAtual) ? undefined : ROTULOS_DE_SECAO.find((r) => r.re.test(tituloAtual!));
    const valor = corpoLimpo(corpo);
    // Seção com uma palavra solta não é fato; é cabeçalho órfão.
    if (alvo && valor.length >= 12 && !VAZIO.test(valor) && !fatos.some((f) => f.field === alvo.field)) {
      fatos.push({ field: alvo.field, value: valor.slice(0, LIMITE_SECAO), source, sourceId: sourceId ?? null });
    }
    tituloAtual = null;
    corpo = [];
  };

  for (const linha of linhas) {
    const cabecalho = /^\s*#{1,4}\s+(.+?)\s*$/.exec(linha);
    if (cabecalho) {
      fechar();
      tituloAtual = tituloLimpo(cabecalho[1]!).toLowerCase();
      continue;
    }
    // Front matter YAML do dossiê não é corpo de seção.
    if (/^---\s*$/.test(linha)) continue;
    if (tituloAtual) corpo.push(linha);
  }
  fechar();
  return fatos;
}

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
