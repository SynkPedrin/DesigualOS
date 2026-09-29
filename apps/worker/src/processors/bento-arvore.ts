/**
 * bento-arvore.ts — parar de listar fato e passar a explicar o sistema.
 *
 * Pedido da operação (29/09/2026), com a régua dita em duas frases:
 *
 *   Bento bom:          "Você tem 14 tarefas atrasadas."
 *   Bento impressionante: "Você tem 14 atrasadas, mas 9 não são o problema. O
 *                        risco está em 5 tarefas de duas frentes, porque
 *                        dependem de duas pessoas já sobrecarregadas."
 *
 * A diferença entre as duas frases não é escrita, é ESTRUTURA: a segunda só
 * existe se alguém souber a que entrega cada tarefa pertence, quem a sustenta,
 * e o que está parado esperando outra coisa.
 *
 * ONDE ESSA ESTRUTURA ESTAVA, E ONDE ELA NÃO ESTAVA
 *
 * Medido no workspace real, nos três maiores clientes (29/09/2026):
 *
 *   dependencies  ....... 0 de 253    <- a agência NÃO usa dependência do ClickUp
 *   linked_tasks  ....... 0 de 253
 *   subtarefa (parent) .. 221 de 253  (84% a 91% por cliente)
 *   aguardando aprovação   2 a 5 por cliente
 *
 * Ou seja: montar "essa task depende daquela" em cima de `dependencies` daria
 * uma análise vazia com cara de análise — o mesmo erro que a pasta do ClickUp
 * ("CLIENTES ATIVOS" em 411 de 411) já tinha quase induzido antes. A relação
 * que esta operação de fato mantém é a ÁRVORE DE SUBTAREFA, e ela estava sendo
 * jogada fora: o campo `parent` sempre veio na listagem e nunca foi lido.
 *
 * A árvore real de um cliente, lida do ClickUp:
 *
 *   DC_Aprosoja                          <- frente
 *   ├─ DC_Aprosoja_Captação              pronto
 *   ├─ DC_Aprosoja_Roteiros              pronto
 *   ├─ DC_Aprosoja_Vídeo Painel de Led   pronto
 *   │  ├─ _Bases    (Gui)
 *   │  └─ _Edição   (Celso)
 *   └─ DC_Aprosoja_Edições               aberto, 7 peças, 6 com Junior Antunes
 *
 * O QUE ESTE ARQUIVO SE PROÍBE DE DIZER
 *
 * Que uma tarefa depende de outra. O dado não existe, e inventar precedência a
 * partir do nome ("edição vem depois de layout") seria exatamente o tipo de
 * frase que parece pensada e não tem lastro — a pior falha possível, porque
 * ninguém confere o que parece raciocinado.
 *
 * O que ele afirma é só o que a árvore e os campos sustentam: a que frente a
 * tarefa pertence, quanto daquela frente já está pronto, quem a sustenta
 * sozinho, o que está parado em aprovação e o que não tem dono. A causa é
 * apurada, nunca opinada — a mesma regra dos números do panorama.
 */

import type { OperationTask } from '@desigual-os/tool-gateway';

export interface NoDaArvore {
  task: OperationTask;
  filhos: NoDaArvore[];
}

export interface Frente {
  /** A tarefa-mãe. Quando a raiz não veio na listagem, é a peça mais alta que veio. */
  raiz: OperationTask;
  /** Todas as descendentes, em qualquer profundidade, incluindo a própria raiz. */
  pecas: OperationTask[];
  prontas: number;
  abertas: number;
  atrasadas: number;
  semDono: number;
  emAprovacao: number;
  /** Quem sustenta, do que mais carrega pro que menos. */
  donos: Array<{ pessoa: string; quantas: number }>;
  /** O prazo aberto mais próximo, em ms. `null` = nada com prazo. */
  proximoPrazo: number | null;
}

function estaFechada(t: OperationTask): boolean {
  return t.statusType === 'done' || t.statusType === 'closed';
}

