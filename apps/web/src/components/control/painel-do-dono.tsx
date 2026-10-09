'use client';

import Link from 'next/link';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowRight } from 'lucide-react';
import { usePanorama } from '@/hooks/use-panorama';
import { useIsMaster } from '@/hooks/use-is-master';
import { LinhasFantasma, SemNadaAinda } from '@/components/control/primitives';

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

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
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
                  {(inteligencia.por_agente ?? []).map((a) => (
                    <Cell key={a.agente} fill={COR_DO_AGENTE[a.agente] ?? '#8b8b93'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Cartao>
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
}: {
  rotulo: string;
  valor: string;
  detalhe?: string | undefined;
  href?: string | undefined;
  alerta?: boolean;
}) {
  const classe = [
    'group rounded-lg border bg-grafite px-4 py-3.5 transition-colors',
    alerta ? 'border-aviso/40' : 'border-grafite-elevado',
    href ? (alerta ? 'hover:border-aviso/70' : 'hover:border-roxo-eletrico/50') : '',
  ].join(' ');

  const conteudo = (
    <>
      <p className="text-[13px] text-nevoa">{rotulo}</p>
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
