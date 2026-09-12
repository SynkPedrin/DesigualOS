/**
 * Portão de não regressão do Jarbas (Onda 0, auditoria seção 5).
 *
 * O Jarbas é INTOCÁVEL: baseline de qualidade do sistema. Este script roda os
 * quatro testes que provam que nada no comportamento dele mudou, e imprime um
 * placar. Roda no início e no fim de toda onda.
 *
 * Uso:  pnpm --filter @desigual-os/api exec tsx ../../scripts/qa/jarbas-nao-regressao.ts
 * Sai com código 1 se qualquer portão falhar.
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

interface Portao {
  id: string;
  nome: string;
  package: string;
  testFile: string;
}

const PORTOES: Portao[] = [
  {
    id: 'a',
    nome: 'snapshot sha256 do prompt do Jarbas (personalities.ts congelado)',
    package: '@desigual-os/types',
    testFile: 'src/personalities.test.ts',
  },
  {
    id: 'b',
    nome: 'bloco operacional do ClickUp NUNCA entra na mensagem do Jarbas',
    package: '@desigual-os/api',
    testFile: 'src/chat/message-assembly.test.ts',
  },
  {
    id: 'c',
    nome: 'anti-duplicidade: Jarbas tem exatamente 1 tentativa no BullMQ',
    package: '@desigual-os/orchestrator',
    testFile: 'src/queues.test.ts',
  },
  {
    id: 'd1',
    nome: '[AGUARDA_APROVACAO] vira tool_call pendente (interceptação no worker)',
    package: '@desigual-os/worker',
    testFile: 'src/processors/execute-job.test.ts',
  },
  {
    id: 'd2',
    nome: 'extractApprovalProposal extrai o bloco de aprovação (contrato do marcador)',
    package: '@desigual-os/types',
    testFile: 'src/text.test.ts',
  },
];

let falhas = 0;

console.log('PORTÃO DO JARBAS: não regressão');
console.log('================================');

for (const portao of PORTOES) {
  const comando = `pnpm --filter ${portao.package} exec vitest run ${portao.testFile}`;
  try {
    execSync(comando, { cwd: REPO, stdio: 'pipe' });
    console.log(`[PASS] ${portao.id}) ${portao.nome}`);
  } catch (error) {
    falhas++;
    console.log(`[FAIL] ${portao.id}) ${portao.nome}`);
    const saida = String((error as { stdout?: Buffer }).stdout ?? '');
    const resumo = saida.split('\n').filter((l) => l.includes('✗') || l.includes('FAIL') || l.includes('AssertionError'));
    for (const linha of resumo.slice(0, 6)) console.log(`       ${linha.trim()}`);
  }
}

console.log('================================');
if (falhas > 0) {
  console.log(`PLACAR: ${PORTOES.length - falhas}/${PORTOES.length} verdes. O Jarbas foi tocado. PARE a onda.`);
  process.exit(1);
}
console.log(`PLACAR: ${PORTOES.length}/${PORTOES.length} verdes. Jarbas intacto, a onda pode seguir.`);
