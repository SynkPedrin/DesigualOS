'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, History, Inbox, Loader2, MessageCircle, QrCode, RefreshCw, Settings2, Smartphone, Unplug, X } from 'lucide-react';
import { useMe } from '@/hooks/use-me';
import {
  useConnectWhatsappOpenwa,
  useDisconnectWhatsappOpenwa,
  useReconnectWhatsappOpenwa,
  useRetryWhatsappOpenwaSync,
  useSyncWhatsappOpenwa,
  useWhatsappOpenwaQr,
  useWhatsappOpenwaSession,
  useWhatsappOpenwaSessions,
  useWhatsappOpenwaSyncHistory,
  type WhatsappOpenwaSession,
} from '@/hooks/use-whatsapp-openwa';
import { ApiRequestError } from '@/lib/api/client';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiRequestError) return error.message;
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

function phone(value: string | null): string {
  if (!value) return 'Número ainda não identificado';
  const digits = value.replace(/\D/g, '');
  return digits ? `+${digits}` : value;
}

function stateOf(session: WhatsappOpenwaSession | null, connecting: boolean) {
  if (connecting) return { label: 'Preparando conexão', detail: 'Criando uma sessão isolada no OpenWA.', tone: 'warning' };
  if (!session) return { label: 'Não configurado', detail: 'Centralize as conversas da sua operação diretamente no Desigual OS.', tone: 'neutral' };
  const sync = session.latest_sync;
  if (session.status === 'unavailable') return { label: 'Serviço indisponível', detail: session.last_error ?? 'O OpenWA não respondeu. Tente novamente.', tone: 'error' };
  if (session.status === 'action_required') return { label: 'Sessão expirada', detail: 'É necessário escanear um novo QR Code.', tone: 'error' };
  if (session.status === 'failed') return { label: 'Erro de autenticação', detail: session.last_error ?? 'A autenticação da sessão falhou.', tone: 'error' };
  if (session.status === 'reconnecting') return { label: 'Reconectando', detail: 'A sessão foi interrompida e está sendo recuperada automaticamente.', tone: 'warning' };
  if (session.status === 'disconnected') return { label: 'Desconectado', detail: 'A sessão está parada. Reconecte para retomar as mensagens.', tone: 'warning' };
  if (session.status === 'authenticating') return { label: 'Autenticando', detail: 'QR lido. Aguarde a confirmação do WhatsApp.', tone: 'warning' };
  if (session.status === 'qr_ready') return { label: 'Aguardando leitura', detail: 'Escaneie o QR Code com o celular.', tone: 'warning' };
  if (session.status === 'created' || session.status === 'initializing') return { label: 'Aguardando QR Code', detail: 'O OpenWA está preparando a autenticação.', tone: 'warning' };
  if (session.status === 'ready' && sync && ['queued', 'running'].includes(sync.status)) return { label: 'Sincronizando', detail: sync.error ?? 'Contatos, conversas, mensagens e mídias estão sendo importados.', tone: 'warning' };
  if (sync?.status === 'failed') return { label: 'Erro de sincronização', detail: sync.error ?? 'A sincronização falhou. Você pode tentar novamente.', tone: 'error' };
  if (session.status === 'ready' && sync?.status === 'completed_with_errors') return { label: 'Sincronizado com pendências', detail: `${sync.failures.length} item(ns) precisam de atenção.`, tone: 'warning' };
  if (session.status === 'ready') return { label: sync?.status === 'completed' ? 'Sincronizado' : 'Conectado', detail: 'A sessão está ativa e o recebimento automático está habilitado.', tone: 'success' };
  return { label: 'Não conectado', detail: session.last_error ?? 'Conecte para iniciar.', tone: 'neutral' };
}

function Tone({ children, tone }: { children: React.ReactNode; tone: string }) {
  return <span className={cn('inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium', tone === 'success' && 'bg-sucesso/15 text-sucesso', tone === 'warning' && 'bg-aviso/15 text-aviso', tone === 'error' && 'bg-erro/15 text-erro', tone === 'neutral' && 'bg-grafite-elevado text-nevoa')}>{children}</span>;
}

