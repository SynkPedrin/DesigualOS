'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { ExecutionStatus } from '@desigual-os/types';

const SETTLED_STATUSES: ExecutionStatus[] = ['completed', 'failed', 'timeout', 'cancelled'];

/**
 * Etapas genéricas, usadas SÓ quando o backend não reporta fase real.
 *
 * Elas são deliberadamente vagas: descrevem o que sempre acontece num turno,
 * sem afirmar nada específico. É a diferença entre "analisando" e "consultei o
 * ClickUp" — a segunda só pode aparecer se tiver acontecido de verdade, e é
 * por isso que `liveSteps` tem precedência.
 */
function buildSteps(clientName: string | null) {
  return [
    'Em análise',
    clientName ? `Lendo o contexto do ${clientName}` : 'Lendo o contexto',
    'Organizando as informações',
    'Montando a resposta',
  ];
}

/**
 * As bolinhas da marca: roxo e verde alternados, subindo e descendo em onda.
 *
 * Substituíram a lista de etapas com check (28/09/2026, pedido da operação).
 * A lista dizia quatro coisas ao mesmo tempo e, quando o turno demorava, o
 * olho não achava onde estava o progresso. Um pulso e uma frase resolvem isso
 * ocupando um terço do espaço.
 *
 * `useReducedMotion` não é enfeite de acessibilidade: quem configurou o
 * sistema pra reduzir movimento costuma ter um motivo físico, e um pulso
 * infinito na tela é exatamente o tipo de coisa que incomoda. Sem animação, as
 * bolinhas ficam paradas e a frase continua trocando — a informação não se
 * perde.
 */
function Bolinhas({ parado }: { parado: boolean }) {
  const semMovimento = useReducedMotion();
  // Roxo, verde, roxo: as duas cores da marca (--color-roxo-eletrico e
  // --color-sinal), alternadas pra leitura ficar óbvia mesmo de canto de olho.
  const cores = ['bg-roxo-eletrico', 'bg-sinal', 'bg-roxo-eletrico'];
  return (
    <div className="flex shrink-0 items-end gap-1" aria-hidden="true">
      {cores.map((cor, i) => (
        <motion.span
          key={i}
          className={cn('size-2 rounded-full', cor)}
          animate={parado || semMovimento ? { y: 0 } : { y: [0, -6, 0] }}
          transition={
            parado || semMovimento
              ? { duration: 0 }
              : // O atraso em cascata é o que faz virar ONDA em vez de três
                // bolinhas piscando juntas.
                { duration: 0.9, repeat: Infinity, ease: 'easeInOut', delay: i * 0.15 }
          }
        />
      ))}
    </div>
  );
}

export function ThinkingSteps({
  status,
  clientName,
  liveSteps,
}: {
  status: ExecutionStatus;
  clientName: string | null;
  /** Fases reais reportadas pelo backend (agent.phase, Agentic V2). Quando
   * existem, substituem as etapas genéricas por intervalo: a UI nunca mostra
   * uma etapa que o backend não executou de verdade. */
  liveSteps?: string[] | undefined;
}) {
  const genericSteps = useRef(buildSteps(clientName)).current;
  const useLive = Boolean(liveSteps && liveSteps.length > 0);
  const steps = useLive ? liveSteps! : genericSteps;
  const settled = SETTLED_STATUSES.includes(status);
  const [visibleStep, setVisibleStep] = useState(0);

  useEffect(() => {
    if (useLive) {
      // Com fases reais, a frase visível é sempre a última reportada.
      setVisibleStep(steps.length - 1);
      return;
    }
    if (settled) {
      setVisibleStep(steps.length - 1);
      return;
    }
    // Para na PENÚLTIMA: "Montando a resposta" é o estado final e não pode ser
    // anunciado enquanto o turno ainda está aberto — seria a UI afirmando um
    // progresso que ninguém confirmou.
    const interval = setInterval(() => {
      setVisibleStep((current) => Math.min(current + 1, steps.length - 2));
    }, 1600);
    return () => clearInterval(interval);
  }, [settled, steps.length, useLive]);

  const frase = steps[Math.min(visibleStep, steps.length - 1)] ?? 'Em análise';

  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-grafite-elevado bg-grafite px-4 py-3"
      // A frase é o estado real do turno: leitor de tela recebe cada troca.
      role="status"
      aria-live="polite"
    >
      <Bolinhas parado={settled} />
      {/* A key força a transição a cada troca de frase; sem ela o texto trocaria seco. */}
      <motion.span
        key={frase}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className={cn('text-sm', settled ? 'text-branco-cru' : 'text-nevoa')}
      >
        {frase}
        {settled ? '' : '…'}
      </motion.span>
    </div>
  );
}
