import { create } from 'zustand';

const SIDEBAR_KEY = 'desigual-os:sidebar-collapsed';

function lerSidebarSalva(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

function salvarSidebar(colapsada: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_KEY, colapsada ? '1' : '0');
  } catch {
    // Storage bloqueado (janela privada): a barra só não lembra, segue funcionando.
  }
}

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  /** Lê a preferência salva. Roda depois do mount: no servidor não há storage, e
   * ler no estado inicial faria o HTML do SSR divergir do cliente. */
  hidratarSidebar: () => void;
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
  toggleSidebar: () =>
    set((state) => {
      const proxima = !state.sidebarCollapsed;
      salvarSidebar(proxima);
      return { sidebarCollapsed: proxima };
    }),
  hidratarSidebar: () => set({ sidebarCollapsed: lerSidebarSalva() }),
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
