import { describe, expect, it } from 'vitest';
import { GatewayDoBento, type DependenciasDoGateway } from './gateway';
import { OpenwaError } from './openwa/client';
import { TEXTOS } from './textos';
import type { UsuarioDoCanal } from './usuario';
import {
  ArmazemEmMemoria,
  BOT,
  BrainFalso,
  SESSAO,
  TransporteFalso,
  configDeTeste,
  envelope,
  logMudo,
  texto,
  usuario,
} from './test-doubles';

const JAMILLE = '5518991110001';
const OTTO = '5518991110002';
const SUZY = '5518991110003';
const ESTRANHO = '5511900000000';

function montar(extra: Partial<DependenciasDoGateway> = {}, usuarios: Record<string, UsuarioDoCanal> = {}) {
  const armazem = new ArmazemEmMemoria();
  const transporte = new TransporteFalso();
  const brain = new BrainFalso();
  const deps: DependenciasDoGateway = {
    config: configDeTeste(),
    transporte,
    armazem,
    brain,
    carregarUsuario: async (id) => usuarios[id] ?? { tipo: 'ok', user: usuario(id) },
    transcritor: null,
    guardarAnexo: null,
    log: logMudo,
    esperar: async () => undefined,
    ...extra,
  };
  const gateway = new GatewayDoBento(deps);
  return { gateway, armazem, transporte, brain, deps };
}

describe('entrada: o que nem vira turno', () => {
  it('ignora eco das próprias mensagens (fromMe) sem gravar nada — anti-loop', async () => {
    const { gateway, armazem, brain } = montar();
    const r = await gateway.receber(envelope({ id: 'm1', chatId: `${JAMILLE}@c.us`, body: 'oi', fromMe: true }));
    expect(r).toEqual({ aceito: false, motivo: 'own_message' });
    expect(armazem.recebidas).toHaveLength(0);
    expect(brain.pedidos).toHaveLength(0);
  });

  it('ignora mensagem cujo remetente é o próprio número do Bento, mesmo sem fromMe', async () => {
    const { gateway, armazem } = montar();
    const r = await gateway.receber(texto(BOT, 'eco'));
    expect(r).toEqual({ aceito: false, motivo: 'own_number' });
    expect(armazem.recebidas).toHaveLength(0);
  });

  it('ignora message.sent (eco das respostas) e outros eventos', async () => {
    const { gateway } = montar();
    const r = await gateway.receber({ ...texto(JAMILLE, 'x'), event: 'message.sent' });
    expect(r).toEqual({ aceito: false, motivo: 'evento:message.sent' });
  });

  it('recusa evento de outra sessão do OpenWA (sessão de colaborador nunca vira Bento)', async () => {
    const { gateway, armazem } = montar();
    const r = await gateway.receber({ ...texto(JAMILLE, 'oi'), sessionId: 'sessao-de-outra-pessoa' });
    expect(r).toEqual({ aceito: false, motivo: 'sessao_desconhecida' });
    expect(armazem.recebidas).toHaveLength(0);
  });

  it('recusa envelope velho (replay de corpo assinado capturado)', async () => {
    const { gateway } = montar();
    const velho = { ...texto(JAMILLE, 'oi'), timestamp: new Date(Date.now() - 60 * 60_000).toISOString() };
    expect(await gateway.receber(velho)).toEqual({ aceito: false, motivo: 'evento_fora_da_janela' });
  });

  it('ignora status/broadcast', async () => {
    const { gateway } = montar();
    const r = await gateway.receber(envelope({ id: 'b1', chatId: 'status@broadcast', body: 'x', isStatusBroadcast: true }));
    expect(r.aceito).toBe(false);
  });
});

describe('duplicidade', () => {
  it('o mesmo webhook entregue 3 vezes produz UMA chamada ao Brain e UMA resposta', async () => {
    const { gateway, armazem, transporte, brain } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    const evento = texto(JAMILLE, 'quais tarefas estão atrasadas?', 'wamid-DUP');
    const r1 = await gateway.receber(evento);
    const r2 = await gateway.receber({ ...evento, deliveryId: 'dlv_retry' });
    const r3 = await gateway.receber({ ...evento, idempotencyKey: `msg_${SESSAO}_wamid-DUP_wh2` });
    await gateway.ocioso();
    expect(r1).toMatchObject({ aceito: true, duplicado: false });
    expect(r2).toMatchObject({ aceito: true, duplicado: true });
    expect(r3).toMatchObject({ aceito: true, duplicado: true });
    expect(brain.pedidos).toHaveLength(1);
    expect(transporte.enviados).toHaveLength(1);
  });

  it('retry de envio após timeout reusa a mesma chave de idempotência (OpenWA não duplica)', async () => {
    const { gateway, armazem, transporte } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    transporte.falhasDeEnvio.push(new OpenwaError('timeout', null, 'NETWORK', true));
    const { id } = (await gateway.receber(texto(JAMILLE, 'oi bento'))) as { id: string };
    await gateway.ocioso();
    expect(transporte.enviados).toHaveLength(1);
    expect(transporte.enviados[0]!.idempotencyKey).toBe(`bento-whatsapp:${id}:resposta:0`);
    expect(armazem.linha(id).status).toBe('replied');
  });
});