export function WhatsappBusinessCard() {
  const { data: me } = useMe();
  const sessionsQuery = useWhatsappOpenwaSessions();
  const connect = useConnectWhatsappOpenwa();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<'connect' | 'manage' | null>(null);
  const sessions = sessionsQuery.data ?? [];
  const own = sessions.find((session) => session.owner_user_id === me?.id);
  const selected = sessions.find((session) => session.id === (selectedId ?? own?.id)) ?? own ?? sessions[0] ?? null;
  const state = stateOf(selected, connect.isPending);

  async function beginConnection() {
    try {
      const session = await connect.mutateAsync();
      setSelectedId(session.id);
      setModal('connect');
    } catch {
      setModal('connect');
    }
  }

  if (sessionsQuery.isPending) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-grafite-elevado bg-grafite p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-[#25D366]/15 text-[#25D366]"><MessageCircle size={22} /></span>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-nevoa">WhatsApp Business</p>
              <h3 className="mt-1 font-heading text-lg font-semibold text-branco-cru">Conversas no Desigual OS</h3>
            </div>
          </div>
          <Tone tone={state.tone}>{state.label}</Tone>
        </div>
        <p className="mt-3 text-sm text-nevoa">{state.detail}</p>

        {sessions.length > 1 && (
          <select value={selected?.id ?? ''} onChange={(event) => setSelectedId(event.target.value)} className="mt-4 w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru">
            {sessions.map((session) => <option key={session.id} value={session.id}>{session.push_name ?? phone(session.phone_number)} · {session.owner_user_id === me?.id ? 'Minha conexão' : 'Equipe'}</option>)}
          </select>
        )}

        {selected?.status === 'ready' && (
          <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-grafite-elevado bg-carbono/50 p-3 text-sm sm:grid-cols-4">
            <div className="col-span-2 sm:col-span-1"><p className="text-[10px] uppercase text-nevoa">Número</p><p className="mt-1 truncate text-branco-cru">{phone(selected.phone_number)}</p></div>
            <div><p className="text-[10px] uppercase text-nevoa">Contatos</p><p className="mt-1 text-branco-cru">{selected.counts.contacts}</p></div>
            <div><p className="text-[10px] uppercase text-nevoa">Conversas</p><p className="mt-1 text-branco-cru">{selected.counts.conversations}</p></div>
            <div><p className="text-[10px] uppercase text-nevoa">Mensagens</p><p className="mt-1 text-branco-cru">{selected.counts.messages}</p></div>
            <div className="col-span-2 sm:col-span-4"><p className="text-[10px] uppercase text-nevoa">Última sincronização</p><p className="mt-1 text-branco-cru">{selected.last_sync_at ? formatRelativeTime(selected.last_sync_at) : 'Ainda não concluída'}</p></div>
          </div>
        )}

        {(sessionsQuery.isError || connect.isError) && <p className="mt-3 text-sm text-erro">{errorMessage(sessionsQuery.error ?? connect.error)}</p>}

        <div className="mt-5 flex flex-wrap gap-2">
          {!selected || selected.status !== 'ready' ? (
            <button type="button" onClick={() => void beginConnection()} disabled={connect.isPending} className="inline-flex items-center gap-2 rounded-md bg-[#25D366] px-4 py-2 text-sm font-semibold text-carbono transition-opacity hover:opacity-90 disabled:opacity-50">
              {connect.isPending ? <Loader2 size={15} className="animate-spin" /> : <QrCode size={15} />}
              {selected?.status === 'disconnected' || selected?.status === 'action_required' ? 'Reconectar WhatsApp' : 'Conectar WhatsApp'}
            </button>
          ) : (
            <>
              <Link href="/inbox" className="inline-flex items-center gap-2 rounded-md bg-sinal px-4 py-2 text-sm font-semibold text-carbono"><Inbox size={15} />Abrir Inbox</Link>
              <SyncButton session={selected} />
            </>
          )}
          {selected && <button type="button" onClick={() => setModal('manage')} className="inline-flex items-center gap-2 rounded-md border border-grafite-elevado px-3 py-2 text-sm text-nevoa hover:text-branco-cru"><Settings2 size={15} />Gerenciar conexão</button>}
        </div>
      </section>

      {modal && <WhatsappModal mode={modal} sessionId={selected?.id ?? null} initialSession={selected} connectionError={connect.error} onClose={() => setModal(null)} />}
    </div>
  );
}

function SyncButton({ session }: { session: WhatsappOpenwaSession }) {
  const sync = useSyncWhatsappOpenwa(session.id);
  const running = session.latest_sync && ['queued', 'running'].includes(session.latest_sync.status);
  return (
    <>
      <button type="button" onClick={() => sync.mutate()} disabled={sync.isPending || Boolean(running)} className="inline-flex items-center gap-2 rounded-md border border-grafite-elevado px-3 py-2 text-sm text-nevoa hover:text-branco-cru disabled:opacity-50">
        <RefreshCw size={15} className={sync.isPending || running ? 'animate-spin' : undefined} />Sincronizar agora
      </button>
      {sync.isError && <p className="w-full text-xs text-erro">{errorMessage(sync.error)}</p>}
    </>
  );
}

