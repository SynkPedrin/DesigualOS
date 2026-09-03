'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ExecutionStatus } from '@desigual-os/types';

const SETTLED_STATUSES: ExecutionStatus[] = ['completed', 'failed', 'timeout', 'cancelled'];

function buildSteps(clientName: string | null) {
  return [
    'Entendendo sua pergunta',
    clientName ? `Consultando dados do ${clientName}` : 'Consultando contexto disponível',
    'Analisando informações relevantes',
    'Gerando resposta',
  ];
}

export function ThinkingSteps({
  status,
  clientName,
}: {
  status: ExecutionStatus;
  clientName: string | null;
}) {
  const steps = useRef(buildSteps(clientName)).current;
  const settled = SETTLED_STATUSES.includes(status);
  const [visibleStep, setVisibleStep] = useState(0);

  useEffect(() => {
    if (settled) {
      setVisibleStep(steps.length - 1);
      return;
    }
    const interval = setInterval(() => {
      setVisibleStep((current) => Math.min(current + 1, steps.length - 2));
    }, 850);
    return () => clearInterval(interval);
  }, [settled, steps.length]);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-grafite-elevado bg-grafite px-4 py-3">
      {steps.map((step, index) => {
        const isDone = index < visibleStep || settled;
        const isActive = index === visibleStep && !settled;
        return (
          <div
            key={step}
            className={cn(
              'flex items-center gap-2 text-sm transition-colors',
              isDone ? 'text-branco-cru' : isActive ? 'text-nevoa' : 'text-nevoa/40',
            )}
          >
            {isDone ? (
              <motion.span
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full',
                  status === 'failed' && index === steps.length - 1 ? 'bg-erro' : 'bg-sinal',
                )}
              >
                <Check size={11} className="text-carbono" strokeWidth={3} />
              </motion.span>
            ) : isActive ? (
              <Loader2 size={16} className="shrink-0 animate-spin text-roxo-eletrico" />
            ) : (
              <span className="size-4 shrink-0 rounded-full border border-grafite-elevado" />
            )}
            {step}
          </div>
        );
      })}
    </div>
  );
}
