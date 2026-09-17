/**
 * response-provenance.ts — de onde veio o que EU acabei de dizer.
 *
 * O defeito, medido em 17/09/2026 numa conversa real:
 *
 *   — Quem decide na Colpar?
 *   — Fernanda Alves. Informado na conversa em 17/09.        (certo)
 *   — De onde você tirou isso?
 *   — Do dossiê do cliente e do ClickUp.                     (errado)
 *
 * Não é o agente mentindo. A proveniência era montada com as fontes do turno
 * ATUAL, e "isso" se refere ao turno ANTERIOR. Como a pergunta "de onde você
 * tirou isso?" não tem entidade nenhuma, o turno novo não recuperava o
 * episódio, e o que sobrava pra citar era o dossiê — que estava ali, mas não
 * foi o que sustentou a afirmação.
 *
 * Rastreado antes de corrigir: `messages.metadata` nunca era gravada. Não
 * havia o que perder no caminho — a informação nunca era registrada.
 *
 * Duas regras que definem este módulo:
 *
 * 1. NÃO É RACIOCÍNIO. Guardamos a afirmação final e a fonte dela. Nada do
 *    caminho até a conclusão: isso é privado e não ajuda ninguém a auditar.
 *
 * 2. NÃO INVENTA FONTE NOVA. A resposta de follow-up lê o que ficou gravado. Se
 *    não houver registro, diz que não sabe dizer — jamais parte pra uma busca
 *    nova, que produziria uma origem plausível e diferente da verdadeira. Foi
 *    exatamente assim que "conversa" virou "ClickUp".
 */

/** Uma afirmação da resposta e o que a sustentou. */
export interface ClaimComFonte {
  texto: string;
  fontes: string[];
}

export interface ProvenienciaDaResposta {
  claims: ClaimComFonte[];
  /** União das fontes, para o caso de "isso" cobrir a resposta inteira. */
  fontes: string[];
  agente: string;
  em: string;
}

interface EvidenciaMinima {
  type?: string;
  source?: string;
  sourceId?: string | null;
  summary?: string;
  retrievedAt?: string;
}

/**
 * Rótulo LEGÍVEL. "memory_id 928381" não é resposta pra ninguém; o que a pessoa
 * precisa saber é se aquilo veio do ClickUp, do dossiê ou de algo que ela mesma
 * falou — porque é isso que decide se ela confia ou vai conferir.
 */
export function rotuloDaFonte(ev: EvidenciaMinima): string {
  const fonte = (ev.source ?? '').toLowerCase();
  const quando = ev.retrievedAt ? ev.retrievedAt.slice(0, 10) : null;

  if (fonte.startsWith('conversation:learned')) {
    // A data aqui é a do REGISTRO, e é ela que torna a citação verificável:
    // quem falou consegue lembrar de quando foi.
    const naFala = /em (\d{4}-\d{2}-\d{2})/.exec(ev.summary ?? '')?.[1];
    const dia = naFala ?? quando;
    return dia ? `a conversa em que a equipe informou isso, em ${dia}` : 'a conversa em que a equipe informou isso';
  }
  if (fonte.startsWith('memory:episode')) return 'o que ficou registrado em conversa anterior';
  if (fonte.startsWith('campaign.registry')) return 'o registro de campanhas, derivado das tarefas do ClickUp';
  if (fonte.startsWith('people.registry')) return 'o registro de pessoas e relações';
  if (fonte.startsWith('a2a:')) return 'o outro agente, que leu a fonte direto';
  if (fonte.startsWith('vault')) return 'o vault de conhecimento da agência';
  if (fonte.includes('client.profile') || fonte.includes('dossie') || fonte.includes('dossiê')) {
    return 'o dossiê do cliente registrado no sistema';
  }
  if (fonte.includes('clickup') || ev.type === 'clickup_task' || ev.type === 'clickup_comment') {
    return 'o ClickUp, consultado ao vivo';
  }
  if (ev.type === 'memory') return 'a memória do sistema';
  return ev.source && ev.source.length > 0 ? ev.source : 'fonte não identificada';
}

