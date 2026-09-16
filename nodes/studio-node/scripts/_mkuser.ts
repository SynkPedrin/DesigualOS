import { config as dotenv } from 'dotenv';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
dotenv({ path: resolve('../../.env'), quiet: true });
const { db, schema } = await import('@desigual-os/database');
const { eq } = await import('drizzle-orm');

const EMAIL = 'studio-test@institutoalmada.org';
const PASSWORD = 'St' + randomBytes(12).toString('base64url') + '!9';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);

// 1) conta de auth real (provisionamento, igual ao que um operador faria no painel)
const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
let authUser = list?.users.find(u => u.email === EMAIL);
if (authUser) {
  await sb.auth.admin.updateUserById(authUser.id, { password: PASSWORD, email_confirm: true });
  console.log('auth user JÁ EXISTIA - senha redefinida:', authUser.id);
} else {
  const { data, error } = await sb.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
  if (error) { console.error('createUser falhou:', error.message); process.exit(1); }
  authUser = data.user!;
  console.log('auth user CRIADO:', authUser.id);
}

// 2) perfil + papel ANTES do primeiro login (mesmo padrão do POST /admin/invite)
const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, EMAIL));
let userId = existing?.id;
if (existing) {
  await db.update(schema.users).set({ authUserId: authUser.id, active: true }).where(eq(schema.users.id, existing.id));
  console.log('perfil já existia, authUserId sincronizado');
} else {
  const [created] = await db.insert(schema.users).values({ authUserId: authUser.id, email: EMAIL, name: 'Studio Test' }).returning();
  userId = created!.id; console.log('perfil criado:', userId);
}
const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'colaborador'));
const already = await db.select().from(schema.userRoles).where(eq(schema.userRoles.userId, userId!));
if (already.length === 0) { await db.insert(schema.userRoles).values({ userId: userId!, roleId: role!.id }); console.log('papel colaborador atribuído'); }
else console.log('papel já atribuído');

console.log('\nEMAIL=' + EMAIL);
console.log('PASSWORD=' + PASSWORD);
process.exit(0);
