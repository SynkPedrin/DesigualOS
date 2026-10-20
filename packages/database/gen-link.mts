import { config } from 'dotenv';
config({ path: '../../.env' });
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const email = readFileSync('/tmp/e2e-email.txt', 'utf8').trim();
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data, error } = await admin.auth.admin.generateLink({
  type: 'recovery',
  email,
  options: { redirectTo: `https://desigual-os.vercel.app/convite?email=${encodeURIComponent(email)}` },
});
if (error) { console.log('ERRO:', error.message); process.exit(1); }
console.log('LINK:' + data.properties.action_link);
process.exit(0);
