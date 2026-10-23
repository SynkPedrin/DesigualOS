'use client';

import { PessoasTela } from '@/components/gestao-empresarial/cadastros/pessoas';

export default function Page() {
  return <PessoasTela role="fornecedor" singular="Fornecedor" plural="fornecedores" novo="Novo fornecedor" />;
}
