'use client';

import { useState } from 'react';
import { Bell, Check, Eye, Play, Plus, Trash2 } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError } from '@/lib/api/client';
import {
  useDecideAction,
  useDeleteAlertRule,
  useDeleteReportSchedule,
  useMediaActions,
  useMediaReportSchedules,
  useSaveReportSchedule,
  useDeleteTemplate,
  useEvaluateAlerts,
  useMediaAlertRules,
  useMediaAlerts,
  useMediaDestinations,
  useMediaSettings,
  useMediaTemplates,
  usePreviewTemplate,
  useSaveAlertRule,
  useSaveTemplate,
  useSetAlertStatus,
  useSetMediaSetting,
} from '@/hooks/use-media';
import { ALERT_TYPE_LABEL, ALERT_TYPE_UNIT, MEDIA_PERIODS, type MediaAlertRule, type MediaDestination, type MediaLinkedAccount } from '@/lib/api/media';
import { cn } from '@/lib/utils';
import { dash, when } from './format';
import { CompartilharNaComunicacao } from '@/components/comunicacao/compartilhar-na-comunicacao';

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiRequestError ? e.message : fallback);

const SEVERITY = { info: 'bg-grafite-elevado text-nevoa', warning: 'bg-aviso/15 text-aviso', critical: 'bg-erro/15 text-erro' } as const;
const DELIVERY: Record<string, string> = {
  not_requested: 'Só registrado (sem envio)',
  suppressed: 'Envio bloqueado',
  queued: 'Na fila',
  sent: 'Enviado',
  failed: 'Falhou',
};

// ── Alertas ──────────────────────────────────────────────────────────────

