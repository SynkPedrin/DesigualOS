import type { VideoPlan } from './schemas.js';

/**
 * REEL EXECUTION LINTER (Otto Elite, missão "Reel Execution Engine
 * Closure"): validação DETERMINÍSTICA do storyboard renderizado, na mesma
 * lógica de `computeMissingDeliverables` em critic.ts — não confiar só no
 * julgamento do critic (LLM) pra pegar padrões mecânicos que código detecta
 * com certeza. Achado ao vivo, em DOIS modelos diferentes: "Visual: None"
 * literal, câmera travada repetida, duração idêntica em toda cena. Isto
 * aqui é o código que pega esses padrões sem depender do critic notar.
 */
export type ReelExecutionFinding =
  | 'LITERAL_NONE_VISUAL'
  | 'NON_EXECUTABLE_VISUAL'
  | 'MISSING_SUBJECT_ACTION'
  | 'MISSING_CAMERA_DIRECTION'
  | 'MISSING_TRANSITION'
  | 'STATIC_SEQUENCE'
  | 'MECHANICAL_TIMING'
  | 'LOW_VISUAL_VARIETY'
  | 'LOW_RETENTION_STRUCTURE';

export interface ReelExecutionIssue {
  finding: ReelExecutionFinding;
  /** 1-based; ausente quando o achado é da SEQUÊNCIA inteira, não de uma cena. */
  sceneIndex?: number;
  detail: string;
}

/** "None"/"nenhum"/vazio — Section 9: proibido em Elite, mesmo em cena só de tipografia. */
const NONE_LIKE = /^\s*(none|nenhum[a]?|n\/?a|-+|sem\s+(dire[çc][aã]o|informa[çc][aã]o)|n[aã]o\s+definido)\.?\s*$/i;
const isNoneLike = (value: string | null | undefined): boolean => !value || NONE_LIKE.test(value.trim());

/** Placeholder de direção — descreve a EXISTÊNCIA de uma cena, não o que ela mostra (Section 22). */
const GENERIC_PLACEHOLDER =
  /\b(imagem bonita|cena din[aâ]mica|v[ií]deo do empreendimento|mostrar fam[ií]lia|take cinematogr[áa]fico|visual impactante|cena impactante)\b/i;

const GENERIC_TRANSITION = /^transi[çc][aã]o\s+din[aâ]mica\.?$/i;

const STATIC_CAMERA_HINT = /est[aá]tic|locked|travad[ao]|sem movimento|static/i;

