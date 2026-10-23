'use client';

import { useState } from 'react';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { toast } from '@/stores/toast-store';
import { useConciliar, useContas, useDesconciliar, useImportarExtrato, useSugestoes, type LinhaExtratoWire } from '@/hooks/use-gestao-financeiro';
import { centavosDeTexto, formatarDia, ValorInvalido } from '@/lib/gestao-empresarial/formato';
import { Aviso, BOTAO, BOTAO_SECUNDARIO, Campo, CAMPO, Carregando, Dinheiro, mensagemDeErro, Selo, TD, TH, TH_DIREITA, Tabela, Vazio } from '../kit';

async function chaveEstavel(texto: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(h)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface LinhaLida { postedOn: string; description: string; amountCents: number; externalKey: string }

/**
 * "AAAA-MM-DD;descrição;valor" por linha. A chave de cada linha é um hash do seu conteúdo mais a ordem entre
 * linhas idênticas, então colar o mesmo extrato duas vezes não duplica nada.
 */
export async function lerExtratoColado(texto: string): Promise<{ linhas: LinhaLida[]; erros: string[] }> {
  const erros: string[] = [];
  const linhas: LinhaLida[] = [];
  const vistas = new Map<string, number>();
  const brutas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const [i, bruta] of brutas.entries()) {
    const partes = bruta.split(';');
    if (partes.length < 3) { erros.push(`Linha ${i + 1}: use AAAA-MM-DD;descrição;valor.`); continue; }
    const dia = partes[0]!.trim();
    const valorTexto = partes[partes.length - 1]!;
    const descricao = partes.slice(1, -1).join(';').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) { erros.push(`Linha ${i + 1}: a data precisa estar como AAAA-MM-DD.`); continue; }
    let centavos: number;
    try { centavos = centavosDeTexto(valorTexto); } catch (e) { erros.push(`Linha ${i + 1}: ${e instanceof ValorInvalido ? e.message : 'valor inválido'}`); continue; }
    if (centavos === 0) { erros.push(`Linha ${i + 1}: valor zero.`); continue; }
    const base = `${dia}|${descricao}|${centavos}`;
    const n = (vistas.get(base) ?? 0) + 1;
    vistas.set(base, n);
    linhas.push({ postedOn: dia, description: descricao, amountCents: centavos, externalKey: await chaveEstavel(`${base}|${n}`) });
  }
  return { linhas, erros };
}

