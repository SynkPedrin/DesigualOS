/**
 * sync-dossies.mts — leva os dossies de cliente (vault brain-desigual) para a
 * tabela `memories` como client.profile, que e o que o turno do Bento/Otto le.
 *
 * Complementa sync-brains.mts, nao o substitui: o BRAIN.md e o registro CRIATIVO
 * (posicionamento, persona, tom) e o dossie e o registro OPERACIONAL (lista do
 * ClickUp, servicos contratados, historico, lacunas). Os dois convivem por
 * subject diferente, e client-context.ts entrega os dois rotulados no turno.
 *
 * A RAIZ e passada em runtime de proposito. O vault tem dado real de cliente
 * (IDs de conta de midia, IDs de membro do ClickUp, dado comercial) e o
 * repositorio e PUBLICO: nada disso pode ser commitado. Vale a mesma regra que
 * o .gitignore ja aplica a `arquivos clientes/` e `brain/`.
 *
 * Idempotente: o subject por cliente faz reimportacao ATUALIZAR em vez de
 * empilhar. Rode sem --aplicar pra simular.
 *
 *   pnpm --filter @desigual-os/worker exec tsx scripts/sync-dossies.mts --raiz <caminho>
 *   pnpm --filter @desigual-os/worker exec tsx scripts/sync-dossies.mts --raiz <caminho> --aplicar
 */
import '../src/env.js';
import fs from 'node:fs';
import path from 'node:path';
import { rememberFact } from '@desigual-os/orchestrator';
import { acharCliente, carregarClientes, lerFrontmatter } from './lib/clientes.mjs';

const APLICAR = process.argv.includes('--aplicar');
const raizArg = process.argv.indexOf('--raiz');
const RAIZ = raizArg !== -1 ? process.argv[raizArg + 1] : undefined;

if (!RAIZ) {
  console.error('Faltou --raiz <caminho do vault brain-desigual>.');
  console.error('O vault tem dado real de cliente e NAO mora no repositorio (publico).');
  process.exit(1);
}

const PASTA_CLIENTES = path.join(RAIZ, '02-clientes');
if (!fs.existsSync(PASTA_CLIENTES)) {
  console.error(`Nao achei 02-clientes em ${RAIZ}. Aponte --raiz para a pasta brain-desigual.`);
  process.exit(1);
}

/** Todos os .md sob 02-clientes, menos o indice (que nao e dossie de ninguem). */
function dossies(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return dossies(p);
    if (!e.name.endsWith('.md') || e.name.startsWith('_')) return [];
    return [p];
  });
}

const clientes = await carregarClientes();
const arquivos = dossies(PASTA_CLIENTES).sort();
console.log(`${arquivos.length} dossies em ${PASTA_CLIENTES}; ${clientes.length} clientes no banco.\n`);

let ok = 0;
const semCliente: string[] = [];

for (const arquivo of arquivos) {
  const conteudo = fs.readFileSync(arquivo, 'utf8').trim();
  const fm = lerFrontmatter(conteudo);
  const base = path.basename(arquivo, '.md');
  // Ordem dos candidatos: o frontmatter e mais confiavel que o nome do arquivo.
  const c = acharCliente([fm.slug ?? '', fm.cliente ?? '', fm.nome ?? '', base], clientes);

  if (!c) {
    semCliente.push(base);
    continue;
  }
  if (conteudo.length < 200) {
    console.log(`  [vazio] ${base}`);
    continue;
  }
  if (!APLICAR) {
    console.log(`  ${base} -> ${c.name} (${conteudo.length} chars)`);
    ok++;
    continue;
  }

  const r = await rememberFact({
    kind: 'client.profile',
    clientId: c.id,
    content: conteudo,
    // Subject distinto do brain: os dois registros convivem, nao se aposentam.
    subject: `cliente:${c.id}:dossie`,
    sourceType: 'vault',
    sourceId: `brain-desigual/${path.relative(RAIZ, arquivo)}`,
    confidence: 0.9,
    importance: 0.9,
  });
  console.log(`  ${c.name}: ${r.status}`);
  ok++;
}

if (semCliente.length > 0) {
  console.log(`\nSem cliente correspondente no banco (${semCliente.length}): ${semCliente.join(', ')}`);
}
console.log(`\n${APLICAR ? 'APLICADO' : 'SIMULACAO'} — ${ok} dossies importados`);
process.exit(0);
