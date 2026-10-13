'use client';

import { useEffect, useState } from 'react';
import { Download, FileText, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * PRÉVIA DE ANEXO — ver o arquivo sem sair da conversa.
 *
 * O que existia: imagem aparecia como miniatura (bom) e QUALQUER outro arquivo
 * virava um ícone genérico com o nome ao lado. Abrir um briefing em PDF exigia
 * clicar, trocar de aba, ler, e voltar — e quem está no meio de um turno de
 * chat perde o fio nesse caminho. "Ícone com nome" não é prévia: é um link
 * disfarçado.
 *
 * O QUE ESTE COMPONENTE FAZ, e o que deliberadamente NÃO faz:
 *
 *   imagem  → abre em tamanho real sobre a tela;
 *   PDF     → abre num `iframe`, que o navegador já sabe renderizar nativamente
 *             — sem pdf.js, sem dependência nova, sem worker;
 *   resto   → diz que não tem prévia e oferece baixar. Honestidade em vez de
 *             uma caixa cinza fingindo que carregou.
 *
 * Não existe geração de miniatura de .docx/.xlsx aqui, e isso é escolha: faria
 * o navegador baixar e parsear binário pesado para mostrar uma imagem que o
 * sistema não tem como garantir fiel. Melhor dizer "baixe" do que mostrar algo
 * que pode estar errado.
 */

export interface AnexoParaPrevia {
  url: string;
  filename: string | null;
  contentType: string | null;
}

export function temPrevia(contentType: string | null): boolean {
  if (!contentType) return false;
  return contentType.startsWith('image/') || contentType === 'application/pdf';
}

export function PreviaDeAnexo({ anexo, onClose }: { anexo: AnexoParaPrevia; onClose: () => void }) {
  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', aoTeclar);
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = overflowAnterior;
    };
  }, [onClose]);

  const ehImagem = anexo.contentType?.startsWith('image/') ?? false;
  const ehPdf = anexo.contentType === 'application/pdf';
  const nome = anexo.filename ?? 'arquivo';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Prévia de ${nome}`}
      onClick={onClose}
      className="fixed inset-0 z-[110] flex flex-col items-center justify-center gap-3 bg-carbono/90 p-4 backdrop-blur-sm"
    >
      <div className="flex w-full max-w-4xl items-center justify-between gap-4">
        <p className="truncate font-mono text-[11px] text-nevoa" title={nome}>
          {nome}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <a
            href={anexo.url}
            download={nome}
            target="_blank"
            rel="noreferrer"
            onClick={(evento) => evento.stopPropagation()}
            aria-label="Baixar"
            className="flex size-8 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite hover:text-branco-cru"
          >
            <Download size={16} />
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar prévia"
            className="flex size-8 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-grafite hover:text-branco-cru"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div
        onClick={(evento) => evento.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-4xl flex-1 items-center justify-center overflow-hidden rounded-lg border border-grafite-elevado bg-grafite"
      >
        {ehImagem ? (
          // `img` cru, não next/image: a origem é Storage com URL assinada e
          // dimensão desconhecida — otimizar exigiria saber o tamanho antes.
          <img src={anexo.url} alt={nome} className="max-h-[80vh] w-auto object-contain" />
        ) : ehPdf ? (
          <iframe src={anexo.url} title={`Prévia de ${nome}`} className="h-[80vh] w-full border-0 bg-branco-cru" />
        ) : (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <FileText size={28} className="text-nevoa" />
            <p className="text-sm text-branco-cru">Este tipo de arquivo não abre aqui</p>
            <p className="max-w-sm text-[13px] text-nevoa">
              Dá para baixar e abrir no programa certo. Preferimos dizer isso a mostrar uma prévia que pode não ser
              fiel ao arquivo.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * O gatilho: envolve o que já era mostrado (miniatura ou linha com ícone) e
 * acrescenta o clique que abre a prévia. Quem não tem prévia continua indo
 * para a aba nova, como antes — nada regride.
 */
export function AbrirPrevia({
  anexo,
  className,
  children,
}: {
  anexo: AnexoParaPrevia;
  className?: string;
  children: React.ReactNode;
}) {
  const [aberta, setAberta] = useState(false);

  if (!temPrevia(anexo.contentType)) {
    return (
      <a href={anexo.url} target="_blank" rel="noreferrer" className={className}>
        {children}
      </a>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setAberta(true)} className={cn('text-left', className)}>
        {children}
      </button>
      {aberta && <PreviaDeAnexo anexo={anexo} onClose={() => setAberta(false)} />}
    </>
  );
}