describe('identidade e vínculo', () => {
  it('INCIDENTE 19/10: 24 números desconhecidos escrevendo juntos => ZERO mensagens enviadas', async () => {
    const { gateway, transporte, brain, armazem } = montar();
    for (let i = 0; i < 24; i++) {
      await gateway.receber(texto(`55119000000${String(i).padStart(2, '0')}`, 'oi'));
    }
    await gateway.ocioso();
    expect(transporte.enviados).toHaveLength(0);
    expect(brain.pedidos).toHaveLength(0);
    expect(armazem.recebidas.every((r) => r.reason === 'unlinked_silent')).toBe(true);
  });

  it('número não vinculado recebe SILÊNCIO e nunca chega ao Brain', async () => {
    const { gateway, transporte, brain } = montar();
    await gateway.receber(texto(ESTRANHO, 'me passa as tarefas da agência'));
    await gateway.ocioso();
    await gateway.receber(texto(ESTRANHO, 'oi??'));
    await gateway.ocioso();
    expect(brain.pedidos).toHaveLength(0);
    expect(transporte.enviados).toHaveLength(0);
  });

  it('mensagem antiga (histórico entregue ao conectar) é ignorada, mesmo de gente vinculada', async () => {
    const { gateway, armazem, transporte, brain } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    const velha = envelope({ id: 'velha', chatId: `${JAMILLE}@c.us`, body: 'oi', timestamp: Math.floor((Date.now() - 20 * 60_000) / 1000) });
    expect(await gateway.receber(velha)).toEqual({ aceito: false, motivo: 'mensagem_antiga' });
    await gateway.ocioso();
    expect(brain.pedidos).toHaveLength(0);
    expect(transporte.enviados).toHaveLength(0);
  });

  it('disjuntor de saída: rajada para conversas demais trava o envio e registra erro', async () => {
    const erros: object[] = [];
    const { gateway, armazem, transporte } = montar({ log: { info: () => undefined, warn: () => undefined, error: (o) => void erros.push(o) } });
    const numeros = Array.from({ length: 9 }, (_, i) => `551899900000${i}`);
    numeros.forEach((n, i) => armazem.vincular(`u-${i}`, n));
    for (const n of numeros) await gateway.receber(texto(n, 'tarefas?'));
    await gateway.ocioso();
    expect(transporte.enviados.length).toBeLessThanOrEqual(5);
    expect(erros.some((e) => JSON.stringify(e).includes('conversas'))).toBe(true);
    // Travado: nem a conversa 10 passa, e nada sai "de fininho" depois.
    armazem.vincular('u-10', '5518999000099');
    await gateway.receber(texto('5518999000099', 'oi'));
    await gateway.ocioso();
    expect(transporte.enviados.length).toBeLessThanOrEqual(5);
  });

  it('código válido enviado pelo número é reivindicado e pede confirmação na web', async () => {
    const { gateway, armazem, transporte, brain } = montar();
    armazem.criarCodigo('u-otto', 'BENTO-ABCD-EFGH');
    const { id } = (await gateway.receber(texto(OTTO, 'meu código: bento abcd efgh'))) as { id: string };
    await gateway.ocioso();
    expect(armazem.codigos[0]!.status).toBe('claimed');
    expect(armazem.linha(id).reason).toBe('link_code_claimed');
    expect(transporte.textos()[0]).toContain('confirme no Desigual OS');
    expect(brain.pedidos).toHaveLength(0);
    // Reivindicar NÃO vincula: só a confirmação na sessão web cria o vínculo.
    expect(armazem.vinculos).toHaveLength(0);
  });

  it('código inválido ou expirado é recusado', async () => {
    const { gateway, armazem, transporte } = montar();
    armazem.criarCodigo('u-otto', 'BENTO-ABCD-EFGH', -1_000);
    await gateway.receber(texto(OTTO, 'BENTO-ABCD-EFGH'));
    await gateway.ocioso();
    expect(transporte.textos()).toEqual([TEXTOS.codigoInvalido]);
  });

  it('tentativas de código em sequência são limitadas por número', async () => {
    const { gateway, transporte } = montar();
    for (let i = 0; i < 6; i++) {
      await gateway.receber(texto(ESTRANHO, `BENTO-AAAA-AAA${'BCDEFG'[i]}`));
      await gateway.ocioso();
    }
    expect(transporte.textos().slice(0, 5).every((t) => t === TEXTOS.codigoInvalido)).toBe(true);
    expect(transporte.textos()[5]).toBe(TEXTOS.muitasTentativas);
  });

  it('número já vinculado a outra pessoa não pode ser reivindicado por código', async () => {
    const { gateway, armazem, transporte } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    armazem.criarCodigo('u-intruso', 'BENTO-ABCD-EFGH');
    // Vinculado: a mensagem vira turno normal; o código não muda o dono do número.
    await gateway.receber(texto(JAMILLE, 'BENTO-ABCD-EFGH'));
    await gateway.ocioso();
    expect(armazem.codigos[0]!.status).toBe('pending');
    expect(armazem.vinculos.filter((v) => v.status === 'active')).toHaveLength(1);
    expect(transporte.enviados).toHaveLength(1);
  });

  it('@lid é resolvido para telefone pelo OpenWA antes de procurar o vínculo', async () => {
    const { gateway, armazem, transporte, brain } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    transporte.telefonesDeLid.set('99887766@lid', JAMILLE);
    await gateway.receber(envelope({ id: 'lid1', chatId: '99887766@lid', body: 'oi bento' }));
    await gateway.ocioso();
    expect(brain.pedidos[0]!.user.id).toBe('u-jamille');
  });

  it('remetente sem telefone resolvível é ignorado (não há como provar identidade)', async () => {
    const { gateway, armazem, brain } = montar();
    const { id } = (await gateway.receber(envelope({ id: 'lid2', chatId: '123@lid', body: 'oi' }))) as { id: string };
    await gateway.ocioso();
    expect(armazem.linha(id).reason).toBe('sender_unresolved');
    expect(brain.pedidos).toHaveLength(0);
  });

  it('conta desativada não é atendida', async () => {
    const { gateway, armazem, transporte, brain } = montar({}, { 'u-jamille': { tipo: 'inativo' } });
    armazem.vincular('u-jamille', JAMILLE);
    await gateway.receber(texto(JAMILLE, 'tarefas?'));
    await gateway.ocioso();
    expect(brain.pedidos).toHaveLength(0);
    expect(transporte.textos()).toEqual([TEXTOS.contaInativa]);
  });

  it('usuário sem chat:write não é atendido', async () => {
    const { gateway, armazem, transporte, brain } = montar({}, { 'u-jamille': { tipo: 'sem_permissao' } });
    armazem.vincular('u-jamille', JAMILLE);
    await gateway.receber(texto(JAMILLE, 'tarefas?'));
    await gateway.ocioso();
    expect(brain.pedidos).toHaveLength(0);
    expect(transporte.textos()).toEqual([TEXTOS.semPermissao]);
  });
});

