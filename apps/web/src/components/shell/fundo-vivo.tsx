/**
 * As luzes de fundo da área logada (ver "FUNDO VIVO" em tokens.css). Ficam atrás de tudo e não recebem clique; os
 * cartões são levemente translúcidos para a luz aparecer por baixo sem atrapalhar a leitura.
 */
export function FundoVivo() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="luz-de-fundo luz-de-fundo-a -left-[10vw] -top-[18vh] h-[60vh] w-[50vw] bg-roxo-eletrico/30" />
      <div className="luz-de-fundo luz-de-fundo-b -bottom-[22vh] -right-[8vw] h-[55vh] w-[42vw] bg-sinal/[0.13]" />
      <div className="luz-de-fundo luz-de-fundo-c left-[38vw] top-[30vh] h-[45vh] w-[34vw] bg-magenta-spark/[0.16]" />
    </div>
  );
}
