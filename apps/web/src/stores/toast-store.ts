import { create } from 'zustand';

export interface ToastItem {
  id: number;
  message: string;
  variant: 'success' | 'error' | 'info';
}

interface ToastState {
  toasts: ToastItem[];
  push: (message: string, variant?: ToastItem['variant']) => void;
  dismiss: (id: number) => void;
}

let toastSeq = 0;

/** Mínimo sistema de toast do app (não existia nenhum): store global + <Toaster />
 * montado onde o feedback é usado (Studio, workspace do cliente). */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, variant = 'info') => {
    toastSeq += 1;
    const id = toastSeq;
    set((state) => ({ toasts: [...state.toasts, { id, message, variant }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    }, 4500);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

export function toast(message: string, variant: ToastItem['variant'] = 'info') {
  useToastStore.getState().push(message, variant);
}
