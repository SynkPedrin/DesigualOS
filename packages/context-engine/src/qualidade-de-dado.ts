/**
 * qualidade-de-dado.ts — o que está torto no acervo, medido e nomeado.
 *
 * Existe porque os defeitos que mais custaram a este produto não foram bugs de
 * código: foram dados que pareciam outra coisa. Fixture contada como cliente,
 * artefato de aceite gravado como decisão de produção, memória sem
 * proveniência, cadastro duplicado. Nenhum deles quebra nada — todos fazem o
 * sistema responder com confiança uma coisa errada.
 *
 * MEDIDO NO BANCO REAL EM 30/09/2026, e é contra isto que as regras abaixo
 * foram escritas:
 *
 *   58 clientes ......... 49 carteira, 6 internos, 3 fixture
 *   2 duplicatas exatas . "BIO FIT"/"Biofit", "Case #0" em duas grafias
 *   1 quase-duplicata ... "Colpar"/"Colpar Brasil"
 *   489 memórias ........ 124 SEM proveniência, 14 com marca de teste em produção
 *   31 episódios ........ 5 com marca de teste em produção
 *   6 clientes .......... sem lista do ClickUp (invisíveis pra operação)
 *
 * DUAS REGRAS QUE O ARQUIVO SEGUE, e que vieram do briefing:
 *
 * 1. NADA É APAGADO NEM MESCLADO AQUI. Este módulo APONTA. Merge destrutivo
 *    automático de cadastro é irreversível e uma heurística errada custa um
 *    cliente real; a decisão é de quem cuida do cadastro.
 *
 * 2. A MARCA DE TESTE É ESTREITA DE PROPÓSITO. Um regex largo escondendo
 *    cliente real é pior que fixture aparecendo na lista — o primeiro é
 *    silencioso, o segundo é visível e alguém corrige.
 */

/**
 * O que um registro é, além do que a tabela dele diz.
 *
 * `environment` e `status` já existem em colunas; `nature`, `provenance` e
 * `visibility` são as três dimensões que o sistema usava implicitamente e
 * nunca nomeou — e é de onde vieram os erros.
 */
export type Ambiente = 'PRODUCTION' | 'TEST' | 'DEVELOPMENT';
export type Natureza = 'CLIENT' | 'INTERNAL' | 'FIXTURE' | 'PERSON' | 'SYSTEM';
export type Procedencia = 'MCP' | 'CLICKUP' | 'MANUAL' | 'CLAUDE' | 'IMPORT' | 'SYSTEM' | 'DESCONHECIDA';

/**
 * MARCAS DE ARTEFATO DE TESTE, cada uma vista no banco.
 *
 * Estreitas por decisão: exigem um carimbo que só o aceite produz (prefixo
 * conhecido seguido de número longo). "teste" solto NÃO entra — existe cliente
 * com "teste" no nome, e um regex largo que esconde cliente real é o erro caro
 * e silencioso; fixture aparecendo na lista é o erro barato e visível.
 */
const MARCAS_DE_ACEITE: RegExp[] = [
  /\bmarco-\d{4,}\b/,
  /\bACEITE-\d{6,}\b/,
  /\bQA[ -][A-Z]+ \d{6,}\b/,
  /\bAnotação privada da Tammy\b/,
];

export function pareceArtefatoDeTeste(texto: string): boolean {
  return MARCAS_DE_ACEITE.some((re) => re.test(texto));
}

/**
 * Chave de comparação de nome: sem acento, sem caixa, sem pontuação e sem
 * emoji. É o que faz "BIO FIT" e "Biofit" caírem no mesmo balde, e o que fez
 * "🧪 CASE #0" e "🧪 Case #0" aparecerem como a duplicata que são.
 */
export function chaveDeNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export interface CandidataADuplicata<T> {
  /** 'exata' = mesma chave de nome. 'prefixo' = uma contém a outra. */
  tipo: 'exata' | 'prefixo';
  entidades: T[];
}

/** Abaixo disto, prefixo compartilhado é coincidência ("Ana" e "Anabela"). */
const MINIMO_DE_PREFIXO = 6;

