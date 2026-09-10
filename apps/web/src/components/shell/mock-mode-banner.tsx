'use client';

const API_MODE = process.env.NEXT_PUBLIC_API_MODE ?? 'mock';

/**
 * Aviso discreto e sempre visível de que o app está servindo dados fictícios via MSW
 * (NEXT_PUBLIC_API_MODE não setado como 'live'). Existe pra ninguém confundir uma tela
 * cheia de dados de mentira com o sistema real - inclusive em produção, se a env var
 * de alguém esquecer de ser configurada (ver aviso no console em msw-provider.tsx).
 */
export function MockModeBanner() {
  if (API_MODE !== 'mock') return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[120] flex justify-center pb-3">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-aviso/40 bg-carbono/95 px-4 py-1.5 font-mono text-[11px] text-aviso shadow-elevated backdrop-blur">
        <span className="size-1.5 shrink-0 rounded-full bg-aviso" />
        Modo demonstração — dados fictícios
      </div>
    </div>
  );
}
