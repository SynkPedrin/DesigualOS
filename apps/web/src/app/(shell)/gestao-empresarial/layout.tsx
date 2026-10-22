'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Lock } from 'lucide-react';
import { Toaster } from '@/components/ui/toaster';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useGestaoAcesso } from '@/hooks/use-gestao-empresarial';
import { cn } from '@/lib/utils';

const BASE = '/gestao-empresarial';
const SECOES: Array<{ href: string; rotulo: string; exato?: boolean }> = [
  { href: BASE, rotulo: 'Visão geral', exato: true },
  { href: `${BASE}/financeiro`, rotulo: 'Financeiro' },
  { href: `${BASE}/comercial`, rotulo: 'Comercial' },
  { href: `${BASE}/producao`, rotulo: 'Produção' },
  { href: `${BASE}/cadastros`, rotulo: 'Cadastros' },
  { href: `${BASE}/relatorios`, rotulo: 'Relatórios' },
  { href: `${BASE}/configuracoes`, rotulo: 'Configurações' },
];

export default function GestaoEmpresarialLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data, isPending } = useGestaoAcesso();
  if (isPending) return <Skeleton className="h-64 w-full" />;
  if (data?.allowed !== true) {
    // O servidor recusa de qualquer jeito (403/404); aqui só evitamos uma tela quebrada para quem digitou o endereço.
    return <EmptyState icon={Lock} title="Gestão Empresarial não está disponível" description="Este módulo está desligado neste ambiente ou é restrito a administradores. Se você deveria vê-lo, fale com quem administra a plataforma." />;
  }
  return (
    <div className="space-y-5 pt-6">
      <header>
        <p className="font-mono text-xs uppercase tracking-wider text-sinal">Restrito a administradores</p>
        <h1 className="font-display text-2xl font-black uppercase tracking-tight text-branco-cru">Gestão Empresarial</h1>
      </header>
      <nav aria-label="Gestão Empresarial" className="flex flex-wrap gap-x-1 border-b border-grafite-elevado">
        {SECOES.map((s) => {
          const ativa = s.exato ? pathname === s.href : pathname === s.href || pathname.startsWith(`${s.href}/`);
          return (
            <Link key={s.href} href={s.href} aria-current={ativa ? 'page' : undefined} className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors', ativa ? 'border-sinal text-branco-cru' : 'border-transparent text-nevoa hover:text-branco-cru')}>
              {s.rotulo}
            </Link>
          );
        })}
      </nav>
      <div>{children}</div>
      <Toaster />
    </div>
  );
}
