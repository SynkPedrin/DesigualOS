'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { Plus, Users } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useClients } from '@/hooks/use-clients';
import { useClientWorkspace } from '@/hooks/use-client-workspace';
import { ClientGrid } from '@/components/clients/client-grid';
import { ClientDetailOverlay } from '@/components/clients/client-detail-overlay';
import { CreateClientModal } from '@/components/clients/create-client-modal';
import type { ClientSummary } from '@/lib/api/contracts';

function ClientsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: clients, isPending, isError, refetch } = useClients();
  const [openClient, setOpenClient] = useState<ClientSummary | null>(null);
  const [creating, setCreating] = useState(false);

  // Deep link ?id=<cliente> continua abrindo direto a ficha (o link antigo
  // não pode quebrar só porque a tela virou roleta). É também o caminho da
  // busca (⌘K -> nome do cliente -> Enter), então ele precisa abrir a conta
  // sem escalas.
  const deepLinkId = searchParams.get('id');
  const fromList = clients?.find((client) => client.id === deepLinkId) ?? null;
  // Mesma query que a própria ficha dispara ao montar (React Query dedupa pela
  // chave): não custa request nenhum e evita depender da lista dos 57 clientes
  // ter chegado pra abrir a conta de UM cliente.
  const { data: deepLinkWorkspace } = useClientWorkspace(deepLinkId);
  useEffect(() => {
    const target = deepLinkWorkspace?.client ?? fromList;
    if (target) setOpenClient(target);
  }, [deepLinkWorkspace, fromList]);

  function closeClient() {
    setOpenClient(null);
    // Sem limpar o ?id=, escolher o MESMO cliente de novo na busca não reabria
    // nada: a URL não mudava, o efeito não rodava de novo e o Enter virava um
    // clique morto (reproduzido em 14/09/2026).
    if (deepLinkId) router.replace('/clients', { scroll: false });
  }

  return (
    <div>
      <PageHeader
        eyebrow="Contas"
        title="Clientes"
        description="Clientes vindos do ClickUp e projetos criados por aqui. Clique num card para abrir a ficha completa."
        actions={
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 rounded-md border border-grafite-elevado bg-grafite px-3 py-2 text-sm font-medium text-branco-cru transition-colors hover:border-roxo-eletrico/50"
          >
            <Plus size={15} />
            Novo projeto
          </button>
        }
      />

      {isPending ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-52 rounded-2xl" />
          ))}
        </div>
      ) : isError ? (
        <div className="space-y-4">
          <EmptyState
            icon={Users}
            title="Não conseguimos carregar seus clientes."
            description="Verifique sua conexão e tente novamente."
          />
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-all hover:opacity-90 hover:shadow-glow"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      ) : !clients || clients.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nenhum cliente ainda"
          description="Importe os clientes do ClickUp em Configurações → Integrações, ou clique em Novo projeto."
        />
      ) : (
        <>
          <p className="mb-2 font-mono text-[11px] text-nevoa">{clients.length} clientes</p>
          <ClientGrid clients={clients} onOpen={setOpenClient} />
        </>
      )}

      <AnimatePresence>
        {openClient && <ClientDetailOverlay client={openClient} onClose={closeClient} />}
      </AnimatePresence>

      <AnimatePresence>
        {creating && <CreateClientModal onClose={() => setCreating(false)} />}
      </AnimatePresence>
    </div>
  );
}

export default function ClientsPage() {
  return (
    <Suspense fallback={null}>
      <ClientsPageContent />
    </Suspense>
  );
}
