import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import {
  mapCanvaDocument,
  mapCanvaDocumentSummary,
  type CanvaDocument,
  type CanvaDocumentSummary,
} from '@/lib/api/contracts';
import type { CanvaDocumentSummaryWire, CanvaDocumentWire, CanvaPage } from '@desigual-os/types';

const LIST_KEY = (clientId: string | null) => ['studio', 'canvas-documents', clientId] as const;
const DOC_KEY = (id: string) => ['studio', 'canvas-document', id] as const;

export function useCanvaDocuments(clientId: string | null) {
  return useQuery({
    queryKey: LIST_KEY(clientId),
    queryFn: async () => {
      const wire = await apiFetch<{ documents: CanvaDocumentSummaryWire[] }>(
        `/studio/canvas-documents?client_id=${encodeURIComponent(clientId ?? '')}`,
      );
      return wire.documents.map(mapCanvaDocumentSummary);
    },
    enabled: Boolean(clientId),
  });
}

export function useCanvaDocument(documentId: string | null) {
  return useQuery({
    queryKey: DOC_KEY(documentId ?? ''),
    queryFn: async () => mapCanvaDocument(await apiFetch<CanvaDocumentWire>(`/studio/canvas-documents/${documentId}`)),
    enabled: Boolean(documentId),
  });
}

export function useCreateCanvaDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; name: string; width: number; height: number; projectId?: string | null }) =>
      mapCanvaDocument(
        await apiFetch<CanvaDocumentWire>('/studio/canvas-documents', {
          method: 'POST',
          body: JSON.stringify({
            client_id: input.clientId,
            name: input.name,
            width: input.width,
            height: input.height,
            project_id: input.projectId ?? null,
          }),
        }),
      ),
    onSuccess: (doc) => {
      void queryClient.invalidateQueries({ queryKey: LIST_KEY(doc.clientId) });
    },
  });
}

/**
 * `keepalive` tem teto de 64KB de corpo em todo navegador. Um desenho com
 * muitas camadas passa disso fácil, e aí a requisição falha INTEIRA em vez de
 * sobreviver ao descarregamento - pior que não pedir keepalive. Abaixo do
 * teto (com folga) o envio sobrevive ao F5; acima, vai como requisição comum
 * e tem a chance que o navegador der.
 */
const TETO_KEEPALIVE_BYTES = 60_000;

function podeUsarKeepalive(patch: { keepalive?: boolean; pages?: CanvaPage[] }): boolean {
  if (!patch.keepalive) return false;
  if (!patch.pages) return true;
  return new Blob([JSON.stringify(patch.pages)]).size <= TETO_KEEPALIVE_BYTES;
}

/** Autosave chama isto - sempre parcial, com debounce feito por quem chama (ver canva-editor.tsx). */
export function useUpdateCanvaDocument(documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: {
      name?: string;
      width?: number;
      height?: number;
      thumbnailUrl?: string | null;
      pages?: CanvaPage[];
      /** Salvamento disparado no descarregamento da página: pede ao navegador
       * para terminar o envio mesmo depois que o documento morreu. Sem isto a
       * requisição é cancelada no meio e a última edição se perde (ver o
       * comentário de lib/canva/autosave.ts). */
      keepalive?: boolean;
    }) => {
      // Concorrência otimista (§53). O workspace de um cliente é compartilhado
      // pela equipe toda, e este autosave grava o documento INTEIRO a cada
      // 1,5s - dois colaboradores com o mesmo design aberto se sobrescreviam
      // em silêncio, sem erro e sem forma de recuperar. Mandando a versão que
      // temos em mãos, o servidor recusa (409) em vez de apagar o trabalho do
      // outro. A versão sai do cache porque é lá que mora o último estado
      // confirmado PELO SERVIDOR - toda resposta de PATCH/GET a atualiza logo
      // abaixo, em onSuccess.
      const conhecido = queryClient.getQueryData<CanvaDocument>(DOC_KEY(documentId));
      return mapCanvaDocument(
        await apiFetch<CanvaDocumentWire>(`/studio/canvas-documents/${documentId}`, {
          method: 'PATCH',
          keepalive: podeUsarKeepalive(patch),
          body: JSON.stringify({
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.width !== undefined ? { width: patch.width } : {}),
            ...(patch.height !== undefined ? { height: patch.height } : {}),
            ...(patch.thumbnailUrl !== undefined ? { thumbnail_url: patch.thumbnailUrl } : {}),
            ...(patch.pages !== undefined ? { pages: patch.pages } : {}),
            ...(conhecido ? { version: conhecido.version } : {}),
          }),
        }),
      );
    },
    onSuccess: (doc) => {
      queryClient.setQueryData(DOC_KEY(documentId), doc);
      // Achado real (2026-09-11, "o Canva tá todo travado"): isto invalidava
      // a lista de designs a CADA autosave (a cada 1,5s de edição), o que
      // disparava um GET /studio/canvas-documents novo em cima do PATCH que
      // acabara de sair - dois requests por salvamento, disputando as 3
      // conexões do pool com o próprio autosave, upload de imagem e exclusão.
      // A lista só mostra nome/tamanho/thumbnail/data, e todos esses campos
      // vêm de volta na resposta do PATCH: dá pra atualizar o cache no lugar,
      // sem nenhuma ida à rede. Se o documento ainda não estiver na lista em
      // cache (ex: criado nesta sessão em outra aba), aí sim invalida.
      const listKey = LIST_KEY(doc.clientId);
      const cached = queryClient.getQueryData<CanvaDocumentSummary[]>(listKey);
      const index = cached?.findIndex((item) => item.id === doc.id) ?? -1;
      if (!cached || index === -1) {
        void queryClient.invalidateQueries({ queryKey: listKey });
        return;
      }
      const next = [...cached];
      next[index] = {
        ...cached[index]!,
        name: doc.name,
        width: doc.width,
        height: doc.height,
        thumbnailUrl: doc.thumbnailUrl,
        pageCount: doc.pages.length,
        updatedAt: doc.updatedAt,
      };
      queryClient.setQueryData(listKey, next);
    },
  });
}

export function useDuplicateCanvaDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string) =>
      mapCanvaDocument(await apiFetch<CanvaDocumentWire>(`/studio/canvas-documents/${documentId}/duplicate`, { method: 'POST' })),
    onSuccess: (doc) => {
      void queryClient.invalidateQueries({ queryKey: LIST_KEY(doc.clientId) });
    },
  });
}

/**
 * Exclusão otimista: o card some da tela no clique, não depois da ida e volta
 * ao servidor (achado real, 2026-09-11: "demora um século pra poder deletar
 * um projeto" - a lista só se atualizava depois do DELETE E de um GET novo da
 * lista inteira, dois requests em série contra um Postgres remoto). Se o
 * DELETE falhar, a lista anterior é restaurada e quem chamou mostra o erro.
 */
export function useDeleteCanvaDocument(clientId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => apiFetch<void>(`/studio/canvas-documents/${documentId}`, { method: 'DELETE' }),
    onMutate: async (documentId: string) => {
      const listKey = LIST_KEY(clientId);
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<CanvaDocumentSummary[]>(listKey);
      if (previous) {
        queryClient.setQueryData(
          listKey,
          previous.filter((item) => item.id !== documentId),
        );
      }
      return { previous };
    },
    onError: (_error, _documentId, context) => {
      if (context?.previous) queryClient.setQueryData(LIST_KEY(clientId), context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: LIST_KEY(clientId) });
    },
  });
}

export type { CanvaDocument, CanvaDocumentSummary };
