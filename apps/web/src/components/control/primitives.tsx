import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * As primitivas do CONTROL PLANE.
 *
 * Existem separadas das de `components/ui` por uma diferença de propósito, não
 * de gosto: o `PageHeader` de lá abre a tela com um banner de vídeo, que é
 * certo pra uma tela que alguém visita, e errado pra uma que alguém MONITORA.
 * Aqui a regra é densidade: cabeçalho de duas linhas, borda fina, sombra
 * nenhuma, e o espaço sobrando vira dado.
 *
 * O que NÃO muda: os tokens. Tudo abaixo usa carbono/grafite/nevoa/sinal e os
 * semânticos sucesso/aviso/erro que já existem em styles/tokens.css. Um Control
 * Plane com paleta própria seria um segundo produto dentro do produto.
 */

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

/**
 * A logo do Claude, do arquivo que já existe no projeto:
 * `apps/web/public/providers/claude.png` (320x320), servido em
 * `/providers/claude.png` e já usado pelo card de providers do motion.
 *
 * Existe como componente por um motivo prático: o Control Plane mostra essa
 * logo em seis lugares (conexão MCP, usuários conectados, feed de atividade,
 * integrações, CTA de conectar, detalhe de conexão), e seis `<Image>` soltos
 * viram seis tamanhos diferentes na primeira vez que alguém mexer num deles.
 *
 * O arquivo original não é alterado, redesenhado nem substituído por SVG.
 */
export function ClaudeMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/providers/claude.png"
      alt="Claude"
      width={size}
      height={size}
      className={cn('shrink-0 rounded-[4px]', className)}
      // 320x320 de origem: em 20-40px a densidade sobra, e `unoptimized` evita
      // uma rota de otimização pra um asset que já é pequeno e estático.
      unoptimized
    />
  );
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

export type Estado = 'ok' | 'atencao' | 'erro' | 'desconhecido';

const CORES: Record<Estado, { ponto: string; texto: string }> = {
  ok: { ponto: 'bg-sucesso', texto: 'text-sucesso' },
  atencao: { ponto: 'bg-aviso', texto: 'text-aviso' },
  erro: { ponto: 'bg-erro', texto: 'text-erro' },
  // Cinza, e não verde: "não sei" nunca pode parecer "está bom". É a mesma
  // regra que vale pro que o Bento responde.
  desconhecido: { ponto: 'bg-nevoa/50', texto: 'text-nevoa' },
};

export function StatusDot({ estado, className }: { estado: Estado; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        CORES[estado].ponto,
        estado === 'erro' && 'animate-pulse',
        className,
      )}
    />
  );
}

export function StatusLabel({ estado, children }: { estado: Estado; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 font-mono text-xs', CORES[estado].texto)}>
      <StatusDot estado={estado} />
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Cabeçalho e seções
// ---------------------------------------------------------------------------

export function ControlHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-grafite-elevado pb-5">
      <div className="min-w-0">
        <h1 className="font-heading text-xl font-semibold tracking-tight text-branco-cru">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-nevoa">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Secao({
  titulo,
  acao,
  children,
  className,
}: {
  titulo: string;
  acao?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('mb-8', className)}>
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-nevoa">{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tabela densa
// ---------------------------------------------------------------------------

export function Tabela({ children, className }: { children: React.ReactNode; className?: string }) {
  // O wrapper com overflow é o que impede a tabela de empurrar a sidebar em
  // telas menores — requisito de "tablet e laptop pequeno sem quebrar".
  return (
    <div className={cn('overflow-x-auto rounded-lg border border-grafite-elevado bg-grafite', className)}>
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'border-b border-grafite-elevado px-3 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-nevoa',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn('border-b border-grafite-elevado/60 px-3 py-2.5 text-branco-cru', className)}>{children}</td>;
}

// ---------------------------------------------------------------------------
// Cartão de estado compacto
// ---------------------------------------------------------------------------

export function CartaoDeEstado({
  rotulo,
  valor,
  estado,
  detalhe,
}: {
  rotulo: string;
  valor: string;
  estado: Estado;
  detalhe?: string | undefined;
}) {
  return (
    <div className="rounded-lg border border-grafite-elevado bg-grafite px-3.5 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-nevoa">{rotulo}</p>
      <p className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-branco-cru">
        <StatusDot estado={estado} />
        {valor}
      </p>
      {detalhe && <p className="mt-0.5 truncate font-mono text-[11px] text-nevoa">{detalhe}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ausência honesta
// ---------------------------------------------------------------------------

export function SemNadaAinda({
  titulo,
  explicacao,
  acao,
}: {
  titulo: string;
  explicacao: string;
  acao?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-grafite-elevado bg-grafite px-5 py-10 text-center">
      <p className="font-heading text-base font-semibold text-branco-cru">{titulo}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-nevoa">{explicacao}</p>
      {acao && <div className="mt-4 flex justify-center">{acao}</div>}
    </div>
  );
}

export function LinhasFantasma({ linhas = 5 }: { linhas?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-md bg-grafite-elevado/60" />
      ))}
    </div>
  );
}
