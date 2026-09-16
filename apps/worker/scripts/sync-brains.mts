/**
 * sync-brains.mts — leva os BRAIN.md dos clientes (.claude/skills/otto/brains)
 * para a tabela `memories` como client.profile, que e o que o turno do Bento/Otto le.
 *
 * Sem isto os brains ficam so no repositorio: o node do Otto nunca os enxerga e
 * o modelo passa a deduzir quem e o cliente — foi assim que ele afirmou que uma
 * concessionaria John Deere era "rede de joias" (15/09/2026).
 *
 * Idempotente: o subject por cliente faz reimportacao ATUALIZAR o dossie em vez
 * de empilhar. Rode sem argumento pra simular, com --aplicar pra gravar.
 *
 *   pnpm --filter @desigual-os/worker exec tsx scripts/sync-brains.mts
 *   pnpm --filter @desigual-os/worker exec tsx scripts/sync-brains.mts --aplicar
 */
import '../src/env.js';
import fs from 'node:fs';
import path from 'node:path';
import { rememberFact } from '@desigual-os/orchestrator';
// Regra de casamento compartilhada com sync-dossies.mts: duas copias
// divergiriam na primeira correcao, e casar errado poe o dossie de um cliente
// na ficha de outro.
import { acharCliente, carregarClientes } from './lib/clientes.mjs';

// Caminho relativo ao repo: o script roda em qualquer maquina/checkout.
const RAIZ = new URL('../../../.claude/skills/otto/brains', import.meta.url).pathname;
const APLICAR = process.argv.includes('--aplicar');

const brains = fs.readdirSync(RAIZ).filter(d => !['INDEX.md','_template'].includes(d) && fs.existsSync(path.join(RAIZ,d,'BRAIN.md')));
const clientes = await carregarClientes();

let ok = 0, pulados = 0;
for (const b of brains) {
  const c = acharCliente([b], clientes);
  if (!c) { console.log(`  [sem cliente] ${b}`); pulados++; continue; }
  const conteudo = fs.readFileSync(path.join(RAIZ, b, 'BRAIN.md'), 'utf8').trim();
  if (conteudo.length < 200) { console.log(`  [vazio] ${b}`); pulados++; continue; }
  if (!APLICAR) { console.log(`  ${b} -> ${c.name} (${conteudo.length} chars)`); ok++; continue; }
  const r = await rememberFact({
    kind: 'client.profile',
    clientId: c.id,
    content: conteudo,
    // subject por cliente: reimportar ATUALIZA o dossiê em vez de empilhar.
    subject: `cliente:${c.id}:brain`,
    sourceType: 'vault',
    sourceId: `brains/${b}/BRAIN.md`,
    confidence: 0.9,
    importance: 0.95,
  });
  console.log(`  ${c.name}: ${r.status}`);
  ok++;
}
console.log(`\n${APLICAR ? 'APLICADO' : 'SIMULACAO'} — ${ok} brains, ${pulados} pulados`);
process.exit(0);
