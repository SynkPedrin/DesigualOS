process.loadEnvFile(new URL('../../.env', import.meta.url).pathname);
const { db, sql } = await import('@desigual-os/database');
const inst = await db.execute(sql`select extname from pg_extension order by extname`);
const avail = await db.execute(sql`select name, default_version, installed_version from pg_available_extensions where name in ('pg_trgm','fuzzystrmatch','unaccent')`);
console.log('instaladas:', (inst.rows ?? inst).map(r => r.extname).join(', '));
console.log('disponiveis:', JSON.stringify(avail.rows ?? avail));
const who = await db.execute(sql`select current_user, (select rolsuper from pg_roles where rolname=current_user) as is_super`);
console.log('usuario:', JSON.stringify(who.rows ?? who));
process.exit(0);
