'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { supabase } from '@/lib/supabase/client';
import { mensagemDeErroDoLogin } from '@/lib/auth/mensagem-de-erro-do-login';

/**
 * Destino pós-login: o proxy (src/proxy.ts) manda o usuário barrado pra
 * /login?next=<rota-original>, e antes desta correção a página ignorava o
 * parâmetro e mandava todo mundo pra '/' (auditoria pré-deploy 14/09/2026).
 * Só aceita path interno (começa com '/' e NÃO com '//'), senão viraria
 * open redirect pra domínio externo.
 */
function safeNextPath(next: string | null): string {
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return '/';
}

function LoginPageContent() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mostrarSenha, setMostrarSenha] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    /**
     * ESPAÇO QUE VEIO JUNTO NA CÓPIA. Senha colada do WhatsApp ou do e-mail
     * costuma trazer um espaço ou quebra de linha no fim, e o login falhava com
     * a senha certa (visto em 22/10/2026: 27 caracteres no campo, senha de 25).
     * Tenta primeiro EXATAMENTE como digitado — quem escolheu uma senha com
     * espaço nas pontas continua entrando — e só então sem os espaços das pontas.
     */
    const emailLimpo = email.trim();
    let { error: authError } = await supabase.auth.signInWithPassword({ email: emailLimpo, password });
    if (authError && password.trim() !== password && /invalid login credentials/i.test(authError.message)) {
      ({ error: authError } = await supabase.auth.signInWithPassword({ email: emailLimpo, password: password.trim() }));
    }
    setIsSubmitting(false);
    if (authError) {
      setError(mensagemDeErroDoLogin(authError.message));
      return;
    }
    // Navegação DURA, não router.push: uma troca de conta dentro da mesma aba
    // mantém o cache do React Query da conta anterior (medido em 13/10/2026:
    // login como master mostrando a conta do colaborador recém-criado). Página
    // nova = cache novo = identidade certa.
    window.location.assign(safeNextPath(searchParams.get('next')));
  }

  return (
    <AuthLayout>
      <h1 className="mb-1 font-display text-2xl font-black uppercase tracking-tight text-branco-cru">
        Entrar
      </h1>
      <p className="mb-6 text-sm text-nevoa">Acesse o desigual OS com sua conta.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa"
          >
            E-mail
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-md border border-grafite-elevado bg-grafite px-3 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
          />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label
              htmlFor="password"
              className="block font-mono text-[10px] uppercase tracking-wider text-nevoa"
            >
              Senha
            </label>
            <Link href="/forgot-password" className="font-mono text-[10px] text-roxo-eletrico hover:underline">
              Esqueceu a senha?
            </Link>
          </div>
          <div className="relative">
            <input
              id="password"
              type={mostrarSenha ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-md border border-grafite-elevado bg-grafite py-2 pl-3 pr-10 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
            />
            {/* Ver o que foi digitado resolve a maior parte dos "a senha não funciona". */}
            <button
              type="button"
              onClick={() => setMostrarSenha((v) => !v)}
              aria-label={mostrarSenha ? 'Esconder senha' : 'Mostrar senha'}
              aria-pressed={mostrarSenha}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-nevoa transition-colors hover:text-branco-cru"
            >
              {mostrarSenha ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-erro">{error}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-roxo-eletrico py-2.5 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-50 disabled:hover:shadow-none"
        >
          <LogIn size={16} />
          {isSubmitting ? 'Entrando...' : 'Entrar'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-nevoa">
        Ainda não tem conta?{' '}
        <Link href="/signup" className="text-roxo-eletrico hover:underline">
          Criar conta
        </Link>
      </p>
    </AuthLayout>
  );
}

// useSearchParams exige Suspense boundary no Next 16 (mesmo padrão de
// (shell)/clients/page.tsx); sem isso o build falha na pré-renderização.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}
