import { ABAS_CADASTROS, SecaoLayout } from '@/components/gestao-empresarial/secao';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <SecaoLayout rotulo="Cadastros" abas={ABAS_CADASTROS}>{children}</SecaoLayout>;
}
