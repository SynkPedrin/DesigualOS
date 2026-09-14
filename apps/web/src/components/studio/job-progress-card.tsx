'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { useStudioJob } from '@/hooks/use-studio-jobs';
import { cn } from '@/lib/utils';

// Achado real (2026-09-11): faltavam os 9 estágios extras do pipeline
// adaptativo (packages/types/src/studio.ts, StudioJobStatus) - se algum
// deles chegasse a ser emitido de verdade pelo worker, esta tela mostraria o
// nome cru do status ("video_draft") em vez de um rótulo legível, já que o
// fallback é `job.status` sem tradução nenhuma.
const STATUS_LABEL: Record<string, string> = {
  queued: 'Na fila',
  rendering: 'Renderizando',
  completed: 'Concluído',
  failed: 'Falhou',
  planning: 'Planejando',
  quality_check: 'Verificando qualidade',
  refining: 'Refinando',
  post_processing: 'Pós-processando',
  uploading: 'Enviando',
  keyframe_generation: 'Gerando quadros-chave',
  keyframe_qa: 'Verificando quadros-chave',
  video_draft: 'Rascunho de vídeo',
  motion_qa: 'Verificando movimento',
  video_master: 'Finalizando vídeo',
  video_qa: 'Verificando vídeo',
};

export function JobProgressCard({
  jobId,
  onSettled,
  onDismiss,
}: {
  jobId: string;
  onSettled: (jobId: string, status: 'completed' | 'failed') => void;
  onDismiss: (jobId: string) => void;
}) {
  const { data: job } = useStudioJob(jobId);
  const settledRef = useRef(false);

  useEffect(() => {
    if (!job) return;
    if ((job.status === 'completed' || job.status === 'failed') && !settledRef.current) {
      settledRef.current = true;
      onSettled(jobId, job.status);
    }
  }, [job, jobId, onSettled]);

  // Sem o Skeleton a fila piscava vazia a cada job novo, até o primeiro fetch voltar.
  if (!job) {
    return (
      <Surface level="grafite" className="p-4">
        <Skeleton className="mb-2 h-4 w-2/3" />
        <div className="mb-1.5 flex items-center justify-between">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-8" />
        </div>
        <Skeleton className="h-1.5 w-full" />
      </Surface>
    );
  }

  const isDone = job.status === 'completed';
  const isFailed = job.status === 'failed';

  return (
    <Surface level="grafite" className={cn('p-4', isFailed && 'border-erro/40')}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm text-branco-cru">{job.prompt}</p>
        {isDone && <CheckCircle2 size={16} className="shrink-0 text-sinal" />}
        {isFailed && <AlertTriangle size={16} className="shrink-0 text-erro" />}
        {/* Job que falhou NÃO some sozinho: quem fecha é a pessoa, depois de
         * ler o motivo. Antes ele sumia em 2s e o relato virou "o job começou
         * e depois simplesmente sumiu". */}
        {isFailed && (
          <button
            type="button"
            onClick={() => onDismiss(jobId)}
            aria-label="Dispensar job com falha"
            className="shrink-0 text-nevoa transition-colors hover:text-branco-cru"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="mb-1.5 flex items-center justify-between font-mono text-[11px] text-nevoa">
        <span>{STATUS_LABEL[job.status] ?? job.status}</span>
        <span className="tabular-nums">{job.progress}%</span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-carbono">
        <motion.div
          animate={{ width: `${job.progress}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className={cn('h-full rounded-full', isFailed ? 'bg-erro' : 'bg-sinal shadow-sinal')}
        />
      </div>

      {isFailed && job.error && (
        <p className="mt-2 rounded-md bg-erro/10 px-2.5 py-2 text-[11px] leading-relaxed text-erro">{job.error}</p>
      )}
    </Surface>
  );
}
