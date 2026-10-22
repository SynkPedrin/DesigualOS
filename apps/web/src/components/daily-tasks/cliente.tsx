'use client';

import { useMemo } from 'react';
import { EntityAvatar } from '@/components/ui/entity-avatar';
import { useWorkTree } from '@/hooks/use-work';
import { logoDoCliente } from '@/lib/client-logos';
import { cn } from '@/lib/utils';

/** Índice lista → nomes (lista, espaço, pasta), para mostrar o cliente da tarefa sem chamar a API por linha. */
export function useListIndex() {
  const tree = useWorkTree();
  return useMemo(() => {
    const m = new Map<string, { nome: string; espaco: string; pasta: string | null }>();
    for (const s of tree.data?.spaces ?? []) for (const l of s.lists) m.set(l.id, { nome: l.name, espaco: s.name, pasta: s.folders.find((f) => f.id === l.folderId)?.name ?? null });
    return m;
  }, [tree.data]);
}

/**
 * Logo REAL do cliente, a mesma do resto do app (`client-logos.ts`, casada por nome IGUAL). Lista que não é
 * de um cliente com logo não mostra nada — nunca iniciais de coisa que não é marca, nunca logo adivinhado.
 */
export function LogoDoCliente({ nome, className }: { nome: string | null | undefined; className?: string }) {
  if (!nome || !logoDoCliente(nome)) return null;
  return <EntityAvatar name={nome} kind="client" size="sm" className={cn('!size-5', className)} />;
}

/** Nome do cliente sem a etiqueta "[EX-CLIENTE 2026-08-14]" que o ClickUp colocava no nome da lista. */
export function nomeLimpo(nome: string): string {
  return nome.replace(/^\s*\[[^\]]*\]\s*/, '').trim() || nome;
}
