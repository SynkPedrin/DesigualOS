import { ChevronDown, Users } from 'lucide-react';
import { useClients } from '@/hooks/use-clients';

export function ClientSelector({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (clientId: string | null) => void;
}) {
  const { data: clients, isPending } = useClients();

  return (
    <div className="relative flex items-center">
      <Users size={14} className="pointer-events-none absolute left-3 text-nevoa" />
      <select
        value={value ?? ''}
        disabled={isPending}
        onChange={(event) => onChange(event.target.value || null)}
        className="appearance-none rounded-md border border-grafite-elevado bg-grafite py-1.5 pl-8 pr-7 text-sm text-branco-cru transition-colors hover:border-roxo-eletrico/50 focus:outline-none disabled:opacity-50"
      >
        <option value="">Sem cliente</option>
        {clients?.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 text-nevoa" />
    </div>
  );
}
