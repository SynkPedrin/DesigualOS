import '../src/env.js';
import { resolveOperationalTurn } from '../src/lib/operational-context.js';

const principal = { id: '27334b44-e7ff-41a5-84e9-6e1f617f6b0e', userId: '27334b44-e7ff-41a5-84e9-6e1f617f6b0e', email: 'super@institutoalmada.org', role: 'master', permissions: ['*'] } as never;
for (const pergunta of [
  'quem está sobrecarregado?',
  'como está a operação hoje?',
  'o que está atrasado na D. Carvalho?',
  'me faça um briefing da operação',
]) {
  const t = Date.now();
  const turno = await resolveOperationalTurn(pergunta, principal, new Date(), null, null);
  console.log(`${Date.now() - t}ms | escopo=${turno.scope.kind} | bloco=${turno.context.block?.length ?? 0} chars | falha=${turno.context.failure ?? '-'} :: ${pergunta}`);
}
process.exit(0);
