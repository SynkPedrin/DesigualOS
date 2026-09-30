#!/usr/bin/env node
/**
 * suite-integra.mjs — a suíte rodou INTEIRA, ou rodou pela metade e disse que
 * passou?
 *
 * O defeito que este script existe para tornar visível, medido em 30/09/2026:
 * a suíte do worker devolveu, no mesmo commit, três resultados diferentes —
 *
 *   1465 passed,  0 failed, total 1465   (limpa)
 *   1461 passed,  4 failed, total 1465   (falhou, mas contou tudo)
 *   1427 passed,  2 failed, total 1429   (TRINTA E SEIS testes sumiram)
 *
 * Na terceira, 36 testes não passaram, não falharam e não foram pulados: não
 * produziram resultado nenhum. O conjunto de ARQUIVOS era idêntico ao das
 * execuções limpas, então não foi arquivo deixando de carregar — foi a execução
 * do arquivo sendo abortada no meio.
 *
 * O que torna isso perigoso não é a falha: é que `numTotalTests` cai JUNTO. A
 * soma continua fechando (1427 + 2 = 1429), nenhum relatório acusa nada, e quem
 * lê o terminal vê "2 failed" onde a verdade é "2 failed e 36 nunca rodaram".
 * Eu só descobri comparando dois JSON na mão.
 *
 * A defesa é uma linha de base: o maior total já observado. Se uma execução
 * contar MENOS testes que isso, ela não é comparável às anteriores e o script
 * reprova — mesmo que os testes que rodaram tenham passado todos.
 *
 * Crescer é normal (todo teste novo sobe a linha). Encolher não é.
 *
 *   node scripts/qa/suite-integra.mjs <pacote>      confere e atualiza a linha
 *   node scripts/qa/suite-integra.mjs <pacote> --so-conferir    não escreve
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '../..');
const LINHA_DE_BASE = resolve(RAIZ, 'scripts/qa/suite-integra.baseline.json');

const pacote = process.argv[2] ?? 'worker';
const soConferir = process.argv.includes('--so-conferir');

const saida = resolve(RAIZ, `.tmp-suite-integra-${pacote}.json`);

console.log(`[suite-integra] rodando @desigual-os/${pacote}...`);
try {
  execFileSync(
    'pnpm',
    ['--filter', `@desigual-os/${pacote}`, 'exec', 'vitest', 'run', '--reporter=json', `--outputFile=${saida}`],
    { cwd: RAIZ, stdio: ['ignore', 'ignore', 'inherit'] },
  );
} catch {
  // Vitest sai diferente de zero quando há teste vermelho. Isso NÃO encerra o
  // script: a pergunta daqui é "rodou inteira?", que é outra pergunta, e ela
  // precisa ser respondida justamente nas execuções que falharam.
}

if (!existsSync(saida)) {
  console.error('[suite-integra] o vitest não produziu relatório. Isso já é uma falha de instrumento.');
  process.exit(1);
}

const r = JSON.parse(readFileSync(saida, 'utf8'));
const total = r.numTotalTests ?? 0;
const passou = r.numPassedTests ?? 0;
const falhou = r.numFailedTests ?? 0;
const arquivos = new Set((r.testResults ?? []).map((t) => t.name)).size;

const base = existsSync(LINHA_DE_BASE) ? JSON.parse(readFileSync(LINHA_DE_BASE, 'utf8')) : {};
const anterior = base[pacote];

console.log(`[suite-integra] ${pacote}: ${passou} passou, ${falhou} falhou, total ${total}, em ${arquivos} arquivos`);

let problema = null;

if (anterior) {
  if (total < anterior.total) {
    problema =
      `A suíte contou ${total} testes; o maior total já visto foi ${anterior.total} ` +
      `(em ${anterior.quando}). Faltaram ${anterior.total - total}.\n` +
      `      Teste que some não é teste que passa. Alguma execução de arquivo foi abortada no meio,\n` +
      `      e o relatório NÃO acusa isso sozinho — a soma continua fechando.`;
  } else if (arquivos < anterior.arquivos) {
    problema =
      `Rodaram ${arquivos} arquivos; o maior número já visto foi ${anterior.arquivos}. ` +
      `Arquivo que não carrega não reprova — some.`;
  }
}

if (problema) {
  console.error(`\n[suite-integra] REPROVADO\n\n      ${problema}\n`);
  process.exit(1);
}

// Falha de teste não é problema DESTE script, mas ele não pode devolver sucesso
// e fazer um `&&` na frente passar por cima de vermelho.
if (falhou > 0) {
  console.error(`\n[suite-integra] a suíte rodou inteira, e ${falhou} teste(s) reprovaram.\n`);
  process.exit(1);
}

if (!soConferir && (!anterior || total > anterior.total || arquivos > anterior.arquivos)) {
  base[pacote] = {
    total: Math.max(total, anterior?.total ?? 0),
    arquivos: Math.max(arquivos, anterior?.arquivos ?? 0),
    quando: new Date().toISOString().slice(0, 10),
  };
  mkdirSync(dirname(LINHA_DE_BASE), { recursive: true });
  writeFileSync(LINHA_DE_BASE, `${JSON.stringify(base, null, 2)}\n`);
  console.log(`[suite-integra] linha de base atualizada: ${base[pacote].total} testes, ${base[pacote].arquivos} arquivos`);
}

console.log('[suite-integra] OK — a suíte rodou inteira.');
