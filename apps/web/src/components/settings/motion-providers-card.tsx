'use client';

import Image from 'next/image';
import { AlertCircle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { useMotionProviders, useTestClaudeConnection, type MotionProviderWire } from '@/hooks/use-motion';
import { ApiRequestError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

/**
 * §38 — providers do Motion Engine.
 *
 * As logos são os PNG/WEBP que já existiam em /assets do repositório,
 * copiados pra /public/providers sem redesenho e sem download de nada.
 *
 * Sobre "Conectar": o Claude Code autentica por conta própria, na máquina do
 * worker (`claude auth login`), e é o único mecanismo OFICIAL disponível aqui.
 * Desenhar um botão que abrisse um OAuth inventado seria autenticação falsa —
 * então o card mostra o estado real e a instrução exata que resolve.
 */
const STATE_STYLE: Record<string, { dot: string; text: string; Icon: typeof CheckCircle2 }> = {
  CONNECTED: { dot: 'bg-sucesso', text: 'text-sucesso', Icon: CheckCircle2 },
  CONNECTING: { dot: 'bg-info', text: 'text-info', Icon: Loader2 },
  DISCONNECTED: { dot: 'bg-nevoa', text: 'text-nevoa', Icon: XCircle },
  SESSION_EXPIRED: { dot: 'bg-aviso', text: 'text-aviso', Icon: AlertCircle },
  ACCESS_DENIED: { dot: 'bg-erro', text: 'text-erro', Icon: XCircle },
  OPUS_UNAVAILABLE: { dot: 'bg-aviso', text: 'text-aviso', Icon: AlertCircle },
  ERROR: { dot: 'bg-erro', text: 'text-erro', Icon: XCircle },
};

const STATE_LABEL: Record<string, string> = {
  CONNECTED: 'Conectado',
  CONNECTING: 'Conectando',
  DISCONNECTED: 'Desconectado',
  SESSION_EXPIRED: 'Sessão expirada',
  ACCESS_DENIED: 'Acesso negado',
  OPUS_UNAVAILABLE: 'Opus 5.5 indisponível',
  ERROR: 'Erro',
};

function ProviderCard({
  provider,
  logo,
  name,
  onTest,
  testing,
}: {
  provider: MotionProviderWire;
  logo: { src: string; alt: string };
  name: string;
  onTest?: (() => void) | undefined;
  testing?: boolean;
}) {
  const style = STATE_STYLE[provider.state] ?? STATE_STYLE.ERROR!;

  return (
    <Surface level="grafite" className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-branco-cru/95 p-1.5">
          <Image src={logo.src} alt={logo.alt} width={28} height={28} className="size-full object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-branco-cru">{name}</p>
          <p className="flex items-center gap-1.5 text-xs">
            <span className={cn('size-1.5 rounded-full', style.dot)} />
            <span className={style.text}>{STATE_LABEL[provider.state] ?? provider.state}</span>
            {provider.account ? <span className="truncate text-branco-cru/45">· {provider.account}</span> : null}
          </p>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-branco-cru/65">{provider.message}</p>

      {provider.remedy ? (
        <p className="rounded-md border border-grafite-elevado bg-carbono/40 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-branco-cru/70">
          {provider.remedy}
        </p>
      ) : null}

      {provider.motionCapable && provider.model ? (
        <p className="text-[11px] text-branco-cru/50">
          <span className="font-medium text-branco-cru/75">{provider.model}</span> · disponível para o Motion Engine
        </p>
      ) : null}

      {provider.provider === 'chatgpt' ? (
        // §9 — regra que não se mistura, dita na própria tela pra ninguém
        // supor que conectar o ChatGPT substitui o Claude.
        <p className="text-[11px] text-branco-cru/40">Não participa da geração de motion.</p>
      ) : null}

      {onTest ? (
        <button
          type="button"
          onClick={onTest}
          disabled={testing}
          className="self-start rounded-md border border-grafite-elevado px-3 py-1.5 text-xs text-branco-cru/80 transition-colors hover:border-roxo-eletrico/60 hover:text-branco-cru disabled:opacity-50"
        >
          {testing ? 'Testando…' : 'Testar Opus 5.5'}
        </button>
      ) : null}
    </Surface>
  );
}

export function MotionProvidersSection() {
  const { data, isLoading, error } = useMotionProviders();
  const test = useTestClaudeConnection();

  // Motion desligado devolve 404 de propósito (ver apps/api/src/motion/routes.ts).
  // A seção some em vez de mostrar erro: não há nada pra configurar.
  if (error instanceof ApiRequestError && error.status === 404) return null;

  const claude = data?.providers.find((provider) => provider.provider === 'claude');
  const chatgpt = data?.providers.find((provider) => provider.provider === 'chatgpt');

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-branco-cru">Motion Engine</h2>
        <p className="text-xs text-branco-cru/50">
          Quem cria os motions é o Claude Opus 5.5. Sem ele, o Otto avisa em vez de entregar uma peça pior.
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {claude ? (
            <ProviderCard
              provider={test.data?.provider ?? claude}
              logo={{ src: '/providers/claude.png', alt: 'Claude' }}
              name="Claude"
              onTest={() => test.mutate()}
              testing={test.isPending}
            />
          ) : null}
          {chatgpt ? (
            <ProviderCard
              provider={chatgpt}
              logo={{ src: '/providers/chatgpt.webp', alt: 'ChatGPT' }}
              name="ChatGPT"
            />
          ) : null}
        </div>
      )}
    </section>
  );
}
