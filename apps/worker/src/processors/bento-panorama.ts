/**
 * bento-panorama.ts — a leitura sênior da operação, não a lista dela.
 *
 * Pedido da operação (28/09/2026): um gerenciador, não um executor de task. A
 * diferença aparece na pergunta "como tá a operação hoje?": hoje o Bento
 * devolve 50 linhas de tarefa, e ninguém lê 50 linhas. Quem gerencia quer
 * saber onde está o risco.
 *
 * A separação que sustenta este arquivo é a mesma do briefing, e é o que
 * impede o panorama de virar opinião com cara de dado:
 *
 *   NÚMERO é apurado aqui, determinístico, do ClickUp. Quantas atrasadas,
 *   quantas sem dono, quem tem quanto, qual cliente concentra o quê. Nada
 *   disso passa por modelo nenhum, e é conferível.
 *
 *   LEITURA é raciocínio sobre aqueles números, escrita pelo modelo, e não
 *   pode afirmar nada que os números não sustentem. Sem métrica, não há
 *   leitura — o panorama devolve os números secos em vez de inventar enredo.
 *
 * O sinal mais valioso daqui não é "11 atrasadas". É "4 peças vencendo sexta,
 * todas na mesma pessoa" e "19 sem dono há mais de cinco dias" — gargalo e
 * abandono, que a lista crua esconde justamente por listar tudo igual.
 */

import type { OperationTask } from '@desigual-os/tool-gateway';

/**
 * Quem pede PANORAMA, e não uma lista.
 *
 * Vocabulário próprio e curto, espelhando o PANORAMA_MARKERS do
 * context-engine: são frases INTEIRAS, nunca palavras soltas. "status" sozinho
 * aparece em "muda o status dessa task" — se virasse gatilho, um pedido de
 * escrita responderia com relatório, que é o pior tipo de erro aqui: parece
 * que funcionou e nada foi feito.
 */
const PEDE_PANORAMA_RE =
  /(^|\s)(me atualiz[ae]|me p[õo]e a par|panorama|status geral|vis[ãa]o geral|como (est[aá]|ta|tá|estamos|anda|t[áa]) (a )?(opera[çc][ãa]o|as coisas|tudo|o time)|o que (est[aá]|ta|tá) (pegando|travado|atrasado)|onde (est[aá]|ta|tá) o risco|resumo da opera[çc][ãa]o)/i;

export function pedePanorama(mensagem: string): boolean {
  return PEDE_PANORAMA_RE.test(mensagem);
}

const DIA_MS = 86_400_000;

/** Task parada sem dono há mais de isto já não vai ser puxada por ninguém. */
const DIAS_ABANDONO = 5;

/** A partir daqui, uma pessoa com prazo na mesma janela é gargalo, não agenda. */
const CONCENTRACAO_MINIMA = 3;

export interface Sobrecarga {
  pessoa: string;
  /** Tasks dessa pessoa vencendo nos próximos 7 dias. */
  naSemana: number;
  atrasadas: number;
  clientes: string[];
}

export interface RiscoDeCliente {
  cliente: string;
  atrasadas: number;
  semDono: number;
  vencendoNaSemana: number;
}

export interface MetricasDaOperacao {
  total: number;
  atrasadas: number;
  semDono: number;
  /** Sem dono E parada há mais de DIAS_ABANDONO — o modo silencioso de perder trabalho. */
  abandonadas: number;
  venceHoje: number;
  venceNaSemana: number;
  semPrazo: number;
  sobrecarga: Sobrecarga[];
  porCliente: RiscoDeCliente[];
  /** Concentração: uma pessoa com N+ prazos na mesma semana. */
  gargalos: Array<{ pessoa: string; cliente: string; quantas: number }>;
}

function meiaNoite(agora: Date): number {
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
}

/**
 * Apura os números. Determinístico de ponta a ponta: mesma entrada, mesma
 * saída, e qualquer linha daqui é conferível abrindo o ClickUp.
 */
