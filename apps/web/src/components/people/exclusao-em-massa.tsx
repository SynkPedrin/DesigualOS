'use client';

import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * EXCLUSÃO EM MASSA DA EQUIPE (pedido do Pedro, 08/10/2026): selecionar várias
 * contas e apagar de uma vez, com a mesma trava de "digite a palavra" que
 * ferramentas como GoHighLevel usam pra ação destrutiva em lote — um clique
 * duplo (como o botão único de exclusão individual já tinha) não é fricção
 * suficiente quando o lote pode ter o nome errado dentro.
 *
 * A comparação ignora maiúscula/minúscula e acento ("Excluir", "EXCLUIR",
 * "exclür" de dedo errado em teclado ABNT não entra aqui, mas "éxcluir" sim) —
 * só a PALAVRA precisa bater, não a pontuação exata de quem digita rápido.
 */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

const PALAVRA_DE_CONFIRMACAO = 'excluir';

export function BarraDeSelecao({
  quantidade,
  onLimpar,
  onExcluir,
}: {
  quantidade: number;
  onLimpar: () => void;
  onExcluir: () => void;
}) {
  if (quantidade === 0) return null;

  return (
    <div className="sticky top-0 z-20 mb-4 flex items-center justify-between gap-3 rounded-lg border border-erro/40 bg-grafite px-4 py-3 shadow-lg">
      <p className="text-sm text-branco-cru">
        <span className="font-semibold">{quantidade}</span> {quantidade === 1 ? 'pessoa selecionada' : 'pessoas selecionadas'}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onLimpar}
          className="rounded-md border border-grafite-elevado px-3 py-1.5 text-[13px] text-nevoa hover:text-branco-cru"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onExcluir}
          className="flex items-center gap-1.5 rounded-md bg-erro px-3 py-1.5 text-[13px] font-semibold text-branco-cru hover:opacity-90"
        >
          <Trash2 size={13} />
          Deletar selecionados ({quantidade})
        </button>
      </div>
    </div>
  );
}

export function ModalDeConfirmacaoDeExclusao({
  quantidade,
  nomes,
  excluindo,
  erro,
  onConfirmar,
  onCancelar,
}: {
  quantidade: number;
  /** Até alguns nomes, pra quem confirma saber exatamente quem está apagando — nunca só um número. */
  nomes: string[];
  excluindo: boolean;
  erro: string | null;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const [digitado, setDigitado] = useState('');
  const correto = normalizar(digitado) === PALAVRA_DE_CONFIRMACAO;
  const temTexto = digitado.trim().length > 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-carbono/80 p-4" onClick={excluindo ? undefined : onCancelar}>
      <div
        className="w-full max-w-md rounded-lg border border-erro/40 bg-grafite p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-base font-semibold text-branco-cru">Excluir permanentemente</h2>
          <button type="button" onClick={onCancelar} disabled={excluindo} className="text-nevoa hover:text-branco-cru disabled:opacity-40">
            <X size={16} />
          </button>
        </div>

        <p className="text-sm text-nevoa">
          Isto apaga {quantidade === 1 ? 'a conta de' : `${quantidade} contas`}{' '}
          {nomes.length > 0 && (
            <span className="text-branco-cru">
              {nomes.slice(0, 3).join(', ')}
              {nomes.length > 3 ? ` e mais ${nomes.length - 3}` : ''}
            </span>
          )}{' '}
          para sempre. Não tem como desfazer.
        </p>

        <label className="mt-4 block text-[13px] text-nevoa" htmlFor="confirmacao-exclusao">
          Digite <span className="font-mono font-semibold text-branco-cru">excluir</span> para confirmar
        </label>
        <input
          id="confirmacao-exclusao"
          autoFocus
          value={digitado}
          onChange={(e) => setDigitado(e.target.value)}
          disabled={excluindo}
          className={cn(
            'mt-1.5 w-full rounded-md border bg-carbono px-3 py-2 text-sm font-mono focus:outline-none disabled:opacity-60',
            temTexto ? (correto ? 'border-sucesso text-sucesso' : 'border-erro text-erro') : 'border-grafite-elevado text-branco-cru',
          )}
          placeholder="excluir"
        />

        {erro && (
          <div className="mt-3 rounded-md border border-erro/40 bg-erro/5 px-3 py-2">
            {erro.split('\n').map((linha, i) => (
              <p key={i} className="text-[13px] text-erro">
                {linha}
              </p>
            ))}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            disabled={excluindo}
            className="rounded-md px-3 py-2 text-sm text-nevoa hover:text-branco-cru disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!correto || excluindo}
            onClick={onConfirmar}
            className="rounded-md bg-erro px-4 py-2 text-sm font-semibold text-branco-cru transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {excluindo ? 'Excluindo…' : 'Excluir permanentemente'}
          </button>
        </div>
      </div>
    </div>
  );
}
