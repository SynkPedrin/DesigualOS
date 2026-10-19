/**
 * sync-obsidian-vault.mts — leva o vault Obsidian (o mesmo que
 * `nodes/desigual-node/src/obsidian/reader.ts` busca AO VIVO, por máquina, sob
 * demanda) pra tabela `memories`, como `cliente:<id>:vault`.
 *
 * Bento 3.0, Fase 4 (10/10/2026). O achado da Fase 0 chamou essa busca ao vivo
 * de "desconectada da memória de verdade" — impreciso: o código tem uma regra
 * de ouro deliberada ("nunca sincronizar o vault pro servidor central"), não
 * um bug. O problema real é outro: busca de texto livre por `context_refs`
 * não sabe qual arquivo É o perfil de qual cliente — já causou alucinação
 * documentada (D. Carvalho virando "rede de joias e relógios", achado em
 * `client-context.ts`). Este script é o caminho que SABE: casa arquivo com
 * cliente do banco (mesma heurística de sync-dossies.mts, `lib/clientes.mts`)
 * ANTES de gravar, e o que não casa fica de fora — nunca registrado no
 * cliente errado.
 *
 * NÃO duplica sync-dossies.mts: pula qualquer caminho sob `02-clientes/`
 * (onde o dossiê já vive, já sincronizado, já com subject próprio). Isto
 * cobre o RESTO do vault — anotação solta, nota de reunião, brief que alguém
 * só guardou lá — sob um subject PRÓPRIO (`:vault`, não `:dossie`), porque é
 * dado menos curado: `rememberFact` já reflete isso (sourceType 'vault' tem
 * confidence padrão 0.8, contra o 0.9 que o dossiê recebe explicitamente).
 *
 * A RAIZ é passada em runtime de propósito, igual sync-dossies.mts: o vault
 * tem dado real (nome de cliente, conteúdo de reunião) e o repositório é
 * PÚBLICO.
 *
 * NÃO VERIFICADO contra vault real nesta sessão — não há OBSIDIAN_VAULT_PATH
 * nem vault de cliente disponível neste ambiente. A lógica de casamento e
 * filtro tem teste (sync-obsidian-vault.test.ts) com vault sintético; rodar
 * contra o vault de verdade, numa máquina com acesso a ele, fica para quem
 * tiver esse acesso.
 *
 * Idempotente: subject por arquivo faz reimportação ATUALIZAR, não empilhar.
 * Rode sem --aplicar pra simular.
 *
 *   pnpm --filter @desigual-os/worker exec tsx scripts/sync-obsidian-vault.mts --raiz <caminho>
 *   pnpm --filter @desigual-os/worker exec tsx scripts/sync-obsidian-vault.mts --raiz <caminho> --aplicar
 */
import '../src/env.js';
import fs from 'node:fs';
import path from 'node:path';
import { rememberFact } from '@desigual-os/orchestrator';
import { acharCliente, carregarClientes, lerFrontmatter } from './lib/clientes.mjs';

/** Tamanho mínimo pra valer a pena gravar — mesmo piso de sync-dossies.mts. */
const TAMANHO_MINIMO = 200;

/**
 * Pastas que nunca entram aqui porque já têm dono: `02-clientes` é o
 * dossiê (sync-dossies.mts); ponto no início é o `.obsidian` do próprio app.
 */
export function deveIgnorarCaminho(relativo: string): boolean {
  const segmentos = relativo.split(path.sep);
  return segmentos.some((s) => s.startsWith('.') || s.toLowerCase() === '02-clientes');
}

/** Todos os .md do vault, exceto o que `deveIgnorarCaminho` recusa. */
export function arquivosDoVault(raiz: string, dir = raiz): string[] {
  let entradas: fs.Dirent[];
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entradas.flatMap((entrada) => {
    const caminhoAbsoluto = path.join(dir, entrada.name);
    const relativo = path.relative(raiz, caminhoAbsoluto);
    if (deveIgnorarCaminho(relativo)) return [];
    if (entrada.isDirectory()) return arquivosDoVault(raiz, caminhoAbsoluto);
    if (!entrada.isFile() || !entrada.name.endsWith('.md')) return [];
    return [caminhoAbsoluto];
  });
}

const RODANDO_COMO_SCRIPT = process.argv[1]?.endsWith('sync-obsidian-vault.mts') ?? false;

if (RODANDO_COMO_SCRIPT) {
  const APLICAR = process.argv.includes('--aplicar');
  const raizArg = process.argv.indexOf('--raiz');
  const RAIZ = raizArg !== -1 ? process.argv[raizArg + 1] : undefined;

  if (!RAIZ) {
    console.error('Faltou --raiz <caminho do vault Obsidian>.');
    console.error('O vault tem dado real e NAO mora no repositorio (publico).');
    process.exit(1);
  }
  if (!fs.existsSync(RAIZ)) {
    console.error(`Não achei o vault em ${RAIZ}.`);
    process.exit(1);
  }

  const clientes = await carregarClientes();
  const arquivos = arquivosDoVault(RAIZ).sort();
  console.log(`${arquivos.length} notas (fora de 02-clientes/) em ${RAIZ}; ${clientes.length} clientes no banco.\n`);

  let ok = 0;
  let vazios = 0;
  const semCliente: string[] = [];

  for (const arquivo of arquivos) {
    const conteudo = fs.readFileSync(arquivo, 'utf8').trim();
    const relativo = path.relative(RAIZ, arquivo);
    if (conteudo.length < TAMANHO_MINIMO) {
      vazios++;
      continue;
    }

    const fm = lerFrontmatter(conteudo);
    const base = path.basename(arquivo, '.md');
    // Mesma ordem de candidatos que sync-dossies.mts: frontmatter antes do nome
    // do arquivo, porque o frontmatter é declarado, o nome é só convenção.
    const c = acharCliente([fm.slug ?? '', fm.cliente ?? '', fm.nome ?? '', base], clientes);

    if (!c) {
      semCliente.push(relativo);
      continue;
    }

    if (!APLICAR) {
      console.log(`  ${relativo} -> ${c.name} (${conteudo.length} chars)`);
      ok++;
      continue;
    }

    const r = await rememberFact({
      kind: 'client.profile',
      clientId: c.id,
      content: conteudo,
      // Subject POR ARQUIVO (caminho relativo, não só o nome): um cliente pode
      // ter várias notas soltas no vault, e duas pastas diferentes podem ter
      // um arquivo de mesmo nome — subject repetido faria a segunda
      // reimportação apagar a primeira nota em vez de conviver com ela.
      subject: `cliente:${c.id}:vault:${relativo}`,
      sourceType: 'vault',
      sourceId: relativo,
      // Sem confidence/importance explícitos: o padrão de sourceType 'vault'
      // (0.8 / 0.5) já reflete que isto é nota solta, não dossiê curado —
      // sync-dossies.mts sobe pra 0.9 de propósito, aqui não se justifica.
    });
    console.log(`  ${c.name} (${relativo}): ${r.status}`);
    ok++;
  }

  if (semCliente.length > 0) {
    console.log(`\nSem cliente correspondente no banco (${semCliente.length}): ${semCliente.join(', ')}`);
  }
  if (vazios > 0) {
    console.log(`Ignoradas por serem curtas demais (<${TAMANHO_MINIMO} chars): ${vazios}`);
  }
  console.log(`\n${APLICAR ? 'APLICADO' : 'SIMULACAO'} — ${ok} notas importadas`);
  process.exit(0);
}
