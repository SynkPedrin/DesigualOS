'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Aviso, BOTAO, BOTAO_PERIGO, BOTAO_SECUNDARIO, Carregando, Dinheiro, Paginacao, Selo, Tabela, TD, TH, TH_DIREITA, Vazio, mensagemDeErro } from '@/components/gestao-empresarial/kit';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  ROTULO_DA_SITUACAO, ROTULO_DO_AVISO, ROTULO_DO_TIPO, useAplicarLote, useCedentes, useDecidirLinha, useDescartarLote, useLinhasDoLote, useResumoDoLote, useVincularCedente, useVincularPorDocumento,
  type LinhaWire, type StatusDaLinha,
} from '@/hooks/use-gestao-importacao';
import { formatarDia } from '@/lib/gestao-empresarial/formato';
import { toast } from '@/stores/toast-store';
import { cn } from '@/lib/utils';

const TOM: Record<StatusDaLinha, string> = {
  novo: 'bg-roxo-eletrico/15 text-roxo-eletrico',
  duplicado_provavel: 'bg-aviso/20 text-branco-cru',
  invalido: 'bg-red-500/15 text-red-500',
  precisa_vinculo: 'bg-aviso/20 text-branco-cru',
  aplicado: 'bg-sucesso/15 text-sucesso',
  ignorado: 'bg-grafite-elevado text-nevoa',
};
const ORDEM: StatusDaLinha[] = ['duplicado_provavel', 'precisa_vinculo', 'novo', 'invalido', 'aplicado', 'ignorado'];
const texto = (v: unknown) => (typeof v === 'string' && v ? v : '');

