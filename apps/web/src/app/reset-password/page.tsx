'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { supabase } from '@/lib/supabase/client';

/**
 * O link do e-mail de recuperação (gerado por admin.auth.admin.generateLink
 * no backend) traz o token no fragmento da URL (#access_token=...&type=
 * recovery). O client Supabase já processa isso sozinho ao carregar
 * (detectSessionInUrl, ligado por padrão) e dispara o evento
 * PASSWORD_RECOVERY — é isso que autoriza chamar updateUser({ password })
 * aqui, sem precisar reimplementar verificação de token nenhuma.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true);
    });
    // Se a aba já processou o link antes deste componente montar (sessão já
    // ativa), o evento acima nunca dispara de novo — checa a sessão direto
    // como fallback, em vez de travar pra sempre em "verificando link".
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
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
      setError('As senhas não conferem.');
      return;
    }

    setIsSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setIsSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    setDone(true);
    setTimeout(() => router.push('/'), 2000);
  }

  if (done) {
    return (
      <AuthLayout>
        <h1 className="mb-1 font-display text-2xl font-black uppercase tracking-tight text-branco-cru">
          Senha atualizada
        </h1>
        <p className="text-sm text-nevoa">Redirecionando para o Desigual OS...</p>
      </AuthLayout>
    );
  }

  if (!ready) {
    return (
      <AuthLayout>
        <h1 className="mb-1 font-display text-2xl font-black uppercase tracking-tight text-branco-cru">
          Verificando link...
        </h1>
        <p className="mb-6 text-sm text-nevoa">
          Se isso não avançar em alguns segundos, o link pode ter expirado.
        </p>
        <Link href="/forgot-password" className="text-sm text-roxo-eletrico hover:underline">
          Pedir um novo link
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="mb-1 font-display text-2xl font-black uppercase tracking-tight text-branco-cru">
        Escolha uma nova senha
      </h1>
      <p className="mb-6 text-sm text-nevoa">Mínimo de 8 caracteres.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">Nova senha</label>
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
            Confirmar nova senha
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
          {isSubmitting ? 'Salvando...' : 'Salvar nova senha'}
        </button>
      </form>
    </AuthLayout>
  );
}
