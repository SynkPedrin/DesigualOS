'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Aviso, BOTAO, Campo, CAMPO, Carregando, Selo, Tabela, TD, TH, Vazio, mensagemDeErro } from '@/components/gestao-empresarial/kit';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { arquivoParaBase64, FORMATO_DO_TIPO, ROTULO_DO_TIPO, useEnviarLote, useLotes, type LoteWire, type TipoDeLote } from '@/hooks/use-gestao-importacao';
import { toast } from '@/stores/toast-store';
import { cn } from '@/lib/utils';

const ESTADO: Record<LoteWire['status'], { rotulo: string; classe: string }> = {
  em_staging: { rotulo: 'Em revisão', classe: 'bg-aviso/20 text-branco-cru' },
  aplicado: { rotulo: 'Aplicado', classe: 'bg-sucesso/15 text-sucesso' },
  descartado: { rotulo: 'Descartado', classe: 'bg-grafite-elevado text-nevoa' },
};

export default function ImportacaoPage() {
  const lotes = useLotes();
  const enviar = useEnviarLote();
  const [tipo, setTipo] = useState<TipoDeLote>('clientes');
  const [erro, setErro] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  async function aoEscolher(arquivo: File | undefined) {
    if (!arquivo) return;
    setErro(null);
    if (arquivo.size > 10 * 1024 * 1024) return setErro('O arquivo tem mais de 10 MB.');
    try {
      const r = await enviar.mutateAsync({ kind: tipo, fileName: arquivo.name, contentBase64: await arquivoParaBase64(arquivo) });
      toast(`Arquivo lido: ${r.totals['total'] ?? 0} linhas em revisão. Nada foi gravado ainda.`, 'success');
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível enviar o arquivo.'));
    } finally {
      if (entrada.current) entrada.current.value = '';
    }
  }

  return (
    <div className="space-y-5">
      <Aviso tom="info" titulo="Como a importação funciona">
        O arquivo é lido e fica em <strong>revisão</strong>: nenhuma linha vira cadastro ou lançamento até você aplicar. Cadastros repetidos esperam a sua decisão (nome igual nunca junta ninguém) e cada cedente de lançamento precisa ser ligado a um cadastro por você. O mesmo arquivo não entra duas vezes.
      </Aviso>

      <section aria-label="Enviar arquivo" className="grid gap-3 rounded-lg border border-grafite-elevado bg-grafite p-4 sm:grid-cols-[minmax(0,16rem)_1fr_auto] sm:items-end">
        <Campo rotulo="O que está no arquivo" ajuda={FORMATO_DO_TIPO[tipo]}>
          {(p) => (
            <select {...p} value={tipo} onChange={(e) => setTipo(e.target.value as TipoDeLote)} className={CAMPO}>
              {(Object.keys(ROTULO_DO_TIPO) as TipoDeLote[]).map((t) => <option key={t} value={t}>{ROTULO_DO_TIPO[t]}</option>)}
            </select>
          )}
        </Campo>
        <div className="text-xs text-nevoa">Veículos de mídia entram como fornecedores com o papel de veículo. Quando o mesmo documento já existe, ele ganha o papel em vez de ganhar um cadastro novo.</div>
        <div>
          <input ref={entrada} type="file" accept={tipo === 'lancamentos' ? '.csv' : '.xlsx'} className="sr-only" id="arquivo-importacao" onChange={(e) => void aoEscolher(e.target.files?.[0])} />
          <label htmlFor="arquivo-importacao" className={cn(BOTAO, 'cursor-pointer', enviar.isPending && 'pointer-events-none opacity-50')}>
            <Upload size={14} aria-hidden /> {enviar.isPending ? 'Lendo…' : 'Escolher arquivo'}
          </label>
        </div>
      </section>
      {erro && <Aviso tom="erro" titulo="Não foi possível importar">{erro}</Aviso>}

      <section aria-label="Lotes" className="space-y-2">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-branco-cru">Lotes importados</h2>
        {lotes.isPending ? (
          <Carregando linhas={3} />
        ) : lotes.isError ? (
          <InlineSectionError message="Não conseguimos carregar os lotes." onRetry={() => void lotes.refetch()} />
        ) : lotes.data.items.length === 0 ? (
          <Vazio titulo="Nenhum arquivo importado ainda">Escolha o tipo e envie o primeiro arquivo acima.</Vazio>
        ) : (
          <Tabela legenda="Lotes importados">
            <thead><tr><th className={TH}>Arquivo</th><th className={TH}>Tipo</th><th className={TH}>Linhas</th><th className={TH}>Situação</th><th className={TH}>Enviado em</th><th className={TH}><span className="sr-only">Abrir</span></th></tr></thead>
            <tbody>
              {lotes.data.items.map((l) => (
                <tr key={l.id} className="border-t border-grafite-elevado/60">
                  <td className={cn(TD, 'max-w-64 truncate')} title={l.fileName}>{l.fileName}</td>
                  <td className={TD}>{ROTULO_DO_TIPO[l.kind]}</td>
                  <td className={cn(TD, 'tabular-nums')}>{l.totals['total'] ?? '—'}</td>
                  <td className={TD}><Selo classe={ESTADO[l.status].classe}>{ESTADO[l.status].rotulo}</Selo></td>
                  <td className={cn(TD, 'tabular-nums text-nevoa')}>{new Date(l.createdAt).toLocaleString('pt-BR')}</td>
                  <td className={TD}><Link href={`/gestao-empresarial/configuracoes/importacao/${l.id}`} className="text-sm font-medium text-roxo-eletrico underline">Abrir</Link></td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        )}
      </section>
    </div>
  );
}
