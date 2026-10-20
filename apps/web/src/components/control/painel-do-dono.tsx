'use client';

import Link from 'next/link';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowRight, TrendingDown, TrendingUp } from 'lucide-react';
import { usePanorama } from '@/hooks/use-panorama';
import { useIsMaster } from '@/hooks/use-is-master';
import { LinhasFantasma, SemNadaAinda } from '@/components/control/primitives';
import { BentoInsights, type InsightDoBento } from '@/components/bento/painel-de-insights';

/**
 * DELTA SÓ ONDE HÁ SÉRIE. O mockup põe uma variação ao lado de quase todo
 * número, e a maioria deles não tem com que comparar: não existe histórico de
 * "clientes na carteira" nem de "equipe usando a IA" em lugar nenhum do
 * contrato. O único que tem é o volume de pedidos, porque `serie_14d` guarda
 * o dia a dia, e aí dá pra medir os últimos 7 contra os 7 anteriores.
 *
 * Devolve `null` quando a série não cobre as duas janelas inteiras. Um delta
 * calculado sobre meia janela pareceria apurado e não seria.
 */
function variacaoDeSeteDias(serie: Array<{ total: number }>): number | null {
  if (serie.length < 14) return null;
  const ultimos = serie.slice(-7).reduce((s, d) => s + d.total, 0);
  const anteriores = serie.slice(-14, -7).reduce((s, d) => s + d.total, 0);
  if (anteriores === 0) return null;
  return Math.round(((ultimos - anteriores) / anteriores) * 100);
}

/**
 * O PAINEL DE QUEM É DONO DA AGÊNCIA.
 *
 * A pergunta que ele responde não é "o sistema está no ar" — é "como está a
 * agência". São coisas diferentes, e a segunda é a que faz alguém abrir um
 * painel de manhã.
 *
 * O QUE FICOU DE FORA, e de propósito: gráfico de pizza, medidor de velocímetro
 * e qualquer número que precise de legenda para ser entendido. Painel de dono
 * tem dez segundos de atenção; o que não se lê em dez segundos não está ali
 * para informar, está para impressionar.
 *
 * E a regra que vale mais que o desenho: NENHUM número aqui é estimado. Quando
 * a medição não existe, o campo diz isso — um painel que preenche buraco com
 * zero é pior que um painel vazio, porque o zero é tranquilizador.
 */