export function AlertsTab({ clientId, accounts }: { clientId: string; accounts: MediaLinkedAccount[] }) {
  const events = useMediaAlerts(clientId);
  const rules = useMediaAlertRules(clientId);
  const setStatus = useSetAlertStatus();
  const evaluate = useEvaluateAlerts();
  const del = useDeleteAlertRule();
  const save = useSaveAlertRule();
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-heading text-base font-semibold text-branco-cru">Alertas deste cliente</h3>
        <button type="button" onClick={() => evaluate.mutate()} disabled={evaluate.isPending} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-grafite-elevado px-3 py-1.5 text-sm text-nevoa hover:text-branco-cru disabled:opacity-40">
          <Play size={13} /> {evaluate.isPending ? 'Avaliando…' : 'Avaliar agora'}
        </button>
      </div>
      {evaluate.data && (
        <p className="text-sm text-nevoa">
          {evaluate.data.rulesEvaluated} regras avaliadas, {evaluate.data.fired} disparadas, {evaluate.data.deduped} já registradas nesta janela.
        </p>
      )}

      {events.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : (events.data?.alerts.length ?? 0) === 0 ? (
        <Surface className="p-5 text-sm text-nevoa">Nenhum alerta registrado para este cliente.</Surface>
      ) : (
        <ul className="space-y-2">
          {events.data!.alerts.map((a) => (
            <Surface key={a.id} className="flex flex-wrap items-center gap-3 p-3">
              <span className={cn('rounded-full px-2 py-0.5 text-[11px]', SEVERITY[a.severity])}>{a.severity === 'critical' ? 'Crítico' : a.severity === 'warning' ? 'Atenção' : 'Info'}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-branco-cru">{a.title}</p>
                <p className="text-[11px] text-nevoa">
                  {when(a.firedAt)} · {DELIVERY[a.delivery] ?? a.delivery}
                  {a.deliveryError ? ` — ${a.deliveryError}` : ''}
                </p>
              </div>
              <span className="text-[11px] text-nevoa">{a.status === 'open' ? 'Aberto' : a.status === 'resolved' ? 'Resolvido' : 'Ignorado'}</span>
              <CompartilharNaComunicacao compacto objeto={{ type: 'media_alert', id: a.id, label: a.title }} />
              {a.status === 'open' ? (
                <>
                  <button type="button" onClick={() => setStatus.mutate({ id: a.id, status: 'resolved' })} className="rounded-md border border-grafite-elevado px-2 py-1 text-xs text-nevoa hover:text-branco-cru">Resolver</button>
                  <button type="button" onClick={() => setStatus.mutate({ id: a.id, status: 'ignored' })} className="rounded-md border border-grafite-elevado px-2 py-1 text-xs text-nevoa hover:text-branco-cru">Ignorar</button>
                </>
              ) : (
                <button type="button" onClick={() => setStatus.mutate({ id: a.id, status: 'open' })} className="rounded-md border border-grafite-elevado px-2 py-1 text-xs text-nevoa hover:text-branco-cru">Reabrir</button>
              )}
            </Surface>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-3 pt-2">
        <h3 className="font-heading text-base font-semibold text-branco-cru">Regras</h3>
        <button type="button" onClick={() => setCreating(!creating)} className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-3 py-1.5 text-sm text-branco-cru hover:opacity-90">
          <Plus size={13} /> Nova regra
        </button>
      </div>
      {creating && <RuleForm clientId={clientId} accounts={accounts} onDone={() => setCreating(false)} saveMutation={save} />}

      {rules.isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : (rules.data?.rules.length ?? 0) === 0 ? (
        <Surface className="p-5 text-sm text-nevoa">
          <Bell size={16} className="mb-2" /> Nenhuma regra ainda. Crie uma para ser avisado de saldo baixo, CPL alto, queda de resultados ou campanha reprovada.
        </Surface>
      ) : (
        <ul className="space-y-2">
          {rules.data!.rules.map((r) => (
            <RuleRow key={r.id} rule={r} accounts={accounts} onDelete={() => del.mutate(r.id)} save={save} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DestinationSelect({ value, onChange }: { value: MediaDestination | null; onChange: (d: MediaDestination | null) => void }) {
  const dest = useMediaDestinations();
  if (dest.isPending) return <Skeleton className="h-9 w-64" />;
  if (dest.isError || !dest.data) return <p className="text-xs text-erro">Não consegui listar os destinos de WhatsApp.</p>;
  const { groups, contacts, sessions } = dest.data;
  const ready = sessions.some((s) => s.status === 'ready');
  if (!ready) {
    return <p className="text-xs text-aviso">Nenhuma sessão de WhatsApp conectada ({sessions.length ? `status: ${sessions.map((s) => s.status).join(', ')}` : 'nenhuma sessão criada'}). Conecte uma sessão para escolher grupo ou contato.</p>;
  }
  const key = (d: MediaDestination) => `${d.kind}:${d.externalId}`;
  return (
    <select
      value={value ? key(value) : ''}
      onChange={(e) => {
        const all = [...groups, ...contacts];
        const hit = all.find((d) => key(d) === e.target.value);
        onChange(hit ? { kind: hit.kind, externalId: hit.externalId, label: hit.label } : null);
      }}
      aria-label="Destino do WhatsApp"
      className="max-w-[320px] rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru"
    >
      <option value="">Sem envio (só registrar)</option>
      <optgroup label={`Grupos (${groups.length})`}>
        {groups.map((g) => (
          <option key={key(g)} value={key(g)}>{g.label}</option>
        ))}
      </optgroup>
      <optgroup label={`Contatos (${contacts.length})`}>
        {contacts.map((c) => (
          <option key={key(c)} value={key(c)}>{c.label}</option>
        ))}
      </optgroup>
    </select>
  );
}

function RuleForm({ clientId, accounts, onDone, saveMutation }: { clientId: string; accounts: MediaLinkedAccount[]; onDone: () => void; saveMutation: ReturnType<typeof useSaveAlertRule> }) {
  const [accountId, setAccountId] = useState(accounts[0]?.accountId ?? '');
  const [type, setType] = useState('low_balance');
  const [threshold, setThreshold] = useState('');
  const [windowDays, setWindowDays] = useState(7);
  const [destination, setDestination] = useState<MediaDestination | null>(null);
  const unit = ALERT_TYPE_UNIT[type];

  return (
    <Surface className="space-y-3 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-nevoa">Conta<select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="mt-1 block rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru">{accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.name ?? a.accountId}</option>)}</select></label>
        <label className="text-xs text-nevoa">Tipo<select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 block rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru">{Object.entries(ALERT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {unit && <label className="text-xs text-nevoa">Limite ({unit})<input value={threshold} onChange={(e) => setThreshold(e.target.value)} inputMode="decimal" className="mt-1 block w-32 rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru" /></label>}
        {type !== 'low_balance' && type !== 'budget_limit' && type !== 'sync_failed' && type !== 'account_inactive' && (
          <label className="text-xs text-nevoa">Janela (dias)<input type="number" min={1} max={30} value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))} className="mt-1 block w-20 rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru" /></label>
        )}
      </div>
      {type === 'low_balance' && <p className="text-xs text-aviso">Saldo de contas pós-pagas costuma ser indisponível pela API. Nessas contas esta regra fica inativa e a tela avisa, em vez de estimar.</p>}
      <div className="text-xs text-nevoa">Aviso por WhatsApp (opcional)<div className="mt-1"><DestinationSelect value={destination} onChange={setDestination} /></div><p className="mt-1">O envio só liga depois, de propósito, no botão da regra.</p></div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={saveMutation.isPending || !accountId || (unit !== null && unit !== undefined && threshold === '')}
          onClick={() =>
            saveMutation.mutate(
              { body: { client_id: clientId, account_id: accountId, type, threshold: unit ? Number(threshold.replace(',', '.')) : null, window_days: windowDays, destination } },
              { onSuccess: onDone },
            )
          }
          className="inline-flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-3 py-1.5 text-sm text-branco-cru hover:opacity-90 disabled:opacity-40"
        >
          <Check size={13} /> Salvar regra
        </button>
        <button type="button" onClick={onDone} className="rounded-md border border-grafite-elevado px-3 py-1.5 text-sm text-nevoa hover:text-branco-cru">Cancelar</button>
      </div>
      {saveMutation.isError && <p className="text-sm text-erro">{errMsg(saveMutation.error, 'Não consegui salvar a regra.')}</p>}
    </Surface>
  );
}

function RuleRow({ rule, accounts, onDelete, save }: { rule: MediaAlertRule; accounts: MediaLinkedAccount[]; onDelete: () => void; save: ReturnType<typeof useSaveAlertRule> }) {
  const account = accounts.find((a) => a.accountId === rule.accountExternalId);
  return (
    <Surface className="flex flex-wrap items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-branco-cru">{ALERT_TYPE_LABEL[rule.type] ?? rule.type}{rule.threshold !== null ? ` · limite ${Number(rule.threshold)}` : ''}</p>
        <p className="text-[11px] text-nevoa">
          {account?.name ?? rule.accountExternalId} · janela {rule.windowDays}d · cooldown {rule.cooldownHours}h · destino: {rule.destination?.label ?? dash} · última avaliação {when(rule.lastEvaluatedAt)}
        </p>
      </div>
      <label className="flex items-center gap-1.5 text-xs text-nevoa"><input type="checkbox" checked={rule.enabled} onChange={(e) => save.mutate({ id: rule.id, body: { enabled: e.target.checked } })} /> Ativa</label>
      <label className="flex items-center gap-1.5 text-xs text-nevoa" title={rule.destination ? '' : 'Escolha um destino para ligar o envio'}>
        <input type="checkbox" checked={rule.sendEnabled} disabled={!rule.destination} onChange={(e) => save.mutate({ id: rule.id, body: { send_enabled: e.target.checked } })} /> Enviar WhatsApp
      </label>
      <button type="button" onClick={onDelete} aria-label="Excluir regra" className="text-nevoa hover:text-erro"><Trash2 size={14} /></button>
      {save.isError && <p className="w-full text-xs text-erro">{errMsg(save.error, 'Não consegui salvar.')}</p>}
    </Surface>
  );
}

// ── Configurações ────────────────────────────────────────────────────────

const SOURCE_LABEL = { default: 'padrão do sistema', organization: 'empresa', client: 'este cliente', account: 'esta conta' } as const;

export function SettingsTab({ clientId, accountId }: { clientId: string | null; accountId: string | null }) {
  const settings = useMediaSettings(clientId, accountId);
  const set = useSetMediaSetting();
  const [scope, setScope] = useState<'client' | 'organization' | 'account'>(clientId ? 'client' : 'organization');

  if (settings.isPending) return <Skeleton className="h-48 w-full" />;
  if (settings.isError || !settings.data?.values || !settings.data.source) return <Surface className="p-5 text-sm text-erro">Não consegui carregar as configurações.</Surface>;
  const v = settings.data.values;
  const src = settings.data.source;
  const target = { clientId: scope === 'organization' ? null : clientId, accountId: scope === 'account' ? accountId : null };
  const put = (key: string, value: unknown) => set.mutate({ key, value, ...target });
  const reset = (key: string) => set.mutate({ key, reset: true, ...target });
  const perms = v['agent.permissions'] as { analyze: boolean; generateReports: boolean; prepareMessages: boolean; proposeActions: boolean };

  const Row = ({ k, label, children }: { k: string; label: string; children: React.ReactNode }) => (
    <div className="flex flex-wrap items-center gap-3 border-b border-grafite-elevado/50 py-3 last:border-0">
      <div className="min-w-[220px] flex-1">
        <p className="text-sm text-branco-cru">{label}</p>
        <p className="text-[11px] text-nevoa">Valendo de: {SOURCE_LABEL[src[k] ?? 'default']}</p>
      </div>
      {children}
      {src[k] === scope && <button type="button" onClick={() => reset(k)} className="text-[11px] text-nevoa underline hover:text-branco-cru">Voltar ao herdado</button>}
    </div>
  );

  return (
    <div className="space-y-5">
      <Surface className="p-4">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h3 className="font-heading text-base font-semibold text-branco-cru">Mídia e performance</h3>
          <label className="ml-auto flex items-center gap-2 text-xs text-nevoa">
            Gravar em
            <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} className="rounded-md border border-grafite-elevado bg-carbono px-2 py-1 text-sm text-branco-cru">
              <option value="organization">Toda a empresa</option>
              {clientId && <option value="client">Só este cliente</option>}
              {clientId && accountId && <option value="account">Só esta conta</option>}
            </select>
          </label>
        </div>
        <p className="mb-2 text-xs text-nevoa">Estas configurações são as mesmas que os alertas, os relatórios, o envio por WhatsApp e os agentes usam. Mais específico vence: conta, depois cliente, depois empresa.</p>

        <Row k="dashboard.defaultPeriod" label="Período padrão do painel">
          <select value={String(v['dashboard.defaultPeriod'])} onChange={(e) => put('dashboard.defaultPeriod', e.target.value)} className="rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru">
            {MEDIA_PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </Row>
        <Row k="dashboard.compareWithPrevious" label="Comparar com o período anterior">
          <input type="checkbox" checked={Boolean(v['dashboard.compareWithPrevious'])} onChange={(e) => put('dashboard.compareWithPrevious', e.target.checked)} />
        </Row>
        <Row k="alerts.defaultCooldownHours" label="Intervalo mínimo entre avisos iguais (horas)">
          <input type="number" min={1} max={720} defaultValue={Number(v['alerts.defaultCooldownHours'])} onBlur={(e) => Number(e.target.value) !== v['alerts.defaultCooldownHours'] && put('alerts.defaultCooldownHours', Number(e.target.value))} className="w-24 rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru" />
        </Row>
        <Row k="reports.defaultPeriodDays" label="Período padrão dos relatórios (dias)">
          <input type="number" min={1} max={90} defaultValue={Number(v['reports.defaultPeriodDays'])} onBlur={(e) => Number(e.target.value) !== v['reports.defaultPeriodDays'] && put('reports.defaultPeriodDays', Number(e.target.value))} className="w-24 rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru" />
        </Row>
        <Row k="reports.includeAgentAnalysis" label="Incluir análise de IA nos relatórios">
          <input type="checkbox" checked={Boolean(v['reports.includeAgentAnalysis'])} onChange={(e) => put('reports.includeAgentAnalysis', e.target.checked)} />
        </Row>
      </Surface>

      <Surface className="p-4">
        <h3 className="mb-2 font-heading text-base font-semibold text-branco-cru">WhatsApp</h3>
        <Row k="whatsapp.sendEnabled" label="Permitir envio automático para clientes">
          <label className="flex items-center gap-2 text-xs text-nevoa">
            <input type="checkbox" checked={Boolean(v['whatsapp.sendEnabled'])} onChange={(e) => put('whatsapp.sendEnabled', e.target.checked)} />
            {v['whatsapp.sendEnabled'] ? 'Ligado: regras com envio ativo podem mandar mensagem' : 'Desligado: nada é enviado, alertas só ficam registrados'}
          </label>
        </Row>
        <Row k="whatsapp.defaultDestination" label="Destino padrão">
          <DestinationSelect value={(v['whatsapp.defaultDestination'] as MediaDestination | null) ?? null} onChange={(d) => put('whatsapp.defaultDestination', d)} />
        </Row>
        <Row k="whatsapp.sendWindow" label="Horário permitido para envio (Brasília)">
          <span className="flex items-center gap-2 text-sm text-nevoa">
            <input type="time" defaultValue={(v['whatsapp.sendWindow'] as { start: string }).start} onBlur={(e) => put('whatsapp.sendWindow', { ...(v['whatsapp.sendWindow'] as { start: string; end: string }), start: e.target.value })} className="rounded-md border border-grafite-elevado bg-carbono px-2 py-1 text-branco-cru" />
            até
            <input type="time" defaultValue={(v['whatsapp.sendWindow'] as { end: string }).end} onBlur={(e) => put('whatsapp.sendWindow', { ...(v['whatsapp.sendWindow'] as { start: string; end: string }), end: e.target.value })} className="rounded-md border border-grafite-elevado bg-carbono px-2 py-1 text-branco-cru" />
          </span>
        </Row>
      </Surface>

      <Surface className="p-4">
        <h3 className="mb-1 font-heading text-base font-semibold text-branco-cru">Agentes de IA</h3>
        <p className="mb-2 text-xs text-nevoa">O que um agente pode fazer com a mídia deste escopo. Alterar campanha na plataforma nunca é automático: um agente só propõe, e uma pessoa aprova.</p>
        {(['analyze', 'generateReports', 'prepareMessages', 'proposeActions'] as const).map((k) => (
          <label key={k} className="flex items-center gap-2 py-1 text-sm text-nevoa">
            <input type="checkbox" checked={perms[k]} onChange={(e) => put('agent.permissions', { ...perms, [k]: e.target.checked })} />
            {{ analyze: 'Analisar desempenho', generateReports: 'Gerar relatórios', prepareMessages: 'Preparar mensagens', proposeActions: 'Propor ações em campanhas' }[k]}
          </label>
        ))}
        <p className="mt-1 text-[11px] text-nevoa">Valendo de: {SOURCE_LABEL[src['agent.permissions'] ?? 'default']}</p>
      </Surface>

      {set.isError && <p className="text-sm text-erro">{errMsg(set.error, 'Não consegui salvar a configuração.')}</p>}

      <TemplatesSection />
    </div>
  );
}

function TemplatesSection() {
  const list = useMediaTemplates();
  const save = useSaveTemplate();
  const del = useDeleteTemplate();
  const preview = usePreviewTemplate();
  const [editing, setEditing] = useState<{ id: string | null; code: string | null; name: string; body: string } | null>(null);

  return (
    <Surface className="p-4">
      <div className="mb-2 flex items-center gap-3">
        <h3 className="font-heading text-base font-semibold text-branco-cru">Mensagens</h3>
        <button type="button" onClick={() => setEditing({ id: null, code: null, name: '', body: '' })} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-grafite-elevado px-3 py-1.5 text-sm text-nevoa hover:text-branco-cru"><Plus size={13} /> Nova mensagem</button>
      </div>
      <p className="mb-3 text-xs text-nevoa">Variáveis: {'{cliente} {plataforma} {conta} {saldo} {orcamento} {investimento} {cpl} {cpa} {leads} {periodo} {data} {link_relatorio}'}. Se uma variável não tiver valor no momento do envio (ex.: saldo indisponível), a mensagem não sai.</p>
      {list.isPending ? <Skeleton className="h-20 w-full" /> : (
        <ul className="space-y-2">
          {list.data!.templates.map((t) => (
            <li key={t.id ?? t.code} className="rounded-md border border-grafite-elevado p-3">
              <div className="flex items-center gap-2">
                <p className="text-sm text-branco-cru">{t.name}</p>
                {t.isDefault && <span className="rounded-full bg-grafite-elevado px-2 py-0.5 text-[10px] text-nevoa">padrão</span>}
                <button type="button" className="ml-auto text-xs text-nevoa underline hover:text-branco-cru" onClick={() => { setEditing({ id: t.id, code: t.code, name: t.name, body: t.body }); preview.reset(); }}>{t.isDefault ? 'Personalizar' : 'Editar'}</button>
                {t.id && <button type="button" onClick={() => del.mutate(t.id!)} aria-label="Excluir" className="text-nevoa hover:text-erro"><Trash2 size={13} /></button>}
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-nevoa">{t.body}</p>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <div className="mt-3 space-y-2 rounded-md border border-roxo-eletrico/40 p-3">
          <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Nome" aria-label="Nome da mensagem" className="w-full rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru" />
          <textarea value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={4} aria-label="Texto da mensagem" className="w-full rounded-md border border-grafite-elevado bg-carbono p-2 text-sm text-branco-cru" />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => preview.mutate(editing.body)} className="inline-flex items-center gap-1.5 rounded-md border border-grafite-elevado px-3 py-1.5 text-sm text-nevoa hover:text-branco-cru"><Eye size={13} /> Pré-visualizar</button>
            <button type="button" disabled={save.isPending || !editing.name || !editing.body} onClick={() => save.mutate(editing, { onSuccess: () => setEditing(null) })} className="inline-flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-3 py-1.5 text-sm text-branco-cru hover:opacity-90 disabled:opacity-40"><Check size={13} /> Salvar</button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-md border border-grafite-elevado px-3 py-1.5 text-sm text-nevoa hover:text-branco-cru">Cancelar</button>
          </div>
          {preview.data && (preview.data.ok ? <p className="whitespace-pre-line rounded-md bg-carbono p-2 text-sm text-branco-cru">{preview.data.text}<span className="mt-1 block text-[11px] text-nevoa">Exemplo com dados fictícios. Nada foi enviado.</span></p> : <p className="text-sm text-erro">Problema: {preview.data.reason === 'unknown_variables' ? `variáveis desconhecidas (${preview.data.variables?.join(', ')})` : 'mensagem vazia'}.</p>)}
          {save.isError && <p className="text-sm text-erro">{errMsg(save.error, 'Não consegui salvar a mensagem.')}</p>}
        </div>
      )}
    </Surface>
  );
}

// ── Relatórios agendados ─────────────────────────────────────────────────

const FREQ_LABEL = { daily: 'Todo dia', weekly: 'Toda semana', biweekly: 'A cada 15 dias', monthly: 'Todo mês' } as const;
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function ReportSchedulesSection({ clientId }: { clientId: string }) {
  const list = useMediaReportSchedules(clientId);
  const save = useSaveReportSchedule();
  const del = useDeleteReportSchedule();
  const [open, setOpen] = useState(false);
  const [frequency, setFrequency] = useState<keyof typeof FREQ_LABEL>('weekly');
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [hour, setHour] = useState(9);
  const [periodDays, setPeriodDays] = useState(7);

  return (
    <Surface className="space-y-3 p-4">
      <div className="flex items-center gap-3">
        <h3 className="font-heading text-base font-semibold text-branco-cru">Relatórios agendados</h3>
        <button type="button" onClick={() => setOpen(!open)} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-grafite-elevado px-3 py-1.5 text-sm text-nevoa hover:text-branco-cru"><Plus size={13} /> Novo agendamento</button>
      </div>
      <p className="text-xs text-nevoa">Gera o mesmo relatório do botão acima, no horário de Brasília. O envio automático do PDF por WhatsApp não está ligado: o relatório fica disponível aqui.</p>
      {open && (
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-roxo-eletrico/40 p-3">
          <label className="text-xs text-nevoa">Frequência<select value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)} className="mt-1 block rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru">{Object.entries(FREQ_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          {(frequency === 'weekly' || frequency === 'biweekly') && <label className="text-xs text-nevoa">Dia<select value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))} className="mt-1 block rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru">{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>}
          {frequency === 'monthly' && <label className="text-xs text-nevoa">Dia do mês<input type="number" min={1} max={28} value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))} className="mt-1 block w-20 rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru" /></label>}
          <label className="text-xs text-nevoa">Hora<input type="number" min={0} max={23} value={hour} onChange={(e) => setHour(Number(e.target.value))} className="mt-1 block w-20 rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru" /></label>
          <label className="text-xs text-nevoa">Período (dias)<input type="number" min={1} max={90} value={periodDays} onChange={(e) => setPeriodDays(Number(e.target.value))} className="mt-1 block w-24 rounded-md border border-grafite-elevado bg-carbono px-2 py-1.5 text-sm text-branco-cru" /></label>
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate({ body: { client_id: clientId, frequency, day_of_week: frequency === 'weekly' || frequency === 'biweekly' ? dayOfWeek : null, day_of_month: frequency === 'monthly' ? dayOfMonth : null, hour, period_days: periodDays } }, { onSuccess: () => setOpen(false) })}
            className="inline-flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-3 py-1.5 text-sm text-branco-cru hover:opacity-90 disabled:opacity-40"
          ><Check size={13} /> Salvar</button>
          {save.isError && <p className="w-full text-sm text-erro">{errMsg(save.error, 'Não consegui salvar o agendamento.')}</p>}
        </div>
      )}
      {list.isPending ? <Skeleton className="h-12 w-full" /> : (list.data?.schedules.length ?? 0) === 0 ? <p className="text-sm text-nevoa">Nenhum agendamento.</p> : (
        <ul className="space-y-2">
          {list.data!.schedules.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-md border border-grafite-elevado p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-branco-cru">{FREQ_LABEL[s.frequency]}{s.dayOfWeek !== null ? ` · ${WEEKDAYS[s.dayOfWeek]}` : ''}{s.dayOfMonth !== null ? ` · dia ${s.dayOfMonth}` : ''} · {String(s.hour).padStart(2, '0')}h</p>
                <p className="text-[11px] text-nevoa">Últimos {s.periodDays} dias · última geração {when(s.lastRunAt)}</p>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-nevoa"><input type="checkbox" checked={s.enabled} onChange={(e) => save.mutate({ id: s.id, body: { enabled: e.target.checked } })} /> Ativo</label>
              <button type="button" onClick={() => del.mutate(s.id)} aria-label="Excluir agendamento" className="text-nevoa hover:text-erro"><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}

// ── Ações propostas ──────────────────────────────────────────────────────

const ACTION_LABEL = { pause_campaign: 'Pausar campanha', resume_campaign: 'Reativar campanha', set_budget: 'Alterar orçamento diário' } as const;

export function ActionsSection() {
  const q = useMediaActions();
  const decide = useDecideAction();
  if (q.isPending) return <Skeleton className="h-16 w-full" />;
  const rows = q.data?.actions ?? [];
  if (rows.length === 0) return null;
  return (
    <Surface className="space-y-2 p-4">
      <h3 className="font-heading text-base font-semibold text-branco-cru">Ações propostas em campanhas</h3>
      <p className="text-xs text-nevoa">{q.data!.executionEnabled ? 'A execução está ligada neste servidor: aprovar altera a campanha no Meta.' : 'A execução está DESLIGADA neste servidor: aprovar registra a decisão, mas nada é alterado no Meta.'}</p>
      <ul className="space-y-2">
        {rows.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-md border border-grafite-elevado p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-branco-cru">{ACTION_LABEL[a.action]} · {a.clientName}</p>
              <p className="text-[11px] text-nevoa">Campanha {a.targetExternalId} · pedido por {a.requestedVia === 'agent' ? 'agente de IA' : 'pessoa'} · {a.status}{a.blockedReason ? ` — ${a.blockedReason}` : ''}</p>
            </div>
            {a.status === 'pending' && (
              <>
                <button type="button" disabled={decide.isPending} onClick={() => { if (window.confirm(`Confirmar: ${ACTION_LABEL[a.action]} (campanha ${a.targetExternalId})?`)) decide.mutate({ id: a.id, decision: 'approve' }); }} className="rounded-md bg-roxo-eletrico px-2 py-1 text-xs text-branco-cru hover:opacity-90">Aprovar</button>
                <button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, decision: 'reject' })} className="rounded-md border border-grafite-elevado px-2 py-1 text-xs text-nevoa hover:text-branco-cru">Rejeitar</button>
              </>
            )}
          </li>
        ))}
      </ul>
      {decide.isError && <p className="text-sm text-erro">{errMsg(decide.error, 'Não consegui registrar a decisão.')}</p>}
    </Surface>
  );
}
