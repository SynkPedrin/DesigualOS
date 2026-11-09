import { ABAS_PRODUCAO, SecaoLayout } from '@/components/gestao-empresarial/secao';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <SecaoLayout rotulo="Produção" abas={ABAS_PRODUCAO}>{children}</SecaoLayout>;
}
