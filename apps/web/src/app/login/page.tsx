'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogIn } from 'lucide-react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { supabase } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setIsSubmitting(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    router.push('/');
  }

  return (
    <AuthLayout>
      <h1 className="mb-1 font-display text-2xl font-black uppercase tracking-tight text-branco-cru">
        Entrar
      </h1>
      <p className="mb-6 text-sm text-nevoa">Acesse o desigual OS com sua conta.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
            E-mail
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-md border border-grafite-elevado bg-grafite px-3 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
          />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block font-mono text-[10px] uppercase tracking-wider text-nevoa">
              Senha
            </label>
            <Link href="/forgot-password" className="font-mono text-[10px] text-roxo-eletrico hover:underline">
              Esqueceu a senha?
            </Link>
          </div>
          <input
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-md border border-grafite-elevado bg-grafite px-3 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
          />
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
