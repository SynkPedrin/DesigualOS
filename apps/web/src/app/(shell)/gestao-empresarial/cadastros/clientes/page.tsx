'use client';

import { PessoasTela } from '@/components/gestao-empresarial/cadastros/pessoas';

export default function Page() {
  return <PessoasTela role="cliente" singular="Cliente" plural="clientes" novo="Novo cliente" />;
}
