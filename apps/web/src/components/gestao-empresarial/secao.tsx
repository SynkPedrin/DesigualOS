'use client';

import { SubNav, type Aba } from './kit';

/** Layout de uma seção do módulo: a sub-navegação no topo e a tela da aba embaixo. */
export function SecaoLayout({ rotulo, abas, children }: { rotulo: string; abas: Aba[]; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <SubNav abas={abas} rotulo={`${rotulo}: seções`} />
      {children}
    </div>
  );
}

export const ABAS_FINANCEIRO: Aba[] = [
  { href: '/gestao-empresarial/financeiro/receber', rotulo: 'A receber' },
  { href: '/gestao-empresarial/financeiro/pagar', rotulo: 'A pagar' },
  { href: '/gestao-empresarial/financeiro/contas', rotulo: 'Contas' },
  { href: '/gestao-empresarial/financeiro/recorrencias', rotulo: 'Recorrências' },
  { href: '/gestao-empresarial/financeiro/fluxo-de-caixa', rotulo: 'Fluxo de caixa' },
  { href: '/gestao-empresarial/financeiro/conciliacao', rotulo: 'Conciliação' },
];
export const ABAS_COMERCIAL: Aba[] = [
  { href: '/gestao-empresarial/comercial/propostas', rotulo: 'Propostas' },
  { href: '/gestao-empresarial/comercial/contratos', rotulo: 'Contratos' },
  { href: '/gestao-empresarial/comercial/pedidos', rotulo: 'Pedidos de venda' },
];
export const ABAS_PRODUCAO: Aba[] = [
  { href: '/gestao-empresarial/producao/solicitacoes', rotulo: 'Solicitações e cotações' },
  { href: '/gestao-empresarial/producao/pedidos', rotulo: 'Pedidos de produção' },
];
export const ABAS_CADASTROS: Aba[] = [
  { href: '/gestao-empresarial/cadastros/clientes', rotulo: 'Clientes' },
  { href: '/gestao-empresarial/cadastros/fornecedores', rotulo: 'Fornecedores' },
  { href: '/gestao-empresarial/cadastros/veiculos-de-midia', rotulo: 'Veículos de mídia' },
  { href: '/gestao-empresarial/cadastros/prestadores', rotulo: 'Prestadores' },
  { href: '/gestao-empresarial/cadastros/servicos', rotulo: 'Serviços' },
];
export const ABAS_RELATORIOS: Aba[] = [
  { href: '/gestao-empresarial/relatorios/atraso', rotulo: 'Atraso' },
  { href: '/gestao-empresarial/relatorios/resultado', rotulo: 'Resultado' },
  { href: '/gestao-empresarial/relatorios/rentabilidade', rotulo: 'Rentabilidade da produção' },
  { href: '/gestao-empresarial/relatorios/funil', rotulo: 'Funil comercial' },
];
export const ABAS_CONFIGURACOES: Aba[] = [
  { href: '/gestao-empresarial/configuracoes/importacao', rotulo: 'Importação' },
  { href: '/gestao-empresarial/configuracoes/categorias', rotulo: 'Categorias' },
  { href: '/gestao-empresarial/configuracoes/centros-de-custo', rotulo: 'Centros de custo' },
];
