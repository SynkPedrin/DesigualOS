/**
 * bento-dry-run.mts — o caminho REAL até a borda da escrita, sem escrever.
 *
 * message -> classifyActionIntent -> plano de ação -> resolve cliente ->
 * resolve pessoa -> "escreveria?" — e para aí. Nenhuma ferramenta de escrita
 * é chamada. É o que permite olhar as 16 frases da Tammy de uma vez antes de
 * qualquer task existir.
 */
import '../src/env.js';
import { classifyActionIntent, classifyActionIntentLegacy, classifyActionIntentDetalhado } from '../src/processors/action-intent.js';
import { buildOperationalActionPlan } from '../src/processors/operational-action-plan.js';
import { resolveWriteTarget } from '../src/processors/write-target.js';
import { multiActionWriteHabilitado } from '../src/processors/bento-action-guard.js';
import { resolveMemberByName, getWriteScopeListId } from '@desigual-os/tool-gateway';
import { CORPUS_SETS, type CorpusCase } from '../src/processors/action-intent-corpus.js';

const config = { apiKey: process.env.CLICKUP_API_KEY!, teamId: process.env.CLICKUP_TEAM_ID! };
const conjunto = process.argv[2] ?? 'tammy';
const casos = (CORPUS_SETS as Record<string, CorpusCase[]>)[conjunto] ?? CORPUS_SETS.tammy;

console.log(`DRY RUN — conjunto "${conjunto}" (${casos.length} casos). NENHUMA escrita.\n`);
let divergencias = 0;

for (const c of casos) {
  const v2 = classifyActionIntentDetalhado(c.message);
  const novo = classifyActionIntent(c.message);
  const velho = classifyActionIntentLegacy(c.message);
  const plano = novo.writeAuthorized ? buildOperationalActionPlan(c.message) : null;

  let clienteTxt = '—';
  let pessoaTxt = '—';
  if (novo.writeAuthorized) {
    const alvo = await resolveWriteTarget({ message: c.message, executionClientId: null }).catch(() => null);
    clienteTxt = alvo ? `${alvo.status}${alvo.clientName ? ` (${alvo.clientName})` : ''}` : 'erro';
    const nomes = [...new Set((plano?.tasks ?? []).map((t) => t.assigneeName).filter(Boolean))] as string[];
    if (nomes.length > 0) {
      const res = await Promise.all(nomes.map(async (n) => `${n}=${(await resolveMemberByName(config, n).catch(() => ({ status: 'erro' as const }))).status}`));
      pessoaTxt = res.join(', ');
    }
  }

  const nActions = plano?.tasks.length ?? 0;
  const wouldWrite = novo.writeAuthorized && nActions > 0 && (nActions === 1 || multiActionWriteHabilitado());
  const shadow = velho.writeAuthorized === novo.writeAuthorized ? '' : `  [SHADOW old=${velho.writeAuthorized ? 'ACT' : 'ANALYZE'} -> new=${novo.writeAuthorized ? 'ACT' : 'ANALYZE'}]`;
  if (shadow) divergencias++;

  console.log(`${c.id} ${v2.intent.padEnd(9)} conf=${v2.confidence.toFixed(2)} ações=${nActions} wouldWrite=${wouldWrite ? 'SIM' : 'não'}${shadow}`);
  console.log(`   frase .......: ${c.message.replace(/\s+/g, ' ').slice(0, 88)}`);
  console.log(`   sourceSpan ..: ${v2.sourceSpan ? `"${v2.sourceSpan.slice(0, 78)}"` : '—'}`);
  if (v2.negations.length) console.log(`   negações ....: ${v2.negations.join('; ')}`);
  console.log(`   cliente .....: ${clienteTxt}   pessoa: ${pessoaTxt}`);
  if (plano) {
    for (const t of plano.tasks) console.log(`   · ação ......: ${t.item ?? t.deliverable ?? '(genérica)'} -> ${t.assigneeName ?? '(sem responsável)'}`);
  }
  console.log('');
}
console.log(`cerca de escrita ativa em: ${getWriteScopeListId() ?? '(nenhuma)'}`);
console.log(`multi-action write: ${multiActionWriteHabilitado() ? 'LIGADO' : 'DESLIGADO'}`);
console.log(`divergências V1 -> V2: ${divergencias}`);
process.exit(0);