describe('turno no Brain', () => {
  it('leva ao Brain com o usuário DO VÍNCULO, nunca um usuário de serviço', async () => {
    const { gateway, armazem, brain } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    await gateway.receber(texto(JAMILLE, 'O que tenho para entregar hoje?'));
    await gateway.ocioso();
    expect(brain.pedidos).toHaveLength(1);
    expect(brain.pedidos[0]!.user.id).toBe('u-jamille');
    expect(brain.pedidos[0]!.mensagem).toBe('O que tenho para entregar hoje?');
  });

  it('continuidade: o segundo turno vai na MESMA conversa do primeiro', async () => {
    const { gateway, armazem, brain } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    brain.roteiro = (p) => ({ tipo: 'resposta', texto: 'ok', conversationId: p.conversationId ?? 'conv-jamille', executionId: 'E' });
    await gateway.receber(texto(JAMILLE, 'quais tarefas estão atrasadas?'));
    await gateway.ocioso();
    await gateway.receber(texto(JAMILLE, 'e quais são minhas?'));
    await gateway.ocioso();
    await gateway.receber(texto(JAMILLE, 'e a primeira, quem está responsável?'));
    await gateway.ocioso();
    expect(brain.pedidos.map((p) => p.conversationId)).toEqual([null, 'conv-jamille', 'conv-jamille']);
  });

  it('isolamento: três pessoas ao mesmo tempo, cada uma com seu usuário e sua conversa', async () => {
    const { gateway, armazem, brain } = montar();
    armazem.vincular('u-jamille', JAMILLE, { conversationId: 'conv-j' });
    armazem.vincular('u-otto', OTTO, { conversationId: 'conv-o' });
    armazem.vincular('u-suzy', SUZY, { conversationId: 'conv-s' });
    brain.roteiro = async (p) => {
      await new Promise((r) => setTimeout(r, 5));
      return { tipo: 'resposta', texto: `para ${p.user.id}`, conversationId: p.conversationId!, executionId: 'E' };
    };
    await Promise.all([
      gateway.receber(texto(JAMILLE, 'minhas tarefas')),
      gateway.receber(texto(OTTO, 'minhas tarefas')),
      gateway.receber(texto(SUZY, 'minhas tarefas')),
    ]);
    await gateway.ocioso();
    const pares = brain.pedidos.map((p) => `${p.user.id}:${p.conversationId}`).sort();
    expect(pares).toEqual(['u-jamille:conv-j', 'u-otto:conv-o', 'u-suzy:conv-s']);
  });

  it('mensagens seguidas da mesma pessoa viram um turno só', async () => {
    // Janela larga de propósito: com 5 ms o teste dependia de a máquina estar livre.
    const { gateway, armazem, brain, transporte } = montar({ config: configDeTeste({ coalesceWindowMs: 400 }) });
    armazem.vincular('u-jamille', JAMILLE);
    await gateway.receber(texto(JAMILLE, 'Bento'));
    await gateway.receber(texto(JAMILLE, 'quais tarefas'));
    await gateway.receber(texto(JAMILLE, 'estão atrasadas?'));
    await gateway.ocioso();
    expect(brain.pedidos).toHaveLength(1);
    expect(brain.pedidos[0]!.mensagem).toBe('Bento\nquais tarefas\nestão atrasadas?');
    expect(transporte.enviados).toHaveLength(1);
    expect(armazem.recebidas.every((r) => r.status === 'replied')).toBe(true);
  });

  it('resposta do Brain é formatada para WhatsApp sem perder conteúdo', async () => {
    const { gateway, armazem, brain, transporte } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    brain.roteiro = () => ({
      tipo: 'resposta',
      texto: '## Atrasadas\n\n- **Post Cosentino** — prazo 14/10, Tammy\n- [Briefing](https://app.clickup.com/t/1)',
      conversationId: 'c',
      executionId: 'E',
    });
    await gateway.receber(texto(JAMILLE, 'atrasadas?'));
    await gateway.ocioso();
    expect(transporte.textos()[0]).toBe('*Atrasadas*\n\n- *Post Cosentino* — prazo 14/10, Tammy\n- Briefing (https://app.clickup.com/t/1)');
  });

  it('falha do Brain vira aviso honesto — nunca "tarefa criada"', async () => {
    const { gateway, armazem, brain, transporte } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    brain.roteiro = () => ({ tipo: 'falhou', motivo: "execução terminou em 'failed'", conversationId: 'c', executionId: 'E' });
    const { id } = (await gateway.receber(texto(JAMILLE, 'cria uma tarefa pro Otto'))) as { id: string };
    await gateway.ocioso();
    expect(transporte.textos()).toEqual([TEXTOS.falhaNaExecucao]);
    expect(armazem.linha(id).reason).toBe('brain_failed');
  });

  it('Brain fora do ar vira aviso de indisponibilidade', async () => {
    const { gateway, armazem, brain, transporte } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    brain.roteiro = () => ({ tipo: 'indisponivel', motivo: 'Redis fora' });
    await gateway.receber(texto(JAMILLE, 'status?'));
    await gateway.ocioso();
    expect(transporte.textos()).toEqual([TEXTOS.brainIndisponivel]);
  });

  it('conversa guardada inválida: abre outra e responde, sem falhar', async () => {
    const { gateway, armazem, brain, transporte } = montar();
    const v = armazem.vincular('u-jamille', JAMILLE, { conversationId: 'conv-apagada' });
    brain.roteiro = (p) =>
      p.conversationId === 'conv-apagada'
        ? { tipo: 'conversa_invalida', motivo: 'not found' }
        : { tipo: 'resposta', texto: 'ok', conversationId: 'conv-nova', executionId: 'E' };
    await gateway.receber(texto(JAMILLE, 'oi'));
    await gateway.ocioso();
    expect(brain.pedidos.map((p) => p.conversationId)).toEqual(['conv-apagada', null]);
    expect(transporte.textos()).toEqual(['ok']);
    expect(armazem.vinculos.find((x) => x.id === v.id)!.conversationId).toBe('conv-nova');
  });

  it('limite de turnos por hora por pessoa', async () => {
    const { gateway, armazem, brain, transporte } = montar({ config: configDeTeste({ maxTurnsPerHour: 2 }) });
    armazem.vincular('u-jamille', JAMILLE);
    for (const t of ['um', 'dois', 'três']) {
      await gateway.receber(texto(JAMILLE, t));
      await gateway.ocioso();
    }
    expect(brain.pedidos).toHaveLength(2);
    expect(transporte.textos()[2]).toBe(TEXTOS.limiteDeUso);
  });

  it('envio que falha de vez fica send_failed (a resposta não some calada)', async () => {
    const { gateway, armazem, transporte } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    transporte.falhasDeEnvio.push(new OpenwaError('chat inválido', 400, null, false));
    const { id } = (await gateway.receber(texto(JAMILLE, 'oi'))) as { id: string };
    await gateway.ocioso();
    expect(armazem.linha(id).status).toBe('send_failed');
    expect(armazem.linha(id).error).toContain('chat inválido');
  });
});

