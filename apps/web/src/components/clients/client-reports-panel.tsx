'use client';

import { useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import { useClientReports, useCreateClientReport } from '@/hooks/use-client-reports';
import { ApiRequestError } from '@/lib/api/client';

/**
 * Relatórios PDF (§46-51 do prompt de refinamento, 06/10/2026). Geração é
 * ASSÍNCRONA (worker renderiza e sobe pro Storage) — este painel cria o
 * pedido e deixa a lista de baixo fazer polling sozinha (useClientReports)
 * até sair de "na fila"/"processando".
 *
 * 403 aqui (tratado no componente pai, client-detail-overlay.tsx, junto com
 * os painéis de Meta/Google Ads) = o workspace desta pessoa não inclui
 * "relatorios" — o painel simplesmente não aparece, nunca uma mensagem de erro.
 */
const PERIODOS = [
  { dias: 7, rotulo: '7 dias' },
  { dias: 30, rotulo: '30 dias' },
  { dias: 90, rotulo: '90 dias' },
];

const STATUS_ROTULO: Record<string, string> = {
  queued: 'Na fila',
  processing: 'Gerando…',
  ready: 'Pronto',
  failed: 'Falhou',
};

function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function ClientReportsPanel({ clientId }: { clientId: string }) {
  const reports = useClientReports(clientId);
  const create = useCreateClientReport(clientId);
  const [canais, setCanais] = useState<Set<string>>(new Set(['meta', 'google_ads']));
  const [periodoDias, setPeriodoDias] = useState(30);

  // 403 = o workspace builder desta pessoa não inclui "relatorios" — mesmo
  // tratamento dos painéis de Meta/Google Ads (o painel some, sem erro).
  if (reports.error instanceof ApiRequestError && reports.error.status === 403) return null;

  function alternarCanal(canal: string) {
    setCanais((atual) => {
      const novo = new Set(atual);
      if (novo.has(canal)) novo.delete(canal);
      else novo.add(canal);
      return novo;
    });
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-grafite-elevado p-4">
        <div className="mb-2 flex items-center gap-2">
          <FileText size={16} className="text-nevoa" />
          <p className="text-sm font-semibold text-branco-cru">Relatório de performance</p>
        </div>
        <p className="mb-3 text-xs text-nevoa">Combina Meta Ads e Google Ads num PDF, com comparação contra o período anterior.</p>

        <div className="mb-3 flex flex-wrap items-center gap-4">
          <div className="flex gap-3">
            {(['meta', 'google_ads'] as const).map((canal) => (
              <label key={canal} className="flex items-center gap-1.5 text-xs text-branco-cru">
                <input type="checkbox" checked={canais.has(canal)} onChange={() => alternarCanal(canal)} className="accent-roxo-eletrico" />
                {canal === 'meta' ? 'Meta Ads' : 'Google Ads'}
              </label>
            ))}
          </div>
          <select
            value={periodoDias}
            onChange={(event) => setPeriodoDias(Number(event.target.value))}
            className="rounded-md border border-grafite-elevado bg-carbono px-2 py-1 text-xs text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
          >
            {PERIODOS.map((p) => (
              <option key={p.dias} value={p.dias}>
                {p.rotulo}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          disabled={canais.size === 0 || create.isPending}
          onClick={() => create.mutate({ channels: [...canais], period_days: periodoDias })}
          className="inline-flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-3 py-2 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-40"
        >
          {create.isPending ? 'Pedindo…' : 'Gerar relatório'}
        </button>
        {create.isError && (
          <p className="mt-2 text-[11px] text-erro">{create.error instanceof ApiRequestError ? create.error.message : 'Não foi possível pedir o relatório.'}</p>
        )}
      </div>

      {reports.data && reports.data.length > 0 && (
        <ul className="divide-y divide-grafite-elevado/60 rounded-lg border border-grafite-elevado">
          {reports.data.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm text-branco-cru">
                  {r.channels.map((c) => (c === 'meta' ? 'Meta Ads' : 'Google Ads')).join(' + ')} · últimos {r.period_days} dias
                </p>
                <p className="font-mono text-[11px] text-nevoa">
                  {formatarData(r.period_start)} — {formatarData(r.period_end)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {(r.status === 'queued' || r.status === 'processing') && <Loader2 size={13} className="animate-spin text-nevoa" />}
                <span className={`font-mono text-[11px] ${r.status === 'failed' ? 'text-erro' : 'text-nevoa'}`}>{STATUS_ROTULO[r.status] ?? r.status}</span>
                {r.status === 'ready' && r.storage_url && (
                  <a
                    href={r.storage_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 rounded-md border border-grafite-elevado px-2 py-1 text-[11px] text-nevoa transition-colors hover:border-roxo-eletrico/50 hover:text-branco-cru"
                  >
                    <Download size={11} /> Baixar
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {reports.data && reports.data.some((r) => r.status === 'failed' && r.error_message) && (
        <p className="text-[11px] text-erro">{reports.data.find((r) => r.status === 'failed')?.error_message}</p>
      )}
    </div>
  );
}
