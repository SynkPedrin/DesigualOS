'use client';

import { useEffect } from 'react';

/**
 * Rede de segurança para qualquer exceção não tratada dentro do shell
 * (sidebar/topbar continuam de pé, só o conteúdo da rota é substituído).
 * Sem isto, um erro de render em qualquer tela mostrava o overlay técnico
 * padrão do Next (stack trace em dev, tela em branco em prod) - achado da
 * certificação de pré-release (2026-09-09), seção 53 do escopo master.
 */
export default function ShellError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm font-medium text-branco-cru">Algo deu errado nesta tela.</p>
      <p className="max-w-md text-sm text-nevoa">
        Isso não deveria ter acontecido. Você pode tentar novamente ou voltar mais tarde — o resto do
        Desigual OS continua funcionando normalmente.
      </p>
      <button
        type="button"
        onClick={() => retry()}
        className="rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-all hover:opacity-90 hover:shadow-glow"
      >
        Tentar novamente
      </button>
    </div>
  );
}
