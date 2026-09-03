import { Fragment } from 'react';

/** Small, dependency-free renderer for the subset of markdown agent replies use: **bold**,
 * `code`, and "- " bullet lists. Not a full markdown parser, intentionally. */
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

        return <p key={blockIndex}>{renderInline(block, `${blockIndex}`)}</p>;
      })}
    </div>
  );
}
