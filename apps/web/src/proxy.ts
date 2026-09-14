import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Server-side gate for every route in the (shell) group. Until this file existed, auth was
 * enforced only client-side in (shell)/layout.tsx (a 'use client' component that redirects
 * post-mount via useEffect) - anyone hitting a shell route directly, or with JS slow/disabled,
 * got a flash (or a permanent view, for scrapers/curl) of the real page before the redirect
 * fired. This runs before the page renders at all and bounces unauthenticated requests to
 * /login server-side. The client-side check in layout.tsx stays in place on purpose: this is
 * belt-and-suspenders, not a replacement (Proxy is explicitly not meant to be a full session
 * management solution - see Next.js docs on Proxy).
 *
 * Named `proxy.ts`, not `middleware.ts`: Next.js 16 deprecated the `middleware` file
 * convention and renamed it to `proxy` (same behavior, see node_modules/next/dist/docs
 * /01-app/03-api-reference/03-file-conventions/proxy.md). `middleware.ts` still works but
 * warns on every build, so this project uses the current name directly.
 *
 * Uses @supabase/ssr's createServerClient (not supabase-js's createClient) so it reads the
 * exact same cookie-backed session written by the browser client in
 * src/lib/supabase/client.ts - see the comment there.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

  // Sem as env vars não tem como validar sessão nenhuma - deixa passar em vez de travar o
  // app inteiro (mesmo cenário de configuração ausente que MockModeBanner/msw-provider já
  // sinalizam pro dev; o layout client-side ainda protege a página).
  if (!supabaseUrl || !supabasePublishableKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() (não getSession()) de propósito: revalida o token direto com o servidor de
  // Auth do Supabase em vez de só confiar no JWT que veio no cookie - é a checagem
  // recomendada pra código server-side, que não pode assumir que um cookie não foi adulterado.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Roda em tudo, exceto:
     * - rotas públicas de auth (login, convite, forgot-password, reset-password, signup)
     * - /dev (fora do grupo (shell) de propósito, ver src/app/dev/motion/page.tsx)
     * - assets estáticos e internos do Next (_next/static, _next/image, favicon, etc.)
     * - QUALQUER arquivo com extensão de asset em /public.
     *
     * A última exclusão conserta um defeito medido no navegador em 10/09/2026: 406 respostas
     * `400 GET /_next/image` numa única bateria de chat, e nenhum avatar de agente na tela.
     * `_next/image` estava excluído daqui, mas o otimizador, por dentro, busca a imagem
     * original (`/agents/bento.png`) com uma requisição SERVIDOR-A-SERVIDOR, que não carrega
     * o cookie de sessão do navegador. Sem cookie, este proxy respondia 307 pro /login, o
     * otimizador recebia HTML de login em vez de PNG e devolvia 400. Pela mesma razão a
     * marca e o wallpaper de /brand não renderizavam na TELA DE LOGIN — onde, por definição,
     * ninguém está autenticado ainda.
     *
     * Nada em /public é privado (são logos, wallpaper e as fotos dos agentes), então gatear
     * esses caminhos nunca protegeu nada: só quebrava a imagem.
     */
    '/((?!login|convite|forgot-password|reset-password|signup|dev|_next/static|_next/image|favicon.ico|icon.png|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|woff2?|ttf|otf|mp4|webm)$).*)',
  ],
};
