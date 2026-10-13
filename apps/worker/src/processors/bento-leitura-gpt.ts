import type { ExecuteResponse } from '@desigual-os/node-protocol';

/**
 * A CASCATA DE LEITURA DO BENTO NO CAMINHO AGÊNTICO: GPT → GPU → GPT.
 *
 * Medido em produção em 13/10/2026, minutos depois do deploy de 2fbba2c: a
 * pergunta voltou INFERENCE_UPSTREAM_5XX, a GPU tentou três vezes, e o GPT
 * não foi chamado nenhuma vez — nem como primário, nem como socorro.
 *
 * A causa: as duas vias por GPT (1af9e59) foram escritas no ramo de
 * `AGENT_LOOP_V2` DESLIGADO, e em produção o Bento roda com o loop LIGADO
 * (o boot do worker loga `agentLoopV2: { bento: true }`). O loop chama a GPU
 * pelo `callAgent`, que nunca soube do GPT. Os testes passavam porque
 * exercitavam o ramo que produção não usa.
 *
 * Por isso a cascata vive aqui, dentro do `callAgent` do loop: o loop
 * continua planejando, montando o pacote de contexto e avaliando a resposta
 * exatamente como antes — só passa a receber a resposta do GPT.
 */
export type CamadaDeLeitura = 'openai_leitura_primaria' | 'gpu' | 'openai_leitura_fallback_gpu';

export interface ResultadoDaLeitura {
  resposta: ExecuteResponse;
  camada: CamadaDeLeitura;
}

export async function lerComGptPrimeiro(params: {
  gptPrimario: boolean;
  perguntarAoGpt: () => Promise<ExecuteResponse | null>;
  perguntarAGpu: () => Promise<ExecuteResponse>;
}): Promise<ResultadoDaLeitura> {
  if (params.gptPrimario) {
    const gpt = await params.perguntarAoGpt();
    if (gpt?.answer?.trim()) return { resposta: gpt, camada: 'openai_leitura_primaria' };
  }
  const gpu = await params.perguntarAGpu();
  if (gpu.status === 'completed' && gpu.answer?.trim()) return { resposta: gpu, camada: 'gpu' };

  // O PISO: a GPU falhou de verdade. Com o GPT primário isto é a segunda
  // tentativa dele; sem, é a primeira. Em nenhum caso a falha de
  // infraestrutura chega à tela enquanto houver uma via de pé.
  const socorro = await params.perguntarAoGpt();
  if (socorro?.answer?.trim()) return { resposta: socorro, camada: 'openai_leitura_fallback_gpu' };
  return { resposta: gpu, camada: 'gpu' };
}

/**
 * O texto que vai ao GPT quando o contexto chega APARTADO.
 *
 * O loop entrega o pacote de contexto (equipe, identidade de quem pergunta,
 * boas-vindas, dados do ClickUp, dossiê) num campo separado da pergunta, e
 * isso é deliberado para a GPU: concatenado, o pacote sequestrava a
 * intenção ("Quem é a Esther?" virava a lista de tasks de um cliente). Para
 * o GPT o separador precisa ser explícito pelo mesmo motivo: a pergunta é o
 * que se responde; o contexto é de onde se tira a resposta.
 */
export function montarPromptDeLeitura(pergunta: string, contexto: string | undefined): string {
  const cabecalho = [
    'Você é o Bento, o assistente de operação da Agência Desigual dentro do Desigual OS.',
    'Responda em português do Brasil, direto e útil para quem está operando.',
    'Responda à PERGUNTA. Use o CONTEXTO como fonte: ele traz quem pergunta, a equipe, os clientes e o estado da operação.',
    'Se o CONTEXTO tiver uma instrução de boas-vindas ou de identidade, siga-a.',
    'O que não estiver no CONTEXTO você não sabe: diga isso em vez de supor. Nunca invente pessoa, cliente, tarefa ou número.',
  ].join('\n');
  if (!contexto?.trim()) return `${cabecalho}\n\nPERGUNTA:\n${pergunta}`;
  return `${cabecalho}\n\nPERGUNTA:\n${pergunta}\n\nCONTEXTO:\n${contexto}`;
}
