/**
 * Contatos e conversas de WhatsApp duplicados (29/10/2026).
 *
 * Até o conserto de `5ae2437`, a mesma pessoa virava dois contatos e duas conversas quando o WhatsApp trocava o
 * endereço dela de `@c.us` para `@lid`, e uma mensagem ENVIADA num chat `@lid` gravava como telefone do contato o
 * número da própria colaboradora. O conserto impede casos novos; este script cuida dos que já existem.
 *
 *   sem flag     só relata (nada é gravado)
 *   --aplicar    junta, numa transação:
 *     1. contatos com o mesmo telefone na mesma empresa → fica o mais antigo; mensagens, conversas e tudo que aponta
 *        para o duplicado passa para ele ANTES de apagar (apagar um contato apaga em cascata as conversas dele);
 *     2. contato cujo telefone é o número de uma sessão (o defeito antigo) → perde o telefone, e as conversas
 *        individuais deixam de apontar para ele (a próxima mensagem religa o contato certo);
 *     3. conversas individuais da mesma sessão com o mesmo contato → fica a mais antiga, com todas as mensagens,
 *        a soma de não lidas e a última atividade.
 *   Nenhuma mensagem é apagada.
 *
 * Roda onde houver DATABASE_URL (em produção, dentro do container do worker):
 *   node whatsapp-duplicados.mjs            # relatório
 *   node whatsapp-duplicados.mjs --aplicar  # junta
 */
import postgres from 'postgres';

