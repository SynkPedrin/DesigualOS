'use client';

import { Megaphone } from 'lucide-react';
import { useMe } from '@/hooks/use-me';
import { useAnnouncementsAdmin, useUpdateAnnouncement, type AnuncioAdmin } from '@/hooks/use-announcements';
import { Surface } from '@/components/ui/surface';
import { toast } from '@/stores/toast-store';
import { cn } from '@/lib/utils';

/**
 * ANÚNCIOS DE NOVIDADES — painel mínimo (não é CMS). O conteúdo nasce numa
 * migração; aqui se decide QUANDO e PARA QUEM aparece, e se vê quantos viram e
 * concluíram. Só a Desigual administra (a API devolve 403 para master de empresa
 * cliente, e aí esta seção some).
 *
 * Rollout em três passos: Desligado → Só QA (as contas da lista) → Todos.
 */

const ROLLOUT: Array<{ valor: AnuncioAdmin['rollout']; rotulo: string }> = [
  { valor: 'off', rotulo: 'Desligado' },
  { valor: 'qa', rotulo: 'Só QA' },
  { valor: 'all', rotulo: 'Todos' },
];

export function AnnouncementsAdmin() {
  const { data: me } = useMe();
  const lista = useAnnouncementsAdmin();
  const alterar = useUpdateAnnouncement();
  if (lista.isError || (lista.isSuccess && lista.data.length === 0)) return null;

  const mudar = (a: AnuncioAdmin, mudanca: Parameters<typeof alterar.mutate>[0]) => alterar.mutate(mudanca, {
    onSuccess: () => toast(`"${a.title}" atualizado.`, 'success'),
    onError: (e) => toast(e instanceof Error ? e.message : 'Não foi possível atualizar.', 'error'),
  });

  return (
    <section className="mb-8" aria-labelledby="anuncios-titulo">
      <div className="mb-3 flex items-center gap-2">
        <Megaphone size={15} className="text-nevoa" />
        <h2 id="anuncios-titulo" className="font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">Anúncios de novidades</h2>
      </div>
      <Surface level="grafite" className="divide-y divide-grafite-elevado/60 p-0">
        {lista.isPending && <p className="px-4 py-6 text-sm text-nevoa">Carregando…</p>}
        {lista.data?.map((a) => {
          const souQa = me?.id ? a.qa_user_ids.includes(me.id) : false;
          return (
            <div key={a.key} className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-branco-cru">{a.title}</p>
                <p className="mt-0.5 font-mono text-[11px] text-nevoa">
                  {a.key} · prioridade {a.priority}{a.audience.modules?.length ? ` · quem tem ${a.audience.modules.join(', ')}` : ''}
                </p>
                <p className="mt-1.5 text-xs text-nevoa">
                  {a.stats.apresentados} apresentados · {a.stats.dispensados} explorar depois · {a.stats.em_andamento} no tutorial · <span className="text-sucesso">{a.stats.concluidos} concluíram</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div role="radiogroup" aria-label={`Rollout de ${a.title}`} className="flex overflow-hidden rounded-md border border-grafite-elevado">
                  {ROLLOUT.map((r) => (
                    <button
                      key={r.valor}
                      type="button"
                      role="radio"
                      aria-checked={a.rollout === r.valor}
                      disabled={alterar.isPending}
                      onClick={() => {
                        if (a.rollout === r.valor) return;
                        if (r.valor === 'all' && !window.confirm(`Mostrar "${a.title}" para todo o público agora?`)) return;
                        mudar(a, { key: a.key, rollout: r.valor });
                      }}
                      className={cn('px-3 py-1.5 text-xs transition-colors', a.rollout === r.valor ? 'bg-roxo-eletrico text-white' : 'text-nevoa hover:text-branco-cru')}
                    >
                      {r.rotulo}
                    </button>
                  ))}
                </div>
                {me?.id && (
                  <button type="button" disabled={alterar.isPending} onClick={() => mudar(a, { key: a.key, qa_user_ids: souQa ? a.qa_user_ids.filter((id) => id !== me.id) : [...a.qa_user_ids, me.id] })} className="rounded-md border border-grafite-elevado px-3 py-1.5 text-xs text-branco-cru hover:border-roxo-eletrico/60">
                    {souQa ? 'Sair do QA' : 'Me colocar no QA'}
                  </button>
                )}
                <label className="flex items-center gap-1.5 text-xs text-nevoa">
                  Prioridade
                  <input type="number" defaultValue={a.priority} min={-1000} max={1000} onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== a.priority) mudar(a, { key: a.key, priority: v }); }} className="w-16 rounded-md border border-grafite-elevado bg-grafite px-2 py-1 text-xs text-branco-cru" />
                </label>
                <button type="button" role="switch" aria-checked={a.active} aria-label={`${a.title} ativo`} disabled={alterar.isPending} onClick={() => mudar(a, { key: a.key, active: !a.active })} className={cn('relative h-5 w-9 rounded-full transition-colors', a.active ? 'bg-sucesso' : 'bg-grafite-elevado')}>
                  <span className={cn('absolute top-0.5 size-4 rounded-full bg-branco-cru transition-all', a.active ? 'left-[18px]' : 'left-0.5')} />
                </button>
              </div>
            </div>
          );
        })}
      </Surface>
      <p className="mt-2 font-mono text-[11px] text-nevoa">Só QA: aparece para as contas da lista de QA. Todos: para quem tem o módulo, uma vez por pessoa.</p>
    </section>
  );
}
