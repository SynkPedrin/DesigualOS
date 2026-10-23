'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { baixarCsvDeLancamentos } from '@/hooks/use-gestao-relatorios';
import { toast } from '@/stores/toast-store';
import { BOTAO, CAMPO, Aviso, mensagemDeErro } from '../kit';

/** Exporta os lançamentos para planilha (CSV com ponto e vírgula e vírgula decimal). Os filtros são opcionais. */
export function ExportarCsv() {
  const [kind, setKind] = useState('');
  const [situacao, setSituacao] = useState('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function baixar() {
    setErro(null);
    setBaixando(true);
    try {
      await baixarCsvDeLancamentos({ kind, situacao, from: de, to: ate });
      toast('Arquivo lancamentos.csv baixado.', 'success');
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível exportar.'));
    } finally {
      setBaixando(false);
    }
  }

  return (
    <section aria-label="Exportar lançamentos" className="space-y-3 rounded-lg border border-grafite-elevado bg-grafite p-4">
      <div>
        <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-branco-cru">Exportar lançamentos (CSV)</h3>
        <p className="text-xs text-nevoa">Abre direto no Excel ou no Google Planilhas. Filtre pelo vencimento, se quiser só um período.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-nevoa">Tipo<select value={kind} onChange={(e) => setKind(e.target.value)} className={`${CAMPO} mt-1`}><option value="">Receitas e despesas</option><option value="receita">Só receitas</option><option value="despesa">Só despesas</option></select></label>
        <label className="text-xs text-nevoa">Situação<select value={situacao} onChange={(e) => setSituacao(e.target.value)} className={`${CAMPO} mt-1`}><option value="">Todas</option><option value="aberto">Em aberto</option><option value="vencido">Vencidos</option><option value="quitado">Quitados</option><option value="cancelado">Cancelados</option></select></label>
        <label className="text-xs text-nevoa">Vencimento de<input type="date" value={de} onChange={(e) => setDe(e.target.value)} className={`${CAMPO} mt-1`} /></label>
        <label className="text-xs text-nevoa">até<input type="date" value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)} className={`${CAMPO} mt-1`} /></label>
      </div>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <button type="button" onClick={() => void baixar()} disabled={baixando} className={BOTAO}><Download size={14} /> {baixando ? 'Gerando…' : 'Baixar CSV'}</button>
    </section>
  );
}
