/**
 * Prova ao vivo do Safe Correction Engine sobre uma imagem REAL com defeito
 * real (tentativa 2 do job STU-MU4GK4TT4B396E: mãos deformadas inseridas
 * pelo rerroll cego da fase 2).
 *
 *   detect -> classify -> rubric -> localize -> mask -> inpaint
 *   -> pairwise -> RegressionGuard -> accept ou rollback
 */
import { config as dotenv } from 'dotenv';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
dotenv({ path: resolve('../../.env'), quiet: true });

const { loadConfig } = await import('../src/config');
const { classifyContent, critiqueImageV2, comparePair } = await import('../src/visual-critic');
const { parseContentClassification, reconcile, CONTENT_SYSTEM_PROMPT, CONTENT_FORMAT } = await import('../src/content-classifier');
const { buildRubric, rubricToPrompt } = await import('../src/rubric');
const { classifyProblem, routeCorrection, buildMask, prioritize } = await import('../src/correction-router');
const { runLocalCorrection } = await import('../src/correction-executor');
const { applyRegressionGuard, parsePairwise, buildPairwisePrompt, PAIRWISE_SYSTEM_PROMPT, PAIRWISE_FORMAT } = await import('../src/pairwise');
const { resolveFluxModelNames } = await import('../src/comfyui-client');

const cfg = loadConfig();
const critic = { provider: cfg.STUDIO_CRITIC_PROVIDER, ollamaUrl: cfg.CRITIC_OLLAMA_URL, ollamaModel: cfg.CRITIC_OLLAMA_MODEL, timeoutMs: cfg.CRITIC_TIMEOUT_MS } as const;

const imgPath = process.argv[2]!;
const briefing = process.argv[3]!;
const outDir = process.argv[4] ?? '/tmp';
const A = readFileSync(imgPath);
const t0 = Date.now();

console.log('=== 1. CONTENT CLASSIFIER ===');
const cc = await classifyContent({ imageBytes: A, briefing }, critic, { systemPrompt: CONTENT_SYSTEM_PROMPT, format: CONTENT_FORMAT });
const content = reconcile(parseContentClassification(cc.raw, cc.latencyMs));
console.log(`  tipo=${content.content_type} people=${content.contains_people} face=${content.contains_face} hands=${content.contains_hands} product=${content.contains_product} conf=${content.confidence} (${cc.latencyMs}ms)`);
console.log('  regioes criticas:', content.critical_regions.join(', ') || '(nenhuma)');

console.log('=== 2. RUBRICA ===');
const rubric = buildRubric(content);
console.log('  aplicavel   :', rubric.applicable.join(', '));
console.log('  NAO aplicavel:', rubric.notApplicable.join(', '));
console.log('  critico     :', rubric.critical.join(', ') || '(nenhum)');

console.log('=== 3. CRITIC V2 ===');
const v2 = await critiqueImageV2({ imageBytes: A, briefing, rubricPrompt: rubricToPrompt(rubric) }, critic);
const nulos = Object.entries(v2.scores).filter(([, v]) => v === null).map(([k]) => k);
console.log(`  scores: ${JSON.stringify(v2.scores)}`);
console.log(`  dimensoes null (N/A): ${nulos.join(', ') || '(nenhuma)'} | latencia ${v2.latencyMs}ms`);
for (const i of v2.issues) console.log(`  issue [${i.severity}] ${i.type} conf=${i.confidence} region=${i.region ? JSON.stringify(i.region) : 'null'} :: ${i.description.slice(0, 90)}`);

console.log('=== 4. PROBLEM CLASSIFIER + ROUTER ===');
const classificados = prioritize(v2.issues.map((i) => classifyProblem({ description: i.description, severity: i.severity, confidence: i.confidence, region: i.region })));
for (const p of classificados) console.log(`  ${p.type}/${p.scope} sev=${p.severity} conf=${p.confidence} regiao=${p.region ? 'sim' : 'nao'} -> ${routeCorrection(p).action}`);

const alvo = classificados.find((p) => routeCorrection(p).action === 'LOCAL_INPAINT' && p.region);
if (!alvo) { console.log('\nNENHUM defeito local corrigivel com confianca suficiente -> PRESERVA O ORIGINAL (este e o comportamento correto).'); process.exit(0); }

const rota = routeCorrection(alvo);
const mask = buildMask(alvo.region!);
if (!mask) { console.log('\nMascara recusada (area grande demais) -> PRESERVA O ORIGINAL.'); process.exit(0); }
console.log('=== 5. CORRECTION PLAN ===');
console.log(`  alvo=${alvo.type} acao=${rota.action} workflow=${rota.workflow}`);
console.log(`  mascara=${JSON.stringify(mask)}`);

console.log('=== 6. EXECUTOR (ComfyUI real) ===');
const flux = await resolveFluxModelNames(cfg.COMFYUI_URL, { unetHint: cfg.COMFYUI_UNET_HINT, clipHint: cfg.COMFYUI_CLIP_HINT, vaeHint: cfg.COMFYUI_VAE_HINT });
const instrucao = alvo.type === 'HAND'
  ? 'a natural human hand with five correctly separated fingers, realistic knuckles and skin texture'
  : `corrected ${alvo.type.toLowerCase()}, photographic, consistent with the surrounding image`;
const tc = Date.now();
const B = await runLocalCorrection({ baseUrl: cfg.COMFYUI_URL, ...flux, imageBytes: A, mask, instruction: instrucao, seed: Math.floor(Math.random() * 1e9) });
console.log(`  candidato B gerado em ${((Date.now() - tc) / 1000).toFixed(1)}s (${B.length} bytes)`);
writeFileSync(`${outDir}/candidate_A.png`, A);
writeFileSync(`${outDir}/candidate_B.png`, B);

console.log('=== 7. PAIRWISE ===');
const pw = await comparePair(
  { a: A, b: B, prompt: buildPairwisePrompt({ briefing, targetIssue: alvo.description, rubric }) },
  critic, { systemPrompt: PAIRWISE_SYSTEM_PROMPT, format: PAIRWISE_FORMAT },
);
const pair = parsePairwise(pw.raw, critic.ollamaModel, pw.latencyMs);
console.log(`  winner=${pair.winner} conf=${pair.confidence} alvo_corrigido=${pair.target_issue_fixed} melhora=${pair.target_issue_improvement}`);
for (const r of pair.regressions) console.log(`  REGRESSAO [${r.severity}] ${r.dimension}: ${r.note.slice(0, 90)}`);
console.log(`  razao: ${pair.reason.slice(0, 160)}`);

console.log('=== 8. REGRESSION GUARD ===');
const guard = applyRegressionGuard({ pairwise: pair, rubric });
console.log(`  DECISAO: ${guard.acceptB ? 'ACEITA B' : 'ROLLBACK -> entrega A'}`);
console.log(`  motivo: ${guard.reason}`);
console.log(`\n  entregue = candidate_${guard.acceptB ? 'B' : 'A'}.png | total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(0);
