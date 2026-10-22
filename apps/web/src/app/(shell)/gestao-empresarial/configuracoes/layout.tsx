import { ABAS_CONFIGURACOES, SecaoLayout } from '@/components/gestao-empresarial/secao';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <SecaoLayout rotulo="Configurações" abas={ABAS_CONFIGURACOES}>{children}</SecaoLayout>;
}
