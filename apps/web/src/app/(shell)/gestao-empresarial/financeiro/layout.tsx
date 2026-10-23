import { ABAS_FINANCEIRO, SecaoLayout } from '@/components/gestao-empresarial/secao';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <SecaoLayout rotulo="Financeiro" abas={ABAS_FINANCEIRO}>{children}</SecaoLayout>;
}
