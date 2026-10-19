/**
 * rescore.mjs — relê as execuções do benchmark pelo executionId e recalcula a
 * cobertura. Existe porque o POST /executions/:id devolve `status: completed`
 * um instante ANTES de os steps estarem persistidos: quem lê no mesmo momento
 * do status pega a execução sem resposta. Aqui a leitura é depois, com calma.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const BASE = 'http://127.0.0.1:3001';
const DIR = new URL('../../artifacts/intelligence-benchmark/', import.meta.url);
const headers = { Authorization: `Bearer ${readFileSync('/tmp/desigual-qa-token', 'utf8').trim()}` };

function answerOf(execution) {
  const steps = execution?.steps ?? [];
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const o = steps[i]?.output;
    const t = typeof o === 'string' ? o : (o?.answer ?? o?.response ?? o?.message ?? o?.content ?? o?.text);
    if (typeof t === 'string' && t.trim().length > 0) return t;
  }
  return '';
}

const arquivos = readdirSync(DIR).filter((f) => /^(Q\d\d|GOLD|V\d\d)\.json$/.test(f)).sort();
const linhas = [];
for (const f of arquivos) {
  const reg = JSON.parse(readFileSync(new URL(f, DIR), 'utf8'));
  if (!reg.executionId) { linhas.push(reg); continue; }
  const res = await fetch(`${BASE}/executions/${reg.executionId}`, { headers, signal: AbortSignal.timeout(15000) });
  const exec = await res.json().catch(() => null);
  reg.resposta = answerOf(exec);
  reg.chars = reg.resposta.length;
  reg.tokensInput = exec?.tokens_input ?? null;
  reg.tokensOutput = exec?.tokens_output ?? null;
  reg.fontes = (exec?.steps ?? []).flatMap((s) => s?.output?.sources ?? []);
  const plano = reg.resposta.toLowerCase();
  reg.cobertura = reg.esperado.filter((t) => plano.includes(t.toLowerCase()));
  reg.faltando = reg.esperado.filter((t) => !plano.includes(t.toLowerCase()));
  writeFileSync(new URL(f, DIR), JSON.stringify(reg, null, 2));
  linhas.push(reg);
}

console.log('ID    | dimensão                  | chars | tok_in | cobertura | fontes');
console.log('------+---------------------------+-------+--------+-----------+--------');
for (const r of linhas) {
  console.log(
    `${r.id.padEnd(5)} | ${String(r.dim).padEnd(25)} | ${String(r.chars).padStart(5)} | ${String(r.tokensInput ?? '—').padStart(6)} | ` +
    `${String(r.cobertura.length + '/' + r.esperado.length).padStart(9)} | ${r.fontes?.length ?? 0}`,
  );
}
const tot = linhas.reduce((s, r) => s + r.cobertura.length, 0);
const alvo = linhas.reduce((s, r) => s + r.esperado.length, 0);
const vazias = linhas.filter((r) => r.chars === 0).length;
console.log(`\nCOBERTURA FACTUAL: ${tot}/${alvo} (${Math.round((tot / alvo) * 100)}%) | respostas vazias: ${vazias}/${linhas.length}`);
console.log(`chars médios: ${Math.round(linhas.reduce((s, r) => s + r.chars, 0) / linhas.length)}`);
writeFileSync(new URL('SUMMARY.json', DIR), JSON.stringify({ quando: new Date().toISOString(), resultados: linhas }, null, 2));
