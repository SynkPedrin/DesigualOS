import { describe, expect, it } from 'vitest';
import { expirarSeVelho, MAX_TENTATIVAS, novoEstadoInterno, tentarEntregas, VALIDADE_DO_AVISO_MS, type PayloadDoAviso } from './media-internal-delivery';
import type { EnvioInterno, ResultadoDoEnvio } from './bento-channel';

const payload: PayloadDoAviso = {
  type: 'low_balance', severity: 'warning', title: 'Saldo em R$ 85,00', clientName: 'Cliente Exemplo', platform: 'meta',
  accountName: 'Conta Principal', currency: 'BRL', spend: null, results: null, detail: { threshold: 100 }, link: null,
};
const pessoas = [{ name: 'Pessoa Um', phone: '5511900000001' }, { name: 'Pessoa Dois', phone: '5511900000002' }];
const agora = new Date('2026-10-22T17:00:00Z');

const ok: ResultadoDoEnvio = { ok: true, messageId: 'm' };
const falha = (motivo: Extract<ResultadoDoEnvio, { ok: false }>['motivo'], repetivel = true): ResultadoDoEnvio => ({ ok: false, motivo, erro: 'x', repetivel });

describe('entrega dos avisos internos', () => {
  it('envia a cada pessoa, com a saudação e o nome dela, e fecha o aviso', async () => {
    const enviados: EnvioInterno[] = [];
    const r = await tentarEntregas(novoEstadoInterno(payload, pessoas), { eventId: 'ev1', now: agora, dentroDaJanela: true, sender: async (e) => (enviados.push(e), ok) });
    expect(r.enviadas).toBe(2);
    expect(r.estado.open).toBe(false);
    expect(enviados[0]!.text).toContain('Pessoa Um');
    expect(enviados[1]!.text).toContain('Pessoa Dois');
    expect(enviados.map((e) => e.idempotencyKey)).toEqual(['media-alert-internal:ev1:5511900000001', 'media-alert-internal:ev1:5511900000002']);
  });

  it('fora do horário: adia, sem gastar tentativa e sem enviar', async () => {
    let chamadas = 0;
    const r = await tentarEntregas(novoEstadoInterno(payload, pessoas), { eventId: 'e', now: agora, dentroDaJanela: false, sender: async () => (chamadas++, ok) });
    expect(chamadas).toBe(0);
    expect(r.adiadas).toBe(2);
    expect(r.estado.open).toBe(true);
    expect(r.estado.deliveries.every((d) => d.status === 'pending' && d.attempts === 0)).toBe(true);
  });

  it('Bento desconectado: o aviso fica aberto e NÃO gasta tentativa (espera o aparelho voltar)', async () => {
    let estado = novoEstadoInterno(payload, [pessoas[0]!]);
    for (let i = 0; i < MAX_TENTATIVAS + 3; i++) {
      estado = (await tentarEntregas(estado, { eventId: 'e', now: agora, dentroDaJanela: true, sender: async () => falha('sessao_nao_pronta') })).estado;
    }
    expect(estado.open).toBe(true);
    expect(estado.deliveries[0]!.attempts).toBe(0);
    expect(estado.deliveries[0]!.error).toContain('sessao_nao_pronta');
    // Quando volta, sai e fecha.
    const depois = await tentarEntregas(estado, { eventId: 'e', now: agora, dentroDaJanela: true, sender: async () => ok });
    expect(depois.estado.open).toBe(false);
    expect(depois.estado.deliveries[0]!.status).toBe('sent');
  });

  it('falha de envio gasta tentativa e para depois do máximo; falha definitiva para na hora', async () => {
    let estado = novoEstadoInterno(payload, [pessoas[0]!]);
    for (let i = 0; i < MAX_TENTATIVAS; i++) {
      estado = (await tentarEntregas(estado, { eventId: 'e', now: agora, dentroDaJanela: true, sender: async () => falha('falha_de_envio') })).estado;
    }
    expect(estado.open).toBe(false);
    expect(estado.deliveries[0]!.attempts).toBe(MAX_TENTATIVAS);

    const definitiva = await tentarEntregas(novoEstadoInterno(payload, [pessoas[0]!]), { eventId: 'e', now: agora, dentroDaJanela: true, sender: async () => falha('falha_de_envio', false) });
    expect(definitiva.estado.open).toBe(false);
  });

  it('quem já recebeu NUNCA recebe de novo no reenvio', async () => {
    const enviados: string[] = [];
    // Primeira rodada: a pessoa 1 recebe, a 2 falha.
    let estado = (await tentarEntregas(novoEstadoInterno(payload, pessoas), { eventId: 'e', now: agora, dentroDaJanela: true, sender: async (e) => (e.phone.endsWith('1') ? ok : falha('falha_de_envio')) })).estado;
    estado = (await tentarEntregas(estado, { eventId: 'e', now: agora, dentroDaJanela: true, sender: async (e) => (enviados.push(e.phone), ok) })).estado;
    expect(enviados).toEqual(['5511900000002']);
    expect(estado.open).toBe(false);
  });

  it('aviso com mais de 12 h expira e não gera mensagem de um alerta de ontem', () => {
    const estado = novoEstadoInterno(payload, pessoas);
    const velho = new Date(agora.getTime() - VALIDADE_DO_AVISO_MS - 1);
    expect(expirarSeVelho(estado, velho, agora)).toMatchObject({ open: false, expired: true });
    expect(expirarSeVelho(estado, new Date(agora.getTime() - 3_600_000), agora).open).toBe(true);
  });

  it('o estado não é alterado no lugar (a rodada devolve um novo)', async () => {
    const original = novoEstadoInterno(payload, pessoas);
    await tentarEntregas(original, { eventId: 'e', now: agora, dentroDaJanela: true, sender: async () => ok });
    expect(original.deliveries.every((d) => d.status === 'pending')).toBe(true);
  });
});

describe('configuração dos destinatários (validação do servidor)', () => {
  it('só aceita telefone brasileiro bem formado', async () => {
    const { MEDIA_SETTING_DEFS } = await import('./media-settings');
    const schema = MEDIA_SETTING_DEFS['alerts.internalDelivery'].schema;
    const com = (phone: string) => schema.safeParse({ enabled: true, recipients: [{ name: 'Pessoa Teste', phone }] }).success;
    expect(com('5511900000001')).toBe(true);
    expect(com('551130000001')).toBe(true);
    for (const ruim of ['11900000001', '14155552671', '+5511900000001', '5500900000001', '551180000001', '55119000000011', '']) expect(com(ruim)).toBe(false);
  });

  it('desligado e sem ninguém é o padrão: nada sai sem alguém ligar de propósito', async () => {
    const { MEDIA_SETTING_DEFS } = await import('./media-settings');
    expect(MEDIA_SETTING_DEFS['alerts.internalDelivery'].default).toEqual({ enabled: false, recipients: [] });
  });

  it('no máximo cinco pessoas', async () => {
    const { MEDIA_SETTING_DEFS } = await import('./media-settings');
    const schema = MEDIA_SETTING_DEFS['alerts.internalDelivery'].schema;
    const pessoas = Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, phone: `551190000000${i}` }));
    expect(schema.safeParse({ enabled: true, recipients: pessoas }).success).toBe(false);
    expect(schema.safeParse({ enabled: true, recipients: pessoas.slice(0, 5) }).success).toBe(true);
  });
});
