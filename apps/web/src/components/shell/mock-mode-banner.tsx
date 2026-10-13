'use client';

const API_MODE = process.env.NEXT_PUBLIC_API_MODE ?? 'mock';

/**
 * Aviso discreto e sempre visível de que o app está servindo dados fictícios via MSW
 * (NEXT_PUBLIC_API_MODE não setado como 'live'). Existe pra ninguém confundir uma tela
 * cheia de dados de mentira com o sistema real - inclusive em produção, se a env var
 * de alguém esquecer de ser configurada (ver aviso no console em msw-provider.tsx).
 */
export function MockModeBanner() {
  if (API_MODE !== 'mock') return null;

  // Canto, não centralizado: precisa continuar honesto e sempre visível, mas
  // um aviso flutuando no meio da tela por cima do conteúdo lia como "isto é
  // uma demo" — o efeito contrário do que o produto precisa passar no dia a
  // dia de quem usa de verdade.
  //
  /**
   * AO LADO DO BOTÃO DO BENTO, não acima dele.
   *
   * Duas posições erradas antes desta, e a segunda foi minha: os dois nasceram
   * no mesmo canto inferior direito e se espremiam; subir o aviso resolveu
   * isso e criou outra colisão, porque `bottom-[6.75rem] right-6` é exatamente
   * onde o PAINEL do Bento abre — o aviso, num z-index muito maior, passava a
   * cobrir o canto do painel aberto.
   *
   * À esquerda do botão (`right-28` = 112px, contra os 88px que o botão ocupa)
   * fica livre dos dois: abaixo do painel, ao lado do botão.
   */
  return (
    <div className="pointer-events-none fixed bottom-7 right-28 z-[120]">
      {/*
        * O RÓTULO SOZINHO NÃO ERA SUFICIENTE (07/10/2026): alguém trocou a foto
        * de perfil três vezes, viu ela sumir a cada F5 e foi reportar como
        * defeito do produto — com este aviso na tela o tempo todo. "Dados
        * fictícios" descreve o ESTADO; não diz a consequência, que é a única
        * coisa que importa pra quem está tentando usar o sistema: nada do que
        * você fizer vai ser salvo.
        */}
      <div
        title="O app está servindo dados de demonstração (MSW). Nada do que você fizer aqui é salvo: foto de perfil, convites e mensagens somem no próximo carregamento. Para usar de verdade, rode com NEXT_PUBLIC_API_MODE=live."
        className="pointer-events-auto flex items-center gap-1.5 rounded-md border border-aviso/40 bg-carbono/90 px-2.5 py-1 font-mono text-[10px] text-aviso shadow-elevated backdrop-blur"
      >
        <span className="size-1.5 shrink-0 rounded-full bg-aviso" />
        Dados fictícios · nada é salvo
      </div>
    </div>
  );
}