describe('capacidade igual à do chat', () => {
  it('o turno usa o roteamento configurado (AUTO por padrão)', async () => {
    const { gateway, armazem, brain } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    await gateway.receber(texto(JAMILLE, 'como estão as campanhas da Cosentino?'));
    await gateway.ocioso();
    expect(brain.pedidos[0]!.agente).toBe('AUTO');
  });

  it('resposta de outro agente chega identificada; do Bento chega sem rótulo', async () => {
    const { gateway, armazem, brain, transporte } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    brain.roteiro = (p) => ({
      tipo: 'resposta',
      texto: 'CPL caiu 12% na semana.',
      conversationId: 'c',
      executionId: 'E',
      agente: p.mensagem.includes('campanha') ? 'jarbas' : 'bento',
    });
    await gateway.receber(texto(JAMILLE, 'como está a campanha?'));
    await gateway.ocioso();
    await gateway.receber(texto(JAMILLE, 'e as tarefas?'));
    await gateway.ocioso();
    expect(transporte.textos()).toEqual(['*Jarbas:*\n\nCPL caiu 12% na semana.', 'CPL caiu 12% na semana.']);
  });

  it('imagem vira anexo do turno, como o upload do chat web', async () => {
    const { gateway, armazem, brain, transporte } = montar({
      config: configDeTeste({ documentsEnabled: true }),
      guardarAnexo: async ({ filename, mimetype }) => ({ url: `https://storage.test/${filename}`, filename, contentType: mimetype }),
    });
    armazem.vincular('u-jamille', JAMILLE);
    transporte.midias.set('img2', Buffer.from('jpeg'));
    await gateway.receber(envelope({ id: 'img2', chatId: `${JAMILLE}@c.us`, type: 'image', body: 'anexa isso na tarefa do post', media: { mimetype: 'image/jpeg', omitted: true } }));
    await gateway.ocioso();
    expect(brain.pedidos[0]!.mensagem).toBe('anexa isso na tarefa do post');
    expect(brain.pedidos[0]!.anexos?.[0]).toMatchObject({ contentType: 'image/jpeg' });
  });

  it('atualizar a configuração vale sem recriar o gateway', async () => {
    const { gateway, armazem, brain, transporte } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    gateway.atualizarConfig(configDeTeste({ agentHint: 'BENTO' }));
    await gateway.receber(texto(JAMILLE, 'oi'));
    await gateway.ocioso();
    expect(brain.pedidos[0]!.agente).toBe('BENTO');
    expect(transporte.enviados).toHaveLength(1);
  });
});

