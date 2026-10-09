'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  AlertTriangle,
  BarChart3,
  Eye,
  Link2,
  MousePointerClick,
  Plug,
  Search,
  Target,
  Wallet,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { LinhasFantasma, SemNadaAinda, StatusLabel, Tabela, Td, Th } from '@/components/control/primitives';
import { BentoInsights, type InsightDoBento } from '@/components/bento/painel-de-insights';
import { useMediaOverview } from '@/hooks/use-media-overview';
import { useMetaIntegration } from '@/hooks/use-meta-integration';
import { useGoogleAdsIntegration } from '@/hooks/use-google-ads-integration';
import { ApiRequestError } from '@/lib/api/client';
import { alertasDeMidia, resumoDeMidia } from '@/lib/resumo-de-midia';
import type { MediaOverviewClientWire } from '@/lib/api/contracts';

/**
 * MÍDIAS — a carteira inteira de tráfego pago numa tela.
 *
 * A pergunta que ela responde é a de quem cuida de mídia e abre o sistema de
 * manhã: "onde está entrando dinheiro agora, e o que ainda não está ligado?".
 *
 * CLIENTE SEM CONEXÃO APARECE, e aparece em destaque. A lista do que falta
 * conectar é metade do valor desta tela: um cliente pagando tráfego que
 * ninguém vinculou é dinheiro rodando fora do radar.
 *
 * NENHUM NÚMERO INVENTADO. "Conectado" não implica "tem número": conexão
 * revogada e API fora do ar são estados próprios, com o motivo escrito. As
 * contas ficam em `lib/resumo-de-midia.ts`, com teste, porque é ali que mora o
 * risco — e o risco não é errar a soma, é somar sobre buraco e apresentar o
 * resultado como se fosse a carteira inteira.
 *
 * O MOCKUP PEDE ROAS E CAC, E ELES NÃO ESTÃO AQUI. Os dois exigem RECEITA, e a
 * leitura do Meta hoje vai até gasto, impressão, clique e resultado. Um ROAS
 * inventado numa tela de mídia é pior que nenhum ROAS: é o número que decide
 * se a verba sobe ou desce.
 */

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const MOEDA_CENTAVOS = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const NUMERO = new Intl.NumberFormat('pt-BR');

function dinheiro(v: number | null | undefined, comCentavos = false): string {
  if (typeof v !== 'number') return 'sem leitura';
  return comCentavos ? MOEDA_CENTAVOS.format(v) : MOEDA.format(v);
}
function numero(v: number | null | undefined): string {
  return typeof v === 'number' ? NUMERO.format(v) : 'sem leitura';
}
function percentual(v: number | null | undefined): string {
  return typeof v === 'number' ? `${v.toFixed(2)}%` : 'sem leitura';
}

type Plataforma = 'todas' | 'meta';
type FiltroDeEstado = 'todos' | 'com-leitura' | 'sem-leitura' | 'sem-conta';