function WhatsappModal({ mode, sessionId, initialSession, connectionError, onClose }: { mode: 'connect' | 'manage'; sessionId: string | null; initialSession: WhatsappOpenwaSession | null; connectionError: unknown; onClose: () => void }) {
  const sessionQuery = useWhatsappOpenwaSession(sessionId, mode === 'connect');
  const session = sessionQuery.data ?? initialSession;
  const qr = useWhatsappOpenwaQr(sessionId, mode === 'connect' && session?.status === 'qr_ready');
  const reconnect = useReconnectWhatsappOpenwa(sessionId ?? '');
  const disconnect = useDisconnectWhatsappOpenwa(sessionId ?? '');
  const history = useWhatsappOpenwaSyncHistory(mode === 'manage' ? sessionId : null);
  const retry = useRetryWhatsappOpenwaSync(sessionId ?? '');
  const state = stateOf(session, false);
  const connected = session?.status === 'ready';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-carbono/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={mode === 'connect' ? 'Conectar WhatsApp' : 'Gerenciar conexão'}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-grafite-elevado bg-grafite shadow-2xl">
        <div className="flex items-start justify-between border-b border-grafite-elevado p-5">
          <div>
            <h2 className="font-heading text-xl font-semibold text-branco-cru">{mode === 'connect' ? 'Conectar WhatsApp' : 'Gerenciar conexão'}</h2>
            <p className="mt-1 text-sm text-nevoa">{mode === 'connect' ? 'Escaneie o QR Code com o WhatsApp do seu celular para conectar sua conta.' : phone(session?.phone_number ?? null)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-md p-1 text-nevoa hover:bg-grafite-elevado hover:text-branco-cru"><X size={20} /></button>
        </div>

        <div className="p-5">
          {mode === 'connect' && !connected && (
            <>
              <div className="mb-4 flex items-center justify-between gap-3"><Tone tone={state.tone}>{state.label}</Tone>{sessionQuery.isFetching && <Loader2 size={15} className="animate-spin text-nevoa" />}</div>
              <ol className="mb-5 space-y-1.5 text-sm text-nevoa">
                <li>1. Abra o WhatsApp.</li><li>2. Acesse Aparelhos conectados.</li><li>3. Toque em Conectar aparelho.</li><li>4. Escaneie o código.</li>
              </ol>
              <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-grafite-elevado bg-carbono p-5">
                {qr.data ? (
                  <>
                    <img src={qr.data.qr_code} alt="QR Code real para conectar esta sessão ao WhatsApp" className="size-64 max-w-full rounded-lg bg-white p-2" />
                    <p className="mt-3 text-center text-xs text-nevoa">QR dinâmico · atualizado {formatRelativeTime(qr.data.fetched_at)}</p>
                    <button type="button" onClick={() => void qr.refetch()} className="mt-2 inline-flex items-center gap-1.5 text-xs text-sinal"><RefreshCw size={13} />Atualizar código</button>
                  </>
                ) : (
                  <div className="text-center">
                    {session?.status === 'authenticating' ? <Smartphone size={34} className="mx-auto text-sinal" /> : <Loader2 size={34} className="mx-auto animate-spin text-nevoa" />}
                    <p className="mt-3 text-sm text-branco-cru">{state.label}</p>
                    <p className="mt-1 max-w-xs text-xs text-nevoa">{state.detail}</p>
                  </div>
                )}
              </div>
              {(connectionError || sessionQuery.isError || qr.isError || reconnect.isError) && (
                <div className="mt-4 rounded-lg border border-erro/30 bg-erro/10 p-3 text-sm text-erro">
                  <p>{errorMessage(connectionError ?? sessionQuery.error ?? qr.error ?? reconnect.error)}</p>
                  {sessionId && <button type="button" onClick={() => reconnect.mutate()} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold"><RefreshCw size={13} />Tentar novamente</button>}
                </div>
              )}
            </>
          )}

          {mode === 'connect' && connected && (
            <div className="text-center">
              <CheckCircle2 size={42} className="mx-auto text-sucesso" />
              <h3 className="mt-3 font-heading text-xl font-semibold text-branco-cru">WhatsApp conectado!</h3>
              <p className="mt-1 text-sm text-nevoa">Estamos preparando suas conversas. A sincronização continua mesmo se você fechar esta janela.</p>
              <SyncProgress session={session} />
              <Link href="/inbox" onClick={onClose} className="mt-5 inline-flex items-center gap-2 rounded-md bg-sinal px-4 py-2 text-sm font-semibold text-carbono"><Inbox size={16} />Abrir Inbox</Link>
            </div>
          )}

          {mode === 'manage' && session && (
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-3"><Tone tone={state.tone}>{state.label}</Tone><span className="text-xs text-nevoa">{phone(session.phone_number)}</span></div>
              <p className="text-sm text-nevoa">{state.detail}</p>
              <SyncProgress session={session} />
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-branco-cru"><History size={15} />Histórico de sincronização</h3>
                <div className="mt-2 space-y-2">
                  {history.data?.length ? history.data.map((job) => (
                    <div key={job.id} className="rounded-lg border border-grafite-elevado p-3 text-xs">
                      <div className="flex items-center justify-between gap-2"><span className="text-branco-cru">{job.status}</span><span className="text-nevoa">{formatRelativeTime(job.created_at)}</span></div>
                      <p className="mt-1 text-nevoa">{job.processed_contacts} contatos · {job.processed_chats} conversas · {job.processed_messages} mensagens</p>
                      {(job.error || job.failures.length > 0) && <p className="mt-1 text-aviso">{job.error ?? `${job.failures.length} pendência(s)`}</p>}
                      {['failed', 'completed_with_errors'].includes(job.status) && <button type="button" onClick={() => retry.mutate(job.id)} disabled={retry.isPending} className="mt-2 inline-flex items-center gap-1 text-sinal"><RefreshCw size={12} />Tentar novamente</button>}
                    </div>
                  )) : <p className="text-xs text-nevoa">Nenhuma sincronização concluída ainda.</p>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-grafite-elevado pt-4">
                <button type="button" onClick={() => reconnect.mutate()} disabled={reconnect.isPending} className="inline-flex items-center gap-2 rounded-md border border-grafite-elevado px-3 py-2 text-sm text-nevoa"><RefreshCw size={14} />Reconectar</button>
                <button type="button" onClick={() => { if (window.confirm('Desconectar este WhatsApp? O número precisará de um novo QR Code para voltar.')) disconnect.mutate(undefined, { onSuccess: onClose }); }} disabled={disconnect.isPending} className="inline-flex items-center gap-2 rounded-md border border-erro/40 px-3 py-2 text-sm text-erro"><Unplug size={14} />Desconectar</button>
              </div>
              {(reconnect.isError || disconnect.isError) && <p className="text-sm text-erro">{errorMessage(reconnect.error ?? disconnect.error)}</p>}
            </div>
          )}
        </div>
        <div className="flex justify-end border-t border-grafite-elevado p-4"><button type="button" onClick={onClose} className="rounded-md border border-grafite-elevado px-4 py-2 text-sm text-nevoa hover:text-branco-cru">{connected ? 'Fechar' : 'Cancelar'}</button></div>
      </div>
    </div>
  );
}

function SyncProgress({ session }: { session: WhatsappOpenwaSession }) {
  const sync = session.latest_sync;
  if (!sync) return <p className="mt-4 text-sm text-nevoa">Aguardando o início da sincronização…</p>;
  const running = ['queued', 'running'].includes(sync.status);
  const labels: Record<string, string> = { queued: 'Na fila para sincronizar', contacts: 'Importando a agenda de contatos…', chats: 'Sincronizando conversas…', messages: 'Importando conversas, das mais recentes para as mais antigas…', photos: 'Buscando fotos de perfil…', completed: 'Sincronização concluída', completed_with_errors: 'Sincronização concluída com pendências', failed: 'Falha na sincronização' };
  return (
    <div className="mt-5 rounded-xl border border-grafite-elevado bg-carbono p-4 text-left">
      <div className="flex items-center gap-2">{running ? <Loader2 size={16} className="animate-spin text-sinal" /> : sync.status === 'failed' ? <AlertTriangle size={16} className="text-erro" /> : <CheckCircle2 size={16} className="text-sucesso" />}<p className="text-sm font-medium text-branco-cru">{labels[sync.phase] ?? labels[sync.status] ?? 'Sincronizando…'}</p></div>
      {running && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-grafite-elevado"><div className="h-full w-1/3 animate-pulse rounded-full bg-sinal" /></div>}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div><p className="text-nevoa">Contatos</p><p className="mt-1 text-branco-cru">{sync.processed_contacts}</p></div><div><p className="text-nevoa">Conversas</p><p className="mt-1 text-branco-cru">{sync.processed_chats}</p></div><div><p className="text-nevoa">Mensagens</p><p className="mt-1 text-branco-cru">{sync.processed_messages}</p></div></div>
      {sync.failures.length > 0 && <p className="mt-3 text-xs text-aviso">{sync.failures.length} pendência(s). Consulte Gerenciar conexão para tentar novamente.</p>}
      {sync.error && <p className={cn('mt-3 text-xs', running ? 'text-nevoa' : 'text-erro')}>{sync.error}</p>}
    </div>
  );
}