export function Conciliacao() {
  const contas = useContas();
  const [contaId, setContaId] = useState('');
  const ativas = (contas.data?.items ?? []).filter((c) => c.active);
  const conta = contaId || ativas[0]?.id || null;
  const sug = useSugestoes(conta);
  const importar = useImportarExtrato();
  const conciliar = useConciliar();
  const desfazer = useDesconciliar();
  const [colado, setColado] = useState('');
  const [erros, setErros] = useState<string[]>([]);
  const [feitas, setFeitas] = useState<LinhaExtratoWire[]>([]);

  async function enviar() {
    if (!conta) return;
    const { linhas, erros: e } = await lerExtratoColado(colado);
    setErros(e);
    if (linhas.length === 0) {
      if (e.length === 0) setErros(['Cole ao menos uma linha.']);
      return;
    }
    importar.mutate({ contaId: conta, linhas }, { onSuccess: (r) => { toast(`${r.novas} ${r.novas === 1 ? 'nova' : 'novas'}, ${r.jaExistiam} já ${r.jaExistiam === 1 ? 'existia' : 'existiam'}.`, 'success'); if (e.length === 0) setColado(''); }, onError: (x) => setErros([mensagemDeErro(x)]) });
  }

  if (contas.isPending) return <Carregando linhas={3} />;
  if (ativas.length === 0) return <Vazio titulo="Cadastre uma conta primeiro">A conciliação compara o extrato do banco com o razão de uma conta. Crie a conta na aba Contas.</Vazio>;
  const linhas = sug.data?.linhas ?? [];
  const sugestaoDe = (id: string) => sug.data?.sugestoes.find((s) => s.linhaId === id);

  return (
    <div className="space-y-5">
      <p className="text-sm text-nevoa">Cole o extrato, veja quais linhas combinam com movimentos já registrados (mesmo valor, data próxima) e confirme. Sugerir não concilia: só a sua confirmação grava o vínculo.</p>
      <div className="w-64"><Campo rotulo="Conta">{(p) => <select {...p} value={conta ?? ''} onChange={(e) => setContaId(e.target.value)} className={CAMPO}>{ativas.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Campo></div>

      <section className="space-y-2 rounded-lg border border-grafite-elevado bg-grafite p-4" aria-label="Importar extrato">
        <Campo rotulo="Extrato (uma linha por lançamento: AAAA-MM-DD;descrição;valor, com valor negativo para saídas)">
          {(p) => <textarea {...p} rows={4} value={colado} onChange={(e) => setColado(e.target.value)} placeholder={'2026-10-21;PIX recebido;1.234,56\n2026-10-22;Tarifa;-9,90'} className={`${CAMPO} font-mono text-xs`} />}
        </Campo>
        {erros.length > 0 && <Aviso tom="erro" titulo="Revise o extrato colado"><ul className="list-disc pl-4">{erros.slice(0, 6).map((e) => <li key={e}>{e}</li>)}{erros.length > 6 && <li>e mais {erros.length - 6}</li>}</ul></Aviso>}
        <div className="flex justify-end"><button type="button" onClick={() => void enviar()} disabled={importar.isPending || !colado.trim()} className={BOTAO}>{importar.isPending ? 'Importando…' : 'Importar extrato'}</button></div>
      </section>

      {sug.isPending ? <Carregando linhas={3} /> : sug.isError ? <InlineSectionError message="Não conseguimos carregar o extrato." onRetry={() => void sug.refetch()} /> : linhas.length === 0 ? (
        <Vazio titulo="Nenhuma linha de extrato pendente">Importe o extrato acima. Linhas já conciliadas saem desta lista.</Vazio>
      ) : (
        <Tabela legenda="Linhas de extrato pendentes de conciliação">
          <thead><tr className="border-b border-grafite-elevado"><th className={TH}>Data</th><th className={TH}>Descrição</th><th className={TH_DIREITA}>Valor</th><th className={TH}>Sugestão</th><th className={TH}><span className="sr-only">Ação</span></th></tr></thead>
          <tbody>{linhas.map((l) => {
            const s = sugestaoDe(l.id);
            return (
              <tr key={l.id} className="border-t border-grafite-elevado/60">
                <td className={`${TD} whitespace-nowrap tabular-nums`}>{formatarDia(l.postedOn)}</td>
                <td className={TD}>{l.description}</td>
                <td className={`${TD} text-right`}><Dinheiro centavos={l.amountCents} /></td>
                <td className={TD}>{s?.movimentoId ? <Selo classe="bg-sucesso/15 text-sucesso">Combina com um movimento{s.diasDeDiferenca ? ` (${s.diasDeDiferenca} ${s.diasDeDiferenca === 1 ? 'dia' : 'dias'} de diferença)` : ''}</Selo> : s?.ambigua ? <Selo classe="bg-aviso/15 text-aviso">Mais de um movimento serve: não escolho por você</Selo> : <span className="text-xs text-nevoa">Sem movimento correspondente</span>}</td>
                <td className={`${TD} text-right`}>{s?.movimentoId && <button type="button" disabled={conciliar.isPending} onClick={() => conciliar.mutate({ linhaId: l.id, ledgerId: s.movimentoId! }, { onSuccess: () => { setFeitas((f) => [l, ...f]); toast('Conciliado.', 'success'); }, onError: (x) => toast(mensagemDeErro(x), 'error') })} className={`${BOTAO} px-2 py-1 text-xs`}>Confirmar</button>}</td>
              </tr>
            );
          })}</tbody>
        </Tabela>
      )}

      {feitas.length > 0 && (
        <section aria-label="Conciliadas nesta sessão" className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-nevoa">Conciliadas agora (dá para desfazer)</h2>
          <ul className="space-y-1">{feitas.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 rounded-md border border-grafite-elevado px-3 py-2 text-sm">
              <span>{formatarDia(l.postedOn)} · {l.description} · <Dinheiro centavos={l.amountCents} /></span>
              <button type="button" disabled={desfazer.isPending} onClick={() => desfazer.mutate(l.id, { onSuccess: () => { setFeitas((f) => f.filter((x) => x.id !== l.id)); toast('Conciliação desfeita.', 'success'); }, onError: (x) => toast(mensagemDeErro(x), 'error') })} className={`${BOTAO_SECUNDARIO} px-2 py-1 text-xs`}>Desfazer</button>
            </li>
          ))}</ul>
        </section>
      )}
    </div>
  );
}