function countMatches<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item).trim().toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export function validateReelExecution(plan: VideoPlan): ReelExecutionIssue[] {
  const issues: ReelExecutionIssue[] = [];
  const scenes = plan.scenes;

  scenes.forEach((scene, i) => {
    const n = i + 1;
    if (isNoneLike(scene.subject_movement) || isNoneLike(scene.environment)) {
      issues.push({
        finding: 'LITERAL_NONE_VISUAL',
        sceneIndex: n,
        detail: `cena ${n}: direção visual "None"/vazia — mesmo cena só de tipografia precisa descrever fundo, composição do texto e movimento, nunca ficar sem direção`,
      });
    } else {
      if (GENERIC_PLACEHOLDER.test(scene.subject_movement) || GENERIC_PLACEHOLDER.test(scene.environment)) {
        issues.push({
          finding: 'NON_EXECUTABLE_VISUAL',
          sceneIndex: n,
          detail: `cena ${n}: direção genérica de placeholder ("${scene.subject_movement}" / "${scene.environment}") em vez de ação e ambiente concretos`,
        });
      }
      if (scene.subject_movement.trim().length < 8) {
        issues.push({
          finding: 'MISSING_SUBJECT_ACTION',
          sceneIndex: n,
          detail: `cena ${n}: ação do sujeito curta demais pra ser executável ("${scene.subject_movement}")`,
        });
      }
    }

    if (isNoneLike(scene.camera_movement) || scene.camera_movement.trim().length < 3) {
      issues.push({ finding: 'MISSING_CAMERA_DIRECTION', sceneIndex: n, detail: `cena ${n}: sem direção de câmera` });
    }

    if (isNoneLike(scene.transition) || GENERIC_TRANSITION.test(scene.transition.trim()) || GENERIC_PLACEHOLDER.test(scene.transition)) {
      issues.push({
        finding: 'MISSING_TRANSITION',
        sceneIndex: n,
        detail: `cena ${n}: transição não especifica o quê acontece ("${scene.transition}")`,
      });
    }
  });

  // STATIC_SEQUENCE: 3+ cenas SEGUIDAS com a mesma câmera, e essa câmera é
  // travada/estática — a sequência mecânica que o critic viu ao vivo duas
  // vezes (5 cenas estáticas seguidas, mesma "static, high-end..." repetida).
  for (let i = 0; i + 2 < scenes.length; i++) {
    const trio = [scenes[i]!, scenes[i + 1]!, scenes[i + 2]!];
    const cameras = trio.map((s) => s.camera_movement.trim().toLowerCase());
    if (cameras[0] === cameras[1] && cameras[1] === cameras[2] && STATIC_CAMERA_HINT.test(cameras[0]!)) {
      issues.push({
        finding: 'STATIC_SEQUENCE',
        sceneIndex: i + 1,
        detail: `cenas ${i + 1}-${i + 3}: câmera travada/estática repetida três vezes seguidas, sem nenhuma variação de movimento`,
      });
      break; // um achado já sinaliza o padrão; não repetir pra cada janela subsequente
    }
  }

  // MECHANICAL_TIMING: toda cena com a MESMA duração — ritmo de metrônomo,
  // não derivado do conteúdo de cada cena (Section 11).
  if (scenes.length >= 3) {
    const durations = scenes.map((s) => s.duration_seconds).filter((d): d is number => d !== undefined);
    if (durations.length === scenes.length && new Set(durations).size === 1) {
      issues.push({
        finding: 'MECHANICAL_TIMING',
        detail: `todas as ${scenes.length} cenas com ${durations[0]}s — ritmo mecânico, sem variação por fala/ação/papel de retenção`,
      });
    }
  }

  // LOW_VISUAL_VARIETY: mesmo shot_type em 4+ cenas — sem variedade de enquadramento.
  if (scenes.length >= 4) {
    const shotTypeCounts = countMatches(
      scenes.filter((s) => s.shot_type !== undefined),
      (s) => s.shot_type ?? '',
    );
    if (shotTypeCounts.size <= 1 && scenes.every((s) => s.shot_type !== undefined)) {
      issues.push({
        finding: 'LOW_VISUAL_VARIETY',
        detail: `mesmo shot_type em todas as ${scenes.length} cenas — sem variedade de enquadramento`,
      });
    }
  }

  // LOW_RETENTION_STRUCTURE: sinal AGREGADO (Section 18 — "seria isto seis
  // fotos estáticas com narração por cima?"). Não é um campo novo no
  // schema; é a combinação de ritmo mecânico + zero variedade visual, os
  // dois sinais que juntos significam "nada muda do início ao fim".
  const hasMechanicalTiming = issues.some((issue) => issue.finding === 'MECHANICAL_TIMING');
  const hasLowVariety = issues.some((issue) => issue.finding === 'LOW_VISUAL_VARIETY');
  if (hasMechanicalTiming && hasLowVariety) {
    issues.push({
      finding: 'LOW_RETENTION_STRUCTURE',
      detail: 'ritmo mecânico + zero variedade de enquadramento juntos: a sequência inteira poderia ser fotos estáticas com narração por cima — falha no teste de nativo de plataforma',
    });
  }

  return issues;
}

/** Nota de reparo focada em execução — Section 20: preserva conceito/copy, corrige só a cena. */
export function formatReelExecutionNote(issues: ReelExecutionIssue[]): string {
  return [
    'A execução do Reel (storyboard cena a cena) falhou na checagem determinística de executabilidade:',
    ...issues.map((issue) => `- ${issue.detail}`),
    'Reescreva APENAS o plano de vídeo (storyboard), corrigindo cada ponto acima com direção real de câmera, ação e transição. Preserve o conceito, a copy e a mensagem já aprovados — não regenere a estratégia.',
  ].join('\n');
}
