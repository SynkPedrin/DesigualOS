import { ABAS_COMERCIAL, SecaoLayout } from '@/components/gestao-empresarial/secao';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <SecaoLayout rotulo="Comercial" abas={ABAS_COMERCIAL}>{children}</SecaoLayout>;
}