export default function MidiasPage() {
  const { data, isPending, isError, error } = useMediaOverview();
  const { data: meta } = useMetaIntegration();
  const { data: googleAds } = useGoogleAdsIntegration();

  const [busca, setBusca] = useState('');
  const [plataforma, setPlataforma] = useState<Plataforma>('todas');
  const [estado, setEstado] = useState<FiltroDeEstado>('todos');

  const todos = useMemo(() => data?.clients ?? [], [data]);

  /** O resumo é SEMPRE da carteira inteira, nunca do filtro. Um total que muda
   *  quando alguém digita na busca não é um total — é uma soma do que sobrou. */
  const resumo = useMemo(() => resumoDeMidia(todos), [todos]);
  const alertas = useMemo(() => alertasDeMidia(todos), [todos]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return todos.filter((c) => {
      if (termo && !c.client_name.toLowerCase().includes(termo)) return false;
      if (estado === 'com-leitura' && !(c.connected && c.data_available)) return false;
      if (estado === 'sem-leitura' && !(c.connected && !c.data_available)) return false;
      if (estado === 'sem-conta' && c.connected) return false;
      // Hoje `/media/overview` agrega só `client_meta_accounts`; quando o
      // Google Ads entrar na agregação, este filtro passa a separar de fato.
      if (plataforma === 'meta' && !c.connected) return false;
      return true;
    });
  }, [todos, busca, estado, plataforma]);

  const insights: InsightDoBento[] = useMemo(
    () =>
      alertas.slice(0, 6).map((a) => ({
        id: a.id,
        href: `/clients/${a.clienteId}`,
        /**
         * Conta que o sistema NÃO CONSEGUE LER é urgente; cliente sem conta
         * vinculada e campanha sem resultado são atenção. A diferença é quem
         * resolve: a primeira depende de alguém reconectar agora, as outras
         * duas são decisão de operação.
         */
        tom: a.tipo === 'sem-leitura' ? ('urgente' as const) : ('atencao' as const),
        texto:
          a.tipo === 'sem-conta' ? (
            <>
              <strong className="text-branco-cru">{a.clienteNome}</strong> não tem conta de anúncio vinculada. Se houver
              campanha rodando, ela não aparece em número nenhum desta tela.
            </>
          ) : a.tipo === 'sem-leitura' ? (
            <>
              Não consegui ler a conta de <strong className="text-branco-cru">{a.clienteNome}</strong>: {a.motivo}
            </>
          ) : (
            <>
              <strong className="text-branco-cru">{a.clienteNome}</strong> teve gasto no período e nenhum resultado
              registrado.
            </>
          ),
      })),
    [alertas],
  );

  // 403 = o workspace desta pessoa não inclui mídia. A tela diz isso em vez de
  // mostrar um erro técnico que ela não pode resolver sozinha.
  if (isError && error instanceof ApiRequestError && error.status === 403) {
    return (
      <div className="mx-auto max-w-[1400px]">
        <PageHeader title="Mídias" description="Tráfego pago da carteira." />
        <SemNadaAinda
          titulo="Mídia não faz parte do seu acesso"
          explicacao="Esta tela mostra investimento e resultado de campanha. Peça a quem administra a conta para incluir mídia no seu acesso."
        />
      </div>
    );
  }

  const contasConectadas = resumo.comLeitura + resumo.semLeitura;

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Mídias"
        description="Conecte as contas de anúncios, acompanhe campanhas e gerencie criativos em um só lugar."
      />

      {isPending ? (
        <LinhasFantasma linhas={6} />
      ) : isError ? (
        <SemNadaAinda
          titulo="Não consegui ler a mídia da carteira"
          explicacao="A consulta falhou. Enquanto ela não responder, não dá para afirmar quanto está sendo investido."
        />
      ) : todos.length === 0 ? (
        <SemNadaAinda
          titulo="Nenhum cliente nesta empresa"
          explicacao="Quando houver cliente cadastrado, a mídia dele aparece aqui."
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-6">
            <CartaoDeConexao
              conectadas={contasConectadas}
              metaLigado={meta?.connected === true}
              googleLigado={googleAds?.connected === true}
            />

            {/*
              * A FAIXA DE NÚMEROS, e a decisão que ela carrega: o rodapé de cada
              * cartão diz sobre QUANTOS clientes aquele número fala. Sem isso,
              * "R$ 12.400 investido" parece a carteira inteira mesmo quando são
              * dois clientes de cinquenta.
              */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Indicador
                icone={<Wallet size={15} />}
                rotulo="Investimento"
                valor={dinheiro(resumo.investido)}
                rodape={`${resumo.comLeitura} de ${resumo.totalDeClientes} clientes lidos`}
                destaque
              />
              <Indicador icone={<Eye size={15} />} rotulo="Impressões" valor={numero(resumo.impressoes)} rodape="últimos 30 dias" />
              <Indicador icone={<Target size={15} />} rotulo="Resultados" valor={numero(resumo.leads)} rodape="conversões lidas" />
              <Indicador
                icone={<BarChart3 size={15} />}
                rotulo="Custo por resultado"
                valor={dinheiro(resumo.cplMedio, true)}
                rodape={resumo.cplMedio === null ? 'sem resultado no período' : 'investimento ÷ resultados'}
              />
              <Indicador
                icone={<MousePointerClick size={15} />}
                rotulo="CTR"
                valor={percentual(resumo.ctrMedio)}
                rodape="ponderado por impressão"
              />
              <Indicador
                icone={<Plug size={15} />}
                rotulo="Contas vinculadas"
                valor={String(contasConectadas)}
                rodape={resumo.semConta > 0 ? `${resumo.semConta} cliente(s) sem conta` : 'carteira inteira ligada'}
                alerta={resumo.semConta > 0}
              />
            </div>

            <Filtros
              busca={busca}
              aoBuscar={setBusca}
              plataforma={plataforma}
              aoTrocarPlataforma={setPlataforma}
              estado={estado}
              aoTrocarEstado={setEstado}
              quantidade={visiveis.length}
              total={todos.length}
            />

            <section className="overflow-hidden rounded-xl border border-grafite-elevado bg-grafite/40">
              <header className="flex items-center justify-between gap-3 border-b border-grafite-elevado px-4 py-3">
                <h2 className="font-heading text-sm font-semibold text-branco-cru">Contas por cliente</h2>
                <p className="font-mono text-[11px] text-nevoa">{visiveis.length} de {todos.length}</p>
              </header>

              {visiveis.length === 0 ? (
                <p className="px-4 py-8 text-center text-[13px] text-nevoa">
                  Nenhum cliente corresponde a este filtro.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Tabela>
                    <thead>
                      <tr>
                        <Th>Cliente</Th>
                        <Th>Plataforma</Th>
                        <Th>Conta</Th>
                        <Th className="text-right">Investido</Th>
                        <Th className="text-right">Impressões</Th>
                        <Th className="text-right">Cliques</Th>
                        <Th className="text-right">Resultados</Th>
                        <Th>Estado</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiveis.map((c) => (
                        <LinhaDoCliente key={c.client_id} cliente={c} />
                      ))}
                    </tbody>
                  </Tabela>
                </div>
              )}
            </section>
          </div>

          <aside className="min-w-0 space-y-4 xl:sticky xl:top-[150px] xl:self-start">
            {/*
              * ERRO É DIFERENTE DE VAZIO, e confundir os dois aqui dá boa
              * notícia por omissão.
              *
              * "Toda conta está vinculada e respondendo" é uma AFIRMAÇÃO sobre
              * a carteira. Se a consulta falhou, ninguém mediu coisa nenhuma, e
              * a frase passa a jurar algo que não foi verificado — exatamente
              * na tela onde isso custa dinheiro.
              */}
            <BentoInsights
              titulo="Precisa de atenção"
              subtitulo="A partir do estado real das contas desta carteira"
              itens={insights}
              carregando={isPending}
              {...(isError
                ? { erro: 'Não consegui ler as contas da carteira, então não dá para afirmar que está tudo certo.' }
                : {})}
              vazio="Toda conta da carteira está vinculada e respondendo."
            />
            {alertas.length > insights.length && (
              <p className="px-1 font-mono text-[11px] text-nevoa">
                e mais {alertas.length - insights.length} na lista acima
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

/**
 * A CHAMADA PARA CONECTAR, com o número REAL de contas ligadas.
 *
 * O mockup traz "3 contas conectadas" como enfeite do cartão. Aqui o número sai
 * da mesma leitura que alimenta a tabela abaixo — se divergisse, uma das duas
 * estaria mentindo, e quem lê não teria como saber qual.
 */
function CartaoDeConexao({
  conectadas,
  metaLigado,
  googleLigado,
}: {
  conectadas: number;
  metaLigado: boolean;
  googleLigado: boolean;
}) {
  return (
    <section className="rounded-xl border border-grafite-elevado bg-grafite/40 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-[260px] flex-1">
          <h2 className="font-heading text-sm font-semibold text-branco-cru">Conecte as contas dos seus clientes</h2>
          <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-nevoa">
            Vincule Business Managers e contas de anúncio para centralizar campanhas, métricas e criativos. A conexão
            geral fica em Integrações; o vínculo por cliente fica na ficha de cada um.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/*
            * "VINCULADO" E "CONECTADO" SÃO COISAS DIFERENTES, e ficavam lado a
            * lado dizendo o contrário uma da outra.
            *
            * Medido na tela em 09/10/2026: o cartão estampava "1 conta
            * conectada" logo acima de "Meta Ads: não conectado". Os dois
            * números estavam certos — um conta CLIENTES com conta de anúncio
            * amarrada na ficha, o outro é o OAuth da agência com a plataforma —
            * e, juntos e mal nomeados, só podiam ser lidos como contradição.
            */}
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-nevoa">
            <span className={conectadas > 0 ? 'size-1.5 rounded-full bg-sucesso' : 'size-1.5 rounded-full bg-nevoa'} />
            {conectadas} {conectadas === 1 ? 'cliente com conta vinculada' : 'clientes com conta vinculada'}
          </span>
          <Link
            href="/integrations"
            className="inline-flex items-center gap-2 rounded-md bg-roxo-eletrico px-3 py-1.5 text-[13px] font-medium text-branco-cru transition-opacity hover:opacity-90"
          >
            <Plug size={14} />
            {metaLigado || googleLigado ? 'Gerenciar conexões' : 'Conectar contas'}
          </Link>
        </div>
      </div>

      <div className="mt-3 border-t border-grafite-elevado pt-3">
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-nevoa">Conexão da agência</p>
        <div className="flex flex-wrap gap-2">
          <EstadoDoProvedor nome="Meta Ads" ligado={metaLigado} />
          <EstadoDoProvedor nome="Google Ads" ligado={googleLigado} />
        </div>
        {!metaLigado && conectadas > 0 && (
          <p className="mt-2 text-[12px] text-aviso">
            Há {conectadas} {conectadas === 1 ? 'cliente com conta amarrada' : 'clientes com conta amarrada'}, mas a
            agência não está conectada ao Meta, e por isso nenhuma métrica é lida.
          </p>
        )}
      </div>
    </section>
  );
}

function EstadoDoProvedor({ nome, ligado }: { nome: string; ligado: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-grafite-elevado px-2.5 py-1 font-mono text-[11px]">
      <span className={ligado ? 'size-1.5 rounded-full bg-sucesso' : 'size-1.5 rounded-full bg-nevoa'} />
      <span className="text-nevoa">{nome}</span>
      <span className={ligado ? 'text-branco-cru' : 'text-nevoa/70'}>{ligado ? 'ligado' : 'não conectado'}</span>
    </span>
  );
}

function Indicador({
  icone,
  rotulo,
  valor,
  rodape,
  destaque = false,
  alerta = false,
}: {
  icone: React.ReactNode;
  rotulo: string;
  valor: string;
  rodape: string;
  destaque?: boolean;
  alerta?: boolean;
}) {
  const ausente = valor === 'sem leitura';
  return (
    <div className="rounded-xl border border-grafite-elevado bg-grafite/40 px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span
          className={
            alerta
              ? 'flex size-7 shrink-0 items-center justify-center rounded-lg bg-aviso/15 text-aviso'
              : destaque
                ? 'flex size-7 shrink-0 items-center justify-center rounded-lg bg-roxo-eletrico/20 text-roxo-eletrico'
                : 'flex size-7 shrink-0 items-center justify-center rounded-lg bg-carbono text-nevoa'
          }
        >
          {icone}
        </span>
        <p className="truncate font-mono text-[10px] uppercase tracking-wider text-nevoa">{rotulo}</p>
      </div>
      {/* Ausência de leitura é escrita em cinza e em corpo menor: ela não pode
          competir visualmente com um número de verdade. */}
      <p
        className={
          ausente
            ? 'mt-2 font-heading text-sm font-medium text-nevoa'
            : 'mt-2 font-heading text-[22px] font-semibold leading-none text-branco-cru'
        }
      >
        {valor}
      </p>
      <p className="mt-1.5 truncate text-[11px] text-nevoa">{rodape}</p>
    </div>
  );
}

function Filtros({
  busca,
  aoBuscar,
  plataforma,
  aoTrocarPlataforma,
  estado,
  aoTrocarEstado,
  quantidade,
  total,
}: {
  busca: string;
  aoBuscar: (v: string) => void;
  plataforma: Plataforma;
  aoTrocarPlataforma: (v: Plataforma) => void;
  estado: FiltroDeEstado;
  aoTrocarEstado: (v: FiltroDeEstado) => void;
  quantidade: number;
  total: number;
}) {
  const classeDeSelect =
    'rounded-md border border-grafite-elevado bg-carbono px-2.5 py-1.5 text-[13px] text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[220px] flex-1">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-nevoa" />
        <input
          type="text"
          value={busca}
          onChange={(e) => aoBuscar(e.target.value)}
          placeholder="Buscar cliente…"
          aria-label="Buscar cliente"
          className="w-full rounded-md border border-grafite-elevado bg-carbono py-1.5 pl-8 pr-3 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
        />
      </div>

      <select
        aria-label="Plataforma"
        value={plataforma}
        onChange={(e) => aoTrocarPlataforma(e.target.value as Plataforma)}
        className={classeDeSelect}
      >
        <option value="todas">Todas as plataformas</option>
        <option value="meta">Meta Ads</option>
      </select>

      <select
        aria-label="Estado da conta"
        value={estado}
        onChange={(e) => aoTrocarEstado(e.target.value as FiltroDeEstado)}
        className={classeDeSelect}
      >
        <option value="todos">Todos os estados</option>
        <option value="com-leitura">Com leitura</option>
        <option value="sem-leitura">Vinculados sem leitura</option>
        <option value="sem-conta">Sem conta vinculada</option>
      </select>

      {quantidade !== total && (
        <p className="font-mono text-[11px] text-nevoa">
          {quantidade} de {total}
        </p>
      )}
    </div>
  );
}

/**
 * A LOGO DA PLATAFORMA. `/media/overview` só lê `client_meta_accounts` hoje —
 * Google Ads tem a própria tabela e o próprio resolver de acesso, mas ainda não
 * entra nesta agregação. Até esse merge acontecer, toda linha aqui é Meta, de
 * verdade, não um placeholder.
 */
function LogoDaPlataforma() {
  return <Image src="/logos/meta.png" alt="Meta" width={16} height={16} unoptimized className="shrink-0 rounded-[4px]" />;
}

function LinhaDoCliente({ cliente }: { cliente: MediaOverviewClientWire }) {
  const temLeitura = cliente.connected && cliente.data_available;
  const i = temLeitura ? cliente.insights : null;

  return (
    <tr className="transition-colors hover:bg-grafite/60">
      <Td className="max-w-[200px] truncate">
        <Link href={`/clients/${cliente.client_id}`} className="text-branco-cru hover:text-roxo-eletrico">
          {cliente.client_name}
        </Link>
      </Td>
      <Td>{cliente.connected ? <LogoDaPlataforma /> : <span className="text-nevoa">sem plataforma</span>}</Td>
      <Td className="max-w-[160px] truncate font-mono text-[11px] text-nevoa">
        {cliente.connected ? (cliente.account_label ?? cliente.account_id) : 'não vinculada'}
      </Td>
      <Td className="text-right tabular-nums">{temLeitura ? dinheiro(i?.spend) : <AusenteCurta />}</Td>
      <Td className="text-right tabular-nums">{temLeitura ? numero(i?.impressions) : <AusenteCurta />}</Td>
      <Td className="text-right tabular-nums">{temLeitura ? numero(i?.clicks) : <AusenteCurta />}</Td>
      <Td className="text-right tabular-nums">{temLeitura ? numero(i?.results) : <AusenteCurta />}</Td>
      <Td>
        {!cliente.connected ? (
          <Link
            href={`/clients/${cliente.client_id}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-grafite-elevado px-2 py-0.5 text-[11px] text-nevoa transition-colors hover:border-roxo-eletrico/50 hover:text-branco-cru"
          >
            <Link2 size={11} /> vincular
          </Link>
        ) : temLeitura ? (
          <StatusLabel estado="ok">lendo</StatusLabel>
        ) : (
          <span
            className="inline-flex items-center gap-1.5 text-[11px] text-aviso"
            title={cliente.connected && !cliente.data_available ? cliente.reason : undefined}
          >
            <AlertTriangle size={11} /> sem leitura
          </span>
        )}
      </Td>
    </tr>
  );
}

/** Célula sem leitura: cinza e discreta, pra não ser confundida com um zero. */
function AusenteCurta() {
  return <span className="text-[11px] text-nevoa">sem leitura</span>;
}
