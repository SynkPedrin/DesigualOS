'use client';

import { Suspense } from 'react';
import { Lancamentos } from '@/components/gestao-empresarial/financeiro/lancamentos';
import { Carregando } from '@/components/gestao-empresarial/kit';

export default function Page() {
  return <Suspense fallback={<Carregando />}><Lancamentos kind="receita" /></Suspense>;
}