export default function LotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const resumo = useResumoDoLote(id);
  const aplicar = useAplicarLote(id);
  const descartar = useDescartarLote(id);
  const porDocumento = useVincularPorDocumento(id);
  const [status, setStatus] = useState<string | undefined>();
  const [aviso, setAviso] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [confirmando, setConfirmando] = useState<'aplicar' | 'descartar' | null>(null);
  const [aba, setAba] = useState<'linhas' | 'cedentes'>('linhas');

  if (resumo.isPending) return <Carregando linhas={4} />;
  if (resumo.isError || !resumo.data) return <InlineSectionError message="Não conseguimos carregar este lote." onRetry={() => void resumo.refetch()} />;
  const { lote, porSituacao, avisos } = resumo.data;
  const ehLancamento = lote.kind === 'lancamentos';
  const emRevisao = lote.status === 'em_staging';
  const n = (s: StatusDaLinha) => porSituacao[s] ?? 0;
  const pendentes = n('novo') + n('duplicado_provavel') + n('precisa_vinculo');

  const executar = async (acao: 'aplicar' | 'descartar') => {
    setConfirmando(null);
    try {
      if (acao === 'descartar') {
        await descartar.mutateAsync();
        toast('Lote descartado. Nada foi gravado.', 'success');
      } else {
        const r = await aplicar.mutateAsync();
        toast(`Aplicado: ${r.criados} criados, ${r.vinculados} vinculados, ${r.adiados} aguardando decisão.`, 'success');
      }
    } catch (e) {
      toast(mensagemDeErro(e), 'error');
    }
  };

  return (
    <div className="space-y-5">
      <Link href="/gestao-empresarial/configuracoes/importacao" className="inline-flex items-center gap-1 text-sm text-nevoa hover:text-branco-cru"><ArrowLeft size={14} aria-hidden /> Todos os lotes</Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold text-branco-cru">{lote.fileName}</h2>
          <p className="text-sm text-nevoa">{ROTULO_DO_TIPO[lote.kind]} · {lote.totals['total'] ?? 0} linhas · {lote.status === 'em_staging' ? 'em revisão' : lote.status === 'aplicado' ? 'aplicado' : 'descartado'}</p>
        </div>
        {emRevisao && (
          <div className="flex flex-wrap gap-2">
            {!ehLancamento && n('duplicado_provavel') > 0 && (
              <button type="button" className={BOTAO_SECUNDARIO} disabled={porDocumento.isPending} onClick={() => porDocumento.mutate(undefined, { onSuccess: (r) => toast(`${r.vinculadas} ${r.vinculadas === 1 ? 'linha ligada' : 'linhas ligadas'} ao cadastro de mesmo documento.`, 'success'), onError: (e) => toast(mensagemDeErro(e), 'error') })}>
                Ligar repetidos pelo documento
              </button>
            )}
            <button type="button" className={BOTAO_PERIGO} onClick={() => setConfirmando('descartar')} disabled={n('aplicado') > 0}>Descartar lote</button>
            <button type="button" className={BOTAO} onClick={() => setConfirmando('aplicar')} disabled={aplicar.isPending || n('novo') + n('duplicado_provavel') === 0}>Aplicar</button>
          </div>
        )}
      </header>

      {emRevisao && pendentes > 0 && (
        <Aviso tom="aviso" titulo={`${pendentes} ${pendentes === 1 ? 'linha ainda não foi aplicada' : 'linhas ainda não foram aplicadas'}`}>
          {ehLancamento ? 'Lançamentos só entram quando o cedente é ligado a um cadastro, ou importado sem vínculo, na aba Cedentes.' : 'Repetidos esperam uma decisão: ligue pelo documento, ou ignore a linha. Nome igual nunca liga cadastros.'}
        </Aviso>
      )}

      <section aria-label="Situação das linhas" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {ORDEM.map((s) => (
          <button key={s} type="button" aria-pressed={status === s} onClick={() => { setStatus(status === s ? undefined : s); setAviso(undefined); setPage(1); setAba('linhas'); }} className={cn('rounded-lg border bg-grafite p-3 text-left transition-colors hover:border-sinal/60', status === s ? 'border-sinal' : 'border-grafite-elevado')}>
            <span className="block text-xs text-nevoa">{ROTULO_DA_SITUACAO[s]}</span>
            <span className="block font-heading text-xl font-semibold text-branco-cru tabular-nums">{n(s)}</span>
          </button>
        ))}
      </section>

      {avisos.length > 0 && (
        <section aria-label="Avisos das linhas" className="flex flex-wrap gap-1.5">
          <span className="mr-1 self-center text-xs text-nevoa">Filtrar por aviso:</span>
          {avisos.map((a) => (
            <button key={a.aviso} type="button" aria-pressed={aviso === a.aviso} onClick={() => { setAviso(aviso === a.aviso ? undefined : a.aviso); setPage(1); setAba('linhas'); }} className={cn('rounded-full border px-2.5 py-1 text-xs transition-colors', aviso === a.aviso ? 'border-sinal bg-sinal/10 text-branco-cru' : 'border-grafite-elevado text-nevoa hover:text-branco-cru')}>
              {ROTULO_DO_AVISO[a.aviso] ?? a.aviso} <span className="tabular-nums">({a.n})</span>
            </button>
          ))}
        </section>
      )}

      {ehLancamento && (
        <div role="tablist" aria-label="Seções do lote" className="flex gap-1 border-b border-grafite-elevado">
          {(['linhas', 'cedentes'] as const).map((a) => (
            <button key={a} type="button" role="tab" aria-selected={aba === a} onClick={() => setAba(a)} className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium', aba === a ? 'border-sinal text-branco-cru' : 'border-transparent text-nevoa hover:text-branco-cru')}>
              {a === 'linhas' ? 'Linhas' : `Cedentes${n('precisa_vinculo') ? ` (${n('precisa_vinculo')} linhas)` : ''}`}
            </button>
          ))}
        </div>
      )}

      {aba === 'cedentes' && ehLancamento ? <Cedentes id={id} emRevisao={emRevisao} /> : <Linhas id={id} ehLancamento={ehLancamento} emRevisao={emRevisao} filtro={{ status, aviso }} page={page} onPage={setPage} />}

      {confirmando === 'aplicar' && (
        <ConfirmDialog title="Aplicar este lote?" confirmLabel="Aplicar" description={`Vão virar ${ehLancamento ? 'lançamentos' : 'cadastros'} as ${n('novo')} linhas prontas${n('duplicado_provavel') ? `, e as repetidas que você já ligou a um cadastro ganham o papel (nada do cadastro existente é sobrescrito)` : ''}. O que ainda espera decisão continua em revisão. Dá para arquivar o que foi criado, mas não desfazer a importação.`} isPending={aplicar.isPending} onConfirm={() => void executar('aplicar')} onCancel={() => setConfirmando(null)} />
      )}
      {confirmando === 'descartar' && <ConfirmDialog title="Descartar este lote?" confirmLabel="Descartar" description="Nada foi gravado em cadastros ou lançamentos, e nada será. O mesmo arquivo continuará impedido de ser reenviado." isPending={descartar.isPending} onConfirm={() => void executar('descartar')} onCancel={() => setConfirmando(null)} />}
    </div>
  );
}

