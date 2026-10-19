'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * A COLUNA DO BENTO QUE FALTAVA EM QUATRO TELAS.
 *
 * Os mockups de Hoje, Visão geral, Pipeline e Integrações têm, cada um, um
 * bloco em que o Bento comenta o que está acontecendo ali. Nenhuma das nossas
 * telas tinha isso (levantado pela desigualos-f9 em 09/10/2026, comparando
 * print a print). Como o bloco se repete em quatro lugares com a mesma forma
 * e conteúdos diferentes, ele mora aqui uma vez só.
 *
 * REGRA QUE SUSTENTA O COMPONENTE: ele RENDERIZA insight, nunca CALCULA.
 * Quem chama passa a lista já derivada das próprias consultas da tela. Se o
 * cálculo morasse aqui dentro, este arquivo teria que adivinhar o contexto de
 * cada tela, e adivinhação no lugar de número real é exatamente o que não
 * pode acontecer num painel que a pessoa usa pra decidir o dia.
 *
 * Lista vazia não vira texto animador genérico: vira a frase de vazio que a
 * tela passar, ou nada. O Bento calado é melhor que o Bento inventando.
 */

export type TomDeInsight = 'urgente' | 'atencao' | 'bom' | 'neutro';

const COR_DO_PONTO: Record<TomDeInsight, string> = {
  urgente: 'bg-erro',
  atencao: 'bg-aviso',
  bom: 'bg-sucesso',
  neutro: 'bg-roxo-eletrico',
};

export interface InsightDoBento {
  id: string;
  /** ReactNode, e não string, pra tela poder destacar o nome do cliente ou o
   *  número dentro da frase, como o mockup faz. */
  texto: React.ReactNode;
  tom?: TomDeInsight;
  /** Para onde o item leva. Sem href o item é leitura, não link morto. */
  href?: string;
}

function ItemDeInsight({ item }: { item: InsightDoBento }) {
  const corpo = (
    <>
      <span className={cn('mt-[7px] size-1.5 shrink-0 rounded-full', COR_DO_PONTO[item.tom ?? 'neutro'])} />
      <span className="min-w-0 flex-1 text-sm leading-relaxed text-branco-cru/90">{item.texto}</span>
    </>
  );

  if (item.href) {
    return (
      <li>
        <Link href={item.href} className="flex gap-2.5 rounded-md transition-colors hover:text-branco-cru">
          {corpo}
        </Link>
      </li>
    );
  }
  return <li className="flex gap-2.5">{corpo}</li>;
}

function Assinatura({ titulo, subtitulo }: { titulo: string; subtitulo: string }) {
  return (
    <div className="flex items-center gap-3">
      <Image src="/agents/bento.png" alt="" width={44} height={44} className="size-11 shrink-0 rounded-xl" unoptimized />
      <div className="min-w-0">
        <p className="font-heading text-base font-semibold text-branco-cru">{titulo}</p>
        <p className="truncate text-xs text-nevoa">{subtitulo}</p>
      </div>
    </div>
  );
}

/**
 * Formato LARGO, pro topo da tela (mockup do Hoje): assinatura à esquerda,
 * insights no meio, ação à direita.
 */