function esperandoAprovacao(t: OperationTask): boolean {
  return /aprova/i.test(t.status ?? '');
}

function meiaNoite(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Monta a floresta. Tarefa cujo pai não veio na listagem vira raiz — é o caso
 * de 2 dos 21 pais medidos na D. Carvalho, e derrubar a árvore inteira por
 * causa de um pai ausente perderia as outras 19.
 */
export function montarArvore(tasks: OperationTask[]): NoDaArvore[] {
  const porId = new Map(tasks.map((t) => [t.id, t]));
  const nos = new Map<string, NoDaArvore>(tasks.map((t) => [t.id, { task: t, filhos: [] }]));
  const raizes: NoDaArvore[] = [];
  for (const t of tasks) {
    const no = nos.get(t.id)!;
    const pai = t.parentId ? nos.get(t.parentId) : undefined;
    if (pai && porId.has(t.parentId!)) pai.filhos.push(no);
    else raizes.push(no);
  }
  return raizes;
}

function achatar(no: NoDaArvore, dentro: OperationTask[] = []): OperationTask[] {
  dentro.push(no.task);
  for (const f of no.filhos) achatar(f, dentro);
  return dentro;
}

/**
 * As frentes de um cliente. Só entra raiz que tem filho: tarefa solta é tarefa
 * solta, e chamar isso de "frente de uma peça" encheria a resposta de linhas
 * que não ajudam ninguém a decidir nada.
 */
export function apurarFrentes(tasks: OperationTask[], agora: Date = new Date()): Frente[] {
  const hoje = meiaNoite(agora);
  return montarArvore(tasks)
    .filter((r) => r.filhos.length > 0)
    .map((raiz) => {
      const pecas = achatar(raiz);
      const abertas = pecas.filter((t) => !estaFechada(t));
      const carga = new Map<string, number>();
      for (const t of abertas) for (const p of t.assignees) carga.set(p, (carga.get(p) ?? 0) + 1);
      const prazos = abertas.map((t) => t.dueDate).filter((d): d is number => d !== null);
      return {
        raiz: raiz.task,
        pecas,
        prontas: pecas.length - abertas.length,
        abertas: abertas.length,
        atrasadas: abertas.filter((t) => t.dueDate !== null && t.dueDate < hoje).length,
        semDono: abertas.filter((t) => t.assignees.length === 0).length,
        emAprovacao: abertas.filter(esperandoAprovacao).length,
        donos: [...carga.entries()].map(([pessoa, quantas]) => ({ pessoa, quantas })).sort((a, b) => b.quantas - a.quantas),
        proximoPrazo: prazos.length > 0 ? Math.min(...prazos) : null,
      };
    })
    .sort((a, b) => b.atrasadas - a.atrasadas || b.abertas - a.abertas);
}

/** A frente a que uma tarefa pertence, pra responder "isso é parte de quê?". */
export function frenteDaTask(taskId: string, frentes: Frente[]): Frente | null {
  return frentes.find((f) => f.pecas.some((p) => p.id === taskId)) ?? null;
}

// ---------------------------------------------------------------------------
// CAUSA: por que este cliente está em risco, e não só quanto.
// ---------------------------------------------------------------------------

export interface Causa {
  /** Como a linha aparece na resposta. */
  texto: string;
  /** Quantas das atrasadas esta causa explica. Serve pra separar o que importa. */
  explica: number;
}

export interface Diagnostico {
  atrasadas: number;
  /** As causas, da que mais explica pra que menos. */
  causas: Causa[];
  /**
   * Atrasadas que nenhuma causa sistêmica explica. São a cauda longa: peça
   * velha, avulsa, sem padrão. É o "9 não são o problema" — dizer isso em voz
   * alta é o que impede a pessoa de tratar 14 coisas com a mesma urgência.
   */
  semPadrao: number;
}

/** Abaixo disso não é concentração, é coincidência. */
const MINIMO_PRA_SER_CAUSA = 2;

/**
 * Explica o atraso de um cliente. Cada causa é uma contagem sobre as tarefas
 * ATRASADAS — nunca uma leitura sobre elas.
 */
export function diagnosticar(tasks: OperationTask[], agora: Date = new Date()): Diagnostico {
  const hoje = meiaNoite(agora);
  const abertas = tasks.filter((t) => !estaFechada(t));
  const atrasadas = abertas.filter((t) => t.dueDate !== null && t.dueDate < hoje);
  if (atrasadas.length === 0) return { atrasadas: 0, causas: [], semPadrao: 0 };

  const frentes = apurarFrentes(tasks, agora);
  const explicadas = new Set<string>();
  const causas: Causa[] = [];

  // 1. CONCENTRAÇÃO EM FRENTE. "4 das 7 estão na mesma entrega" muda a ação:
  // não são sete problemas, é um.
  for (const f of frentes) {
    const dela = atrasadas.filter((t) => f.pecas.some((p) => p.id === t.id));
    if (dela.length < MINIMO_PRA_SER_CAUSA) continue;
    for (const t of dela) explicadas.add(t.id);
    const dono = f.donos[0];
    causas.push({
      texto:
        `${dela.length} estão na mesma frente, ${f.raiz.name}` +
        (dono && dono.quantas >= dela.length ? `, toda ela sustentada por ${dono.pessoa}` : '') +
        (f.prontas > 0 ? ` (${f.prontas} de ${f.pecas.length} peças já entregues)` : ''),
      explica: dela.length,
    });
  }

  // 2. PESSOA ÚNICA. A mesma pessoa segurando várias atrasadas de frentes
  // diferentes é um gargalo de gente, não de entrega — e a ação é outra.
  const porPessoa = new Map<string, OperationTask[]>();
  for (const t of atrasadas) {
    for (const p of t.assignees) {
      const l = porPessoa.get(p) ?? [];
      l.push(t);
      porPessoa.set(p, l);
    }
  }
  for (const [pessoa, dela] of [...porPessoa.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (dela.length < MINIMO_PRA_SER_CAUSA) continue;
    const frentesDaPessoa = new Set(dela.map((t) => frenteDaTask(t.id, frentes)?.raiz.id ?? t.id));
    // Se está tudo na mesma frente, a causa 1 já disse. Só vira causa nova
    // quando a pessoa aparece em MAIS DE UMA entrega.
    if (frentesDaPessoa.size < 2) continue;
    for (const t of dela) explicadas.add(t.id);
    const outrasNaJanela = abertas.filter(
      (t) => t.assignees.includes(pessoa) && t.dueDate !== null && t.dueDate >= hoje && t.dueDate < hoje + 7 * 86_400_000,
    ).length;
    causas.push({
      texto:
        `${dela.length} dependem de ${pessoa}, em ${frentesDaPessoa.size} frentes diferentes` +
        (outrasNaJanela > 0 ? `, e ele(a) ainda tem ${outrasNaJanela} com prazo nos próximos 7 dias` : ''),
      explica: dela.length,
    });
  }

  // 3. PARADAS EM APROVAÇÃO. Não é atraso da equipe: é a agência esperando
  // resposta. Misturar as duas coisas manda cobrar a pessoa errada.
  const emAprovacao = atrasadas.filter(esperandoAprovacao);
  if (emAprovacao.length >= 1) {
    for (const t of emAprovacao) explicadas.add(t.id);
    causas.push({
      texto: `${emAprovacao.length} não estão paradas na equipe: estão aguardando aprovação`,
      explica: emAprovacao.length,
    });
  }

  // 4. SEM DONO. Ninguém vai puxar o que não é de ninguém.
  const semDono = atrasadas.filter((t) => t.assignees.length === 0);
  if (semDono.length >= MINIMO_PRA_SER_CAUSA) {
    for (const t of semDono) explicadas.add(t.id);
    causas.push({
      texto: `${semDono.length} não têm responsável — não vão andar sozinhas`,
      explica: semDono.length,
    });
  }

  return {
    atrasadas: atrasadas.length,
    causas: causas.sort((a, b) => b.explica - a.explica),
    semPadrao: atrasadas.filter((t) => !explicadas.has(t.id)).length,
  };
}

// ---------------------------------------------------------------------------
// O bloco que entra no turno.
// ---------------------------------------------------------------------------

function emDias(prazo: number, agora: Date): string {
  const dias = Math.round((prazo - meiaNoite(agora)) / 86_400_000);
  if (dias < 0) return `venceu há ${Math.abs(dias)}d`;
  if (dias === 0) return 'vence hoje';
  return `em ${dias}d`;
}

/**
 * Devolve null quando o cliente não tem árvore nem atraso: bloco que não
 * explica nada só gasta contexto e ensina o modelo a ignorar o bloco.
 */
export function blocoRelacional(params: {
  clientName: string;
  tasks: OperationTask[];
  agora?: Date;
}): string | null {
  const agora = params.agora ?? new Date();
  const frentes = apurarFrentes(params.tasks, agora);
  const diag = diagnosticar(params.tasks, agora);
  if (frentes.length === 0 && diag.causas.length === 0) return null;

  const linhas: string[] = [`COMO ${params.clientName.toUpperCase()} ESTÁ ESTRUTURADA (apurado da árvore de subtarefas do ClickUp):`];

  if (frentes.length > 0) {
    linhas.push(
      'Cada frente é uma tarefa-mãe com suas peças. Quando a pergunta for sobre uma tarefa, diga a que frente ela pertence.',
    );
    for (const f of frentes.slice(0, 6)) {
      const donos = f.donos.slice(0, 3).map((d) => `${d.pessoa} (${d.quantas})`).join(', ');
      linhas.push(
        `- ${f.raiz.name}: ${f.prontas}/${f.pecas.length} peças prontas, ${f.abertas} abertas` +
          (f.atrasadas > 0 ? `, ${f.atrasadas} atrasadas` : '') +
          (f.emAprovacao > 0 ? `, ${f.emAprovacao} em aprovação` : '') +
          (f.semDono > 0 ? `, ${f.semDono} sem dono` : '') +
          (f.proximoPrazo !== null ? ` · prazo mais próximo ${emDias(f.proximoPrazo, agora)}` : '') +
          (donos ? ` · ${donos}` : ''),
      );
    }
  }

  if (diag.causas.length > 0) {
    linhas.push(
      '',
      `POR QUE ${params.clientName.toUpperCase()} ESTÁ ASSIM (${diag.atrasadas} atrasadas, e o que as explica):`,
      ...diag.causas.map((c) => `- ${c.texto}`),
    );
    if (diag.semPadrao > 0) {
      linhas.push(
        diag.semPadrao === 1
          ? '- 1 é avulsa, sem causa comum com as outras'
          : `- as outras ${diag.semPadrao} são avulsas, sem causa comum entre si`,
      );
    }
    linhas.push(
      // Sem este aviso o modelo soma as causas e cria um total que não existe:
      // na Cosentino elas somam 41 num cliente com 24 atrasadas, porque uma
      // tarefa sem dono dentro de uma frente concentrada conta nas duas.
      'ATENÇÃO: as causas SE SOBREPÕEM — a mesma tarefa aparece em mais de uma. Nunca some os números das causas,',
      `e nunca apresente um total diferente de ${diag.atrasadas}.`,
      'Quando perguntarem o que está em risco, responda pela CAUSA, não pela contagem: diga o que explica o atraso,',
      'e o que NÃO é o problema. Não invente causa que não esteja nesta lista, e não afirme que uma tarefa depende de',
      'outra — a agência não registra dependência no ClickUp, então isso você não sabe.',
    );
  }

  return linhas.join('\n');
}

/**
 * A mesma análise, escrita PRA PESSOA em vez de pro modelo.
 *
 * `blocoRelacional` acima é instrução de prompt ("responda pela CAUSA, não
 * invente..."). Isto é resposta: sai pronta no chat, sem passar por modelo
 * nenhum, e por isso não tem como alucinar nem custa token.
 *
 * Existe porque a primeira versão falhou ao vivo de um jeito instrutivo: com a
 * análise só no prompt, "o que está em risco na Cosentino?" foi capturada pelo
 * caminho do panorama, que responde antes da montagem do contexto — o bloco
 * nunca chegou ao modelo (zero ocorrências no log) e a resposta voltou listando
 * 25 tarefas, exatamente o que o panorama existe pra evitar.
 */
export function explicacaoParaPessoa(params: {
  clientName: string;
  tasks: OperationTask[];
  agora?: Date;
}): string | null {
  const agora = params.agora ?? new Date();
  const diag = diagnosticar(params.tasks, agora);
  const frentes = apurarFrentes(params.tasks, agora);
  if (diag.atrasadas === 0 && frentes.length === 0) return null;

  const linhas: string[] = [];

  if (diag.causas.length > 0) {
    const principal = diag.causas[0]!;
    const resto = diag.atrasadas - principal.explica;
    linhas.push(
      `${params.clientName} tem ${diag.atrasadas} tarefas atrasadas, e elas não pesam igual.`,
      '',
      `O que concentra o risco: ${principal.texto.charAt(0).toLowerCase()}${principal.texto.slice(1)}.`,
    );
    if (diag.causas.length > 1) {
      linhas.push('', 'O resto do atraso se explica assim:');
      for (const c of diag.causas.slice(1)) linhas.push(`- ${c.texto}`);
    }
    if (diag.semPadrao > 0) {
      linhas.push(
        '',
        diag.semPadrao === 1
          ? 'Sobra 1 tarefa avulsa, sem relação com as outras — essa dá pra tratar por último.'
          : `Sobram ${diag.semPadrao} tarefas avulsas, sem relação entre si — essas dão pra tratar por último.`,
      );
    } else if (resto > 0) {
      linhas.push('', 'As demais estão cobertas pelas causas acima, então são menos problemas do que parece pelo número.');
    }
  }

  const emRisco = frentes.filter((f) => f.atrasadas > 0 || f.semDono > 0).slice(0, 4);
  if (emRisco.length > 0) {
    linhas.push('', 'Por entrega:');
    for (const f of emRisco) {
      const dono = f.donos[0];
      linhas.push(
        `- ${f.raiz.name}: ${f.prontas} de ${f.pecas.length} peças prontas` +
          (f.atrasadas > 0 ? `, ${f.atrasadas} atrasada(s)` : '') +
          (f.semDono > 0 ? `, ${f.semDono} sem responsável` : '') +
          (f.emAprovacao > 0 ? `, ${f.emAprovacao} esperando aprovação` : '') +
          (dono ? ` · quem sustenta: ${dono.pessoa}` : ''),
      );
    }
  }

  // A oferta de ação, que é o que separa relatório de alguém acompanhando
  // junto. Fica como PERGUNTA: redistribuir responsável sem pedir seria
  // mexer na operação de outra pessoa por conta própria.
  const semDonoTotal = frentes.reduce((s, f) => s + f.semDono, 0);
  if (semDonoTotal > 0 || diag.causas.some((c) => c.texto.includes('dependem de'))) {
    linhas.push(
      '',
      semDonoTotal > 0
        ? `Se quiser, eu distribuo as ${semDonoTotal} sem responsável e reorganizo os prazos, sem mexer no que está em aprovação.`
        : 'Se quiser, eu reorganizo responsáveis e prazos, sem mexer no que está em aprovação.',
    );
  }

  return linhas.join('\n');
}