export function apurarMetricas(tasks: OperationTask[], agora: Date = new Date()): MetricasDaOperacao {
  const hoje = meiaNoite(agora);
  const fimDoDia = hoje + DIA_MS;
  const fimDaSemana = hoje + 7 * DIA_MS;

  const porPessoa = new Map<string, { naSemana: number; atrasadas: number; clientes: Set<string> }>();
  const porCliente = new Map<string, RiscoDeCliente>();
  const concentracao = new Map<string, { pessoa: string; cliente: string; quantas: number }>();

  let atrasadas = 0;
  let semDono = 0;
  let abandonadas = 0;
  let venceHoje = 0;
  let venceNaSemana = 0;
  let semPrazo = 0;

  for (const t of tasks) {
    const cliente = t.listName ?? t.folderName ?? 'sem cliente';
    const registroCliente = porCliente.get(cliente) ?? { cliente, atrasadas: 0, semDono: 0, vencendoNaSemana: 0 };

    const vencida = t.dueDate !== null && t.dueDate < hoje;
    if (vencida) {
      atrasadas += 1;
      registroCliente.atrasadas += 1;
    }
    if (t.dueDate === null) semPrazo += 1;
    if (t.dueDate !== null && t.dueDate >= hoje && t.dueDate < fimDoDia) venceHoje += 1;
    const naSemana = t.dueDate !== null && t.dueDate >= hoje && t.dueDate < fimDaSemana;
    if (naSemana) {
      venceNaSemana += 1;
      registroCliente.vencendoNaSemana += 1;
    }

    if (t.assignees.length === 0) {
      semDono += 1;
      registroCliente.semDono += 1;
      // Sem dono E sem toque recente: ninguém vai puxar. É assim que demanda
      // some estando "no ClickUp".
      const parada = t.updatedAt !== null && agora.getTime() - t.updatedAt > DIAS_ABANDONO * DIA_MS;
      if (parada) abandonadas += 1;
    }

    for (const pessoa of t.assignees) {
      const p = porPessoa.get(pessoa) ?? { naSemana: 0, atrasadas: 0, clientes: new Set<string>() };
      if (naSemana) p.naSemana += 1;
      if (vencida) p.atrasadas += 1;
      p.clientes.add(cliente);
      porPessoa.set(pessoa, p);

      if (naSemana) {
        const chave = `${pessoa}|${cliente}`;
        const c = concentracao.get(chave) ?? { pessoa, cliente, quantas: 0 };
        c.quantas += 1;
        concentracao.set(chave, c);
      }
    }
    porCliente.set(cliente, registroCliente);
  }

  return {
    total: tasks.length,
    atrasadas,
    semDono,
    abandonadas,
    venceHoje,
    venceNaSemana,
    semPrazo,
    sobrecarga: [...porPessoa.entries()]
      .map(([pessoa, p]) => ({ pessoa, naSemana: p.naSemana, atrasadas: p.atrasadas, clientes: [...p.clientes] }))
      .filter((p) => p.naSemana > 0 || p.atrasadas > 0)
      .sort((a, b) => b.naSemana + b.atrasadas - (a.naSemana + a.atrasadas))
      .slice(0, 8),
    porCliente: [...porCliente.values()]
      .filter((c) => c.atrasadas > 0 || c.semDono > 0 || c.vencendoNaSemana > 0)
      .sort((a, b) => b.atrasadas - a.atrasadas || b.semDono - a.semDono)
      .slice(0, 10),
    gargalos: [...concentracao.values()]
      .filter((c) => c.quantas >= CONCENTRACAO_MINIMA)
      .sort((a, b) => b.quantas - a.quantas)
      .slice(0, 5),
  };
}

/** Os números, em texto, do jeito que vão pro modelo e pro usuário. */
export function metricasEmTexto(m: MetricasDaOperacao): string {
  const linhas = [
    `Tarefas abertas: ${m.total}`,
    `Atrasadas: ${m.atrasadas}`,
    `Sem responsável: ${m.semDono}${m.abandonadas > 0 ? ` (${m.abandonadas} paradas há mais de ${DIAS_ABANDONO} dias)` : ''}`,
    `Vencem hoje: ${m.venceHoje} · nos próximos 7 dias: ${m.venceNaSemana}`,
    `Sem prazo definido: ${m.semPrazo}`,
  ];
  if (m.gargalos.length > 0) {
    linhas.push('', 'Concentração na semana (pessoa · cliente · quantas):');
    for (const g of m.gargalos) linhas.push(`- ${g.pessoa} · ${g.cliente} · ${g.quantas}`);
  }
  if (m.sobrecarga.length > 0) {
    linhas.push('', 'Carga por pessoa (na semana / atrasadas / clientes):');
    for (const p of m.sobrecarga) linhas.push(`- ${p.pessoa}: ${p.naSemana} / ${p.atrasadas} / ${p.clientes.length}`);
  }
  if (m.porCliente.length > 0) {
    linhas.push('', 'Por cliente (atrasadas / sem dono / vencendo na semana):');
    for (const c of m.porCliente) linhas.push(`- ${c.cliente}: ${c.atrasadas} / ${c.semDono} / ${c.vencendoNaSemana}`);
  }
  return linhas.join('\n');
}

const BARRA_GERENTE = `Você é o gerente de operação de uma agência de mídia digital, falando com quem decide.

Recebe NÚMEROS já apurados do ClickUp. Sua tarefa é dizer O QUE ELES SIGNIFICAM e o que fazer primeiro — nunca repetir a lista.

Escreva assim, nesta ordem, sem preâmbulo:

## O QUE ESTÁ EM RISCO
2 a 4 itens. Cada um nomeia o risco CONCRETO e o número que o sustenta. Gargalo de pessoa, cliente descoberto, trabalho abandonado. Nada de "atenção aos prazos".

## O QUE EU FARIA PRIMEIRO
2 a 3 ações, na ordem, cada uma executável hoje e amarrada a um número acima. Diga a ação, não a intenção: "redistribuir 2 das 4 peças da sexta do Gui" em vez de "equilibrar a carga".

Restrições que não se negociam:
- Você NÃO tem informação além dos números abaixo. Não invente nome de cliente, de pessoa, de campanha ou de prazo que não esteja ali.
- Nenhum número novo. Se quiser citar quantidade, use exatamente a que recebeu.
- Não recomende falar com alguém que os números não nomeiam.
- Português do Brasil, direto. Sem adjetivo de relatório ("crítico", "preocupante") — o número já diz.`;