export function PainelDoDono() {
  const { data, isPending, isError } = usePanorama();
  // A Equipe virou tela de administração: só quem administra recebe o clique.
  // O NÚMERO continua à vista para todo mundo — saber quanto da equipe usa a
  // IA não é privilégio; agir sobre as contas é.
  const { isMaster } = useIsMaster();

  if (isPending) return <LinhasFantasma linhas={4} />;
  if (isError || !data) {
    return (
      <SemNadaAinda
        titulo="Não consegui montar o panorama"
        explicacao="A consulta falhou. Isto não quer dizer que a operação está parada, quer dizer que não deu para olhar."
      />
    );
  }

  /**
   * A guarda acima só pergunta se `data` existe. Mas o /panorama agrega cinco
   * blocos de fontes diferentes, e um deles pode faltar sem a resposta inteira
   * falhar — foi assim que `inteligencia.serie_14d` estourou e levou a VISÃO
   * GERAL junto, que é a tela que abre quando alguém entra no sistema
   * (08/10/2026). Bloco ausente vira bloco vazio: a tela mostra menos, nunca
   * some.
   */
  const {
    carteira = { clientes: 0, internos: 0 },
    equipe = { usando: 0, pessoas: 0, sem_clickup: 0 },
    inteligencia = { pedidos_30d: 0, taxa_de_falha_14d: null, serie_14d: [], por_agente: [] },
    conhecimento = { memorias: 0 },
    atencao = { sinais_abertos: 0 },
  } = data;
  const variacao = variacaoDeSeteDias(inteligencia.serie_14d ?? []);

  const semUsar = Math.max(equipe.pessoas - equipe.usando, 0);
  const recomendacoes: InsightDoBento[] = [];
  if (semUsar > 0) {
    recomendacoes.push({
      id: 'uso-da-ia',
      tom: 'atencao',
      ...(isMaster ? { href: '/people' } : {}),
      texto: (
        <>
          <strong className="font-semibold text-branco-cru">Aumentar o uso da IA na equipe.</strong>{' '}
          {semUsar} pessoa{semUsar > 1 ? 's' : ''} não {semUsar > 1 ? 'usaram' : 'usou'} a IA nos últimos 30 dias.
        </>
      ),
    });
  }
  if (inteligencia.taxa_de_falha_14d !== null && inteligencia.taxa_de_falha_14d > 0) {
    recomendacoes.push({
      id: 'falhas',
      tom: inteligencia.taxa_de_falha_14d >= 15 ? 'urgente' : 'atencao',
      href: '/errors',
      texto: (
        <>
          <strong className="font-semibold text-branco-cru">Reduzir falhas de pedidos.</strong> A taxa dos últimos 14 dias está em{' '}
          {inteligencia.taxa_de_falha_14d}%.
        </>
      ),
    });
  }
  // Mesma regra do aviso acima: vincular e-mail de alguém é ação de
  // administrador, e recomendar a quem não pode agir é ruído.
  if (isMaster && equipe.sem_clickup > 0) {
    recomendacoes.push({
      id: 'clickup',
      tom: 'atencao',
      href: '/people',
      texto: (
        <>
          <strong className="font-semibold text-branco-cru">Vincular a equipe ao ClickUp.</strong> {equipe.sem_clickup} pessoa
          {equipe.sem_clickup > 1 ? 's' : ''} sem vínculo, e o trabalho dela{equipe.sem_clickup > 1 ? 's' : ''} não aparece em
          consulta nenhuma.
        </>
      ),
    });
  }
  const serie = (inteligencia.serie_14d ?? []).map((d) => ({
    ...d,
    rotulo: new Date(`${d.dia}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
  }));

  return (
    <div className="space-y-8">
      {/* OS QUATRO NÚMEROS que respondem "como estamos" sem precisar de mais nada. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Numero
          rotulo="Clientes na carteira"
          valor={String(carteira.clientes)}
          detalhe={carteira.internos > 0 ? `+ ${carteira.internos} frentes internas` : undefined}
          href="/clients"
        />
        <Numero
          rotulo="Equipe usando a IA"
          valor={`${equipe.usando} de ${equipe.pessoas}`}
          detalhe={equipe.usando < equipe.pessoas ? `${equipe.pessoas - equipe.usando} sem usar em 30 dias` : 'todo mundo'}
          {...(isMaster ? { href: '/people' } : {})}
          alerta={equipe.usando < equipe.pessoas / 2}
        />
        <Numero
          rotulo="Pedidos à IA (30 dias)"
          valor={inteligencia.pedidos_30d.toLocaleString('pt-BR')}
          detalhe={`${conhecimento.memorias.toLocaleString('pt-BR')} coisas aprendidas`}
          href="/memory"
          {...(variacao !== null ? { delta: variacao } : {})}
        />
        {/*
          * `null` = não houve pedido na janela. Mostrar "0%" aí seria pintar de
          * verde a ausência de dado, que é como um painel ensina a confiar no
          * verde errado.
          */}
        <Numero
          rotulo="Falhas (14 dias)"
          valor={inteligencia.taxa_de_falha_14d === null ? 'sem pedidos' : `${inteligencia.taxa_de_falha_14d}%`}
          detalhe={inteligencia.taxa_de_falha_14d === null ? 'nada para medir' : 'dos pedidos não completaram'}
          href="/errors"
          alerta={(inteligencia.taxa_de_falha_14d ?? 0) >= 15}
        />
      </div>

      {/* O QUE PEDE AÇÃO, quando pede. Some quando não há. */}
      {(atencao.sinais_abertos > 0 || equipe.sem_clickup > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {atencao.sinais_abertos > 0 && (
            <Aviso
              href="/signals"
              titulo={`${atencao.sinais_abertos} sinal(is) esperando você`}
              corpo="O sistema percebeu algo sozinho e ninguém tratou ainda."
            />
          )}
          {/* O conserto deste aviso (vincular o e-mail de alguém) é ação de
            * administrador. Mostrá-lo a quem não pode agir é ruído. */}
          {isMaster && equipe.sem_clickup > 0 && (
            <Aviso
              href="/people"
              titulo={`${equipe.sem_clickup} pessoa(s) sem vínculo com o ClickUp`}
              corpo="O trabalho delas não aparece em nenhuma consulta do sistema, parece que não há tarefa, quando falta o vínculo."
            />
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
        {/* USO AO LONGO DO TEMPO — a forma da curva diz mais que o total. */}
        <Cartao titulo="Uso da inteligência, dia a dia" legenda="Últimos 14 dias. A faixa escura é o que falhou.">
          {serie.length === 0 ? (
            <Vazio texto="Nenhum pedido nos últimos 14 dias." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={serie} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad-ok" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#a78bfa" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2e" vertical={false} />
                <XAxis dataKey="rotulo" stroke="#8b8b93" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#8b8b93" fontSize={12} tickLine={false} axisLine={false} width={48} />
                <Tooltip
                  contentStyle={{
                    background: '#1a1a1d',
                    border: '1px solid #2a2a2e',
                    borderRadius: 8,
                    fontSize: 13,
                  }}
                  labelStyle={{ color: '#f5f5f0' }}
                />
                <Area type="monotone" dataKey="ok" name="entregues" stroke="#a78bfa" fill="url(#grad-ok)" strokeWidth={2} />
                <Area type="monotone" dataKey="falhou" name="falharam" stroke="#ef4444" fill="#ef4444" fillOpacity={0.25} strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Cartao>

        {/* QUEM FAZ O TRABALHO. Diz de que a agência precisa, não só quanto usa. */}
        <Cartao titulo="Quem a equipe aciona" legenda="Pedidos por agente, últimos 30 dias.">
          {(inteligencia.por_agente ?? []).length === 0 ? (
            <Vazio texto="Nenhum pedido nos últimos 30 dias." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={inteligencia.por_agente ?? []}
                layout="vertical"
                margin={{ top: 4, right: 12, left: 8, bottom: 0 }}
              >
                <XAxis type="number" stroke="#8b8b93" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="agente"
                  stroke="#8b8b93"
                  fontSize={13}
                  tickLine={false}
                  axisLine={false}
                  width={64}
                />
                <Tooltip
                  cursor={{ fill: '#ffffff08' }}
                  contentStyle={{ background: '#1a1a1d', border: '1px solid #2a2a2e', borderRadius: 8, fontSize: 13 }}
                />
                <Bar dataKey="total" name="pedidos" radius={[0, 4, 4, 0]}>
                  {/* O NÚMERO AO LADO DA BARRA (mockup). Sem ele, comparar duas
                    * barras parecidas exigia passar o mouse em cada uma, e um
                    * painel que só entrega o valor sob passagem de mouse não
                    * entrega o valor em tela nenhuma de toque. */}
                  <LabelList
                    dataKey="total"
                    position="right"
                    fill="#c9c9d1"
                    fontSize={12}
                    formatter={(v: unknown) => (typeof v === 'number' ? v.toLocaleString('pt-BR') : String(v ?? ''))}
                  />
                  {(inteligencia.por_agente ?? []).map((a) => (
                    <Cell key={a.agente} fill={COR_DO_AGENTE[a.agente] ?? '#8b8b93'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Cartao>

        {/* RECOMENDAÇÕES DO BENTO (mockup). Cada uma é uma leitura do MESMO
          * panorama que os números acima mostram, com o destino de quem
          * conserta. Nada aqui é conselho genérico de produtividade: se o
          * panorama não acusa nada, a coluna diz que não há o que recomendar,
          * em vez de encher com três frases bonitas. */}
        <BentoInsights
          titulo="Recomendações do Bento"
          subtitulo="A partir do panorama desta tela"
          itens={recomendacoes}
          vazio="Nada a recomendar: o panorama não acusa nada pendente agora."
        />
      </div>
    </div>
  );
}

/** Cada agente com uma cor estável: a mesma barra na mesma cor toda vez. */
const COR_DO_AGENTE: Record<string, string> = {
  bento: '#a78bfa',
  jarbas: '#e1f900',
  otto: '#38bdf8',
  suzy: '#f472b6',
  studio: '#fb923c',
};

/** Exportado: controle-da-agencia.tsx reusa o mesmo tile de número em vez de duplicar o padrão visual. */
/**
 * `href` é OPCIONAL desde 08/10/2026: a Equipe virou tela de administração, e
 * um número que leva a "acesso restrito" é pior que um número que não leva a
 * lugar nenhum. Sem destino, o cartão continua informando — só deixa de
 * prometer um clique que não cumpre.
 */
export function Numero({
  rotulo,
  valor,
  detalhe,
  href,
  alerta,
  delta,
  deltaBomQuandoSobe = true,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string | undefined;
  href?: string | undefined;
  alerta?: boolean;
  /** Variação percentual contra o período anterior. Só passe quando existir
   *  série histórica de verdade: sem ela, o lugar fica sem delta, nunca com
   *  "0%", que leria como "não mudou" em vez de "não medi". */
  delta?: number | undefined;
  /** Em "falhas", subir é ruim. Sem isto, a seta verde elogiaria a piora. */
  deltaBomQuandoSobe?: boolean;
}) {
  const classe = [
    'group rounded-lg border bg-grafite px-4 py-3.5 transition-colors',
    alerta ? 'border-aviso/40' : 'border-grafite-elevado',
    href ? (alerta ? 'hover:border-aviso/70' : 'hover:border-roxo-eletrico/50') : '',
  ].join(' ');

  const subiu = (delta ?? 0) > 0;
  const bom = delta === undefined || delta === 0 ? null : subiu === deltaBomQuandoSobe;
  const SetaDoDelta = subiu ? TrendingUp : TrendingDown;

  const conteudo = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] text-nevoa">{rotulo}</p>
        {delta !== undefined && (
          <span
            title="Últimos 7 dias contra os 7 anteriores"
            className={[
              'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
              bom === null ? 'bg-grafite-elevado text-nevoa' : bom ? 'bg-sucesso/15 text-sucesso' : 'bg-erro/15 text-erro',
            ].join(' ')}
          >
            {delta !== 0 && <SetaDoDelta size={11} />}
            {delta > 0 ? '+' : ''}
            {delta}%
          </span>
        )}
      </div>
      <p className={['mt-1 font-heading text-2xl font-semibold', alerta ? 'text-aviso' : 'text-branco-cru'].join(' ')}>
        {valor}
      </p>
      {detalhe && <p className="mt-0.5 text-[12px] text-nevoa">{detalhe}</p>}
    </>
  );

  if (!href) return <div className={classe}>{conteudo}</div>;
  return (
    <Link href={href} className={classe}>
      {conteudo}
    </Link>
  );
}

function Aviso({ href, titulo, corpo }: { href: string; titulo: string; corpo: string }) {
  return (
    <Link
      href={href}
      className="group flex items-start justify-between gap-3 rounded-lg border border-aviso/40 bg-aviso/5 px-4 py-3 transition-colors hover:bg-aviso/10"
    >
      <span>
        <span className="block font-heading text-sm font-semibold text-branco-cru">{titulo}</span>
        <span className="mt-0.5 block text-[13px] text-nevoa">{corpo}</span>
      </span>
      <ArrowRight size={14} className="mt-1 shrink-0 text-nevoa transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function Cartao({ titulo, legenda, children }: { titulo: string; legenda: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-grafite-elevado bg-grafite px-4 py-4">
      <p className="text-[15px] font-medium text-branco-cru">{titulo}</p>
      <p className="mb-3 mt-0.5 text-[13px] text-nevoa">{legenda}</p>
      {children}
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <p className="py-12 text-center text-[13px] text-nevoa">{texto}</p>;
}
