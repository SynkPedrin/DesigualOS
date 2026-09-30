'use client';

import { CalendarDays, ExternalLink, UserRound } from 'lucide-react';
import type { AgencyTaskWire } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

function dueLabel(ms: number | null): { text: string; late: boolean } | null {
  if (!ms) return null;
  const late = ms < Date.now();
  return { text: new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }), late };
}

/**
 * Linha de tarefa da Central de Tasks (agência inteira / minhas tarefas).
 *
 * O RESPONSÁVEL ERA INVISÍVEL, e não por ausência de dado: ele já vinha na
 * resposta e era desenhado como uma pilha de 10px em fonte mono, na mesma
 * linha, com a mesma cor e o mesmo formato de status, prioridade e tags. Quem
 * olhava não conseguia dizer quem era dono da tarefa — tudo parecia etiqueta.
 *
 * Numa tela que existe para supervisionar, "de quem é isto" é a segunda
 * pergunta depois de "o que é isto". Então o responsável saiu da sopa de chips
 * e ganhou lugar, ícone e tamanho de leitura.
 *
 * E o estado que mais importa ganhou nome: TAREFA SEM RESPONSÁVEL não é um
 * espaço em branco, é um problema. Antes ela simplesmente não mostrava chip
 * nenhum, e some entre as outras exatamente como se estivesse resolvida.
 */
export function AgencyTaskRow({ task, showClient }: { task: AgencyTaskWire; showClient: boolean }) {
  const due = dueLabel(task.due_date);
  const donos = task.assignees.filter((a) => a.trim().length > 0);

  return (
    <a
      href={task.url ?? '#'}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col gap-2 rounded-lg border border-transparent px-3 py-3 transition-colors hover:border-grafite-elevado hover:bg-carbono"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn('mt-1.5 size-2 shrink-0 rounded-full', due?.late ? 'bg-erro' : 'bg-nevoa/50')}
        />
        {/* 15px e peso normal: é o texto que a pessoa realmente lê. */}
        <span className="min-w-0 flex-1 text-[15px] font-normal leading-snug text-branco-cru">{task.name}</span>
        {showClient && task.client && (
          <span className="shrink-0 rounded border border-grafite-elevado px-2 py-0.5 text-[12px] text-nevoa">
            {task.client.name}
          </span>
        )}
        <ExternalLink size={14} className="mt-1 shrink-0 text-nevoa opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      {/* QUEM É O DONO — primeira linha depois do título, sozinha. */}
      <div className="flex flex-wrap items-center gap-2 pl-5">
        <UserRound size={14} className={donos.length === 0 ? 'text-aviso' : 'text-nevoa'} />
        {donos.length === 0 ? (
          <span className="text-[13px] text-aviso">sem responsável</span>
        ) : (
          <span className="text-[13px] text-branco-cru">{donos.join(', ')}</span>
        )}

        {due && (
          <span
            className={cn(
              'inline-flex items-center gap-1 text-[13px]',
              due.late ? 'font-medium text-erro' : 'text-nevoa',
            )}
          >
            <CalendarDays size={13} />
            {due.late ? `atrasada desde ${due.text}` : `vence ${due.text}`}
          </span>
        )}
      </div>

      {/* Status, prioridade e tags continuam — agora claramente em segundo
        * plano, que é o lugar deles numa lista de supervisão. */}
      {(task.status || task.priority || task.tags.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 pl-5">
          {task.status && (
            <span className="rounded border border-grafite-elevado px-1.5 py-0.5 text-[11px] text-nevoa">
              {task.status}
            </span>
          )}
          {task.priority && (
            <span className="rounded border border-grafite-elevado px-1.5 py-0.5 text-[11px] text-nevoa">
              {task.priority}
            </span>
          )}
          {task.tags.map((tag) => (
            <span key={tag} className="rounded bg-grafite-elevado px-1.5 py-0.5 text-[11px] text-nevoa">
              {tag}
            </span>
          ))}
        </div>
      )}

      {task.description && (
        <p className="line-clamp-2 pl-5 text-[13px] leading-relaxed text-nevoa">{task.description}</p>
      )}
    </a>
  );
}