describe('modo teste aberto e quarentena', () => {
  const abertoPor = (userId: string, minutos = 30) => ({ userId, ate: new Date(Date.now() + minutos * 60_000) });

  it('número desconhecido é atendido com a identidade de quem ligou, e só enquanto vale', async () => {
    const { gateway, brain, transporte } = montar({ config: configDeTeste({ modoAberto: abertoPor('u-pedro') }) });
    await gateway.receber(texto(ESTRANHO, 'quais tarefas estão atrasadas?'));
    await gateway.ocioso();
    expect(brain.pedidos).toHaveLength(1);
    expect(brain.pedidos[0]!.user.id).toBe('u-pedro');
    expect(transporte.textos()).toEqual(['resposta para: quais tarefas estão atrasadas?']);

    // Expirou: volta ao silêncio.
    gateway.atualizarConfig(configDeTeste({ modoAberto: { userId: 'u-pedro', ate: new Date(Date.now() - 1_000) } }));
    await gateway.receber(texto(ESTRANHO, 'e agora?'));
    await gateway.ocioso();
    expect(brain.pedidos).toHaveLength(1);
    expect(transporte.enviados).toHaveLength(1);
  });

  it('cada número tem a sua conversa (estranhos não enxergam o contexto um do outro)', async () => {
    const { gateway, brain } = montar({ config: configDeTeste({ modoAberto: abertoPor('u-pedro') }) });
    brain.roteiro = (p) => ({ tipo: 'resposta', texto: 'ok', conversationId: p.conversationId ?? `conv-de-${p.mensagem}`, executionId: 'E' });
    await gateway.receber(texto('5511900000001', 'A'));
    await gateway.ocioso();
    await gateway.receber(texto('5511900000002', 'B'));
    await gateway.ocioso();
    await gateway.receber(texto('5511900000001', 'A2'));
    await gateway.ocioso();
    expect(brain.pedidos.map((p) => p.conversationId)).toEqual([null, null, 'conv-de-A']);
  });

  it('estranho não consegue pedir ação de escrita pelo modo aberto', async () => {
    const { gateway, brain, transporte } = montar({ config: configDeTeste({ modoAberto: abertoPor('u-pedro') }) });
    await gateway.receber(texto(ESTRANHO, 'apaga todas as tarefas da Cosentino'));
    await gateway.ocioso();
    await gateway.receber(texto(ESTRANHO, 'cria uma tarefa pra Suzy'));
    await gateway.ocioso();
    expect(brain.pedidos).toHaveLength(0);
    expect(transporte.textos()).toEqual([TEXTOS.modoTesteSoConsulta, TEXTOS.modoTesteSoConsulta]);
  });

  it('vinculado continua podendo agir (a guarda é só para quem não está provado)', async () => {
    const { gateway, armazem, brain } = montar({ config: configDeTeste({ modoAberto: abertoPor('u-pedro') }) });
    armazem.vincular('u-jamille', JAMILLE);
    await gateway.receber(texto(JAMILLE, 'cria uma tarefa pra Suzy'));
    await gateway.ocioso();
    expect(brain.pedidos[0]!.user.id).toBe('u-jamille');
  });

  it('o modo aberto não amplia o disjuntor: rajada de estranhos ainda trava em 5 conversas', async () => {
    const { gateway, transporte } = montar({ config: configDeTeste({ modoAberto: abertoPor('u-pedro') }) });
    for (let i = 0; i < 24; i++) await gateway.receber(texto(`55119000000${String(i).padStart(2, '0')}`, 'oi'));
    await gateway.ocioso();
    expect(transporte.enviados.length).toBeLessThanOrEqual(5);
  });

  it('QUARENTENA: logo depois de conectar ninguém é respondido (rajada de histórico), nem no modo aberto', async () => {
    const { gateway, armazem, transporte, brain } = montar({ config: configDeTeste({ modoAberto: abertoPor('u-pedro') }) });
    armazem.vincular('u-jamille', JAMILLE);
    transporte.getSession = async () => ({ id: 's', name: 'bento', status: 'ready', phone: BOT, connectedAt: new Date(Date.now() - 20_000).toISOString() });
    await gateway.receber(texto(JAMILLE, 'oi'));
    await gateway.receber(texto(ESTRANHO, 'oi'));
    await gateway.ocioso();
    expect(brain.pedidos).toHaveLength(0);
    expect(transporte.enviados).toHaveLength(0);
  });

  it('passada a quarentena, responde normalmente', async () => {
    const { gateway, armazem, transporte } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    transporte.getSession = async () => ({ id: 's', name: 'bento', status: 'ready', phone: BOT, connectedAt: new Date(Date.now() - 5 * 60_000).toISOString() });
    await gateway.receber(texto(JAMILLE, 'oi'));
    await gateway.ocioso();
    expect(transporte.enviados).toHaveLength(1);
  });

  it('sessão que não está pronta ou não responde: falha fechada (não responde)', async () => {
    const { gateway, armazem, transporte } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    transporte.getSession = async () => {
      throw new Error('OpenWA fora');
    };
    await gateway.receber(texto(JAMILLE, 'oi'));
    await gateway.ocioso();
    expect(transporte.enviados).toHaveLength(0);
  });
});

