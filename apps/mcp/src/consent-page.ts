/**
 * consent-page.ts — a tela que o funcionário vê ao conectar o Desigual OS no
 * Claude dele.
 *
 * ── POR QUE O MCP SERVE A PRÓPRIA TELA ────────────────────────────────────
 *
 * O caminho "elegante" seria redirecionar para o app web e voltar. Ele adiciona
 * uma dependência de deploy (a página precisa existir, estar no ar e conhecer o
 * fluxo do MCP) entre o funcionário e a conexão — e o objetivo aqui é que o
 * Pedro consiga conectar três contas hoje, não que o fluxo seja bonito.
 *
 * ── A SENHA NÃO PASSA POR ESTE SERVIDOR ───────────────────────────────────
 *
 * O formulário fala DIRETO com o Supabase (grant de senha, mesma rota que o app
 * web usa), no navegador. O que chega aqui é o access_token resultante, que é o
 * que a gente precisa para saber QUEM autorizou. A chave `publishable` do
 * Supabase é pública por definição — é ela que o app web já expõe.
 *
 * Isso importa: um servidor que recebe a senha dos funcionários vira um alvo
 * que não precisava existir.
 */

export interface ConsentPageParams {
  requestId: string;
  clientName: string;
  scopes: string[];
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Erro de uma tentativa anterior, mostrado no topo. */
  erro?: string | null;
}

/** Descrição humana de cada scope. Ninguém autoriza o que não entende. */
const EXPLICACAO: Record<string, string> = {
  'desigual.read': 'Ler a operação da agência (clientes, tarefas, prazos)',
  'desigual.write': 'Registrar e alterar coisas na operação',
  'tasks.read': 'Ver tarefas',
  'tasks.write': 'Criar e alterar tarefas',
  'clients.read': 'Ver clientes',
  'clients.write': 'Criar e alterar clientes',
  'memory.read': 'Ler a memória da agência (decisões, preferências de cliente)',
  'memory.write': 'Registrar decisões, feedback e aprendizados',
  'traffic.read': 'Ver desempenho de mídia paga',
  'assets.read': 'Ver peças produzidas',
  'assets.write': 'Registrar peças',
  'admin.read': 'Ver dados administrativos da organização',
};

function escapar(t: string): string {
  return t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function renderConsentPage(p: ConsentPageParams): string {
  const lista = (p.scopes.length ? p.scopes : ['desigual.read'])
    .map((s) => `<li><code>${escapar(s)}</code> — ${escapar(EXPLICACAO[s] ?? 'permissão específica')}</li>`)
    .join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conectar o Desigual OS</title>
<style>
  :root { color-scheme: light dark; --borda: #d8d8d8; --fundo: #fff; --texto: #1a1a1a; --suave: #666; --acento: #111; }
  @media (prefers-color-scheme: dark) { :root { --borda: #333; --fundo: #141414; --texto: #f0f0f0; --suave: #999; --acento: #f0f0f0; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
         font: 15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
         background: var(--fundo); color: var(--texto); }
  .cartao { width: 100%; max-width: 430px; border: 1px solid var(--borda); border-radius: 14px; padding: 28px; }
  h1 { font-size: 19px; margin: 0 0 4px; letter-spacing: -0.01em; }
  .sub { color: var(--suave); font-size: 14px; margin: 0 0 22px; }
  ul { margin: 0 0 22px; padding-left: 18px; font-size: 13.5px; color: var(--suave); }
  li { margin-bottom: 5px; }
  code { font-size: 12px; background: rgba(128,128,128,.14); padding: 1px 5px; border-radius: 4px; color: var(--texto); }
  label { display: block; font-size: 13px; margin-bottom: 5px; color: var(--suave); }
  input { width: 100%; padding: 10px 12px; margin-bottom: 14px; border: 1px solid var(--borda);
          border-radius: 8px; font-size: 15px; background: transparent; color: var(--texto); }
  input:focus { outline: 2px solid var(--acento); outline-offset: -1px; }
  button { width: 100%; padding: 11px; border: 0; border-radius: 8px; background: var(--acento);
           color: var(--fundo); font-size: 15px; font-weight: 500; cursor: pointer; }
  button:disabled { opacity: .55; cursor: default; }
  .erro { background: rgba(200,60,60,.1); border: 1px solid rgba(200,60,60,.35); color: #c83c3c;
          padding: 10px 12px; border-radius: 8px; font-size: 13.5px; margin-bottom: 18px; }
  .rodape { margin-top: 18px; font-size: 12px; color: var(--suave); text-align: center; }
</style>
</head>
<body>
<div class="cartao">
  <h1>Conectar o Desigual OS</h1>
  <p class="sub">${escapar(p.clientName)} quer acessar a operação da agência em seu nome.</p>
  ${p.erro ? `<div class="erro">${escapar(p.erro)}</div>` : ''}
  <ul>${lista}</ul>
  <form id="f" autocomplete="on">
    <label for="email">E-mail do Desigual OS</label>
    <input id="email" name="email" type="email" required autocomplete="username" autofocus>
    <label for="senha">Senha</label>
    <input id="senha" name="senha" type="password" required autocomplete="current-password">
    <button id="b" type="submit">Autorizar</button>
  </form>
  <p class="rodape">Sua senha vai direto para o Desigual OS. Este servidor recebe apenas a confirmação de que você entrou.</p>
</div>
<script>
const SUPABASE_URL = ${JSON.stringify(p.supabaseUrl)};
const ANON = ${JSON.stringify(p.supabaseAnonKey)};
const PEDIDO = ${JSON.stringify(p.requestId)};
const f = document.getElementById('f'), b = document.getElementById('b');
f.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  b.disabled = true; b.textContent = 'Autorizando...';
  const mostrarErro = (m) => {
    const d = document.createElement('div');
    d.className = 'erro'; d.textContent = m;
    f.parentNode.insertBefore(d, f);
    b.disabled = false; b.textContent = 'Autorizar';
  };
  try {
    // Direto ao Supabase: a senha NÃO passa pelo servidor do MCP.
    const r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value, password: senha.value }),
    });
    if (!r.ok) return mostrarErro('E-mail ou senha não conferem.');
    const { access_token } = await r.json();
    const c = await fetch('/mcp/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: PEDIDO, supabase_token: access_token }),
    });
    const corpo = await c.json();
    if (!c.ok) return mostrarErro(corpo.error || 'Não consegui concluir a autorização.');
    window.location.href = corpo.redirect_to;
  } catch (e) {
    mostrarErro('Falha de rede ao autorizar. Tente de novo.');
  }
});
</script>
</body>
</html>`;
}