/**
 * Encontra candidatas a duplicata. CANDIDATAS — nunca resolve.
 *
 * Duas passadas, e a segunda é deliberadamente conservadora: prefixo só conta
 * a partir de 6 caracteres, senão meia carteira vira "quase igual" e a tela
 * perde a utilidade exatamente por acusar demais.
 */
export function candidatasADuplicata<T extends { id: string; name: string }>(
  entidades: readonly T[],
): Array<CandidataADuplicata<T>> {
  const porChave = new Map<string, T[]>();
  for (const e of entidades) {
    const k = chaveDeNome(e.name);
    if (!k) continue;
    const atual = porChave.get(k);
    if (atual) atual.push(e);
    else porChave.set(k, [e]);
  }

  const achados: Array<CandidataADuplicata<T>> = [];
  for (const grupo of porChave.values()) {
    if (grupo.length > 1) achados.push({ tipo: 'exata', entidades: grupo });
  }

  const chaves = [...porChave.keys()].filter((k) => k.length >= MINIMO_DE_PREFIXO);
  for (let i = 0; i < chaves.length; i++) {
    for (let j = i + 1; j < chaves.length; j++) {
      const a = chaves[i]!;
      const b = chaves[j]!;
      if (a === b) continue;
      if (a.startsWith(b) || b.startsWith(a)) {
        achados.push({ tipo: 'prefixo', entidades: [...porChave.get(a)!, ...porChave.get(b)!] });
      }
    }
  }
  return achados;
}

/**
 * De onde veio, a partir do `source_type` que a tabela guarda.
 *
 * `null` vira DESCONHECIDA, e não SYSTEM: 124 memórias estão nesse caso, e
 * chamá-las de "do sistema" apagaria justamente o problema que a tela precisa
 * mostrar. Proveniência ausente é uma pendência, não um valor.
 */
export function procedenciaDe(sourceType: string | null | undefined): Procedencia {
  if (!sourceType) return 'DESCONHECIDA';
  const s = sourceType.toLowerCase();
  if (s.includes('mcp')) return 'MCP';
  if (s.includes('claude')) return 'CLAUDE';
  if (s.includes('clickup')) return 'CLICKUP';
  if (s.includes('vault') || s.includes('import') || s.includes('brain')) return 'IMPORT';
  if (s.includes('chat') || s.includes('manual') || s.includes('whatsapp')) return 'MANUAL';
  if (s.includes('agent') || s.includes('system')) return 'SYSTEM';
  return 'DESCONHECIDA';
}

export interface AlertaDeQualidade {
  /** Identificador estável, pra tela poder linkar e pro teste poder travar. */
  codigo:
    | 'DUPLICATA'
    | 'ARTEFATO_DE_TESTE_EM_PRODUCAO'
    | 'SEM_PROVENIENCIA'
    | 'CLIENTE_SEM_LISTA'
    | 'MEMORIA_ORFA'
    | 'FIXTURE_NA_CARTEIRA';
  titulo: string;
  /** O que fazer com isso. Alerta sem ação é ruído. */
  oQueFazer: string;
  /** Quantos registros. `0` some da tela — não é conquista, é ausência do problema. */
  quantos: number;
  /** ALTO = engana quem lê. MEDIO = atrapalha. BAIXO = incomoda. */
  gravidade: 'ALTO' | 'MEDIO' | 'BAIXO';
  /** Amostra pra pessoa reconhecer o caso sem abrir o banco. */
  exemplos: string[];
}

/** Ordena o que a pessoa deve olhar primeiro: engana antes de incomoda. */
const PESO: Record<AlertaDeQualidade['gravidade'], number> = { ALTO: 0, MEDIO: 1, BAIXO: 2 };

export function ordenarAlertas(alertas: AlertaDeQualidade[]): AlertaDeQualidade[] {
  return [...alertas]
    .filter((a) => a.quantos > 0)
    .sort((a, b) => PESO[a.gravidade] - PESO[b.gravidade] || b.quantos - a.quantos);
}