describe('atalhos', () => {
  it('/ajuda responde no canal, sem gastar o Brain', async () => {
    const { gateway, armazem, brain, transporte } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    await gateway.receber(texto(JAMILLE, '/ajuda'));
    await gateway.ocioso();
    expect(brain.pedidos).toHaveLength(0);
    expect(transporte.textos()).toEqual([TEXTOS.ajuda]);
  });

  it('/tarefas vira pergunta em linguagem natural para o MESMO Brain', async () => {
    const { gateway, armazem, brain } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    await gateway.receber(texto(JAMILLE, '/tarefas'));
    await gateway.ocioso();
    expect(brain.pedidos[0]!.mensagem).toMatch(/minhas tarefas abertas/);
  });

  it('/novo zera a conversa do vínculo', async () => {
    const { gateway, armazem } = montar();
    const v = armazem.vincular('u-jamille', JAMILLE, { conversationId: 'conv-velha' });
    await gateway.receber(texto(JAMILLE, '/novo'));
    await gateway.ocioso();
    expect(armazem.vinculos.find((x) => x.id === v.id)!.conversationId).toBeNull();
  });
});

describe('grupos', () => {
  const GRUPO = '120363000000000000@g.us';
  const emGrupo = (corpo: string, extra: Record<string, unknown> = {}) =>
    envelope({ id: `g-${Math.random()}`, chatId: GRUPO, from: GRUPO, author: `${JAMILLE}@c.us`, isGroup: true, kind: 'group', body: corpo, ...extra });

  it('grupo não autorizado: silêncio total', async () => {
    const { gateway, armazem, transporte, brain } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    await gateway.receber(emGrupo('@Bento quais as entregas de hoje?'));
    await gateway.ocioso();
    expect(transporte.enviados).toHaveLength(0);
    expect(brain.pedidos).toHaveLength(0);
  });

  it('grupo autorizado sem menção: silêncio', async () => {
    const { gateway, armazem, transporte } = montar({ config: configDeTeste({ allowedGroups: [GRUPO] }) });
    armazem.vincular('u-jamille', JAMILLE);
    await gateway.receber(emGrupo('alguém viu o briefing?'));
    await gateway.ocioso();
    expect(transporte.enviados).toHaveLength(0);
  });

  it('grupo autorizado com menção: não expõe dado da operação; chama para o privado', async () => {
    const { gateway, armazem, transporte, brain } = montar({ config: configDeTeste({ allowedGroups: [GRUPO] }) });
    armazem.vincular('u-jamille', JAMILLE);
    await gateway.receber(emGrupo('quais as entregas de hoje?', { mentionedIds: [`${BOT}@c.us`] }));
    await gateway.ocioso();
    expect(brain.pedidos).toHaveLength(0);
    expect(transporte.textos()).toEqual([TEXTOS.grupoAindaNao]);
    expect(transporte.enviados[0]!.chatId).toBe(GRUPO);
  });

  it('participante não vinculado em grupo autorizado: silêncio', async () => {
    const { gateway, transporte } = montar({ config: configDeTeste({ allowedGroups: [GRUPO] }) });
    await gateway.receber(emGrupo('Bento, me ajuda'));
    await gateway.ocioso();
    expect(transporte.enviados).toHaveLength(0);
  });
});

