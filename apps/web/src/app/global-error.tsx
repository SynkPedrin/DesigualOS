'use client';

import { useEffect } from 'react';
import '@/styles/tokens.css';

/**
 * Rede de segurança de último nível: só entra em ação se o próprio
 * RootLayout (app/layout.tsx) quebrar, o que o error.tsx do shell não cobre.
 * Precisa declarar html/body porque substitui o layout raiz inteiro
 * (regra do Next 16, ver node_modules/next/dist/docs/01-app/.../error.md).
 */
export default function GlobalError({
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
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.75rem',
          padding: '1.5rem',
          textAlign: 'center',
          backgroundColor: '#0f0f0f',
          color: '#fafaf7',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <p style={{ fontSize: '0.875rem', fontWeight: 500 }}>O Desigual OS encontrou um erro inesperado.</p>
        <p style={{ maxWidth: 420, fontSize: '0.875rem', color: '#a1a1aa' }}>
          Tente recarregar a página. Se continuar acontecendo, avise o time técnico.
        </p>
        <button
          type="button"
          onClick={() => retry()}
          style={{
            borderRadius: 6,
            backgroundColor: '#9333ea',
            color: '#fafaf7',
            padding: '0.5rem 1rem',
            fontSize: '0.875rem',
            fontWeight: 500,
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Tentar novamente
        </button>
      </body>
    </html>
  );
}
