'use client';

import Link from 'next/link';
import { ArrowRight, Check, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Surface } from '@/components/ui/surface';
import { EmptyState } from '@/components/ui/empty-state';
import { useIsMaster } from '@/hooks/use-is-master';
import { PERMISSION_MATRIX } from '@/lib/admin/sample-users';
import { AnnouncementsAdmin } from '@/components/announcements/announcements-admin';

/**
 * ADMIN — o que sobrou depois que a gestão de acessos foi para a Equipe.
 *
 * Esta tela era a ÚNICA porta para convidar alguém, trocar papel e desativar
 * conta, e ficava atrás de Configurações → Administração, ao lado de fila,
 * embedding e episódio de agente. Ninguém montando uma operação procura "como
 * dou acesso ao fulano" ali: procura onde as pessoas estão. Desde 07/10/2026
 * esse trabalho inteiro mora em /people (Equipe), com um item próprio na barra.
 *
 * A rota continua existindo — quem tem o link antigo chega aqui e descobre
 * para onde ir, em vez de encontrar um 404. O que ela NÃO faz mais é oferecer
 * um segundo formulário de convite: duas portas para a mesma ação são duas
 * chances de uma divergir da outra, e foi exatamente isso que aconteceu com os
 * gates da sidebar e do ⌘K.
 *
 * O QUE FICA: a matriz de permissões por papel. Não é uma ação, é referência —
 * a resposta a "o que muda se eu tornar alguém administrador?", que a Equipe
 * responde em uma linha e aqui está por inteiro.
 */
export default function AdminPage() {
  const { isMaster, isPending } = useIsMaster();

  if (!isPending && !isMaster) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Acesso restrito"
        description="Governança é visível só para quem administra a conta."
      />
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Governança"
        title="Admin"
        description="O que cada papel pode fazer. A gestão de pessoas mora na Equipe."
      />

      <Link
        href="/people"
        className="mb-8 flex items-center justify-between gap-4 rounded-lg border border-grafite-elevado bg-grafite px-4 py-4 transition-colors hover:border-roxo-eletrico/50"
      >
        <div>
          <p className="font-heading text-sm font-semibold text-branco-cru">Gestão de acessos ficou na Equipe</p>
          <p className="mt-1 text-[13px] text-nevoa">
            Convidar alguém, trocar papel, desativar conta e escolher as telas de cada pessoa — tudo num lugar só,
            junto de quem está usando o sistema.
          </p>
        </div>
        <ArrowRight size={18} className="shrink-0 text-nevoa" />
      </Link>

      <AnnouncementsAdmin />

      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck size={15} className="text-nevoa" />
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">
          Permissões por papel
        </h2>
      </div>
      <p className="mb-3 font-mono text-[11px] text-nevoa">
        Acesso a um cliente específico é concedido na aba &ldquo;Acesso&rdquo; da tela daquele cliente, não aqui.
      </p>

      <Surface level="grafite" className="overflow-x-auto p-0">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="border-b border-grafite-elevado bg-grafite text-left font-mono text-[10px] uppercase tracking-wider text-nevoa">
              <th className="px-4 py-3">Permissão</th>
              <th className="px-4 py-3 text-center">Administrador</th>
              <th className="px-4 py-3 text-center">Colaborador</th>
            </tr>
          </thead>
          <tbody>
            {PERMISSION_MATRIX.map((row) => (
              <tr key={row.resource} className="border-b border-grafite-elevado/60 last:border-b-0">
                <td className="px-4 py-3 font-mono text-xs text-branco-cru">{row.resource}</td>
                <td className="px-4 py-3 text-center">
                  {row.master ? (
                    <Check size={14} className="mx-auto text-sucesso" />
                  ) : (
                    <X size={14} className="mx-auto text-nevoa/40" />
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  {row.colaborador ? (
                    <Check size={14} className="mx-auto text-sucesso" />
                  ) : (
                    <X size={14} className="mx-auto text-nevoa/40" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Surface>
    </div>
  );
}
