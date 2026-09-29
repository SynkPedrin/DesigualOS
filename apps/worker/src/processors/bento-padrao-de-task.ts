/**
 * bento-padrao-de-task.ts — a relação entre as tarefas, que no ClickUp desta
 * agência não está onde se espera encontrá-la.
 *
 * Pedido da operação (29/09/2026): "o Bento precisa entender os processos da
 * operação, entender o padrão de task que é usado pela agência e usar aquilo
 * como padrão", e "ele sabe que a task existe, não sabe que ela pertence a uma
 * entrega da D. Carvalho, envolve audiovisual e depende de outra".
 *
 * A primeira tentativa foi procurar isso na estrutura do ClickUp, e a medição
 * (29/09/2026, 411 tarefas abertas do workspace real) derrubou a ideia:
 *
 *   folderName preenchido: 411 de 411 — e vale "CLIENTES ATIVOS".
 *   tags:                   32 de 411 (8%).
 *
 * Ou seja: pasta é carteira, não entrega, e tag quase não é usada. Não existe
 * camada de campanha no ClickUp para ler. Montar um "mapa de entregas" em cima
 * disso devolveria "CLIENTES ATIVOS: 51 tarefas", que é ruído com cara de
 * análise — o pior resultado possível.
 *
 * O padrão REAL está no nome, e é uma convenção por cliente, consistente:
 *
 *   DC_Digitais Outubro/26_Dia das Crianças
 *   Cosentino_Europa V_Campanha de Aniversário_Motion_Painel Recepção
 *   3Net - Criação Layout 09/10 - CARD – Checklist do feriadão
 *
 * Prefixo do cliente, separador fixo, e daí pra baixo uma hierarquia de frente
 * > fase > peça. É disto que este arquivo extrai duas coisas:
 *
 *   1. A CONVENÇÃO de nome do cliente, pra que a task que o Bento criar nasça
 *      igual às da equipe. Hoje ela não nasce: as tarefas criadas por ele estão
 *      no workspace como "Criar Cosentino_Europa V_Fase 1_Arquétipos — Cosentino",
 *      com verbo na frente e nome do cliente repetido no fim. Dá pra ver a olho
 *      nu qual task é da agência e qual é do robô.
 *
 *   2. As FRENTES: tarefas que compartilham prefixo são a mesma entrega. É o
 *      agrupamento que a pasta deveria dar e não dá.
 *
 * Tudo aqui é determinístico e sem rede: roda sobre as tarefas que o turno já
 * buscou. Nenhuma chamada de modelo, nenhum custo por turno.
 */

import type { OperationTask } from '@desigual-os/tool-gateway';

/** Os separadores que a operação usa de fato, na ordem em que são testados. */
const SEPARADORES = ['_', ' – ', ' - '] as const;
export type Separador = (typeof SEPARADORES)[number];

/** Abaixo disto não é convenção, é coincidência. */
const MINIMO_DE_TASKS = 4;
/** Fração das tarefas do cliente que precisa seguir o padrão pra ele valer. */
const COBERTURA_MINIMA = 0.6;

export interface Convencao {
  separador: Separador;
  /** O primeiro segmento repetido — "DC", "Cosentino", "3Net". */
  prefixo: string;
  /** Quantas das tarefas do cliente seguem isto. */
  seguem: number;
  total: number;
  /** Nomes reais, pra mostrar em vez de descrever. */
  exemplos: string[];
}

/**
 * Quebra o nome nos segmentos da convenção. Sem separador conhecido, o nome
 * inteiro é um segmento só — não força hierarquia onde não há.
 */
export function segmentar(nome: string, separador: Separador): string[] {
  return nome
    .split(separador)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Descobre a convenção observando o que a equipe já fez. Nunca pergunta nem
 * assume: se as tarefas do cliente não concordam entre si, devolve null e o
 * Bento segue sem padrão em vez de inventar um.
 */
export function inferirConvencao(nomes: string[]): Convencao | null {
  if (nomes.length < MINIMO_DE_TASKS) return null;

  let melhor: Convencao | null = null;
  for (const separador of SEPARADORES) {
    // Conta o primeiro segmento de cada nome: o prefixo da convenção é o que
    // mais se repete. Nome sem o separador não vota.
    const contagem = new Map<string, number>();
    for (const nome of nomes) {
      if (!nome.includes(separador)) continue;
      const primeiro = segmentar(nome, separador)[0];
      if (!primeiro || primeiro.length > 40) continue;
      contagem.set(primeiro, (contagem.get(primeiro) ?? 0) + 1);
    }
    const [prefixo, seguem] = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!prefixo || !seguem) continue;
    if (seguem / nomes.length < COBERTURA_MINIMA) continue;
    if (melhor && melhor.seguem >= seguem) continue;
    melhor = {
      separador,
      prefixo,
      seguem,
      total: nomes.length,
      exemplos: nomes.filter((n) => n.startsWith(`${prefixo}${separador}`)).slice(0, 3),
    };
  }
  return melhor;
}