export function BentoBriefing({
  subtitulo = 'Seu briefing do dia',
  itens,
  carregando = false,
  vazio = 'Sem nada fora do lugar agora.',
  erro,
  acao,
}: {
  subtitulo?: string;
  itens: InsightDoBento[];
  carregando?: boolean;
  vazio?: string;
  /**
   * VAZIO E ERRO NÃO SÃO A MESMA COISA, e tratá-los igual foi um defeito real
   * (09/10/2026, tela de Tarefas): com `/clickup/tasks/agency` respondendo
   * 400, a lista de insights nascia vazia e o cartão anunciava "nenhuma
   * tarefa atrasada nem vencendo na semana". Isso afirma um fato que
   * NINGUÉM mediu. Quem não conseguiu ler precisa dizer que não conseguiu
   * ler, nunca dar a boa notícia por omissão.
   */
  erro?: string;
  acao?: { label: string; href: string };
}) {
  return (
    <Surface className="flex flex-col gap-5 bg-gradient-to-r from-roxo-eletrico/15 via-grafite to-grafite p-5 lg:flex-row lg:items-center lg:gap-8">
      <div className="lg:w-56 lg:shrink-0">
        <Assinatura titulo="Bento" subtitulo={subtitulo} />
      </div>

      <div className="min-w-0 flex-1">
        {carregando ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : erro ? (
          <p className="flex items-center gap-2 text-sm text-aviso">
            <span className="size-1.5 shrink-0 rounded-full bg-aviso" />
            {erro}
          </p>
        ) : itens.length === 0 ? (
          <p className="text-sm text-nevoa">{vazio}</p>
        ) : (
          <ul className="space-y-2">
            {itens.map((item) => (
              <ItemDeInsight key={item.id} item={item} />
            ))}
          </ul>
        )}
      </div>

      {acao && !carregando && (
        <Link
          href={acao.href}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-roxo-eletrico px-4 py-2.5 text-sm font-medium text-branco-cru transition-opacity hover:opacity-90"
        >
          {acao.label}
          <ArrowRight size={14} />
        </Link>
      )}
    </Surface>
  );
}

/**
 * Formato COLUNA, pra lateral direita (mockups de Visão geral e Pipeline).
 * Mesmo conteúdo, empilhado, com cada insight em seu próprio cartão.
 */
export function BentoInsights({
  titulo = 'Recomendações do Bento',
  subtitulo = 'A partir do que está nesta tela',
  itens,
  carregando = false,
  vazio = 'Nada a recomendar com os dados de agora.',
  erro,
  acao,
}: {
  titulo?: string;
  subtitulo?: string;
  itens: InsightDoBento[];
  carregando?: boolean;
  vazio?: string;
  /** Mesma distinção do `BentoBriefing`: não conseguir ler é diferente de ler
   *  e não achar nada, e só um dos dois é boa notícia. */
  erro?: string;
  acao?: { label: string; href: string };
}) {
  return (
    <Surface className="flex flex-col gap-4 p-5">
      <Assinatura titulo={titulo} subtitulo={subtitulo} />

      {carregando ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : erro ? (
        <p className="flex items-center gap-2 py-2 text-sm text-aviso">
          <span className="size-1.5 shrink-0 rounded-full bg-aviso" />
          {erro}
        </p>
      ) : itens.length === 0 ? (
        <p className="py-4 text-center text-sm text-nevoa">{vazio}</p>
      ) : (
        <ul className="space-y-2">
          {itens.map((item) => (
            <li key={item.id}>
              {item.href ? (
                <Link
                  href={item.href}
                  className="flex gap-2.5 rounded-lg border border-grafite-elevado bg-carbono/40 p-3 transition-colors hover:border-roxo-eletrico/60"
                >
                  <span className={cn('mt-[7px] size-1.5 shrink-0 rounded-full', COR_DO_PONTO[item.tom ?? 'neutro'])} />
                  <span className="min-w-0 flex-1 text-sm leading-relaxed text-branco-cru/90">{item.texto}</span>
                </Link>
              ) : (
                <div className="flex gap-2.5 rounded-lg border border-grafite-elevado bg-carbono/40 p-3">
                  <span className={cn('mt-[7px] size-1.5 shrink-0 rounded-full', COR_DO_PONTO[item.tom ?? 'neutro'])} />
                  <span className="min-w-0 flex-1 text-sm leading-relaxed text-branco-cru/90">{item.texto}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {acao && !carregando && itens.length > 0 && (
        <Link
          href={acao.href}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-grafite-elevado py-2 font-mono text-[11px] text-nevoa transition-colors hover:text-branco-cru"
        >
          {acao.label}
          <ArrowRight size={11} />
        </Link>
      )}
    </Surface>
  );
}
