'use client';

import { PessoasTela } from '@/components/gestao-empresarial/cadastros/pessoas';

export default function Page() {
  return <PessoasTela role="prestador" singular="Prestador" plural="prestadores" novo="Novo prestador" />;
}
