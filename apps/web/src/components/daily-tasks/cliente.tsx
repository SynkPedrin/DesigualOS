'use client';

import { useMemo } from 'react';
import { EntityAvatar } from '@/components/ui/entity-avatar';
import { useClients } from '@/hooks/use-clients';
import { useSpaceStatuses, useWorkTree, type WorkStatus } from '@/hooks/use-work';
import { logoDoCliente } from '@/lib/client-logos';
import { cn } from '@/lib/utils';

/** Índice lista → nomes (lista, espaço, pasta), para mostrar o cliente da tarefa sem chamar a API por linha. */
export function useListIndex() {
  const tree = useWorkTree();
  return useMemo(() => {
    const m = new Map<string, { nome: string; espaco: string; espacoId: string; pasta: string | null; clientId: string | null }>();
    for (const s of tree.data?.spaces ?? []) for (const l of s.lists) m.set(l.id, { nome: l.name, espaco: s.name, espacoId: s.id, pasta: s.folders.find((f) => f.id === l.folderId)?.name ?? null, clientId: l.clientId });
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

/** id do cliente → nome (para escrever "Colpar · Lista" sem perguntar à API por linha). */
export function useClientIndex() {
  const clientes = useClients().data;
  return useMemo(() => new Map((clientes ?? []).map((c) => [c.id, c.name])), [clientes]);
}

/** Status por espaço, para editar o status de tarefas de VÁRIOS espaços (Meu Trabalho, Calendário). */
export function useStatusesDoEspaco(espacoId: string | null): WorkStatus[] {
  return useSpaceStatuses(espacoId).data?.statuses ?? [];
}
