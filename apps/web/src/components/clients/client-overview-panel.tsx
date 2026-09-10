'use client';

import { ImageIcon, Loader2, MessageSquare } from 'lucide-react';
import { useClientOverview } from '@/hooks/use-client-overview';
import { formatRelativeTime } from '@/lib/format';

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="font-mono text-[11px] uppercase tracking-wider text-nevoa">{children}</h3>;
}

/**
 * Aba Visão Geral: resumo data-driven do cliente com dados reais lidos na
 * hora (tarefas do ClickUp por status, últimos comentários, assets do
 * Studio, conversas do Desigual OS). O endpoint devolve null/0 pro que não
 * existe, então aqui só se renderiza o que veio - nada inventado.
 */
export function ClientOverviewPanel({ clientId }: { clientId: string }) {
  const { data, isPending, isError } = useClientOverview(clientId);

  if (isPending) {
    return (
      <p className="flex items-center gap-2 py-12 text-sm text-nevoa">
        <Loader2 size={15} className="animate-spin" /> Montando o resumo do cliente…
      </p>
    );
  }
  if (isError || !data) {
    return <p className="py-8 text-center text-sm text-erro">Não foi possível montar o resumo agora.</p>;
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <SectionTitle>ClickUp</SectionTitle>
        {!data.clickup ? (
          <p className="text-sm text-nevoa">Cliente ainda não vinculado a uma lista do ClickUp.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-grafite-elevado bg-carbono p-4">
                <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">Tarefas abertas</p>
                <p className="mt-1 font-display text-2xl text-sinal">{data.clickup.open_tasks}</p>
              </div>
              <div className="rounded-lg border border-grafite-elevado bg-carbono p-4">
                <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">Tarefas no total</p>
                <p className="mt-1 font-display text-2xl text-branco-cru">{data.clickup.total_tasks}</p>
              </div>
            </div>
            {data.clickup.by_status.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {data.clickup.by_status.map((entry) => (
                  <span
                    key={entry.status}
                    className="inline-flex items-center gap-1.5 rounded-md border border-grafite-elevado bg-carbono px-2 py-1 text-xs text-branco-cru"
                  >
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: entry.color ?? 'var(--color-nevoa, #888)' }}
                    />
                    {entry.status} · {entry.count}
                  </span>
                ))}
              </div>
            )}
            {data.clickup.latest_comments.length > 0 && (
              <div className="space-y-1.5">
                <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">Últimos comentários</p>
                <ul className="space-y-1.5">
                  {data.clickup.latest_comments.map((comment) => {
                    const millis = Number(comment.date);
                    return (
                      <li key={comment.id} className="rounded-md border border-grafite-elevado bg-carbono px-3 py-2">
                        <p className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="truncate font-semibold text-branco-cru">
                            {comment.username ?? 'ClickUp'} em {comment.task_name}
                          </span>
                          {Number.isFinite(millis) && (
                            <span className="shrink-0 font-mono text-[10px] text-nevoa">
                              {formatRelativeTime(new Date(millis).toISOString())}
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-branco-cru/80">{comment.text}</p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      <section className="space-y-2">
        <SectionTitle>Studio · {data.studio.total} asset(s)</SectionTitle>
        {data.studio.latest.length === 0 ? (
          <p className="text-sm text-nevoa">Nenhum material gerado pra este cliente ainda.</p>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {data.studio.latest.map((asset) =>
              /\.(mp4|webm|mov)$/i.test(asset.filename) ? (
                <video key={asset.id} src={asset.storage_url} className="aspect-square w-full rounded-md object-cover" />
              ) : (
                <img key={asset.id} src={asset.storage_url} alt={asset.filename} className="aspect-square w-full rounded-md object-cover" />
              ),
            )}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <SectionTitle>Conversas no Desigual OS · {data.conversations.total}</SectionTitle>
        {data.conversations.latest.length === 0 ? (
          <p className="text-sm text-nevoa">Nenhuma conversa com os agentes sobre este cliente ainda.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.conversations.latest.map((conversation) => (
              <li key={conversation.id} className="flex items-center justify-between gap-3 rounded-md border border-grafite-elevado bg-carbono px-3 py-2">
                <span className="flex min-w-0 items-center gap-2 text-xs text-branco-cru">
                  <MessageSquare size={12} className="shrink-0 text-nevoa" />
                  <span className="truncate">{conversation.title ?? 'Conversa sem título'}</span>
                </span>
                <span className="shrink-0 font-mono text-[10px] text-nevoa">{formatRelativeTime(conversation.updated_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.studio.latest.length === 0 && data.conversations.latest.length === 0 && !data.clickup && (
        <p className="flex items-center gap-2 text-sm text-nevoa">
          <ImageIcon size={15} /> Nada registrado pra este cliente ainda.
        </p>
      )}
    </div>
  );
}
