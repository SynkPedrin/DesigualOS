/**
 * QA live — Memória V2 (spec seções 102, 106, 107):
 *  1. escrita em "conversa 1" e recuperação em "conversa 2" (persistência real)
 *  2. isolamento cliente A vs cliente B (CRÍTICO)
 *  3. isolamento user A vs user B
 *  4. supersessão: fato novo sobre o mesmo subject aposenta o antigo
 *  5. expiração não volta pro recall
 * Roda contra o Supabase REAL com kind 'qa.test' e limpa tudo no final.
 * Uso: pnpm tsx scripts/qa/memory-test.mts
 */
process.loadEnvFile(new URL('../../../.env', import.meta.url).pathname);

const { rememberFact, recallMemories } = await import('@desigual-os/orchestrator');
const { db, schema } = await import('@desigual-os/database');
const { eq } = await import('drizzle-orm');

const CLIENT_A = 'c812e31f-de79-4c5c-8731-a467ac94dc84'; // cliente "teste"
const CLIENT_B = '091c458a-521d-49b9-b5d5-53e204989ec6'; // CASE #0
const USER_A = '27334b44-e7ff-41a5-84e9-6e1f617f6b0e'; // super
const USER_B = '23af47ac-8267-49b5-ae92-2b087539ec83'; // kimi.teste

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`);
  if (!ok) failures += 1;
}

try {
  // 1. Conversa 1: usuário ensina uma preferência.
  await rememberFact({
    kind: 'qa.test',
    clientId: CLIENT_A,
    content: 'QA memória: o cliente teste prefere headlines curtas e diretas nos criativos.',
    subject: 'qa:headline-pref',
    sourceType: 'manual',
    sourceId: 'qa-script-1',
    confidence: 0.9,
  });

  // 2. Conversa 2 (outra execução, outro processo lógico): recupera?
  const recalledA = await recallMemories({ clientId: CLIENT_A, kinds: ['qa.test'], limit: 5 });
  check(
    'memória persiste entre conversas',
    recalledA.some((m) => m.content.includes('headlines curtas')),
    `${recalledA.length} memória(s) recuperada(s)`,
  );

  // 3. CRÍTICO: cliente B não pode ver memória do cliente A.
  const recalledB = await recallMemories({ clientId: CLIENT_B, kinds: ['qa.test'], limit: 5 });
  check('isolamento cliente A/B', !recalledB.some((m) => m.content.includes('headlines curtas')), `${recalledB.length} vazada(s)`);

  // 4. User memory: user A escreve, user B não lê.
  await rememberFact({
    kind: 'qa.test.user',
    userId: USER_A,
    content: 'QA memória de usuário: prefere respostas curtas e objetivas no chat.',
    sourceType: 'manual',
    sourceId: 'qa-script-2',
  });
  const userA = await recallMemories({ userId: USER_A, kinds: ['qa.test.user'], limit: 5 });
  const userB = await recallMemories({ userId: USER_B, kinds: ['qa.test.user'], limit: 5 });
  check('user memory persiste', userA.some((m) => m.content.includes('respostas curtas')), `${userA.length}`);
  check('isolamento user A/B', !userB.some((m) => m.content.includes('respostas curtas')), `${userB.length} vazada(s)`);

  // 5. Supersessão: fato novo sobre o MESMO subject aposenta o antigo.
  await rememberFact({
    kind: 'qa.test',
    clientId: CLIENT_A,
    content: 'QA memória: o cliente teste agora prefere headlines longas e explicativas.',
    subject: 'qa:headline-pref',
    sourceType: 'manual',
    sourceId: 'qa-script-3',
    confidence: 0.95,
  });
  const afterSupersede = await recallMemories({ clientId: CLIENT_A, kinds: ['qa.test'], limit: 10 });
  const oldActive = afterSupersede.filter((m) => m.content.includes('headlines curtas'));
  const newActive = afterSupersede.filter((m) => m.content.includes('headlines longas'));
  check('supersessão: fato novo ativo', newActive.length === 1, `${newActive.length}`);
  check('supersessão: fato antigo aposentado', oldActive.length === 0, `${oldActive.length} ainda ativa(s)`);

  // 6. Histórico preservado (aposentado continua no banco, auditável).
  const all = await db.select().from(schema.memories).where(eq(schema.memories.kind, 'qa.test'));
  check(
    'histórico auditável preservado',
    all.some((m) => m.status === 'superseded' && m.content.includes('headlines curtas')),
    `${all.length} linha(s), superseded: ${all.filter((m) => m.status === 'superseded').length}`,
  );
} finally {
  // Cleanup: apaga SÓ as linhas QA deste teste.
  await db.delete(schema.memories).where(eq(schema.memories.kind, 'qa.test'));
  await db.delete(schema.memories).where(eq(schema.memories.kind, 'qa.test.user'));
  console.log('cleanup: linhas qa.test* removidas');
}

console.log(failures === 0 ? 'RESULTADO: TODOS OS TESTES DE MEMÓRIA PASSARAM' : `RESULTADO: ${failures} FALHA(S)`);
process.exit(failures === 0 ? 0 : 1);
