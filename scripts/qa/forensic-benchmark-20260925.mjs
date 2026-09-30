import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const base = 'http://127.0.0.1:3001';
const headers = { Authorization: `Bearer ${readFileSync('/tmp/desigual-qa-token', 'utf8').trim()}`, 'Content-Type': 'application/json' };
const clientId = '3f1849a0-8682-45df-8ea2-b74be305f98b';
const cases = [
 ['B01','Crie uma task chamada "[QA FORENSE 2509] Carrossel IA" para Pedro Gabriel no Cliente Teste 7. Briefing: carrossel de 5 slides sobre IA no atendimento, formato 1080x1350, linguagem simples, sem estatísticas inventadas. CTA para WhatsApp. Preciso até amanhã.'],
 ['B02','O que você acha desse briefing? Apenas analise, não altere nada.'],
 ['B03','Acrescente no briefing da task que acabamos de criar: incluir legendas acessíveis e revisar ortografia.'],
 ['B04','Comente nessa task: QA forense confirmou o recebimento das orientações.'],
 ['B05','Mude o prazo dessa task para 28/09/2026.'],
 ['B06','Quem está responsável por essa task e qual é o prazo agora?'],
 ['B07','Crie uma task chamada "[QA FORENSE 2509] Responsavel invalido" no Cliente Teste 7 para Xylophonia Inexistente.'],
 ['B08','Crie uma task para Pedro Gabriel no Cliente Absolutamente Inexistente ZXQ.'],
 ['B09','Crie um briefing de edição para um Reel de 30 segundos sobre IA no atendimento do Cliente Teste 7. Hook, cenas, fala, texto na tela e CTA para WhatsApp. Somente o briefing, não crie task.'],
 ['B10','Esse briefing ficou aprovado. Crie isso no ClickUp para Pedro Gabriel, chamado "[QA FORENSE 2509] Reel aprovado", até amanhã.'],
 ['B11','Como está a operação do Cliente Teste 7 e o que eu deveria acompanhar primeiro? Não crie nem altere nada.'],
 ['B12','Localize a task "[QA FORENSE 2509] Carrossel IA" e confira responsável, prazo e briefing. Não crie outra.'],
];
const directory = new URL('../../artifacts/forensic-2026-09-25/', import.meta.url);
mkdirSync(directory, { recursive: true });
const results = [];
let conversationId;
for (const [id,prompt] of cases) {
 const start = Date.now();
 try {
  const response = await fetch(`${base}/chat`, {method:'POST',headers,body:JSON.stringify({message:prompt,agent_hint:'BENTO',client_id:clientId,...(conversationId?{conversation_id:conversationId}:{})}),signal:AbortSignal.timeout(60000)});
  const ack = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(ack));
  conversationId=ack.conversation_id;
  let execution;
  while(Date.now()-start<160000){
   await new Promise(r=>setTimeout(r,1500));
   const res=await fetch(`${base}/executions/${ack.execution_id}`,{headers,signal:AbortSignal.timeout(10000)});
   execution=await res.json();
   if(['completed','failed','cancelled'].includes(execution.status))break;
  }
  const result={id,prompt,ack,execution,durationMs:Date.now()-start};
  results.push(result);
  writeFileSync(new URL(`${id}.json`,directory),JSON.stringify(result,null,2),{mode:0o600});
  console.log(JSON.stringify({id,status:execution?.status,executionId:ack.execution_id,durationMs:result.durationMs,answer:execution?.steps?.at(-1)?.output?.answer}));
 } catch(error){results.push({id,prompt,error:String(error),durationMs:Date.now()-start});console.log(JSON.stringify(results.at(-1)));}
 writeFileSync(new URL('runtime-benchmark.json',directory),JSON.stringify(results,null,2),{mode:0o600});
}
