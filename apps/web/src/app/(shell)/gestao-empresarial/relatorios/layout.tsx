import { ABAS_RELATORIOS, SecaoLayout } from '@/components/gestao-empresarial/secao';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <SecaoLayout rotulo="Relatórios" abas={ABAS_RELATORIOS}>{children}</SecaoLayout>;
}