const aplicar = process.argv.includes('--aplicar');
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL não definida');
const sql = postgres(url, { prepare: false, max: 1, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require' });
const mascara = (fone: string | null) => (fone ? `…${fone.slice(-4)}` : '-');

/** Toda coluna que aponta para a tabela, lida do próprio banco (não só o que o código Drizzle declara). */
async function referencias(tabela: string) {
  return sql<{ tabela: string; coluna: string; regra: string }[]>`
    select kcu.table_name as tabela, kcu.column_name as coluna, rc.delete_rule as regra
    from information_schema.referential_constraints rc
    join information_schema.key_column_usage kcu on kcu.constraint_name = rc.constraint_name and kcu.constraint_schema = rc.constraint_schema
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = rc.unique_constraint_name and ccu.constraint_schema = rc.unique_constraint_schema
    where ccu.table_name = ${tabela} and ccu.column_name = 'id' and kcu.table_schema = 'public'`;
}

async function relatorio() {
  const refContato = await referencias('contacts');
  const refConversa = await referencias('conversation_threads');
  console.log('Apontam para contacts:', refContato.map((r) => `${r.tabela}.${r.coluna} (${r.regra})`).join(', '));
  console.log('Apontam para conversation_threads:', refConversa.map((r) => `${r.tabela}.${r.coluna} (${r.regra})`).join(', '));

  const grupos = await sql<{ organization_id: string; phone: string; n: number }[]>`
    select organization_id, phone, count(*)::int as n from contacts where phone is not null and phone <> '' group by 1, 2 having count(*) > 1 order by n desc`;
  const sobra = grupos.reduce((t, g) => t + g.n - 1, 0);
  console.log(`\n1) Telefones com mais de um contato: ${grupos.length} (contatos a mais: ${sobra}). Maiores: ${grupos.slice(0, 8).map((g) => `${mascara(g.phone)}×${g.n}`).join(' ')}`);

  const proprios = await sql<{ id: string; phone: string; conversas: number; dono: string }[]>`
    select c.id, c.phone, (select count(*)::int from conversation_threads t where t.contact_id = c.id) as conversas, coalesce(u.name, s.push_name, '?') as dono
    from contacts c join whatsapp_sessions s on s.organization_id = c.organization_id and regexp_replace(coalesce(s.phone_number, ''), '\\D', '', 'g') = c.phone
    left join users u on u.id = s.owner_user_id`;
  console.log(`2) Contatos com o número da própria colaboradora: ${proprios.length}${proprios.length ? ' → ' + proprios.map((p) => `${p.dono} (${p.conversas} conversa(s) ligadas)`).join(', ') : ''}`);

  // Conversas duplicadas DEPOIS de juntar os contatos: o contato de cada conversa é trocado pelo canônico do telefone.
  const dup = await sql<{ dono: string; grupos: number; sobra: number }[]>`
    with canon as (
      select c.id, coalesce((select c2.id from contacts c2 where c2.organization_id = c.organization_id and c2.phone = c.phone and c.phone is not null and c.phone <> '' order by c2.created_at, c2.id limit 1), c.id) as canon_id
      from contacts c
    ), g as (
      select t.whatsapp_session_id, k.canon_id, count(*)::int as n
      from conversation_threads t join canon k on k.id = t.contact_id
      where t.whatsapp_session_id is not null and t.kind <> 'group'
      group by 1, 2 having count(*) > 1
    )
    select coalesce(u.name, s.push_name, '?') as dono, count(*)::int as grupos, sum(g.n - 1)::int as sobra
    from g join whatsapp_sessions s on s.id = g.whatsapp_session_id left join users u on u.id = s.owner_user_id
    group by 1 order by 3 desc`;
  console.log(`3) Conversas da mesma pessoa repetidas na mesma Inbox: ${dup.reduce((t, d) => t + d.sobra, 0)} a mais → ${dup.map((d) => `${d.dono}: ${d.sobra} em ${d.grupos} pessoa(s)`).join(' | ') || 'nenhuma'}`);

  const porSessao = await sql<{ dono: string; status: string; contatos_lid_sem_fone: number }[]>`
    select coalesce(u.name, s.push_name, '?') as dono, s.status,
      (select count(*)::int from contacts c where c.organization_id = s.organization_id and c.phone is null and c.external_ids ? ('openwa:' || s.id) and (c.external_ids->>('openwa:' || s.id)) like '%@lid') as contatos_lid_sem_fone
    from whatsapp_sessions s left join users u on u.id = s.owner_user_id order by 1`;
  console.log('4) Contatos @lid ainda sem telefone, por sessão (o conserto resolve conforme falam):', porSessao.map((p) => `${p.dono}[${p.status}] ${p.contatos_lid_sem_fone}`).join(' | '));
  return { refContato, refConversa };
}

async function juntar(refContato: Awaited<ReturnType<typeof referencias>>, refConversa: Awaited<ReturnType<typeof referencias>>) {
  await sql.begin(async (tx) => {
    // 1) contatos com o mesmo telefone
    const pares = await tx<{ dup: string; canon: string }[]>`
      select c.id as dup, (select c2.id from contacts c2 where c2.organization_id = c.organization_id and c2.phone = c.phone order by c2.created_at, c2.id limit 1) as canon
      from contacts c where c.phone is not null and c.phone <> ''`;
    const juntar = pares.filter((p) => p.dup !== p.canon);
    for (const { dup, canon } of juntar) {
      for (const r of refContato) await tx.unsafe(`update "${r.tabela}" set "${r.coluna}" = $1 where "${r.coluna}" = $2`, [canon, dup]);
      // Endereços (@c.us, @lid, por sessão) somados: o do canônico vence quando os dois têm a mesma chave.
      await tx`update contacts set external_ids = (select external_ids from contacts where id = ${dup}) || external_ids,
        name = case when name ~ '^[0-9+ ]+$' then (select name from contacts where id = ${dup}) else name end where id = ${canon}`;
      await tx`delete from contacts where id = ${dup}`;
    }
    // 2) o número da própria colaboradora gravado como telefone de contato
    const proprios = await tx<{ id: string }[]>`
      select c.id from contacts c join whatsapp_sessions s on s.organization_id = c.organization_id and regexp_replace(coalesce(s.phone_number, ''), '\\D', '', 'g') = c.phone`;
    for (const { id } of proprios) {
      await tx`update conversation_threads set contact_id = null where contact_id = ${id} and kind <> 'group'`;
      await tx`update contacts set phone = null where id = ${id}`;
    }
    // 3) conversas individuais repetidas da mesma pessoa na mesma sessão
    const conversas = await tx<{ dup: string; canon: string }[]>`
      select t.id as dup, (select t2.id from conversation_threads t2 where t2.whatsapp_session_id = t.whatsapp_session_id and t2.contact_id = t.contact_id and t2.kind <> 'group' order by t2.created_at, t2.id limit 1) as canon
      from conversation_threads t where t.whatsapp_session_id is not null and t.contact_id is not null and t.kind <> 'group'`;
    const fundir = conversas.filter((c) => c.dup !== c.canon);
    for (const { dup, canon } of fundir) {
      for (const r of refConversa) await tx.unsafe(`update "${r.tabela}" set "${r.coluna}" = $1 where "${r.coluna}" = $2`, [canon, dup]);
      await tx`update conversation_threads c set
          unread_count = c.unread_count + d.unread_count,
          last_message_at = greatest(c.last_message_at, d.last_message_at),
          last_message_preview = case when d.last_message_at > coalesce(c.last_message_at, '-infinity') then d.last_message_preview else c.last_message_preview end
        from conversation_threads d where c.id = ${canon} and d.id = ${dup}`;
      await tx`delete from conversation_threads where id = ${dup}`;
    }
    console.log(`\nAPLICADO: ${juntar.length} contato(s) juntado(s), ${proprios.length} contato(s) com o número da colaboradora corrigido(s), ${fundir.length} conversa(s) fundida(s). Nenhuma mensagem apagada.`);
  });
}

const refs = await relatorio();
if (aplicar) await juntar(refs.refContato, refs.refConversa);
else console.log('\nSimulação: nada foi gravado. Rode com --aplicar para juntar.');
await sql.end();
