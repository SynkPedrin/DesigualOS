import { create } from 'zustand';

export interface RecentUpload {
  url: string;
  filename: string;
}

/** Compartilhado entre o painel "Uploads" e qualquer caminho que envie um
 * arquivo local pro Storage (upload manual, paste, drag do computador) - sem
 * isto, colar uma imagem (Ctrl/Cmd+V) nunca aparecia na lista de uploads
 * recentes, só o que passava pelo próprio botão de upload (pedido explícito
 * do usuário, 2026-09-11: "quando eu colar já atualiza no upload"). */
interface CanvaRecentUploadsState {
  recent: RecentUpload[];
  addRecent: (item: RecentUpload) => void;
}

const MAX_RECENT = 12;

export const useCanvaRecentUploadsStore = create<CanvaRecentUploadsState>((set) => ({
  recent: [],
  addRecent: (item) =>
    set((state) => ({ recent: [item, ...state.recent.filter((r) => r.url !== item.url)].slice(0, MAX_RECENT) })),
}));
