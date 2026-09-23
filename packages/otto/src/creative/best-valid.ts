/**
 * SELEÇÃO DE MELHOR ARTEFATO VÁLIDO (Otto Senior V1 — "Best-Valid Fix").
 *
 * Achado ao vivo real (qwen3.6:35b-a3b, mesma sessão): draft=45,
 * reescrita#1=43, reparo de execução=39 — os TRÊS estruturalmente válidos
 * (sem regressão de completude, sem erro de schema), e o sistema entregou
 * o ÚLTIMO (39), não o MELHOR (45). O invariante "nenhuma reescrita destrói
 * um artefato válido" (Blocker 2) já impede um candidato PIOR EM
 * COMPLETUDE de virar `result` — mas nunca comparou NOTA. Uma reescrita
 * que passa no gate de completude mas piora a nota geral ainda vencia só
 * por ser a mais recente.
 *
 * Esta função é pura e não sabe nada de Otto/execute.ts de propósito — o
 * chamador monta os `CandidateRecord` a partir do que já calcula (gate,
 * evaluation, missingDeliverables) e só entrega aqui a decisão de qual
 * ganha.
 */
export interface CandidateRecord<T> {
  stage: string;
  value: T;
  /** Sobreviveu a produce()/reparo sem lançar exceção e sem regressão de completude (Blocker 2). */
  schemaValid: boolean;
  /** `computeMissingDeliverables` vazio pra este candidato. */
  semanticComplete: boolean;
  /** `unsupported_claims` vazio pra este candidato. */
  factuallyValid: boolean;
  /** `deriveCriticOverall` — nunca a nota que o modelo relatou, sempre a média calculada. */
  qualityScore: number;
  /** Os dez scores do critic pra este candidato, se avaliado. */
  criticalDimensionScores?: Record<string, number>;
  unsupportedClaims: string[];
  /** Ordem de criação — só decide em EMPATE TOTAL (último critério, nunca o primeiro). */
  order: number;
}

function countCriticalDeficiencies(scores: Record<string, number> | undefined): number {
  if (!scores) return Number.POSITIVE_INFINITY;
  return Object.values(scores).filter((value) => value < 8).length;
}

function minCriticalDimension(scores: Record<string, number> | undefined): number {
  if (!scores || Object.keys(scores).length === 0) return Number.NEGATIVE_INFINITY;
  return Math.min(...Object.values(scores));
}

/**
 * Compara dois candidatos e devolve o melhor, na ordem de critérios do
 * contrato (Otto Senior V1, Section "REQUIRED SELECTION CONTRACT"):
 * 1. nota geral mais alta
 * 2. menos dimensões críticas (< 8) — desempate de "mesma nota, uma versão
 *    tem mais problemas concentrados"
 * 3. menos unsupported_claims
 * 4. dimensão crítica mínima mais alta (a versão que não tem um "buraco" pior)
 * 5. mais recente — SÓ como ÚLTIMO desempate, nunca critério principal
 *    (essa é exatamente a regra que o bug violava: recência não pode
 *    vencer qualidade)
 */
function pickBetter<T>(a: CandidateRecord<T>, b: CandidateRecord<T>): CandidateRecord<T> {
  if (a.qualityScore !== b.qualityScore) return a.qualityScore > b.qualityScore ? a : b;

  const aDeficiencies = countCriticalDeficiencies(a.criticalDimensionScores);
  const bDeficiencies = countCriticalDeficiencies(b.criticalDimensionScores);
  if (aDeficiencies !== bDeficiencies) return aDeficiencies < bDeficiencies ? a : b;

  if (a.unsupportedClaims.length !== b.unsupportedClaims.length) {
    return a.unsupportedClaims.length < b.unsupportedClaims.length ? a : b;
  }

  const aMin = minCriticalDimension(a.criticalDimensionScores);
  const bMin = minCriticalDimension(b.criticalDimensionScores);
  if (aMin !== bMin) return aMin > bMin ? a : b;

  return a.order > b.order ? a : b;
}

/**
 * Elegível = schema_valid AND semantic_complete AND factually_valid (o
 * contrato pede exatamente estes três, nada mais). Sem NENHUM elegível
 * (todo candidato tem algum problema estrutural), cai pro conjunto
 * schema_valid — nunca devolve `null` havendo pelo menos um candidato que
 * sobreviveu sem exceção, porque a regra de sempre-existir (Missão 4-5)
 * continua valendo: melhor um candidato imperfeito classificado
 * corretamente como "draft" do que nenhum candidato.
 */
export function selectBestValidCandidate<T>(candidates: CandidateRecord<T>[]): CandidateRecord<T> | null {
  if (candidates.length === 0) return null;

  const eligible = candidates.filter((c) => c.schemaValid && c.semanticComplete && c.factuallyValid);
  const pool = eligible.length > 0 ? eligible : candidates.filter((c) => c.schemaValid);
  if (pool.length === 0) return null;

  return pool.reduce((best, current) => pickBetter(best, current));
}
