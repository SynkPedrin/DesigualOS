'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { supabase } from '@/lib/supabase/client';
import { apiFetch } from '@/lib/api/client';

/**
 * Where POST /admin/invite's email link lands (redirect_to=/convite?email=...).
 * Supabase's invite verify URL, once clicked, redirects here with the session
 * tokens in the URL hash; a página consome o hash explicitamente (ver
 * hydrateFromInviteLink abaixo) e faz a pessoa definir a senha antes de entrar.
 *
 * A PERGUNTA "?email=" É A TRAVA DE CONTA ERRADA (13/10/2026, incidente real):
 * scanner de e-mail (Outlook Safe Links) abre o link de uso único antes da
 * pessoa, e o clique dela chega SEM tokens no hash. A versão anterior caía no
 * `getSession()` e aceitava qualquer sessão viva do navegador: quem convidou
 * estava logado como master no mesmo navegador, definiu "a senha do convidado"
 * e na verdade TROCOU A PRÓPRIA SENHA, sem nunca sair da conta errada. Agora a
 * sessão tem que ser da pessoa convidada; se não for, a página diz isso e
 * oferece a troca, em vez de mexer na conta errada.
 */
function ConviteForm() {
  const searchParams = useSearchParams();
  const emailDoConvite = searchParams.get('email')?.toLowerCase() ?? null;

  const [status, setStatus] = useState<'checking' | 'ready' | 'invalid' | 'conta-errada'>('checking');
  const [emailDaSessao, setEmailDaSessao] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [cargo, setCargo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    async function hydrateFromInviteLink() {
      const hash = window.location.hash;
      if (hash.includes('access_token=')) {
        const params = new URLSearchParams(hash.replace(/^#/, ''));
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        if (accessToken && refreshToken) {
          const { data: sessao, error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
          if (sessionError || !sessao.session) {
            setStatus('invalid');
            return;
          }
          const emailLogado = sessao.session.user.email?.toLowerCase() ?? null;
          setEmailDaSessao(emailLogado);
          // Os tokens dizem quem entrou; se não bate com o convite, alguém
          // abriu o link de outra pessoa — melhor parar aqui do que configurar
          // a conta errada.
          setStatus(emailDoConvite && emailLogado !== emailDoConvite ? 'conta-errada' : 'ready');
          return;
        }
      }
      // Erros do verify do Supabase vêm no hash também (#error=access_denied...).
      if (hash.includes('error=')) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        setStatus('invalid');
        return;
      }
      // Sem tokens no hash: ou o link já foi consumido (scanner de e-mail) ou a
      // pessoa voltou depois. Só segue se a sessão viva FOR a do convidado;
      // sessão de outra pessoa (o master que convidou, no mesmo navegador) vira
      // "conta errada", nunca formulário de senha.
      const { data } = await supabase.auth.getSession();
      const emailVivo = data.session?.user.email?.toLowerCase() ?? null;
      setEmailDaSessao(emailVivo);
      if (!data.session) {
        setStatus('invalid');
      } else if (emailDoConvite && emailVivo !== emailDoConvite) {
        setStatus('conta-errada');
      } else {
        setStatus('ready');
      }
    }

    void hydrateFromInviteLink();
    // Nenhum onAuthStateChange marcando 'ready' aqui: ele disparava com a
    // sessão ANTIGA (de quem já estava logado) e destravava o formulário na
    // conta errada — era a segunda metade do incidente.
  }, [emailDoConvite]);

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
    if (updateError) {
      setIsSubmitting(false);
      setError(updateError.message);
      return;
    }

    // O cargo entra na MESMA etapa (pedido do Pedro, 13/10/2026): primeiro
    // acesso já pergunta a função da pessoa na operação. Falha aqui não trava
    // a entrada — a senha já está definida; o cargo fica pra Configurações.
    const cargoLimpo = cargo.trim();
    if (cargoLimpo) {
      try {
        await apiFetch('/me', { method: 'PATCH', body: JSON.stringify({ job_title: cargoLimpo }) });
      } catch {
        // de propósito sem erro na tela: conta criada, cargo é aprimoramento
      }
    }

    setIsSubmitting(false);
    // Navegação dura: a conta acabou de nascer nesta aba; o cache da conta
    // anterior não pode atravessar para ela.
    window.location.assign('/');
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
        <p className="mb-6 text-sm text-nevoa">
          Esse link de convite expirou ou já foi usado. Se você ainda não definiu sua senha, peça pra quem te
          convidou reenviar o convite — alguns leitores de e-mail gastam o link antes de você clicar.
        </p>
        <Link href="/login" className="text-sm text-roxo-eletrico hover:underline">
          Ir para o login
        </Link>
      </AuthLayout>
    );
  }

  if (status === 'conta-errada') {
    return (
      <AuthLayout>
        <h1 className="mb-2 font-display text-2xl font-black uppercase tracking-tight text-branco-cru">
          Conta diferente
        </h1>
        <p className="mb-4 text-sm text-nevoa">
          Este convite é para <span className="text-branco-cru">{emailDoConvite}</span>, mas este navegador está
          logado como <span className="text-branco-cru">{emailDaSessao ?? 'outra conta'}</span>. Se você definiu
          uma senha agora há pouco vendo esta página, ela foi gravada na conta errada — avise quem te convidou.
        </p>
        <button
          type="button"
          onClick={async () => {
            await supabase.auth.signOut();
            window.location.assign('/login');
          }}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-md bg-roxo-eletrico py-2.5 text-sm font-semibold text-branco-cru transition-opacity hover:opacity-90"
        >
          Sair desta conta e entrar com a minha
        </button>
        <p className="text-xs text-nevoa">
          Depois de sair, se o link disser que expirou, peça o reenvio do convite — ele é de uso único.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="mb-1 font-display text-2xl font-black uppercase tracking-tight text-branco-cru">
        Bem-vindo(a)
      </h1>
      <p className="mb-6 text-sm text-nevoa">
        Defina sua senha e seu cargo pra concluir seu acesso ao desigual OS.
      </p>

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
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">
            Seu cargo na operação
          </label>
          <input
            type="text"
            value={cargo}
            maxLength={80}
            placeholder="Ex: Tráfego, Atendimento, Criação"
            onChange={(event) => setCargo(event.target.value)}
            className="w-full rounded-md border border-grafite-elevado bg-grafite px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa/50 focus:border-roxo-eletrico/60 focus:outline-none"
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

/**
 * useSearchParams exige Suspense em rota estática (Next 15): sem isto o build
 * de produção falha em "should be wrapped in a suspense boundary".
 */
export default function ConvitePage() {
  return (
    <Suspense>
      <ConviteForm />
    </Suspense>
  );
}
