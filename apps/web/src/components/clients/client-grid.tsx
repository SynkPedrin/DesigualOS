'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import type { ClientSummary } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

const STATUS_META: Record<string, { label: string; className: string }> = {
  active: { label: 'Ativo', className: 'border-sinal/40 bg-sinal/10 text-sinal' },
  pontual: { label: 'Pontual', className: 'border-roxo-eletrico/40 bg-roxo-eletrico/10 text-roxo-eletrico' },
  inactive: { label: 'Inativo', className: 'border-grafite-elevado bg-carbono text-nevoa' },
};

function ClientCard({ client, onOpen }: { client: ClientSummary; onOpen: (client: ClientSummary) => void }) {
  const status = STATUS_META[client.status] ?? STATUS_META.active!;

  return (
    <motion.button
      type="button"
      layoutId={`client-card-${client.id}`}
      onClick={() => onOpen(client)}
      className={cn(
        'group flex h-52 w-full flex-col justify-between rounded-2xl border p-6 text-left',
        'border-grafite-elevado bg-grafite transition-colors duration-200',
        'hover:border-roxo-eletrico/60 hover:shadow-glow',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-grafite-elevado">
          <Image src="/brand/os-mark.png" alt="" width={56} height={56} className="size-full object-cover" />
        </span>
        <span className={cn('shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider', status.className)}>
          {status.label}
        </span>
      </div>

      <div>
        <p className="line-clamp-2 font-heading text-lg font-semibold leading-tight text-branco-cru">{client.name}</p>
        <p className="mt-1 truncate font-mono text-[11px] text-nevoa">
          {client.clickupListId ? 'ClickUp vinculado' : 'sem vínculo no ClickUp'}
        </p>
      </div>
    </motion.button>
  );
}

/**
 * Grade de clientes: scroll fluido, tudo numa rolagem só (sem paginação).
 *
 * A versão anterior tinha um efeito de roleta 3D (cards tombando conforme a
 * distância do centro). Foi removido a pedido do Endrigo: atrapalhava a
 * leitura. Ficou só o card entrando suave, e o clique continua abrindo a
 * ficha em popup pelo `layoutId`.
 */
export function ClientGrid({
  clients,
  onOpen,
}: {
  clients: ClientSummary[];
  onOpen: (client: ClientSummary) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {clients.map((client, index) => (
        <motion.div
          key={client.id}
          data-client-id={client.id}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          // Escalonado só nos primeiros: com 51 clientes, atrasar todo mundo
          // faria o último aparecer segundos depois — vira lentidão, não charme.
          transition={{ duration: 0.28, ease: 'easeOut', delay: Math.min(index, 8) * 0.035 }}
        >
          <ClientCard client={client} onOpen={onOpen} />
        </motion.div>
      ))}
    </div>
  );
}
