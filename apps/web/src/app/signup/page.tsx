'use client';

import { useState } from 'react';
import Link from 'next/link';
import { UserPlus } from 'lucide-react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { supabase } from '@/lib/supabase/client';

export default function SignupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    setIsSubmitting(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <AuthLayout>
        <h1 className="mb-2 font-display text-2xl font-black uppercase tracking-tight text-branco-cru">
          Confira seu e-mail
        </h1>
        <p className="text-sm text-nevoa">
          Enviamos um link de confirmação para {email}. Confirme para poder entrar.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="mb-1 font-display text-2xl font-black uppercase tracking-tight text-branco-cru">
        Criar conta
      </h1>
      <p className="mb-6 text-sm text-nevoa">Comece a usar o desigual OS.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
            Nome
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-md border border-grafite-elevado bg-grafite px-3 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
          />
        </div>
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
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
            Senha
          </label>
          <input
            type="password"
            required
            minLength={8}
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
          <UserPlus size={16} />
          {isSubmitting ? 'Criando conta...' : 'Criar conta'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-nevoa">
        Já tem conta?{' '}
        <Link href="/login" className="text-roxo-eletrico hover:underline">
          Entrar
        </Link>
      </p>
    </AuthLayout>
  );
}
