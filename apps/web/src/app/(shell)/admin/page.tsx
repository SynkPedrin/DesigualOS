'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Check, Pencil, Plug, ShieldAlert, ShieldCheck, Trash2, Unplug, UserPlus, Users, X } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { ApiRequestError } from '@/lib/api/client';
import {
  useAdminUsers,
  useDeleteUser,
  useInviteUser,
  useUpdateUserName,
  useUpdateUserRole,
  useUpdateUserStatus,
} from '@/hooks/use-admin-users';
import { useIsMaster } from '@/hooks/use-is-master';
import { useMe } from '@/hooks/use-me';
import { ROLE_NAMES, type AdminUser, type RoleName } from '@/lib/api/contracts';
import { formatRelativeTime } from '@/lib/format';
import { PERMISSION_MATRIX } from '@/lib/admin/sample-users';
import { cn } from '@/lib/utils';

const ROLE_LABEL: Record<RoleName, string> = { master: 'Administrador Master', colaborador: 'Colaborador' };
const ROLE_ACCENT: Record<RoleName, string> = {
  master: 'border-roxo-eletrico/60 text-roxo-eletrico',
  colaborador: 'border-grafite-elevado text-nevoa',
};

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback;
}

/** The backend can create + provision the user for real and still return an error status,
 * because only the notification email failed (e.g. Resend sandbox mode only delivers to the
 * account owner's address). Detected by message prefix since there's no distinct status code
 * for "partially succeeded" - not a guess: the backend crafts this exact string on purpose. */
function isPartialInviteFailure(message: string): boolean {
  return message.startsWith('Convite criado');
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<RoleName>('colaborador');
  const inviteUser = useInviteUser();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    inviteUser.mutate(
      { email: email.trim(), name: name.trim() || undefined, role },
      { onSuccess: onDone },
    );
  }

  const errorMessage = inviteUser.error instanceof ApiRequestError ? inviteUser.error.message : null;
  const partialFailure = errorMessage ? isPartialInviteFailure(errorMessage) : false;

  return (
    <Surface level="elevado" className="mb-6 p-4">
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">E-mail</label>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="pessoa@exemplo.com"
            className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2.5 text-sm text-branco-cru placeholder:text-nevoa/50 focus:border-roxo-eletrico/60 focus:outline-none"
          />
        </div>
        <div className="min-w-[180px] flex-1">
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">Nome (opcional)</label>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2.5 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">Papel</label>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as RoleName)}
            className="rounded-md border border-grafite-elevado bg-carbono px-3 py-2.5 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
          >
            {ROLE_NAMES.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={!email.trim() || inviteUser.isPending}
          className="flex items-center gap-2 rounded-md bg-roxo-eletrico px-4 py-2.5 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-50 disabled:hover:shadow-none"
        >
          <UserPlus size={15} />
          {inviteUser.isPending ? 'Convidando...' : 'Enviar convite'}
        </button>

        {inviteUser.isError && partialFailure && (
          <div className="w-full rounded-md border border-aviso/30 bg-aviso/10 p-3">
            <p className="text-sm text-aviso">
              O convite foi criado, mas não conseguimos confirmar que o e-mail foi enviado. Avise a pessoa
              manualmente ou peça pro time técnico verificar o serviço de e-mail.
            </p>
            <p className="mt-1 font-mono text-[10px] text-nevoa">{errorMessage}</p>
          </div>
        )}
        {inviteUser.isError && !partialFailure && (
          <div className="w-full rounded-md border border-erro/30 bg-erro/10 p-3">
            <p className="text-sm text-erro">{errorMessage ?? 'Não foi possível convidar.'}</p>
          </div>
        )}
        {inviteUser.isSuccess && (
          <div className="w-full rounded-md border border-sucesso/30 bg-sucesso/10 p-3">
            <p className="text-sm text-sucesso">Convite enviado.</p>
          </div>
        )}
      </form>
    </Surface>
  );
}

