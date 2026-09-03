'use client';

import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useGrantClientAccess } from '@/hooks/use-client-workspace';
import { ApiRequestError } from '@/lib/api/client';
import { CLIENT_ACCESS_ROLES, type ClientAccessRole } from '@/lib/api/contracts';

/** Concessão de acesso ao workspace do cliente. Só master chega aqui. */
export function GrantAccessForm({ clientId }: { clientId: string }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ClientAccessRole>('viewer');
  const grantAccess = useGrantClientAccess(clientId);

  return (
    <div className="space-y-3">
      <p className="text-sm text-nevoa">
        Dê acesso a um colaborador que já tem conta no Desigual OS (crie a conta primeiro em Admin, se necessário).
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="e-mail do colaborador"
          className="min-w-0 flex-1 rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru placeholder:text-nevoa focus:border-roxo-eletrico/60 focus:outline-none"
        />
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as ClientAccessRole)}
          className="rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
        >
          {CLIENT_ACCESS_ROLES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!email.trim() || grantAccess.isPending}
          onClick={() => grantAccess.mutate({ email: email.trim(), role }, { onSuccess: () => setEmail('') })}
          className="flex items-center gap-2 rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-50 disabled:hover:shadow-none"
        >
          <UserPlus size={15} />
          Dar acesso
        </button>
      </div>
      {grantAccess.isError && (
        <p className="text-sm text-erro">
          {grantAccess.error instanceof ApiRequestError ? grantAccess.error.message : 'Não foi possível dar acesso.'}
        </p>
      )}
      {grantAccess.isSuccess && <p className="text-sm text-sinal">Acesso concedido.</p>}
    </div>
  );
}
