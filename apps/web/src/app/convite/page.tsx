'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { supabase } from '@/lib/supabase/client';

/**
 * Where POST /admin/invite's email link lands (redirect_to=/convite). Supabase's invite verify
 * URL, once clicked, redirects here with the session tokens in the URL hash; supabase-js reads
 * that automatically (detectSessionInUrl, on by default) and logs the invited user in - but
 * they were never given a password, so this page's only job is to make them set one before
 * sending them into the app for real.
 */
export default function ConvitePage() {
  const router = useRouter();
  const [status, setStatus] = useState<'checking' | 'ready' | 'invalid'>('checking');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setStatus(data.session ? 'ready' : 'invalid');
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setStatus('ready');
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }
    setIsSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setIsSubmitting(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.replace('/');
  }

  if (status === 'checking') {
    return (
      <AuthLayout>
        <p className="text-sm text-nevoa">Confirmando seu convite...</p>
      </AuthLayout>
    );
  }

  if (status === 'invalid') {
    return (
      <AuthLayout>
        <h1 className="mb-2 font-display text-2xl font-black uppercase tracking-tight text-branco-cru">
          Link inválido
        </h1>
        <p className="mb-6 text-sm text-nevoa">Esse link de convite expirou ou já foi usado.</p>
        <Link href="/login" className="text-sm text-roxo-eletrico hover:underline">
          Ir para o login
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="mb-1 font-display text-2xl font-black uppercase tracking-tight text-branco-cru">
        Bem-vindo(a)
      </h1>
      <p className="mb-6 text-sm text-nevoa">Defina uma senha pra concluir seu acesso ao desigual OS.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">Senha</label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-md border border-grafite-elevado bg-grafite px-3 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
            Confirmar senha
          </label>
          <input
            type="password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="w-full rounded-md border border-grafite-elevado bg-grafite px-3 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
          />
        </div>

        {error && <p className="text-sm text-erro">{error}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-roxo-eletrico py-2.5 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-50 disabled:hover:shadow-none"
        >
          <KeyRound size={16} />
          {isSubmitting ? 'Salvando...' : 'Definir senha e entrar'}
        </button>
      </form>
    </AuthLayout>
  );
}
