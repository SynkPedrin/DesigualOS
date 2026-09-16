import { Fragment } from 'react';

/** Small, dependency-free renderer for the subset of markdown agent replies use: **bold**,
 * `code`, and "- " bullet lists. Not a full markdown parser, intentionally.
 *
 * Emoji não recebe tratamento nenhum aqui de propósito: é texto, e legenda real
 * de rede social usa emoji. Nada no caminho de renderização os remove. */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={key} className="font-semibold text-branco-cru">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={key} className="rounded bg-carbono px-1.5 py-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

export function MarkdownLite({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);

  return (
    <div className="space-y-3">
      {blocks.map((block, blockIndex) => {
        const lines = block.split('\n').filter(Boolean);
        const isList = lines.every((line) => line.trim().startsWith('- '));

        if (isList) {
          return (
            <ul key={blockIndex} className="list-disc space-y-1 pl-5">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{renderInline(line.replace(/^- /, ''), `${blockIndex}-${lineIndex}`)}</li>
              ))}
            </ul>
          );
        }

        // `whitespace-pre-line` preserva a QUEBRA DE LINHA simples dentro do
        // parágrafo. Sem isso o HTML colapsa `\n` em espaço e uma legenda de
        // Instagram — que é escrita em linhas curtas, com respiro entre elas —
        // chegava na tela como parágrafo corrido. Quem copiava recebia o texto
        // certo do clipboard e a forma errada na tela, então revisava no escuro.
        // Espaço repetido continua colapsando; só a quebra sobrevive.
        return (
          <p key={blockIndex} className="whitespace-pre-line">
            {renderInline(block, `${blockIndex}`)}
          </p>
        );
      })}
    </div>
  );
}