function Linhas({ id, ehLancamento, emRevisao, filtro, page, onPage }: { id: string; ehLancamento: boolean; emRevisao: boolean; filtro: { status?: string | undefined; aviso?: string | undefined }; page: number; onPage: (p: number) => void }) {
  const linhas = useLinhasDoLote(id, { ...filtro, page });
  const decidir = useDecidirLinha(id);
  if (linhas.isPending) return <Carregando />;
  if (linhas.isError || !linhas.data) return <InlineSectionError message="Não conseguimos carregar as linhas." onRetry={() => void linhas.refetch()} />;
  const d = linhas.data;
  if (d.total === 0) return <Vazio titulo="Nenhuma linha com este filtro">Tire o filtro de situação ou de aviso para ver as outras.</Vazio>;
  const acao = (l: LinhaWire, decisao: Parameters<typeof decidir.mutate>[0]['decisao']) => decidir.mutate({ rowId: l.id, decisao }, { onError: (e) => toast(mensagemDeErro(e), 'error') });

  return (
    <div className="space-y-2">
      <Tabela legenda="Linhas do lote">
        <thead>
          <tr>
            <th className={TH}>#</th>
            {ehLancamento ? <><th className={TH}>Vencimento</th><th className={TH}>Cedente</th><th className={TH}>Descrição</th><th className={TH_DIREITA}>Valor</th><th className={TH}>No Operand</th></> : <><th className={TH}>Nome</th><th className={TH}>Documento</th><th className={TH}>Cidade/UF</th><th className={TH}>Situação no arquivo</th></>}
            <th className={TH}>Situação</th><th className={TH}>Avisos</th>{emRevisao && <th className={TH}><span className="sr-only">Ações</span></th>}
          </tr>
        </thead>
        <tbody>
          {d.items.map((l) => {
            const nz = l.normalized;
            return (
              <tr key={l.id} className="border-t border-grafite-elevado/60 align-top">
                <td className={cn(TD, 'tabular-nums text-nevoa')}>{l.rowNo}</td>
                {ehLancamento ? (
                  <>
                    <td className={cn(TD, 'tabular-nums')}>{formatarDia(texto(nz['dueDate']))}</td>
                    <td className={cn(TD, 'max-w-44 truncate')} title={texto(nz['partyLabel'])}>{texto(nz['partyLabel']) || '—'}</td>
                    <td className={cn(TD, 'max-w-64 truncate')} title={texto(nz['description'])}>{texto(nz['description'])}</td>
                    <td className={cn(TD, 'text-right')}><Dinheiro centavos={typeof nz['amountCents'] === 'number' ? nz['amountCents'] : null} /></td>
                    <td className={TD}>{texto(nz['status'])}</td>
                  </>
                ) : (
                  <>
                    <td className={cn(TD, 'max-w-56 truncate')} title={texto(nz['name'])}>{texto(nz['name']) || <span className="text-red-500">sem nome</span>}</td>
                    <td className={cn(TD, 'tabular-nums')}>{texto(nz['rawDocument']) || <span className="text-nevoa/60">—</span>}</td>
                    <td className={TD}>{[texto(nz['city']), texto(nz['state'])].filter(Boolean).join('/') || '—'}</td>
                    <td className={TD}>{nz['active'] === false ? 'Inativo' : 'Ativo'}</td>
                  </>
                )}
                <td className={TD}><Selo classe={TOM[l.status]}>{ROTULO_DA_SITUACAO[l.status]}</Selo></td>
                <td className={cn(TD, 'text-xs text-nevoa')}>{l.issues.map((i) => ROTULO_DO_AVISO[i] ?? i.replace(/^documento_repetido_na_linha_(\d+)$/, 'Mesmo documento da linha $1')).join(' · ') || '—'}</td>
                {emRevisao && (
                  <td className={cn(TD, 'whitespace-nowrap text-right')}>
                    {l.status === 'duplicado_provavel' && (
                      <>
                        {typeof nz['matchPartyId'] === 'string' && !l.resolvedPartyId && <button type="button" className="mr-3 text-xs font-medium text-roxo-eletrico underline disabled:opacity-50" disabled={decidir.isPending} onClick={() => acao(l, { acao: 'vincular', partyId: nz['matchPartyId'] as string })}>Ligar ao cadastro existente</button>}
                        {l.resolvedPartyId && <span className="mr-3 text-xs text-sucesso">Ligada, aguardando aplicar</span>}
                        <button type="button" className="text-xs text-nevoa underline hover:text-branco-cru disabled:opacity-50" disabled={decidir.isPending} onClick={() => acao(l, { acao: 'ignorar' })}>Ignorar</button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </Tabela>
      <Paginacao page={d.page} totalPages={d.totalPages} total={d.total} pageSize={d.pageSize} onPage={onPage} />
    </div>
  );
}

function Cedentes({ id, emRevisao }: { id: string; emRevisao: boolean }) {
  const cedentes = useCedentes(id, true);
  const vincular = useVincularCedente(id);
  if (cedentes.isPending) return <Carregando />;
  if (cedentes.isError || !cedentes.data) return <InlineSectionError message="Não conseguimos carregar os cedentes." onRetry={() => void cedentes.refetch()} />;
  if (cedentes.data.items.length === 0) return <Vazio titulo="Nenhum cedente esperando decisão">Todos os cedentes deste lote já foram ligados ou importados sem vínculo.</Vazio>;
  const decidir = (label: string, partyId: string | null) => vincular.mutate({ label, partyId }, { onSuccess: (r) => toast(`${r.atualizadas} ${r.atualizadas === 1 ? 'linha' : 'linhas'} atualizadas.`, 'success'), onError: (e) => toast(mensagemDeErro(e), 'error') });
  return (
    <div className="space-y-3">
      <Aviso tom="info">
        O arquivo traz o nome do cedente, não um código de cadastro. Sugerimos cadastros de nome <strong>exatamente igual</strong>, mas quem decide é você. Um cedente que casa com um <em>fornecedor</em> numa receita merece conferência.
      </Aviso>
      <ul className="space-y-2">
        {cedentes.data.items.map((c) => (
          <li key={c.label} className="rounded-lg border border-grafite-elevado bg-grafite p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium text-branco-cru">{c.label}</p>
              <p className="text-xs text-nevoa tabular-nums">{c.linhas} {c.linhas === 1 ? 'linha' : 'linhas'} · <Dinheiro centavos={c.totalCents} /></p>
            </div>
            {emRevisao && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {c.candidatos.length === 0 && <span className="text-xs text-nevoa">Nenhum cadastro com este nome.</span>}
                {c.candidatos.map((cand) => (
                  <button key={cand.id} type="button" disabled={vincular.isPending} onClick={() => decidir(c.label, cand.id)} className={BOTAO_SECUNDARIO}>
                    Ligar a “{cand.name}”{cand.roles.length > 0 && <span className="text-nevoa"> ({cand.roles.map((r) => r.replace('_', ' ')).join(', ')})</span>}
                  </button>
                ))}
                <button type="button" disabled={vincular.isPending} onClick={() => decidir(c.label, null)} className="text-xs text-nevoa underline hover:text-branco-cru disabled:opacity-50">Importar sem vínculo (guarda o nome)</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
