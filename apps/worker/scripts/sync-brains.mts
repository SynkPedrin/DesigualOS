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
import { db, schema } from '@desigual-os/database';
import { isNull } from 'drizzle-orm';
import { rememberFact } from '@desigual-os/orchestrator';

// Caminho relativo ao repo: o script roda em qualquer maquina/checkout.
const RAIZ = new URL('../../../.claude/skills/otto/brains', import.meta.url).pathname;
const dobra = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const APLICAR = process.argv.includes('--aplicar');

const brains = fs.readdirSync(RAIZ).filter(d => !['INDEX.md','_template'].includes(d) && fs.existsSync(path.join(RAIZ,d,'BRAIN.md')));
const clientes = await db.select({ id: schema.clients.id, name: schema.clients.name, slug: schema.clients.slug }).from(schema.clients).where(isNull(schema.clients.deletedAt));

function acharCliente(brain: string) {
  const alvo = dobra(brain);
  return clientes.find(c => dobra(c.name) === alvo || dobra(c.slug) === alvo)
      ?? clientes.find(c => dobra(c.name).startsWith(alvo) || alvo.startsWith(dobra(c.name)))
      // "por-do-sol" -> "Cond. Pôr do Sol": o nome do banco carrega prefixo.
      ?? clientes.find(c => dobra(c.name).includes(alvo) || alvo.includes(dobra(c.slug)));
}

let ok = 0, pulados = 0;
for (const b of brains) {
  const c = acharCliente(b);
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
