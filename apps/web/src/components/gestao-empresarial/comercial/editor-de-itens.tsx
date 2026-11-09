'use client';

import { Plus, Trash2 } from 'lucide-react';
import type { ItemDePropostaWire } from '@/hooks/use-gestao-comercial';
import { Campo, CampoDinheiro, CAMPO, BOTAO_SECUNDARIO, Dinheiro } from '../kit';

/** Item em edição: a chave local mantém cada linha estável ao inserir/remover (o campo de dinheiro guarda o próprio texto). */
export interface ItemEmEdicao {
  chave: string;
  description: string;
  quantity: number | null;
  unitPriceCents: number | null;
  discountCents: number | null;
}

let contador = 0;
export const novoItem = (de?: Partial<ItemDePropostaWire>): ItemEmEdicao => ({
  chave: `i${++contador}`,
  description: de?.description ?? '',
  quantity: de?.quantity ?? 1,
  unitPriceCents: de?.unitPriceCents ?? null,
  discountCents: de?.discountCents ?? 0,
});

/** O que a API aceita, ou `null` enquanto algum item estiver incompleto ou inválido. */
export function itensParaEnvio(itens: ItemEmEdicao[]): ItemDePropostaWire[] | null {
  const pronto: ItemDePropostaWire[] = [];
  for (const i of itens) {
    if (!i.description.trim() || i.quantity === null || i.quantity < 1 || !Number.isInteger(i.quantity) || i.unitPriceCents === null || i.unitPriceCents < 0 || i.discountCents === null || i.discountCents < 0) return null;
    if (i.discountCents > i.quantity * i.unitPriceCents) return null;
    pronto.push({ description: i.description.trim(), quantity: i.quantity, unitPriceCents: i.unitPriceCents, discountCents: i.discountCents });
  }
  return pronto;
}

export const totalDosItens = (itens: ItemDePropostaWire[]): number => itens.reduce((s, i) => s + i.quantity * i.unitPriceCents - i.discountCents, 0);

export function EditorDeItens({ itens, onChange, desabilitado = false }: { itens: ItemEmEdicao[]; onChange: (i: ItemEmEdicao[]) => void; desabilitado?: boolean }) {
  const muda = (chave: string, p: Partial<ItemEmEdicao>) => onChange(itens.map((i) => (i.chave === chave ? { ...i, ...p } : i)));
  const validos = itensParaEnvio(itens);
  return (
    <div className="space-y-3">
      {itens.length === 0 && <p className="text-sm text-nevoa">Nenhum item ainda. Uma proposta sem itens não pode ser enviada.</p>}
      {itens.map((i, n) => {
        const excede = i.quantity !== null && i.unitPriceCents !== null && i.discountCents !== null && i.discountCents > i.quantity * i.unitPriceCents;
        return (
          <fieldset key={i.chave} disabled={desabilitado} className="grid gap-2 rounded-md border border-grafite-elevado bg-carbono p-3 sm:grid-cols-[1fr_5rem_8rem_8rem_auto]">
            <legend className="sr-only">Item {n + 1}</legend>
            <Campo rotulo="Descrição">{(p) => <input {...p} value={i.description} maxLength={300} onChange={(e) => muda(i.chave, { description: e.target.value })} className={CAMPO} />}</Campo>
            <Campo rotulo="Qtd.">{(p) => <input {...p} type="number" min={1} step={1} value={i.quantity ?? ''} onChange={(e) => muda(i.chave, { quantity: e.target.value === '' ? null : Number(e.target.value) })} className={CAMPO} />}</Campo>
            <CampoDinheiro rotulo="Preço unitário" centavos={i.unitPriceCents} obrigatorio onChange={(c) => muda(i.chave, { unitPriceCents: c })} />
            <CampoDinheiro rotulo="Desconto" centavos={i.discountCents} obrigatorio onChange={(c) => muda(i.chave, { discountCents: c })} {...(excede && { ajuda: 'Maior que o valor da linha.' })} />
            <div className="flex items-end">
              <button type="button" aria-label={`Remover item ${n + 1}`} onClick={() => onChange(itens.filter((x) => x.chave !== i.chave))} className={`${BOTAO_SECUNDARIO} px-2`}><Trash2 size={14} /></button>
            </div>
          </fieldset>
        );
      })}
      <div className="flex items-center justify-between gap-3">
        <button type="button" disabled={desabilitado} onClick={() => onChange([...itens, novoItem()])} className={BOTAO_SECUNDARIO}><Plus size={14} /> Adicionar item</button>
        <p className="text-sm text-nevoa">Total: {validos ? <Dinheiro centavos={totalDosItens(validos)} className="font-heading text-lg font-semibold text-branco-cru" /> : <span>complete os itens</span>}</p>
      </div>
    </div>
  );
}
