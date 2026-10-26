'use client';

import { AguardandoAprovacao, Prazo } from '@/components/ui/prazo';
import { use, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, ExternalLink, FileArchive, FileText, Image as ImageIcon, Loader2, Paperclip, Send, Sparkles, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { Toaster } from '@/components/ui/toaster';
import { EntityAvatar } from '@/components/ui/entity-avatar';
import { toast } from '@/stores/toast-store';
import { formatRelativeTime } from '@/lib/format';
import { ApiRequestError } from '@/lib/api/client';
import {
  DEMAND_FILE_KINDS,
  useDeleteDemandFile,
  useDemand,
  useDemandActivity,
  useDemandFiles,
  useUploadDemandFile,
  type DemandFileKind,
} from '@/hooks/use-demands';
import {
  useAddBriefVersion,
  useApproveBriefVersion,
  useBrief,
  useBriefsByDemand,
  useCreateBrief,
  useDraftBriefFromDemand,
  useSendBriefToProduction,
} from '@/hooks/use-briefs';
import { useApprovals, useCreateApprovalRequest, useResolveApproval } from '@/hooks/use-approvals';
import type { BriefContentWire, DemandStatus } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<DemandStatus, string> = {
  new: 'Nova',
  briefing: 'Em briefing',
  in_production: 'Em produção',
  done: 'Concluída',
  cancelled: 'Cancelada',
};

const CONTENT_FIELDS: Array<{ key: keyof BriefContentWire; label: string; multiline?: boolean }> = [
  { key: 'objective', label: 'Objetivo', multiline: true },
  { key: 'deliverable', label: 'Entregável' },
  { key: 'channel', label: 'Canal' },
  { key: 'format', label: 'Formato' },
  { key: 'deadline', label: 'Prazo' },
  { key: 'direction', label: 'Direção de criação', multiline: true },
  { key: 'restrictions', label: 'Restrições', multiline: true },
  { key: 'notes', label: 'Notas', multiline: true },
];

export default function DemandDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: demand, isPending, isError, error, refetch } = useDemand(id);

  if (isPending) {
    return (
      <div className="mx-auto max-w-[800px]">
        <PageHeader eyebrow="Quinzena" title="Carregando…" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !demand) {
    const msg = error instanceof ApiRequestError ? error.message : '';
    return (
      <div className="mx-auto max-w-[800px]">
        <BackLink />
        <EmptyState
          icon={FileText}
          title={/not found/i.test(msg) ? 'Esta quinzena não existe ou não é sua' : 'Não conseguimos carregar esta quinzena'}
          {...(/not found/i.test(msg) ? {} : { description: 'A consulta falhou, tente de novo.' })}
        />
        {!/not found/i.test(msg) && (
          <div className="mt-3 text-center">
            <button type="button" onClick={() => refetch()} className="text-xs text-roxo-eletrico hover:underline">
              Tentar novamente
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[800px]">
      <BackLink />
      <PageHeader
        eyebrow={demand.clientName ?? 'Sem cliente vinculado'}
        title={demand.title}
        {...(demand.description ? { description: demand.description } : {})}
      />

      <Surface className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
        <Info label="Status" value={STATUS_LABEL[demand.status]} />
        <Info label="Prioridade" value={demand.priority} />
        <Info label="Origem" value={SOURCE_LABEL[demand.source] ?? demand.source} />
        <Info label="Pedida" value={formatRelativeTime(demand.requestedAt)} />
        {demand.dueDate && <Info label="Prazo" value={new Date(demand.dueDate).toLocaleDateString('pt-BR')} />}
        {demand.dueDate && demand.status !== 'done' && demand.status !== 'cancelled' && <Prazo prazo={demand.dueDate} className="self-center" />}
        {demand.clickupTaskUrl && (
          <a
            href={demand.clickupTaskUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-xs text-roxo-eletrico hover:underline"
          >
            Ver no ClickUp
            <ExternalLink size={11} />
          </a>
        )}
      </Surface>

      <div className="mb-6 space-y-6">
        <ArquivosSection demandId={id} />
        <AtividadeSection demandId={id} />
      </div>

      <BriefSection demandId={id} clientId={demand.clientId} />

      <Toaster />
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  manual: 'Lançada pela equipe',
  bento: 'Bento',
};

function BackLink() {
  return (
    <Link href="/demands" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-nevoa transition-colors hover:text-branco-cru">
      <ArrowLeft size={13} />
      Quinzenas
    </Link>
  );
}

const KIND_LABEL: Record<DemandFileKind, string> = {
  briefing: 'Briefing',
  documento: 'Documento',
  imagem: 'Imagem',
  compactado: 'Compactado',
  outro: 'Outro',
};

function iconeDoArquivo(kind: DemandFileKind) {
  if (kind === 'imagem') return ImageIcon;
  if (kind === 'compactado') return FileArchive;
  return FileText;
}

/**
 * ARQUIVOS da quinzena — briefing, documentos, imagens, compactados, à vista
 * de todo mundo (acesso é sempre da empresa inteira, nunca por dono). Chute
 * de categoria pela extensão é só o default do seletor: quem envia confirma
 * ou troca antes de subir.
 */
function ArquivosSection({ demandId }: { demandId: string }) {
  const { data: files, isPending } = useDemandFiles(demandId);
  const upload = useUploadDemandFile(demandId);
  const remover = useDeleteDemandFile(demandId);
  const [kindEscolhido, setKindEscolhido] = useState<DemandFileKind>('outro');
  const inputRef = useRef<HTMLInputElement>(null);

  const porCategoria = DEMAND_FILE_KINDS.map((kind) => ({
    kind,
    arquivos: (files ?? []).filter((f) => f.kind === kind),
  })).filter((grupo) => grupo.arquivos.length > 0);

  return (
    <Surface className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-lg font-semibold text-branco-cru">Arquivos</h2>
        <div className="flex items-center gap-2">
          <select
            value={kindEscolhido}
            onChange={(e) => setKindEscolhido(e.target.value as DemandFileKind)}
            className="rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-[13px] text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
          >
            {DEMAND_FILE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={upload.isPending}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md border border-grafite-elevado bg-carbono px-3 py-1.5 text-[13px] text-branco-cru transition-colors hover:border-roxo-eletrico/60 disabled:opacity-50"
          >
            <Paperclip size={13} />
            {upload.isPending ? 'Enviando...' : 'Anexar'}
          </button>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              upload.mutate(
                { file, kind: kindEscolhido },
                { onError: (error) => toast(errorMessage(error, 'Não foi possível anexar o arquivo.'), 'error') },
              );
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : !files || files.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-nevoa">Nenhum arquivo anexado ainda.</p>
      ) : (
        <div className="space-y-4">
          {porCategoria.map(({ kind, arquivos }) => (
            <div key={kind}>
              <p className="mb-1.5 text-[11px] uppercase tracking-wide text-nevoa">{KIND_LABEL[kind]}</p>
              <ul className="space-y-1.5">
                {arquivos.map((f) => {
                  const Icone = iconeDoArquivo(f.kind);
                  return (
                    <li key={f.id} className="flex items-center justify-between gap-2 rounded-md border border-grafite-elevado bg-carbono px-3 py-2">
                      <a href={f.storageUrl} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 text-[13px] text-branco-cru hover:text-roxo-eletrico">
                        <Icone size={14} className="shrink-0 text-nevoa" />
                        <span className="truncate">{f.filename}</span>
                      </a>
                      <button
                        type="button"
                        onClick={() => remover.mutate(f.id)}
                        className="shrink-0 text-nevoa transition-colors hover:text-erro"
                        title="Remover"
                      >
                        <Trash2 size={13} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Surface>
  );
}

/**
 * ATIVIDADE da quinzena — quem fez o quê e quando, nome e foto incluídos.
 * Mesma tabela da tela de Atividade geral (operational_events), só recortada
 * por esta quinzena — nunca um feed calculado separado que pudesse divergir.
 */
function AtividadeSection({ demandId }: { demandId: string }) {
  const { data: eventos, isPending } = useDemandActivity(demandId);

  return (
    <Surface className="p-5">
      <h2 className="mb-3 font-heading text-lg font-semibold text-branco-cru">Atividade</h2>
      {isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : !eventos || eventos.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-nevoa">Nada registrado ainda.</p>
      ) : (
        <ul className="space-y-3">
          {eventos.map((e) => (
            <li key={e.id} className="flex items-start gap-2.5">
              <EntityAvatar name={e.userName ?? 'Sistema'} photoUrl={e.userAvatarUrl} kind="person" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-branco-cru">{e.summary ?? e.type}</p>
                <p className="text-[11px] text-nevoa">
                  {e.userName ?? 'Sistema'} · {e.occurredAt ? formatRelativeTime(e.occurredAt) : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-nevoa">{label}</p>
      <p className="text-branco-cru">{value}</p>
    </div>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback;
}

function BriefSection({ demandId, clientId }: { demandId: string; clientId: string }) {
  const { data: briefs, isPending, isError, refetch } = useBriefsByDemand(demandId);
  const draftFromDemand = useDraftBriefFromDemand(demandId);
  const createManual = useCreateBrief(demandId);
  const [showManualForm, setShowManualForm] = useState(false);

  if (isPending) {
    return <Skeleton className="h-40 w-full" />;
  }

  if (isError) {
    return <InlineSectionError message="Não conseguimos carregar o briefing desta quinzena." onRetry={() => refetch()} />;
  }

  const brief = briefs?.[0] ?? null;

  if (!brief) {
    return (
      <Surface className="p-5">
        <h2 className="mb-3 font-heading text-lg font-semibold text-branco-cru">Briefing</h2>
        {!showManualForm ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={draftFromDemand.isPending}
              onClick={() =>
                draftFromDemand.mutate(undefined, {
                  onError: (error) => toast(errorMessage(error, 'Não foi possível gerar o rascunho.'), 'error'),
                })
              }
              className="flex items-center gap-2 rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-all hover:opacity-90 disabled:opacity-50"
            >
              {draftFromDemand.isPending ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              Gerar rascunho a partir da conversa
            </button>
            <button
              type="button"
              onClick={() => setShowManualForm(true)}
              className="rounded-md border border-grafite-elevado px-4 py-2 text-sm text-nevoa hover:text-branco-cru"
            >
              Escrever briefing manualmente
            </button>
          </div>
        ) : (
          <BriefContentForm
            initial={{}}
            submitLabel="Criar briefing"
            pending={createManual.isPending}
            onCancel={() => setShowManualForm(false)}
            onSubmit={(content) =>
              createManual.mutate(content, {
                onError: (error) => toast(errorMessage(error, 'Não foi possível criar o briefing.'), 'error'),
                onSuccess: () => setShowManualForm(false),
              })
            }
          />
        )}
      </Surface>
    );
  }

  return <BriefDetail briefId={brief.id} clientId={clientId} />;
}

function BriefDetail({ briefId, clientId }: { briefId: string; clientId: string }) {
  const { data: brief, isPending, isError, refetch } = useBrief(briefId);
  const addVersion = useAddBriefVersion(briefId);
  const approveVersion = useApproveBriefVersion(briefId);
  const sendToProduction = useSendBriefToProduction(briefId);
  const [showNewVersionForm, setShowNewVersionForm] = useState(false);

  if (isPending) return <Skeleton className="h-60 w-full" />;
  if (isError || !brief) {
    return <InlineSectionError message="Não conseguimos carregar este briefing." onRetry={() => refetch()} />;
  }

  const versions = [...(brief.versions ?? [])].sort((a, b) => b.version - a.version);
  const latest = versions[0];

  return (
    <div className="space-y-4">
      <Surface className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold text-branco-cru">Briefing</h2>
          <span className="rounded-full border border-grafite-elevado bg-carbono px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-nevoa">
            {BRIEF_STATUS_LABEL[brief.status] ?? brief.status}
          </span>
        </div>

        {!showNewVersionForm ? (
          <div className="space-y-4">
            {versions.map((version) => (
              <div key={version.id} className="rounded-md border border-grafite-elevado p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-branco-cru">
                    Versão {version.version}
                    {brief.approved_version_id === version.id && (
                      <span className="ml-2 text-sinal">· aprovada</span>
                    )}
                  </span>
                  <span className="text-[11px] text-nevoa">
                    {version.source === 'ai_draft' ? 'Rascunho IA' : 'Edição humana'} · {formatRelativeTime(version.created_at)}
                  </span>
                </div>
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  {CONTENT_FIELDS.filter((f) => version.content[f.key]).map((f) => (
                    <div key={f.key} className={f.multiline ? 'sm:col-span-2' : undefined}>
                      <dt className="text-[10px] uppercase tracking-wide text-nevoa">{f.label}</dt>
                      <dd className="whitespace-pre-wrap text-branco-cru">{String(version.content[f.key])}</dd>
                    </div>
                  ))}
                </dl>
                {brief.approved_version_id !== version.id && version.id === latest?.id && (
                  <button
                    type="button"
                    disabled={approveVersion.isPending}
                    onClick={() =>
                      approveVersion.mutate(version.id, {
                        onError: (error) => toast(errorMessage(error, 'Não foi possível aprovar esta versão.'), 'error'),
                        onSuccess: () => toast('Versão aprovada.', 'success'),
                      })
                    }
                    className="mt-3 flex items-center gap-1.5 rounded-md bg-sinal/20 px-3 py-1.5 text-xs font-semibold text-sinal hover:bg-sinal/30 disabled:opacity-50"
                  >
                    <Check size={13} />
                    Aprovar esta versão
                  </button>
                )}
              </div>
            ))}

            <button
              type="button"
              onClick={() => setShowNewVersionForm(true)}
              className="text-xs text-roxo-eletrico hover:underline"
            >
              + nova versão
            </button>
          </div>
        ) : (
          <BriefContentForm
            initial={latest?.content ?? {}}
            submitLabel="Salvar nova versão"
            pending={addVersion.isPending}
            onCancel={() => setShowNewVersionForm(false)}
            onSubmit={(content) =>
              addVersion.mutate(content, {
                onError: (error) => toast(errorMessage(error, 'Não foi possível salvar a nova versão.'), 'error'),
                onSuccess: () => setShowNewVersionForm(false),
              })
            }
          />
        )}
      </Surface>

      {brief.approved_version_id && (
        <Surface className="p-5">
          <h2 className="mb-3 font-heading text-lg font-semibold text-branco-cru">Produção</h2>
          {brief.external_task_id ? (
            <p className="text-sm text-nevoa">
              Enviado para produção — tarefa <span className="text-branco-cru">{brief.external_task_id}</span> no{' '}
              {brief.external_task_provider ?? 'provedor de tarefas'}.
            </p>
          ) : (
            <button
              type="button"
              disabled={sendToProduction.isPending}
              onClick={() =>
                sendToProduction.mutate(undefined, {
                  onError: (error) => toast(errorMessage(error, 'Não foi possível enviar para produção.'), 'error'),
                  onSuccess: () => toast('Enviado para produção.', 'success'),
                })
              }
              className="flex items-center gap-2 rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-all hover:opacity-90 disabled:opacity-50"
            >
              {sendToProduction.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              Enviar para produção
            </button>
          )}
        </Surface>
      )}

      <ApprovalSection briefId={briefId} clientId={clientId} />
    </div>
  );
}

const BRIEF_STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  in_review: 'Em revisão',
  approved: 'Aprovado',
  sent_to_production: 'Em produção',
};

function BriefContentForm({
  initial,
  submitLabel,
  pending,
  onCancel,
  onSubmit,
}: {
  initial: BriefContentWire;
  submitLabel: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (content: BriefContentWire) => void;
}) {
  const [content, setContent] = useState<BriefContentWire>(initial);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(content);
      }}
    >
      {CONTENT_FIELDS.map((f) => (
        <div key={f.key}>
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-nevoa">{f.label}</label>
          {f.multiline ? (
            <textarea
              rows={2}
              value={content[f.key] ?? ''}
              onChange={(e) => setContent((c) => ({ ...c, [f.key]: e.target.value }))}
              className="w-full rounded-md border border-grafite-elevado bg-carbono px-2.5 py-1.5 text-sm text-branco-cru"
            />
          ) : (
            <input
              value={content[f.key] ?? ''}
              onChange={(e) => setContent((c) => ({ ...c, [f.key]: e.target.value }))}
              className="w-full rounded-md border border-grafite-elevado bg-carbono px-2.5 py-1.5 text-sm text-branco-cru"
            />
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-all hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Salvando…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-grafite-elevado px-4 py-2 text-sm text-nevoa">
          Cancelar
        </button>
      </div>
    </form>
  );
}

function ApprovalSection({ briefId, clientId }: { briefId: string; clientId: string }) {
  const { data: approvals, isPending } = useApprovals({});
  const createApproval = useCreateApprovalRequest();
  const resolveApproval = useResolveApproval();

  if (isPending) return <Skeleton className="h-20 w-full" />;

  const approval = approvals?.find((a) => a.resource_type === 'brief' && a.resource_id === briefId) ?? null;

  return (
    <Surface className="p-5">
      <h2 className="mb-3 font-heading text-lg font-semibold text-branco-cru">Aprovação</h2>
      {!approval ? (
        <button
          type="button"
          disabled={createApproval.isPending}
          onClick={() =>
            createApproval.mutate(
              { clientId, resourceType: 'brief', resourceId: briefId },
              {
                onError: (error) => toast(errorMessage(error, 'Não foi possível pedir aprovação.'), 'error'),
                onSuccess: () => toast('Aprovação solicitada.', 'success'),
              },
            )
          }
          className="rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-all hover:opacity-90 disabled:opacity-50"
        >
          Pedir aprovação deste briefing
        </button>
      ) : approval.status === 'pending' ? (
        <div className="flex flex-wrap items-center gap-2">
          <AguardandoAprovacao desde={approval.created_at} />
          {(['approved', 'changes_requested', 'rejected'] as const).map((status) => (
            <button
              key={status}
              type="button"
              disabled={resolveApproval.isPending}
              onClick={() =>
                resolveApproval.mutate(
                  { id: approval.id, status },
                  { onError: (error) => toast(errorMessage(error, 'Não foi possível resolver esta aprovação.'), 'error') },
                )
              }
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50',
                status === 'approved' && 'bg-sinal/20 text-sinal hover:bg-sinal/30',
                status === 'rejected' && 'bg-erro/20 text-erro hover:bg-erro/30',
                status === 'changes_requested' && 'bg-aviso/20 text-aviso hover:bg-aviso/30',
              )}
            >
              {APPROVAL_ACTION_LABEL[status]}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-nevoa">
          Resolvida como <span className="text-branco-cru">{APPROVAL_STATUS_LABEL[approval.status]}</span>
          {approval.comment && <span>, &ldquo;{approval.comment}&rdquo;</span>}
        </p>
      )}
    </Surface>
  );
}

const APPROVAL_ACTION_LABEL: Record<'approved' | 'changes_requested' | 'rejected', string> = {
  approved: 'Aprovar',
  changes_requested: 'Pedir ajustes',
  rejected: 'Rejeitar',
};

const APPROVAL_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  approved: 'Aprovada',
  rejected: 'Rejeitada',
  changes_requested: 'Ajustes pedidos',
};