describe('áudio, imagem e documento', () => {
  const audio = (de: string, id = `a-${Math.random()}`) =>
    envelope({ id, chatId: `${de}@c.us`, type: 'voice', body: '', media: { mimetype: 'audio/ogg; codecs=opus', data: Buffer.from('ogg').toString('base64') } });

  it('sem transcrição configurada, pede texto — não finge que ouviu', async () => {
    const { gateway, armazem, brain, transporte } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    await gateway.receber(audio(JAMILLE));
    await gateway.ocioso();
    expect(brain.pedidos).toHaveLength(0);
    expect(transporte.textos()).toEqual([TEXTOS.audioSemTranscricao]);
  });

  it('pergunta por áudio vai direto ao Brain transcrita', async () => {
    const { gateway, armazem, brain } = montar({
      transcritor: { transcrever: async () => ({ texto: 'quais são minhas tarefas para amanhã?', confianca: 0.9 }) },
    });
    armazem.vincular('u-jamille', JAMILLE);
    await gateway.receber(audio(JAMILLE));
    await gateway.ocioso();
    expect(brain.pedidos[0]!.mensagem).toBe('quais são minhas tarefas para amanhã?');
  });

  it('transcrição de baixa confiança: pede para repetir, não age', async () => {
    const { gateway, armazem, brain, transporte } = montar({
      transcritor: { transcrever: async () => ({ texto: 'apaga a tarefa', confianca: 0.2 }) },
    });
    armazem.vincular('u-jamille', JAMILLE);
    await gateway.receber(audio(JAMILLE));
    await gateway.ocioso();
    expect(brain.pedidos).toHaveLength(0);
    expect(transporte.textos()).toEqual([TEXTOS.audioFalhou]);
  });

  it('ação por áudio exige "sim" antes de ir ao Brain; "não" descarta', async () => {
    const { gateway, armazem, brain, transporte } = montar({
      transcritor: { transcrever: async () => ({ texto: 'cria uma tarefa de revisão para a Suzy', confianca: 0.95 }) },
    });
    armazem.vincular('u-jamille', JAMILLE);
    await gateway.receber(audio(JAMILLE));
    await gateway.ocioso();
    expect(brain.pedidos).toHaveLength(0);
    expect(transporte.textos()[0]).toContain('cria uma tarefa de revisão para a Suzy');

    await gateway.receber(texto(JAMILLE, 'sim'));
    await gateway.ocioso();
    expect(brain.pedidos).toHaveLength(1);
    expect(brain.pedidos[0]!.mensagem).toBe('cria uma tarefa de revisão para a Suzy');

    await gateway.receber(audio(JAMILLE));
    await gateway.ocioso();
    await gateway.receber(texto(JAMILLE, 'não'));
    await gateway.ocioso();
    expect(brain.pedidos).toHaveLength(1);
    expect(transporte.textos().at(-1)).toBe(TEXTOS.audioDescartado);
  });

  it('imagem: diz que não vê imagem, não simula leitura', async () => {
    const { gateway, armazem, brain, transporte } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    await gateway.receber(envelope({ id: 'img', chatId: `${JAMILLE}@c.us`, type: 'image', body: 'olha isso', media: { mimetype: 'image/jpeg', omitted: true } }));
    await gateway.ocioso();
    expect(brain.pedidos).toHaveLength(0);
    expect(transporte.textos()).toEqual([TEXTOS.imagemNaoSuportada]);
  });

  it('documento com o recurso desligado: avisa, não lê', async () => {
    const { gateway, armazem, brain, transporte } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    await gateway.receber(envelope({ id: 'doc', chatId: `${JAMILLE}@c.us`, type: 'document', media: { mimetype: 'application/pdf', filename: 'b.pdf' } }));
    await gateway.ocioso();
    expect(brain.pedidos).toHaveLength(0);
    expect(transporte.textos()).toEqual([TEXTOS.documentoNaoSuportado]);
  });

  it('documento ligado: baixa, guarda e vai como anexo do turno', async () => {
    const guardados: string[] = [];
    const { gateway, armazem, brain, transporte } = montar({
      config: configDeTeste({ documentsEnabled: true }),
      guardarAnexo: async ({ filename, mimetype, userId }) => {
        guardados.push(`${userId}/${filename}`);
        return { url: `https://storage.test/${filename}`, filename, contentType: mimetype };
      },
    });
    armazem.vincular('u-jamille', JAMILLE);
    transporte.midias.set('doc2', Buffer.from('%PDF-1.4'));
    await gateway.receber(envelope({ id: 'doc2', chatId: `${JAMILLE}@c.us`, type: 'document', body: 'resume esse briefing', media: { mimetype: 'application/pdf', filename: 'briefing.pdf', omitted: true, sizeBytes: 8 } }));
    await gateway.ocioso();
    expect(guardados).toEqual(['u-jamille/briefing.pdf']);
    expect(brain.pedidos[0]!.anexos).toEqual([{ url: 'https://storage.test/briefing.pdf', filename: 'briefing.pdf', contentType: 'application/pdf' }]);
  });

  it('documento de tipo executável é recusado sem baixar', async () => {
    const { gateway, armazem, transporte } = montar({
      config: configDeTeste({ documentsEnabled: true }),
      guardarAnexo: async () => {
        throw new Error('não deveria guardar');
      },
    });
    armazem.vincular('u-jamille', JAMILLE);
    await gateway.receber(envelope({ id: 'exe', chatId: `${JAMILLE}@c.us`, type: 'document', media: { mimetype: 'application/x-msdownload', filename: 'x.exe' } }));
    await gateway.ocioso();
    expect(transporte.textos()).toEqual([TEXTOS.documentoTipoNaoSuportado]);
  });
});