export interface Frente {
  /** O prefixo compartilhado — "DC_Digitais Outubro/26", "Cosentino_Europa V". */
  nome: string;
  quantas: number;
  atrasadas: number;
  semDono: number;
  /** Quem está nessa frente, sem repetir. */
  donos: string[];
}

function meiaNoite(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Agrupa por prefixo compartilhado: as tarefas que começam igual são a mesma
 * entrega. O prefixo de cada frente é o MAIS ESPECÍFICO que ainda junta duas
 * tarefas — parar no primeiro segmento devolveria "Cosentino: 48", que é a
 * mesma informação que o nome do cliente já dá.
 *
 * Frente de uma tarefa só é descartada: não é entrega, é tarefa avulsa, e
 * listar 40 frentes de tamanho 1 enterra as que importam.
 */
export function agruparEmFrentes(
  tasks: OperationTask[],
  convencao: Convencao,
  agora: Date = new Date(),
): Frente[] {
  const hoje = meiaNoite(agora);
  // Cada prefixo possível de cada tarefa (1 segmento, 2 segmentos, ...) aponta
  // pras tarefas que o compartilham. Depois fica o mais fundo com 2 ou mais.
  const porPrefixo = new Map<string, OperationTask[]>();
  for (const t of tasks) {
    const segs = segmentar(t.name, convencao.separador);
    for (let n = 2; n <= Math.min(segs.length, 4); n++) {
      const chave = segs.slice(0, n).join(convencao.separador);
      const lista = porPrefixo.get(chave);
      if (lista) lista.push(t);
      else porPrefixo.set(chave, [t]);
    }
  }

  const escolhida = new Map<string, string>(); // task id -> prefixo da frente
  for (const t of tasks) {
    const segs = segmentar(t.name, convencao.separador);
    for (let n = Math.min(segs.length, 4); n >= 2; n--) {
      const chave = segs.slice(0, n).join(convencao.separador);
      if ((porPrefixo.get(chave)?.length ?? 0) >= 2) {
        escolhida.set(t.id, chave);
        break;
      }
    }
  }

  const frentes = new Map<string, OperationTask[]>();
  for (const t of tasks) {
    const chave = escolhida.get(t.id);
    if (!chave) continue;
    const lista = frentes.get(chave);
    if (lista) lista.push(t);
    else frentes.set(chave, [t]);
  }

  return [...frentes.entries()]
    .map(([nome, lista]) => ({
      nome,
      quantas: lista.length,
      atrasadas: lista.filter((t) => t.dueDate !== null && t.dueDate < hoje).length,
      semDono: lista.filter((t) => t.assignees.length === 0).length,
      donos: [...new Set(lista.flatMap((t) => t.assignees))].slice(0, 4),
    }))
    .sort((a, b) => b.atrasadas - a.atrasadas || b.quantas - a.quantas);
}

/**
 * O bloco que entra no turno. Duas partes, e a ordem importa: primeiro COMO a
 * equipe nomeia (porque é isso que o Bento tem que imitar quando criar), depois
 * O QUE está em andamento agrupado por entrega.
 *
 * Devolve null quando não há convenção: bloco vazio é melhor que bloco que
 * afirma um padrão que a operação não tem.
 *
 * ELE NÃO LISTA MAIS AS FRENTES. Listava, por prefixo de nome, até a medição de
 * 29/09/2026 mostrar que a operação mantém uma árvore de subtarefa de verdade
 * (84% a 91% das tarefas) — ver bento-arvore.ts. Duas definições de "frente"
 * convivendo no mesmo prompt faziam o modelo citar agrupamento que a árvore não
 * confirma, e frente inventada é pior que frente nenhuma. Aqui ficou só o que
 * a árvore NÃO sabe dizer: como a equipe escreve o nome de uma task nova.
 */
export function blocoDeFrentes(params: {
  clientName: string;
  tasks: OperationTask[];
  agora?: Date;
}): string | null {
  const abertas = params.tasks.filter((t) => t.statusType !== 'done' && t.statusType !== 'closed');
  const convencao = inferirConvencao(abertas.map((t) => t.name));
  if (!convencao) return null;

  const linhas: string[] = [
    `COMO A EQUIPE NOMEIA AS TASKS DE ${params.clientName.toUpperCase()} (padrão observado em ${convencao.seguem} de ${convencao.total} tarefas abertas):`,
    `Prefixo "${convencao.prefixo}", segmentos separados por "${convencao.separador}", do mais geral pro mais específico.`,
    'Exemplos reais da equipe:',
    ...convencao.exemplos.map((e) => `- ${e}`),
    'Ao CRIAR task deste cliente, use esta forma. Nada de verbo na frente ("Criar ...") e nada de repetir o nome do cliente no fim.',
  ];

  return linhas.join('\n');
}