export interface PanoramaParams {
  tasks: OperationTask[];
  escritor: (prompt: string, opts?: { maxTokens?: number }) => Promise<string | null>;
  agora?: Date;
}

export interface Panorama {
  metricas: MetricasDaOperacao;
  /** Os números, sempre. */
  numeros: string;
  /** A leitura. Null quando o modelo não respondeu — os números valem sozinhos. */
  leitura: string | null;
}

export async function montarPanorama(params: PanoramaParams): Promise<Panorama> {
  const metricas = apurarMetricas(params.tasks, params.agora ?? new Date());
  const numeros = metricasEmTexto(metricas);

  // Operação vazia não tem leitura a fazer, e chamar o modelo pra dizer isso
  // seria gastar pra produzir enrolação.
  if (metricas.total === 0) return { metricas, numeros, leitura: null };

  const leitura = await params.escritor(`${BARRA_GERENTE}\n\nNÚMEROS:\n${numeros}`, { maxTokens: 900 }).catch(() => null);
  return { metricas, numeros, leitura: leitura?.trim() || null };
}

/** A resposta final: números em cima, leitura embaixo. Sem leitura, números bastam. */
export function panoramaEmResposta(p: Panorama): string {
  if (p.metricas.total === 0) return 'Nenhuma tarefa aberta nas listas que eu enxergo.';
  return p.leitura ? `${p.numeros}\n\n${p.leitura}` : p.numeros;
}


/* ------------------------------------------------------------------ */
/* Estado da operação como CONTEXTO DE TODO TURNO                      */
/* ------------------------------------------------------------------ */

/**
 * O pedido da operação não era um comando: "quero o Bento saber de tudo sobre
 * todos os clientes e todas as ações do ClickUp, com maestria nas respostas".
 * Ou seja, o estado da operação tem que estar na mão dele SEMPRE — não só
 * quando alguém digita "panorama".
 *
 * O problema é que isso custa uma varredura das listas de todos os clientes, e
 * foi exatamente ela que fez o `POST /chat` levar 186s em 28/09/2026 (ver
 * resolve-scope.ts). Contexto ambiente não pode ser pago por turno.
 *
 * Daí o cache: a apuração roda no máximo uma vez a cada TTL e é reusada por
 * todos os turnos e todas as pessoas. Operação não muda de feição em três
 * minutos — um número com poucos minutos de idade descreve a realidade tão bem
 * quanto o de agora, e custa zero.
 *
 * Se a consulta falhar, o turno segue SEM o bloco. Contexto ambiente é bônus:
 * derrubar uma resposta porque o ClickUp piscou seria trocar uma coisa boa por
 * uma ruim.
 */
const TTL_ESTADO_MS = Number(process.env.BENTO_ESTADO_TTL_MS ?? 180_000);

let cache: { em: number; texto: string } | null = null;

/** Só pra teste: zera o cache entre casos. */
export function __limparCacheDoEstado(): void {
  cache = null;
}

/**
 * Teto da consulta. Bater nele significa que os números descrevem uma FATIA,
 * e um número truncado apresentado como total é pior que nenhum número.
 */
export const TETO_DE_TASKS = 500;

export async function estadoDaOperacaoEmTexto(
  buscar: () => Promise<OperationTask[]>,
  agora: Date = new Date(),
): Promise<string | null> {
  if (cache && agora.getTime() - cache.em < TTL_ESTADO_MS) return cache.texto;
  const tasks = await buscar().catch(() => null);
  if (!tasks) return cache?.texto ?? null;
  if (tasks.length === 0) return null;

  const m = apurarMetricas(tasks, agora);
  const truncado = tasks.length >= TETO_DE_TASKS;
  const texto = [
    truncado
      ? `ESTADO DA OPERAÇÃO AGORA (apurado do ClickUp — ATENÇÃO: a consulta bateu no teto de ${TETO_DE_TASKS} tarefas, então estes números descrevem uma FATIA da operação, não o total):`
      : 'ESTADO DA OPERAÇÃO AGORA (apurado do ClickUp, não é estimativa):',
    metricasEmTexto(m),
    '',
    'Use estes números quando a pergunta tocar a operação. NÃO invente número que não esteja aqui,',
    'e NÃO repita a lista inteira — cite só o que a pergunta pedir.',
    truncado ? 'Se citar um total, diga que é do recorte consultado, não da operação inteira.' : '',
  ].join('\n');
  cache = { em: agora.getTime(), texto };
  return texto;
}