/**
 * Monta o registro compacto a partir do que o turno já produziu: as claims do
 * grounding e as evidências do estado. Reaproveita as duas estruturas de
 * propósito — proveniência que precisa de pipeline próprio vira pipeline que
 * diverge do que o agente de fato usou.
 */
export function montarProveniencia(params: {
  claims: Array<{ text: string; evidence_ids?: string[] }>;
  evidence: EvidenciaMinima[];
  agente: string;
  em?: string;
}): ProvenienciaDaResposta | null {
  const porId = new Map<string, EvidenciaMinima>();
  params.evidence.forEach((e, i) => {
    porId.set(e.sourceId ?? `ev${i}`, e);
  });

  const claims: ClaimComFonte[] = [];
  for (const c of params.claims) {
    const rotulos = [...new Set((c.evidence_ids ?? []).map((id) => porId.get(id)).filter(Boolean).map((e) => rotuloDaFonte(e!)))];
    if (rotulos.length === 0) continue;
    claims.push({ texto: c.text.slice(0, 240), fontes: rotulos });
  }

  const fontes = [...new Set(params.evidence.map((e) => rotuloDaFonte(e)))];
  if (claims.length === 0 && fontes.length === 0) return null;

  return { claims, fontes, agente: params.agente, em: params.em ?? new Date().toISOString() };
}

/**
 * Pergunta ANAFÓRICA sobre a resposta anterior. O que separa estas de "qual a
 * fonte do dossiê da Colpar?" é não terem objeto próprio: elas apontam pra
 * frase que acabou de ser dita.
 */
const APONTA_PRA_ANTERIOR = [
  /\bde onde (?:voce |você )?(?:tirou|tirar|saiu|veio|vc tirou)\b/i,
  /\bd[ea] onde (?:veio|saiu|vieram|sairam|saíram)\b/i,
  /\bqual (?:e |é )?a fonte (?:disso|dessa|desse|dessas|desses)\b/i,
  // O espaço antes do grupo opcional era obrigatório e fazia "como você sabe?"
  // escapar — a forma mais curta e mais comum de todas.
  /\bcomo (?:voce |você |vc )?sabe\b(?:\s+dis[st]o)?/i,
  /\b(?:isso|essa informacao|essa informação|esse dado) (?:veio|saiu) de onde\b/i,
  /\bem que (?:voce |você )?se baseou\b/i,
  /\bbaseado em qu[êe]/i,
  /\bonde (?:voce |você )?(?:viu|leu|achou) isso\b/i,
];

export function ehPerguntaDeFonteAnterior(mensagem: string): boolean {
  const t = (mensagem ?? '').trim();
  // Turno longo não é follow-up: quem escreve um parágrafo está fazendo outra
  // pergunta, e responder com a fonte da anterior seria ignorar o que foi dito.
  if (t.length === 0 || t.length > 160) return false;
  return APONTA_PRA_ANTERIOR.some((re) => re.test(t));
}

/**
 * A resposta, escrita a partir do que ficou gravado.
 *
 * Quando a resposta anterior tinha várias afirmações com fontes DIFERENTES, cada
 * uma é nomeada: dizer só "veio do ClickUp e do dossiê" obriga quem leu a
 * adivinhar qual fato veio de onde, que é o problema original em outra forma.
 */
export function responderFonteAnterior(prov: ProvenienciaDaResposta): string {
  const distintas = [...new Set(prov.claims.flatMap((c) => c.fontes))];

  if (prov.claims.length === 0) {
    return `Isso veio de ${listar(prov.fontes)}.`;
  }
  if (distintas.length <= 1) {
    return `Isso veio de ${listar(distintas.length > 0 ? distintas : prov.fontes)}.`;
  }

  const linhas = ['Cada parte veio de um lugar:'];
  for (const c of prov.claims.slice(0, 4)) {
    linhas.push(`- "${c.texto}" — ${listar(c.fontes)}.`);
  }
  return linhas.join('\n');
}

function listar(xs: string[]): string {
  if (xs.length === 0) return 'fonte não registrada';
  if (xs.length === 1) return xs[0]!;
  return `${xs.slice(0, -1).join(', ')} e ${xs.at(-1)}`;
}
