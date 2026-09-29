/**
 * e2e-oauth.mjs — o fluxo inteiro do DESIGUAL OS MCP, de ponta a ponta.
 *
 * Faz o que o Claude faz ao conectar, na mesma ordem, e depois chama uma tool
 * de verdade contra o banco de verdade:
 *
 *   discovery -> registro dinâmico -> /authorize -> consentimento ->
 *   troca do código (com PKCE) -> initialize -> tools/list -> tools/call
 *
 * O único atalho é o do NAVEGADOR: em vez de digitar e-mail e senha na tela de
 * consentimento, o script usa um token do Supabase já obtido (o mesmo que
 * scripts/qa/login.mjs guarda). O resto do caminho é idêntico.
 *
 *   node scripts/mcp/e2e-oauth.mjs [url-do-mcp]
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3010';
const REDIRECT = 'http://127.0.0.1:9999/cb';
let falhas = 0;

function ok(rotulo, condicao, detalhe = '') {
  if (!condicao) falhas += 1;
  console.log(`  ${condicao ? '✓' : '✗ FALHOU'}  ${rotulo}${detalhe ? ` — ${detalhe}` : ''}`);
}
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function json(res) {
  const t = await res.text();
  try { return JSON.parse(t); } catch { return { __raw: t.slice(0, 300) }; }
}

console.log(`\nDESIGUAL OS MCP — fluxo completo contra ${BASE}\n`);

// ── 1. DISCOVERY ─────────────────────────────────────────────────────────
console.log('1. Discovery (o que o Claude lê primeiro)');
const meta = await json(await fetch(`${BASE}/.well-known/oauth-authorization-server`));
ok('metadata do authorization server', Boolean(meta.authorization_endpoint && meta.token_endpoint));
ok('PKCE S256 anunciado', (meta.code_challenge_methods_supported ?? []).includes('S256'));
ok('registro dinâmico anunciado', Boolean(meta.registration_endpoint));
const prot = await json(await fetch(`${BASE}/.well-known/oauth-protected-resource`));
ok('metadata do resource server', Boolean(prot.resource));

// ── 2. A PORTA ESTÁ FECHADA ANTES DE TUDO ────────────────────────────────
console.log('\n2. Sem token, nada entra');
for (const [rotulo, headers] of [
  ['sem Authorization', {}],
  ['token inválido', { Authorization: 'Bearer dsga_inventado' }],
  ['header malformado', { Authorization: 'Basic xyz' }],
]) {
  const r = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  ok(`${rotulo} devolve 401`, r.status === 401, `HTTP ${r.status}`);
}

// ── 3. REGISTRO DINÂMICO ─────────────────────────────────────────────────
console.log('\n3. Registro dinâmico do cliente (RFC 7591)');
const reg = await json(await fetch(`${BASE}/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    client_name: 'E2E do Desigual',
    redirect_uris: [REDIRECT],
    grant_types: ['authorization_code', 'refresh_token'],
    scope: 'desigual.read desigual.write',
  }),
}));
ok('cliente registrado', Boolean(reg.client_id));
const clientId = reg.client_id;

// ── 4. AUTHORIZE -> TELA DE CONSENTIMENTO ────────────────────────────────
console.log('\n4. /authorize leva à tela de consentimento');
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash('sha256').update(verifier).digest());
const authUrl = `${BASE}/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code`
  + `&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${challenge}&code_challenge_method=S256`
  + `&scope=${encodeURIComponent('desigual.read desigual.write')}&state=estado-do-teste`;
const authRes = await fetch(authUrl, { redirect: 'manual' });
ok('redireciona (302)', authRes.status === 302, `HTTP ${authRes.status}`);
const destino = new URL(authRes.headers.get('location'));
const pedido = destino.searchParams.get('mcp_request');
ok('carrega um id de pedido', Boolean(pedido));

const telaHtml = await (await fetch(`${BASE}/consent?mcp_request=${pedido}&client_name=E2E&scopes=desigual.read`)).text();
ok('a tela renderiza com formulário', telaHtml.includes('<form') && telaHtml.includes('Autorizar'));
ok('a tela NÃO contém segredo de serviço', !telaHtml.includes('service_role') && !telaHtml.includes('SUPABASE_SERVICE'));

// ── 5. CONSENTIMENTO ─────────────────────────────────────────────────────
console.log('\n5. Consentimento (o navegador faria isto com e-mail e senha)');
let supabaseToken;
try {
  supabaseToken = readFileSync('/tmp/desigual-qa-token', 'utf8').trim();
} catch {
  console.log('  ✗ FALHOU  sem /tmp/desigual-qa-token — rode: node scripts/qa/login.mjs');
  process.exit(1);
}
const consent = await fetch(`${BASE}/mcp/consent`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ request_id: pedido, supabase_token: supabaseToken }),
});
const consentBody = await json(consent);
ok('consentimento aceito', consent.ok, consentBody.error ?? '');
if (!consent.ok) { console.log('\nInterrompido: sem código de autorização.\n'); process.exit(1); }
const code = new URL(consentBody.redirect_to).searchParams.get('code');
const state = new URL(consentBody.redirect_to).searchParams.get('state');
ok('volta com código', Boolean(code));
ok('preserva o state', state === 'estado-do-teste');

// ── 6. TROCA DO CÓDIGO ───────────────────────────────────────────────────
console.log('\n6. Troca do código por token (PKCE)');
const trocar = (corpo) => fetch(`${BASE}/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(corpo),
});
const errado = await trocar({ grant_type: 'authorization_code', code, client_id: clientId, code_verifier: b64url(randomBytes(32)), redirect_uri: REDIRECT });
ok('PKCE errado é RECUSADO', !errado.ok, `HTTP ${errado.status}`);

const tokens = await json(await trocar({ grant_type: 'authorization_code', code, client_id: clientId, code_verifier: verifier, redirect_uri: REDIRECT }));
ok('access_token emitido', Boolean(tokens.access_token));
ok('refresh_token emitido', Boolean(tokens.refresh_token));
ok('expira em no máximo 1h', tokens.expires_in > 0 && tokens.expires_in <= 3600, `${tokens.expires_in}s`);

const reuso = await trocar({ grant_type: 'authorization_code', code, client_id: clientId, code_verifier: verifier, redirect_uri: REDIRECT });
ok('código é de USO ÚNICO', !reuso.ok, `HTTP ${reuso.status}`);

// ── 7. AS TOOLS ──────────────────────────────────────────────────────────
console.log('\n7. Chamando o MCP com o token');
let sessionId = null;
async function rpc(method, params) {
  const r = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, ...(params ? { params } : {}) }),
  });
  const sid = r.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  const texto = await r.text();
  // O transporte pode responder em SSE; a carga JSON vem depois de "data: ".
  const linha = texto.split('\n').find((l) => l.startsWith('data: '));
  try { return JSON.parse(linha ? linha.slice(6) : texto); } catch { return { __raw: texto.slice(0, 300) }; }
}

const init = await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'e2e', version: '1.0.0' },
});
ok('initialize responde', Boolean(init.result?.serverInfo), JSON.stringify(init.error ?? '').slice(0, 120));
ok('servidor se identifica', init.result?.serverInfo?.name === 'desigual-os');

const lista = await rpc('tools/list');
const tools = lista.result?.tools ?? [];
ok('tools/list devolve ferramentas', tools.length > 0, `${tools.length} tools`);
for (const esperada of ['get_current_user', 'search_clients', 'get_client_context', 'search_tasks', 'create_task', 'log_work', 'get_operation_summary']) {
  ok(`tool "${esperada}" existe`, tools.some((t) => t.name === esperada));
}
ok('create_task marcada como escrita', tools.find((t) => t.name === 'create_task')?.annotations?.readOnlyHint === false);
ok('search_tasks marcada como leitura', tools.find((t) => t.name === 'search_tasks')?.annotations?.readOnlyHint === true);

console.log('\n8. Uma tool DE VERDADE, contra o banco de verdade');
const quem = await rpc('tools/call', { name: 'get_current_user', arguments: {} });
const quemTexto = quem.result?.content?.[0]?.text ?? '';
ok('get_current_user responde', quemTexto.length > 0, quemTexto.slice(0, 90).replace(/\n/g, ' '));
const perfil = (() => { try { return JSON.parse(quemTexto); } catch { return {}; } })();
ok('traz user_id e organização', Boolean(perfil.user_id && perfil.organization_id));
ok('traz o papel resolvido do banco', Boolean(perfil.role), `papel: ${perfil.role}`);

const perms = await rpc('tools/call', { name: 'get_current_permissions', arguments: {} });
const permTexto = perms.result?.content?.[0]?.text ?? '{}';
const p = (() => { try { return JSON.parse(permTexto); } catch { return {}; } })();
ok('scopes efetivos resolvidos', Array.isArray(p.effective_scopes), (p.effective_scopes ?? []).join(' '));

const clientes = await rpc('tools/call', { name: 'search_clients', arguments: { query: 'cosentino', limit: 5 } });
const cTexto = clientes.result?.content?.[0]?.text ?? '{}';
const cJson = (() => { try { return JSON.parse(cTexto); } catch { return {}; } })();
ok('search_clients acha cliente real', (cJson.clients ?? []).length > 0, `${(cJson.clients ?? []).length} encontrados`);

const resumo = await rpc('tools/call', { name: 'get_operation_summary', arguments: {} });
const rTexto = resumo.result?.content?.[0]?.text ?? '{}';
const rJson = (() => { try { return JSON.parse(rTexto); } catch { return {}; } })();
ok('get_operation_summary traz números', typeof rJson.open_tasks === 'number', `${rJson.open_tasks} abertas, ${rJson.overdue} atrasadas`);

// ── 9. REVOGAÇÃO ─────────────────────────────────────────────────────────
console.log('\n9. Revogação corta o acesso na hora');
await fetch(`${BASE}/revoke`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ token: tokens.access_token, client_id: clientId }),
});
const depois = await fetch(`${BASE}/mcp`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list' }),
});
ok('token revogado devolve 401', depois.status === 401, `HTTP ${depois.status}`);

console.log(falhas === 0 ? '\n✓ FLUXO COMPLETO OK\n' : `\n✗ ${falhas} verificação(ões) falharam\n`);
process.exit(falhas === 0 ? 0 : 1);
