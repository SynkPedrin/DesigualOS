// Só banco LOCAL de QA: liga o Daily Tasks para todo usuário que já logou. Recusa host que não seja 127.0.0.1.
const postgres = require('postgres');
const url = process.env.DATABASE_URL || '';
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) { console.error('recusado: não é banco local'); process.exit(1); }
const s = postgres(url);
async function once() {
  const orgs = await s`select id from organizations where id = '73786772-a98a-414e-b351-7b335d7a7cd8'`;
  const users = (await s`select id from users`).map((u) => u.id);
  for (const o of orgs) {
    for (const u of users) await s`insert into organization_members (organization_id, user_id, role) values (${o.id}, ${u}, 'owner') on conflict do nothing`;
    await s`insert into work_feature_flags (organization_id, key, enabled, allowed_user_ids) values (${o.id}, 'daily_tasks_enabled', true, ${s.json(users)})
      on conflict (organization_id, key) do update set enabled = true, allowed_user_ids = ${s.json(users)}`;
  }
  return users.length;
}
(async () => { let last = -1; for (;;) { const n = await once().catch((e) => { console.error(e.message); return last; }); if (n !== last) console.log('usuários liberados:', n); last = n; await new Promise((r) => setTimeout(r, 3000)); } })();
