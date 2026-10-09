'use client';

import Link from 'next/link';
import { useAgencyControlCenter } from '@/hooks/use-agency-control-center';
import { LinhasFantasma, SemNadaAinda, StatusDot, type Estado } from './primitives';
import { Numero } from './painel-do-dono';
import { ApiRequestError } from '@/lib/api/client';

/**
 * CONTROLE DA AGÊNCIA (§52-59 do prompt de refinamento "FINAL PRODUCT
 * REFINEMENT", 06/10/2026) — "a home da gestão". Consome /agency-control-center
 * (apps/api/src/agency-control-center/routes.ts).
 *
 * NÃO confundir com PainelDoDono (acima, "A agência agora"): aquele é uso de
 * IA/infra; isto é o TRABALHO — demanda, aprovação, cliente em atenção, carga
 * por colaborador. As duas perguntas são diferentes e cabem na mesma home.
 *
 * O que NÃO está aqui, de propósito (documentado com o motivo exato no
 * cabeçalho da rota): spend agregado de mídia de todos os clientes (exigiria
 * uma chamada externa por cliente a cada carregamento da tela) e filtro por
 * "equipe" (não existe esse conceito modelado ainda, só "área" via
 * responsibility). "Campanhas em alerta" também fica de fora pelo mesmo
 * motivo do spend.
 */
