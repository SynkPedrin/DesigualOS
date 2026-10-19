/**
 * sync-product-docs.mts — leva os manuais de produto (docs/product/*.md) pra
 * tabela `memories` como kind `org.manual`, que o Bento passa a consultar em
 * TODO turno (não só quando um cliente está resolvido) pra responder "onde
 * fica X" / "como eu faço Y" sobre o próprio DesigualOS.
 *
 * Diferente de sync-brains.mts (que é por CLIENTE), este conteúdo é da
 * EMPRESA — mesmo manual serve qualquer colaborador daquela empresa,
 * independente de qual cliente está sendo atendido. Por isso grava com
 * `organizationId` explícito (ver nota em memory-engine.ts/RememberInput) em
 * vez de `clientId`.
 *
 * Hoje só existe uma empresa real de verdade (PROVIDER_ORGANIZATION_ID, a
 * própria Desigual) — se/quando uma segunda empresa branca começar a operar
 * o mesmo produto, rodar este script de novo apontando pra organização dela
 * (ORG_ID=<uuid> na frente do comando) é o que leva o manual até o Bento dela.
 *
 * Idempotente: subject por arquivo faz reimportação ATUALIZAR em vez de
 * empilhar. Sem argumento simula, com --aplicar grava.
 *
 *   pnpm --filter @desigual-os/worker exec tsx scripts/sync-product-docs.mts
 *   pnpm --filter @desigual-os/worker exec tsx scripts/sync-product-docs.mts --aplicar
 *   ORG_ID=<uuid> pnpm --filter @desigual-os/worker exec tsx scripts/sync-product-docs.mts --aplicar
 */
import '../src/env.js';
import fs from 'node:fs';
import path from 'node:path';
import { rememberFact } from '@desigual-os/orchestrator';

const RAIZ = new URL('../../../docs/product', import.meta.url).pathname;
const APLICAR = process.argv.includes('--aplicar');
const ORG_ID = (process.env.ORG_ID ?? process.env.PROVIDER_ORGANIZATION_ID)?.trim();

if (!ORG_ID) {
  console.error('Faltou ORG_ID (ou PROVIDER_ORGANIZATION_ID no .env) — sem isso o manual gravaria sem empresa e ficaria invisível pro recall.');
  process.exit(1);
}

const arquivos = fs.readdirSync(RAIZ).filter((f) => f.endsWith('.md'));

let ok = 0;
let pulados = 0;
for (const arquivo of arquivos) {
  const slug = arquivo.replace(/\.md$/, '');
  const conteudo = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8').trim();
  if (conteudo.length < 50) {
    console.log(`  [vazio] ${arquivo}`);
    pulados++;
    continue;
  }
  if (!APLICAR) {
    console.log(`  ${arquivo} -> org ${ORG_ID} (${conteudo.length} chars)`);
    ok++;
    continue;
  }
  const r = await rememberFact({
    kind: 'org.manual',
    organizationId: ORG_ID,
    content: conteudo,
    // subject por seção: reimportar ATUALIZA o manual daquela tela em vez de empilhar.
    subject: `sistema:manual:${slug}`,
    sourceType: 'vault',
    sourceId: `docs/product/${arquivo}`,
    confidence: 0.9,
    importance: 0.6,
  });
  console.log(`  ${slug}: ${r.status}`);
  ok++;
}
console.log(`\n${APLICAR ? 'APLICADO' : 'SIMULACAO'} — ${ok} manuais, ${pulados} pulados`);
process.exit(0);
