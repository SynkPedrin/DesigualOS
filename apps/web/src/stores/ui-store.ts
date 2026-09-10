import { create } from 'zustand';

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  /** Drawer da sidebar em telas < md (ver mobile-nav-drawer.tsx) - independente do
   * collapse de desktop, que não faz sentido num overlay que já fecha sozinho. */
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  toggleMobileNav: () => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  studioModalOpen: boolean;
  /** Abertura simples (sidebar/command palette) nunca arrasta um highlight antigo. */
  setStudioModalOpen: (open: boolean) => void;
  /** Peça da galeria que o Studio deve abrir direto (notificação de job concluído). */
  studioHighlightAsset: string | null;
  /** Clique em notificação do Studio: abre o POPUP (com a animação de entrada)
   * já na peça, em vez de navegar pra rota /studio. */
  openStudioWithAsset: (assetId: string | null) => void;
  clearStudioHighlight: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  mobileNavOpen: false,
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
  toggleMobileNav: () => set((state) => ({ mobileNavOpen: !state.mobileNavOpen })),
  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  studioModalOpen: false,
  setStudioModalOpen: (open) =>
    set(open ? { studioModalOpen: true, studioHighlightAsset: null } : { studioModalOpen: false }),
  studioHighlightAsset: null,
  openStudioWithAsset: (assetId) => set({ studioModalOpen: true, studioHighlightAsset: assetId }),
  clearStudioHighlight: () => set({ studioHighlightAsset: null }),
}));
