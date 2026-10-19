'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

/**
 * AJUSTE DA INTEGRAÇÃO, NO LUGAR ONDE ELA É MOSTRADA.
 *
 * Antes existia uma seção "Conectar e ajustar" no fim da página: os cartões
 * apontavam pra uma âncora, a tela rolava, e a pessoa precisava achar o bloco
 * certo entre vários. Pior, cartão sem bloco correspondente rolava pra lugar
 * nenhum (Meta Ads, Google Ads, Microsoft Calendar — relato do Pedro,
 * 08/10/2026).
 *
 * Agora o ajuste abre sobre o próprio cartão clicado. Não há como clicar numa
 * integração e cair num painel que não é dela, nem como existir cartão sem
 * destino: o painel é propriedade do cartão, não um bloco solto no fim da
 * página que alguém precisa lembrar de criar junto.
 */
export function IntegracaoDialog({
  titulo,
  onClose,
  children,
}: {
  titulo: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const fecharRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fecharRef.current?.focus();
    function aoTeclar(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', aoTeclar);
    // Trava o scroll do fundo: sem isso a página rola atrás do modal e a
    // pessoa perde a posição que tinha na vitrine ao fechar.
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = overflowAnterior;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-carbono/80 p-4 py-10"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="w-full max-w-lg rounded-xl border border-grafite-elevado bg-grafite p-5"
        // O clique dentro do painel não fecha — só o clique no fundo.
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-heading text-base font-semibold text-branco-cru">{titulo}</h2>
          <button
            ref={fecharRef}
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-1 text-nevoa transition-colors hover:text-branco-cru"
          >
            <X size={18} />
          </button>
        </div>
        <div className="mt-1">{children}</div>
      </motion.div>
    </div>
  );
}