export function ControleDaAgencia() {
  const { data, isPending, isError, error } = useAgencyControlCenter();

  if (isPending) return <LinhasFantasma linhas={4} />;
  // 403 = o workspace desta pessoa não inclui o módulo "operação" (Workspace
  // Builder) — não é falha, é a seção não sendo pra ela. Sem caixa de erro:
  // a home só não mostra esta seção, igual a qualquer outra de navegação
  // escondida por módulo.
  if (error instanceof ApiRequestError && error.status === 403) return null;
  if (isError || !data) {
    return (
      <SemNadaAinda
        titulo="Não consegui montar o controle da agência"
        explicacao="A consulta falhou. Isto não quer dizer que a operação está parada, quer dizer que não deu para olhar."
      />
    );
  }

  /**
   * Sete blocos de fontes diferentes num agregado só. A guarda acima pergunta
   * se `data` existe; não pergunta se cada bloco veio. Um deles faltando —
   * integração fora, consulta que falhou do lado do servidor — estourava no
   * render e levava a tela inteira (mesmo defeito do painel do dono,
   * 08/10/2026). Bloco ausente vira bloco vazio: mostra menos, nunca some.
   */
  const {
    kpis = { clientes_ativos: 0, conversas_aguardando: 0, demandas_abertas: 0, atrasados: 0, aguardando_aprovacao: 0, previstas_hoje: 0 },
    funil_de_workflow: funil = { novas: 0, briefing: 0, producao: 0, revisao: 0, aprovacao: 0, concluido: 0 },
    clientes_em_atencao: atencao = [],
    operacao_por_colaborador: operacao = [],
    media_summary: media = { clientes_com_meta_conectado: 0, clientes_com_google_ads_conectado: 0, performance_agregada_disponivel: false as const },
    clickup_summary: clickup = null,
    integration_health: saude = {
      clickup: { status: 'desconhecido', last_event_at: null },
      whatsapp: { status: 'desconhecido' },
      meta: { status: 'desconhecido', collaborator_connections: 0 },
      google_ads: { status: 'desconhecido', collaborator_connections: 0 },
      calendar: { status: 'desconhecido', collaborator_connections: 0 },
    },
  } = data;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Numero rotulo="Clientes ativos" valor={String(kpis.clientes_ativos)} href="/clients" />
        <Numero
          rotulo="Conversas aguardando"
          valor={String(kpis.conversas_aguardando)}
          href="/inbox"
          alerta={kpis.conversas_aguardando > 0}
        />
        <Numero rotulo="Demandas abertas" valor={String(kpis.demandas_abertas)} href="/demands" />
        <Numero rotulo="Atrasados" valor={String(kpis.atrasados)} href="/demands" alerta={kpis.atrasados > 0} />
        <Numero
          rotulo="Aguardando aprovação"
          valor={String(kpis.aguardando_aprovacao)}
          href="/approvals"
          alerta={kpis.aguardando_aprovacao > 0}
        />
        <Numero rotulo="Previstas para hoje" valor={String(kpis.previstas_hoje)} href="/demands" />
      </div>

      <div>
        <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-nevoa">Funil de workflow</p>
        <div className="flex gap-2 overflow-x-auto">
          {[
            ['Novas', funil.novas],
            ['Briefing', funil.briefing],
            ['Produção', funil.producao],
            ['Revisão', funil.revisao],
            ['Aprovação', funil.aprovacao],
            ['Concluído', funil.concluido],
          ].map(([rotulo, valor]) => (
            <div key={rotulo as string} className="min-w-[110px] flex-1 rounded-lg border border-grafite-elevado bg-grafite px-3 py-2.5 text-center">
              <p className="font-heading text-xl font-semibold text-branco-cru">{valor}</p>
              <p className="mt-0.5 text-[11px] text-nevoa">{rotulo}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-nevoa">Clientes em atenção</p>
          {atencao.length === 0 ? (
            <SemNadaAinda titulo="Nada pedindo atenção agora" explicacao="Nenhum cliente com demanda atrasada ou aprovação pendente." />
          ) : (
            <ul className="divide-y divide-grafite-elevado/60 rounded-lg border border-grafite-elevado bg-grafite">
              {atencao.map((c) => (
                <li key={c.client_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <Link href={`/clients?id=${encodeURIComponent(c.client_id)}`} className="min-w-0 flex-1 truncate text-sm text-branco-cru hover:underline">
                    {c.client_name}
                  </Link>
                  <span className="shrink-0 font-mono text-[11px] text-aviso">
                    {[
                      c.demandas_atrasadas > 0 ? `${c.demandas_atrasadas} atrasada(s)` : null,
                      c.aprovacoes_pendentes > 0 ? `${c.aprovacoes_pendentes} aprovação(ões)` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-nevoa">{c.responsavel ?? 'sem responsável'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-nevoa">Operação por colaborador</p>
          {operacao.length === 0 ? (
            <SemNadaAinda titulo="Ninguém com carga agora" explicacao="Nenhum colaborador com demanda ou aprovação em aberto." />
          ) : (
            <div className="overflow-hidden rounded-lg border border-grafite-elevado bg-grafite">
              <table className="w-full text-sm">
                <thead className="bg-grafite-elevado/50 text-left font-mono text-[10px] uppercase tracking-wider text-nevoa">
                  <tr>
                    <th className="px-3 py-2">Pessoa</th>
                    <th className="px-3 py-2 text-right">Clientes</th>
                    <th className="px-3 py-2 text-right">Em andamento</th>
                    <th className="px-3 py-2 text-right">Atrasados</th>
                    <th className="px-3 py-2 text-right">Aprovações</th>
                  </tr>
                </thead>
                <tbody>
                  {operacao.map((p) => (
                    <tr key={p.id} className="border-t border-grafite-elevado/60">
                      <td className="px-3 py-2 text-branco-cru">{p.name}</td>
                      <td className="px-3 py-2 text-right text-nevoa">{p.clientes}</td>
                      <td className="px-3 py-2 text-right text-nevoa">{p.em_andamento}</td>
                      <td className={`px-3 py-2 text-right ${p.atrasados > 0 ? 'text-aviso' : 'text-nevoa'}`}>{p.atrasados}</td>
                      <td className="px-3 py-2 text-right text-nevoa">{p.aprovacoes_pendentes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {clickup && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase tracking-wider text-nevoa">ClickUp</p>
            <Link href="/tasks" className="font-mono text-[11px] text-nevoa hover:text-branco-cru">
              Ver tarefas →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-grafite-elevado bg-grafite px-3 py-2.5">
              <p className="font-heading text-xl font-semibold text-branco-cru">{clickup.total_tarefas}</p>
              <p className="mt-0.5 text-[11px] text-nevoa">Total</p>
            </div>
            <div className="rounded-lg border border-grafite-elevado bg-grafite px-3 py-2.5">
              <p className="font-heading text-xl font-semibold text-branco-cru">{clickup.abertas}</p>
              <p className="mt-0.5 text-[11px] text-nevoa">Abertas</p>
            </div>
            <div className="rounded-lg border border-grafite-elevado bg-grafite px-3 py-2.5">
              <p className={`font-heading text-xl font-semibold ${clickup.atrasadas > 0 ? 'text-aviso' : 'text-branco-cru'}`}>{clickup.atrasadas}</p>
              <p className="mt-0.5 text-[11px] text-nevoa">Atrasadas</p>
            </div>
            <div className="flex flex-wrap content-center gap-1 rounded-lg border border-grafite-elevado bg-grafite px-3 py-2.5">
              {clickup.por_status.map((s) => (
                <span key={s.status} className="rounded-full bg-grafite-elevado px-2 py-0.5 text-[10px] text-nevoa">
                  {s.status} · {s.total}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-nevoa">Mídia</p>
          <div className="rounded-lg border border-grafite-elevado bg-grafite px-4 py-3 text-sm text-branco-cru">
            <p>{media.clientes_com_meta_conectado} cliente(s) com Meta Ads conectado</p>
            <p className="mt-1">{media.clientes_com_google_ads_conectado} cliente(s) com Google Ads conectado</p>
            <p className="mt-2 text-[11px] text-nevoa">
              Performance agregada de todos os clientes ainda não disponível aqui — veja investimento e campanhas na ficha de cada cliente, aba Mídia.
            </p>
          </div>
        </div>

        <div>
          <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-nevoa">Saúde das integrações</p>
          <div className="space-y-1.5 rounded-lg border border-grafite-elevado bg-grafite px-4 py-3">
            <SaudeLinha label="WhatsApp" status={saude.whatsapp.status} />
            <SaudeLinha label="ClickUp" status={saude.clickup.status} />
            <SaudeLinha label="Meta Ads" status={saude.meta.status} detalhe={saude.meta.collaborator_connections > 0 ? `${saude.meta.collaborator_connections} conexão(ões)` : undefined} />
            <SaudeLinha label="Google Ads" status={saude.google_ads.status} detalhe={saude.google_ads.collaborator_connections > 0 ? `${saude.google_ads.collaborator_connections} conexão(ões)` : undefined} />
            <SaudeLinha label="Calendário" status={saude.calendar.status} />
          </div>
        </div>
      </div>
    </div>
  );
}

function estadoDe(status: string): Estado {
  if (status === 'conectado' || status === 'ativa' || status === 'ok') return 'ok';
  if (status === 'nao_implementado' || status === 'unknown') return 'desconhecido';
  if (status === 'degraded') return 'atencao';
  return 'erro';
}

function rotuloDe(status: string): string {
  if (status === 'nao_implementado') return 'não implementado';
  if (status === 'conectado' || status === 'ativa' || status === 'ok') return 'conectado';
  if (status === 'desconectado') return 'desconectado';
  return status;
}

function SaudeLinha({ label, status, detalhe }: { label: string; status: string; detalhe?: string | undefined }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="flex items-center gap-2 text-branco-cru">
        <StatusDot estado={estadoDe(status)} />
        {label}
      </span>
      <span className="font-mono text-[11px] text-nevoa">
        {rotuloDe(status)}
        {detalhe ? ` · ${detalhe}` : ''}
      </span>
    </div>
  );
}
