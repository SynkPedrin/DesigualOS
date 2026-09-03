'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Mail } from 'lucide-react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { apiFetch, ApiRequestError } from '@/lib/api/client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      // A rota sempre responde sucesso genérico (nunca revela se o e-mail
      // tem conta ou não), então não há um "e-mail não encontrado" pra
      // tratar aqui — só falha de rede/validação chega a este catch.
      await apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      setDone(true);
    } catch (submitError) {
      setError(submitError instanceof ApiRequestError ? submitError.message : 'Não foi possível enviar o e-mail agora.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (done) {
    return (
      <AuthLayout>
        <h1 className="mb-1 font-display text-2xl font-black uppercase tracking-tight text-branco-cru">
          Verifique seu e-mail
        </h1>
        <p className="mb-6 text-sm text-nevoa">
          Se <span className="text-branco-cru">{email}</span> tiver uma conta no Desigual OS, você vai receber um
          link para redefinir a senha em instantes.
        </p>
        <Link
          href="/login"
          className="flex items-center justify-center gap-2 rounded-md border border-grafite-elevado py-2.5 text-sm font-semibold text-branco-cru transition-colors hover:border-roxo-eletrico/60"
        >
          <ArrowLeft size={16} />
          Voltar para o login
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="mb-1 font-display text-2xl font-black uppercase tracking-tight text-branco-cru">
        Esqueceu a senha?
      </h1>
      <p className="mb-6 text-sm text-nevoa">Digite seu e-mail e mandamos um link para redefinir a senha.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">E-mail</label>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-md border border-grafite-elevado bg-grafite px-3 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
          />
        </div>

        {error && <p className="text-sm text-erro">{error}</p>}

        <button
          type="submit"
          disabled={isSubmitting || !email.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-roxo-eletrico py-2.5 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-50 disabled:hover:shadow-none"
        >
          <Mail size={16} />
          {isSubmitting ? 'Enviando...' : 'Enviar link de redefinição'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-nevoa">
        <Link href="/login" className="text-roxo-eletrico hover:underline">
          Voltar para o login
        </Link>
      </p>
    </AuthLayout>
  );
}
