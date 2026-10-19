import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import type { Sql } from 'postgres';
import type * as DatabaseModule from '@desigual-os/database';

/**
 * meeting-brief.test.ts (§51-53/§77 do prompt "CALENDAR + AUTOMATIONS + BENTO
 * V2", 06/10/2026): prova que o Meeting Brief agrega o que já existe de
 * verdade (demandas/briefs abertos, aprovação pendente, última conversa,
 * reunião anterior visível) e que `proximasReunioesDeCliente` acha a reunião
 * certa, ignora quem já foi avisado e nunca inclui reunião sem cliente.
 */
const enabled = Boolean(process.env.TENANT_TEST_DATABASE_URL);

vi.mock('@desigual-os/database', async () => {
  const original = await vi.importActual<typeof DatabaseModule>('@desigual-os/database');
  if (!process.env.TENANT_TEST_DATABASE_URL) return original;
  const url = new URL(process.env.TENANT_TEST_DATABASE_URL);
  if (url.hostname !== '127.0.0.1') throw new Error('Meeting Brief tests require an isolated local PostgreSQL');
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const connection = postgres(url.toString(), { max: 2 });
  return { ...original, db: drizzle(connection, { schema: original.schema }), testConnection: connection };
});

describe.skipIf(!enabled)('Meeting Prep — buildMeetingBrief e proximasReunioesDeCliente (Postgres real)', () => {
  const org = randomUUID();
  const cliente = randomUUID();
  const jamille = randomUUID();
  const alicia = randomUUID();
  const contato = randomUUID();
  let connection: Sql;
  let eventoAlvo: string;
  let eventoAnterior: string;

  beforeAll(async () => {
    const database = await import('@desigual-os/database');
    connection = (database as unknown as { testConnection: Sql }).testConnection;

    await connection`insert into organizations(id, name, slug) values (${org}, 'QA Meeting Prep', ${org})`;
    await connection`insert into users(id, name, email) values (${jamille}, 'Jamille', ${jamille + '@meeting-qa.invalid'})`;
    await connection`insert into users(id, name, email) values (${alicia}, 'Alicia', ${alicia + '@meeting-qa.invalid'})`;
    await connection`insert into clients(id, name, slug, organization_id) values (${cliente}, 'QA Client', ${cliente}, ${org})`;
    await connection`insert into contacts(id, organization_id, client_id, name, email) values (${contato}, ${org}, ${cliente}, 'Contato Externo', ${contato + '@cliente-qa.invalid'})`;

    const agora = new Date();
    const inicioAnterior = new Date(agora.getTime() - 7 * 24 * 60 * 60_000);
    const [anterior] = await connection`insert into calendar_events(organization_id, client_id, title, description, start_at, end_at, created_by, status, visibility)
      values (${org}, ${cliente}, 'Kickoff', 'Alinhamos o escopo inicial.', ${inicioAnterior.toISOString()}, ${new Date(inicioAnterior.getTime() + 3_600_000).toISOString()}, ${jamille}, 'confirmed', 'default') returning id`;
    eventoAnterior = anterior!.id as string;

    const inicioAlvo = new Date(agora.getTime() + 10 * 60_000);
    const [alvo] = await connection`insert into calendar_events(organization_id, client_id, title, start_at, end_at, created_by, status, visibility)
      values (${org}, ${cliente}, 'Reunião mensal', ${inicioAlvo.toISOString()}, ${new Date(inicioAlvo.getTime() + 3_600_000).toISOString()}, ${jamille}, 'confirmed', 'default') returning id`;
    eventoAlvo = alvo!.id as string;

    await connection`insert into calendar_event_participants(event_id, member_id, required, response_status) values (${eventoAlvo}, ${jamille}, true, 'accepted')`;
    await connection`insert into calendar_event_participants(event_id, member_id, required, response_status) values (${eventoAlvo}, ${alicia}, true, 'needsAction')`;
    await connection`insert into calendar_event_participants(event_id, contact_id, required, response_status) values (${eventoAlvo}, ${contato}, false, 'needsAction')`;

    await connection`insert into demands(organization_id, client_id, created_by, title, source, status) values (${org}, ${cliente}, ${jamille}, 'Carrossel do mês', 'manual', 'in_production')`;
    await connection`insert into demands(organization_id, client_id, created_by, title, source, status) values (${org}, ${cliente}, ${jamille}, 'Peça antiga', 'manual', 'done')`;

    const [demandaDoBrief] = await connection`insert into demands(organization_id, client_id, created_by, title, source, status) values (${org}, ${cliente}, ${jamille}, 'Brief do Reels', 'manual', 'briefing') returning id`;
    await connection`insert into briefs(organization_id, client_id, demand_id, created_by, status) values (${org}, ${cliente}, ${demandaDoBrief!.id}, ${jamille}, 'in_review')`;

    await connection`insert into approval_requests(organization_id, client_id, resource_type, resource_id, requested_by, status) values (${org}, ${cliente}, 'brief', ${randomUUID()}, ${jamille}, 'pending')`;

    await connection`insert into conversations(organization_id, client_id, user_id, title, status) values (${org}, ${cliente}, ${jamille}, 'Dúvida sobre entrega', 'open')`;
  });

  afterAll(async () => {
    await connection?.end();
  });

  it('agrega demandas/briefs/aprovações abertos, participantes internos/externos, última conversa e reunião anterior visível', async () => {
    const { buildMeetingBrief } = await import('./meeting-brief');
    const brief = await buildMeetingBrief(eventoAlvo, org);

    expect(brief).not.toBeNull();
    expect(brief!.client.id).toBe(cliente);
    expect(brief!.demands.open_count).toBe(2); // in_production + briefing (done não conta)
    expect(brief!.briefs.open_count).toBe(1);
    expect(brief!.approvals.pending_count).toBe(1);
    expect(brief!.participants.internal.map((p) => p.user_id).sort()).toEqual([alicia, jamille].sort());
    expect(brief!.participants.external).toEqual([{ contact_id: contato, name: 'Contato Externo', email: contato + '@cliente-qa.invalid' }]);
    expect(brief!.last_conversation?.title).toBe('Dúvida sobre entrega');
    expect(brief!.previous_meeting?.id).toBe(eventoAnterior);
    expect(brief!.previous_meeting?.description).toBe('Alinhamos o escopo inicial.');
  });

  it('retorna null para evento sem cliente vinculado — nunca inventa um brief', async () => {
    const { buildMeetingBrief } = await import('./meeting-brief');
    const agora = new Date();
    const [semCliente] = await connection`insert into calendar_events(organization_id, title, start_at, end_at, created_by, status)
      values (${org}, 'Reunião interna', ${agora.toISOString()}, ${new Date(agora.getTime() + 1_800_000).toISOString()}, ${jamille}, 'confirmed') returning id`;

    expect(await buildMeetingBrief(semCliente!.id as string, org)).toBeNull();
  });

  it('proximasReunioesDeCliente acha a reunião dentro da janela e para de achar depois que ela foi avisada', async () => {
    const { proximasReunioesDeCliente } = await import('./meeting-brief');
    const agora = new Date();

    const antes = await proximasReunioesDeCliente(agora, 15);
    expect(antes.map((c) => c.id)).toContain(eventoAlvo);

    await connection`insert into notifications(user_id, type, title, link) values (${jamille}, 'meeting_prep', 'Reunião em instantes', ${'/calendar?evento=' + eventoAlvo})`;

    const depois = await proximasReunioesDeCliente(agora, 15);
    expect(depois.map((c) => c.id)).not.toContain(eventoAlvo);
  });
});
