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

/** Autosave chama isto - sempre parcial, com debounce feito por quem chama (ver canva-editor.tsx). */
export function useUpdateCanvaDocument(documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: { name?: string; width?: number; height?: number; thumbnailUrl?: string | null; pages?: CanvaPage[] }) =>
      mapCanvaDocument(
        await apiFetch<CanvaDocumentWire>(`/studio/canvas-documents/${documentId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.width !== undefined ? { width: patch.width } : {}),
            ...(patch.height !== undefined ? { height: patch.height } : {}),
            ...(patch.thumbnailUrl !== undefined ? { thumbnail_url: patch.thumbnailUrl } : {}),
            ...(patch.pages !== undefined ? { pages: patch.pages } : {}),
          }),
        }),
      ),
    onSuccess: (doc) => {
      queryClient.setQueryData(DOC_KEY(documentId), doc);
      void queryClient.invalidateQueries({ queryKey: LIST_KEY(doc.clientId) });
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

export function useDeleteCanvaDocument(clientId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => apiFetch<void>(`/studio/canvas-documents/${documentId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LIST_KEY(clientId) });
    },
  });
}

export type { CanvaDocument, CanvaDocumentSummary };
