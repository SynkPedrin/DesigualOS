'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { Plus, Search, Users } from 'lucide-react';
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
  /**
   * BUSCA E RECORTE — a tela tinha 55 cartões e nenhum dos dois.
   *
   * Cinquenta e cinco cartões sem busca não é uma lista: é uma pilha. Quem
   * procura "Colormaq" rolava a página inteira lendo nome por nome, e quem
   * queria só a carteira via junto as frentes internas da própria agência.
   */
  const [busca, setBusca] = useState('');
  const [recorte, setRecorte] = useState<'carteira' | 'internos' | 'tudo'>('carteira');

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
        /**
         * A CONTAGEM DIZ O MESMO QUE O CONTROL PLANE.
         *
         * O Overview separa carteira de trabalho interno e de fixture de teste,
         * usando o classificador do backend. Esta tela mostrava os 58 como
         * iguais e o Overview dizia 49 — duas telas do MESMO produto
         * discordando do que é cliente, que é a família de defeito mais cara
         * deste projeto (1222 x 411, 58 x 49, 33 x 35 ferramentas).
         *
         * Nada some: fixture continua listada, porque apagar do cadastro é
         * decisão de quem cuida do cadastro. Só deixa de ser contada como
         * cliente.
         */
        description={
          clients
            ? [
                `${clients.filter((c) => c.natureza === 'CLIENTE').length} na carteira`,
                clients.filter((c) => c.natureza === 'INTERNO').length > 0 &&
                  `${clients.filter((c) => c.natureza === 'INTERNO').length} frente(s) interna(s)`,
                clients.filter((c) => c.natureza === 'FIXTURE').length > 0 &&
                  `${clients.filter((c) => c.natureza === 'FIXTURE').length} de teste`,
              ]
                .filter(Boolean)
                .join(' · ') + '. Clique num card para abrir a ficha completa.'
            : 'Clientes vindos do ClickUp e projetos criados por aqui. Clique num card para abrir a ficha completa.'
        }
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

      {/*
        * O recorte PADRÃO é a carteira, não "tudo". Quem abre Clientes quer ver
        * clientes; frente interna da agência é outra pergunta, e misturar as
        * duas foi o que já fez a tela dizer 58 onde o Overview dizia 49.
        */}
      {!isPending && !isError && clients && clients.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-nevoa" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar cliente"
              aria-label="Buscar cliente"
              className="w-full rounded-md border border-grafite-elevado bg-grafite py-2 pl-9 pr-3 text-[14px] text-branco-cru placeholder:text-nevoa/60 focus:border-roxo-eletrico/60 focus:outline-none"
            />
          </div>
          {([
            ['carteira', 'Carteira'],
            ['internos', 'Internos'],
            ['tudo', 'Tudo'],
          ] as const).map(([id, rotulo]) => {
            const quantos =
              id === 'tudo'
                ? clients.length
                : clients.filter((c) => (id === 'carteira' ? c.natureza === 'CLIENTE' : c.natureza !== 'CLIENTE')).length;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setRecorte(id)}
                aria-pressed={recorte === id}
                className={[
                  'rounded-full border px-3 py-1.5 text-[13px] transition-colors',
                  recorte === id
                    ? 'border-roxo-eletrico/60 bg-roxo-eletrico/15 text-branco-cru'
                    : 'border-grafite-elevado text-nevoa hover:text-branco-cru',
                ].join(' ')}
              >
                {rotulo} <span className="text-nevoa/60">{quantos}</span>
              </button>
            );
          })}
        </div>
      )}

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
        (() => {
          const termo = busca.trim().toLowerCase();
          const filtrados = clients.filter((c) => {
            if (recorte === 'carteira' && c.natureza !== 'CLIENTE') return false;
            if (recorte === 'internos' && c.natureza === 'CLIENTE') return false;
            return !termo || c.name.toLowerCase().includes(termo);
          });
          if (filtrados.length === 0) {
            return (
              <EmptyState
                icon={Search}
                title={termo ? `Nada com "${busca.trim()}"` : 'Nada neste recorte'}
                description={
                  termo
                    ? 'Confira a grafia, ou troque o recorte — o cliente pode estar em Internos.'
                    : 'Troque o recorte acima para ver os outros.'
                }
              />
            );
          }
          return (
            <>
              <p className="mb-3 text-[13px] text-nevoa">
                {filtrados.length === clients.length
                  ? `${filtrados.length} clientes`
                  : `${filtrados.length} de ${clients.length}`}
              </p>
              <ClientGrid clients={filtrados} onOpen={setOpenClient} />
            </>
          );
        })()
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