function EditableName({ userId, name }: { userId: string; name: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const updateName = useUpdateUserName();

  function save() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) {
      setEditing(false);
      setValue(name);
      return;
    }
    updateName.mutate({ userId, name: trimmed }, { onSuccess: () => setEditing(false) });
  }

  if (editing) {
    return (
      <div>
        <input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save();
            if (event.key === 'Escape') { setValue(name); setEditing(false); }
          }}
          disabled={updateName.isPending}
          className="w-full rounded-md border border-roxo-eletrico/60 bg-carbono px-2 py-1 text-sm font-semibold text-branco-cru focus:outline-none"
        />
        {updateName.isError && (
          <p className="mt-0.5 text-[11px] text-erro">{errorText(updateName.error, 'Não foi possível salvar.')}</p>
        )}
      </div>
    );
  }

  return (
    <button type="button" onClick={() => setEditing(true)} className="group flex items-center gap-1.5 text-left">
      <span className="truncate font-heading text-sm font-semibold text-branco-cru">{name}</span>
      <Pencil size={12} className="shrink-0 text-nevoa opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function StatusToggle({
  active,
  onToggle,
  pending,
  error,
}: {
  active: boolean;
  onToggle: () => void;
  pending: boolean;
  error: string | null;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label={active ? 'Desativar usuário' : 'Ativar usuário'}
        onClick={onToggle}
        disabled={pending}
        className={cn(
          'relative flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60',
          active ? 'bg-sucesso' : 'bg-grafite-elevado',
        )}
      >
        <span
          className={cn(
            'absolute size-5 rounded-full bg-branco-cru transition-transform',
            active ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
      <span className={cn('font-mono text-[10px] uppercase tracking-wider', active ? 'text-sucesso' : 'text-nevoa')}>
        {active ? 'Ativo' : 'Inativo'}
      </span>
      {error && <p className="max-w-[110px] text-center text-[10px] text-erro">{error}</p>}
    </div>
  );
}

function DeleteUserButton({ userId, disabled }: { userId: string; disabled: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const deleteUser = useDeleteUser();

  if (disabled) return <div className="size-7" />;

  if (confirming) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => deleteUser.mutate(userId)}
            disabled={deleteUser.isPending}
            className="rounded-md bg-erro px-2 py-1 text-[11px] font-semibold text-branco-cru hover:opacity-90 disabled:opacity-50"
          >
            {deleteUser.isPending ? 'Excluindo...' : 'Confirmar'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-md border border-grafite-elevado px-2 py-1 text-[11px] text-nevoa hover:text-branco-cru"
          >
            Cancelar
          </button>
        </div>
        {deleteUser.isError && (
          <p className="max-w-[200px] text-right text-[11px] text-erro">
            {errorText(deleteUser.error, 'Não foi possível excluir.')}
          </p>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      aria-label="Excluir usuário"
      title="Excluir usuário"
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-erro/10 hover:text-erro"
    >
      <Trash2 size={15} />
    </button>
  );
}

function UserCard({
  user,
  isSelf,
  updateRole,
  updateStatus,
}: {
  user: AdminUser;
  isSelf: boolean;
  updateRole: ReturnType<typeof useUpdateUserRole>;
  updateStatus: ReturnType<typeof useUpdateUserStatus>;
}) {
  const role = user.roles[0] ?? 'colaborador';

  return (
    <Surface level="grafite" className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-roxo-eletrico font-mono text-sm font-semibold text-branco-cru">
            {user.avatarUrl ? (
              <Image src={user.avatarUrl} alt={user.name} fill sizes="44px" unoptimized className="object-cover" />
            ) : (
              user.name.charAt(0).toUpperCase()
            )}
          </span>
          <div className="min-w-0">
            <EditableName userId={user.id} name={user.name} />
            <p className="truncate font-mono text-xs text-nevoa">{user.email}</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div>
            <label className="mb-1 block text-center font-mono text-[10px] uppercase tracking-wider text-nevoa">
              Papel
            </label>
            <select
              value={role}
              onChange={(event) => updateRole.mutate({ userId: user.id, role: event.target.value as RoleName })}
              className={cn(
                'rounded-md border bg-carbono px-2.5 py-1.5 text-xs font-medium focus:outline-none',
                ROLE_ACCENT[role],
              )}
            >
              {ROLE_NAMES.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
            {updateRole.isError && updateRole.variables?.userId === user.id && (
              <p className="mt-1 max-w-[130px] text-center text-[10px] text-erro">
                {errorText(updateRole.error, 'Falhou.')}
              </p>
            )}
          </div>

          <StatusToggle
            active={user.active}
            pending={updateStatus.isPending && updateStatus.variables?.userId === user.id}
            error={
              updateStatus.isError && updateStatus.variables?.userId === user.id
                ? errorText(updateStatus.error, 'Falhou.')
                : null
            }
            onToggle={() => updateStatus.mutate({ userId: user.id, active: !user.active })}
          />

          <DeleteUserButton userId={user.id} disabled={isSelf} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-grafite-elevado pt-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-nevoa">
          {user.clientAccess.length === 0 ? 'Sem acesso a clientes' : 'Acesso a clientes:'}
        </span>
        {user.clientAccess.map((access) => (
          <span
            key={access.clientId}
            className="rounded-full border border-grafite-elevado bg-carbono px-2 py-0.5 font-mono text-[10px] text-nevoa"
          >
            {access.clientName} · {access.role}
          </span>
        ))}
        <span className="ml-auto font-mono text-[10px] text-nevoa/70">Desde {formatRelativeTime(user.createdAt)}</span>
      </div>

      {/* Integrações por pessoa (pedido do Endrigo): dá pra ver quem está
        * conectado ao ClickUp, em qual workspace e desde quando sincronizou -
        * sem nunca expor o token, que não sai do servidor. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-nevoa">Integrações:</span>
        {user.integrations.length === 0 ? (
          <span className="font-mono text-[10px] text-nevoa/70">nenhuma conectada</span>
        ) : (
          user.integrations.map((integration) => {
            const conectada = integration.status === 'connected';
            return (
              <span
                key={integration.provider}
                title={
                  conectada
                    ? `Workspace: ${integration.workspaceName ?? '-'} · última sincronização: ${
                        integration.lastSyncedAt ? formatRelativeTime(integration.lastSyncedAt) : 'nunca'
                      }`
                    : `Status: ${integration.status}`
                }
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px]',
                  conectada ? 'border-sinal/40 bg-sinal/10 text-sinal' : 'border-grafite-elevado bg-carbono text-nevoa',
                )}
              >
                {conectada ? <Plug size={9} /> : <Unplug size={9} />}
                {integration.provider}
                {conectada && integration.workspaceName ? ` · ${integration.workspaceName}` : ''}
                {conectada && (
                  <span className="text-nevoa">
                    {integration.lastSyncedAt ? ` · sync ${formatRelativeTime(integration.lastSyncedAt)}` : ' · sem sync'}
                  </span>
                )}
              </span>
            );
          })
        )}
      </div>
    </Surface>
  );
}

export default function AdminPage() {
  const { isMaster, isPending: rolePending } = useIsMaster();
  const { data: me } = useMe();
  const { data: users, isPending, isError, refetch } = useAdminUsers();
  const updateRole = useUpdateUserRole();
  const updateStatus = useUpdateUserStatus();
  const [inviteOpen, setInviteOpen] = useState(false);

  if (!rolePending && !isMaster) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Acesso restrito"
        description="Gestão de time é visível só para o papel Administrador Master."
      />
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Governança"
        title="Admin"
        description="Time, papéis e acesso por cliente."
        actions={
          <button
            type="button"
            onClick={() => setInviteOpen((v) => !v)}
            className="flex items-center gap-2 rounded-md border border-grafite-elevado bg-grafite px-4 py-2 text-sm font-medium text-branco-cru transition-colors hover:border-roxo-eletrico/50"
          >
            <UserPlus size={15} />
            Convidar colaborador
          </button>
        }
      />

      {inviteOpen && <InviteForm onDone={() => setInviteOpen(false)} />}

      <div className="mb-4 flex items-center gap-2">
        <Users size={15} className="text-nevoa" />
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">
          Time {users && `(${users.length})`}
        </h2>
      </div>

      {isPending ? (
        <div className="mb-8 space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : isError ? (
        <div className="mb-8">
          <InlineSectionError message="Não conseguimos carregar o time." onRetry={() => refetch()} />
        </div>
      ) : !users || users.length === 0 ? (
        <div className="mb-8">
          <EmptyState icon={Users} title="Nenhum usuário" description="Convide alguém pra começar." />
        </div>
      ) : (
        <div className="mb-8 space-y-3">
          {users.map((user) => (
            <UserCard
              key={user.id}
              user={user}
              isSelf={user.id === me?.id}
              updateRole={updateRole}
              updateStatus={updateStatus}
            />
          ))}
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck size={15} className="text-nevoa" />
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-nevoa">
          Permissões por papel
        </h2>
      </div>
      <p className="mb-3 font-mono text-[11px] text-nevoa">
        Acesso a um cliente específico é concedido a partir da aba "Acesso" na tela daquele cliente, não aqui.
      </p>

      <Surface level="grafite" className="overflow-x-auto p-0">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="border-b border-grafite-elevado bg-grafite text-left font-mono text-[10px] uppercase tracking-wider text-nevoa">
              <th className="px-4 py-3">Permissão</th>
              <th className="px-4 py-3 text-center">Master</th>
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