describe('recuperação depois de reinício', () => {
  it('turno já despachado: volta a esperar a resposta, NUNCA reenvia ao Brain', async () => {
    const { gateway, armazem, brain, transporte } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    const { id } = await armazem.registrar({
      dedupeKey: 'k1', sessionId: SESSAO, waMessageId: 'w1', chatId: `${JAMILLE}@c.us`, remetenteJid: `${JAMILLE}@c.us`,
      telefone: JAMILLE, isGroup: false, tipo: 'text', texto: 'cria tarefa', midia: null, mencoes: [], citadaId: null, enviadaEm: null,
    });
    await armazem.atualizar(id, { status: 'dispatched', conversationId: 'conv-j', executionId: 'EXE-9' });
    const r = await gateway.retomar();
    await gateway.ocioso();
    expect(r.retomados).toBe(1);
    expect(brain.pedidos).toHaveLength(0);
    expect(brain.esperas[0]).toMatchObject({ conversationId: 'conv-j', executionId: 'EXE-9' });
    expect(transporte.textos()).toEqual(['resposta retomada']);
  });

  it('turno interrompido antes do despacho: avisa para repetir, não arrisca executar duas vezes', async () => {
    const { gateway, armazem, brain, transporte } = montar();
    armazem.vincular('u-jamille', JAMILLE);
    const { id } = await armazem.registrar({
      dedupeKey: 'k2', sessionId: SESSAO, waMessageId: 'w2', chatId: `${JAMILLE}@c.us`, remetenteJid: `${JAMILLE}@c.us`,
      telefone: JAMILLE, isGroup: false, tipo: 'text', texto: 'apaga a tarefa X', midia: null, mencoes: [], citadaId: null, enviadaEm: null,
    });
    await armazem.atualizar(id, { status: 'processing' });
    await gateway.retomar();
    expect(brain.pedidos).toHaveLength(0);
    expect(transporte.textos()).toEqual([TEXTOS.interrompido]);
  });
});
