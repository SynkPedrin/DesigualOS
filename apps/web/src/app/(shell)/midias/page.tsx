'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, Link2, Search } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { LinhasFantasma, Secao, SemNadaAinda, StatusLabel } from '@/components/control/primitives';
import { useMediaOverview } from '@/hooks/use-media-overview';
import { ApiRequestError } from '@/lib/api/client';
import type { MediaOverviewClientWire } from '@/lib/api/contracts';

/**
 * MÍDIAS — a carteira inteira de tráfego pago numa tela.
 *
 * A pergunta que ela responde é a de quem cuida de mídia e abre o sistema de
 * manhã: "onde está entrando dinheiro agora, e o que ainda não está ligado?".
 * Antes disso, mídia só existia DENTRO da ficha de cada cliente — responder
 * essa pergunta custava abrir vinte abas, e ninguém abre vinte abas.
 *
 * CLIENTE SEM CONEXÃO APARECE, e aparece primeiro quando é o caso. A lista do
 * que falta conectar é metade do valor desta tela: um cliente pagando tráfego
 * que ninguém vinculou é dinheiro rodando fora do radar.
 *
 * NENHUM NÚMERO INVENTADO. "Conectado" não implica "tem número": conexão
 * revogada e API fora do ar são estados próprios, com o motivo escrito. Um
 * zero tranquilizador num painel de mídia é a pior mentira que esta tela
 * poderia contar.
 */

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

function dinheiro(valor: number | null | undefined): string {
  return typeof valor === 'number' ? MOEDA.format(valor) : 'sem dado';
}

function numero(valor: number | null | undefined): string {
  return typeof valor === 'number' ? new Intl.NumberFormat('pt-BR').format(valor) : 'sem dado';
}

export default function MidiasPage() {
  const { data, isPending, isError, error } = useMediaOverview();
  const [busca, setBusca] = useState('');

  const clientes = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const todos = data?.clients ?? [];
    return termo ? todos.filter((c) => c.client_name.toLowerCase().includes(termo)) : todos;
  }, [data, busca]);

  const comNumero = clientes.filter((c) => c.connected && c.data_available);
  const semVinculo = clientes.filter((c) => !c.connected);
  const comProblema = clientes.filter((c) => c.connected && !c.data_available);

  /** Só soma o que foi de fato lido — total com buraco dentro não é total. */
  const investido = comNumero.reduce((soma, c) => soma + (c.connected && c.data_available ? (c.insights?.spend ?? 0) : 0), 0);

  // 403 = o workspace desta pessoa não inclui mídia. A tela diz isso em vez de
  // mostrar um erro técnico que ela não pode resolver sozinha.
  if (isError && error instanceof ApiRequestError && error.status === 403) {
    return (
      <div className="mx-auto max-w-[1200px]">
        <PageHeader title="Mídias" description="Tráfego pago da carteira." />
        <SemNadaAinda
          titulo="Mídia não faz parte do seu acesso"
          explicacao="Esta tela mostra investimento e resultado de campanha. Peça a quem administra a conta para incluir mídia no seu acesso."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Mídias"
        description="Onde está entrando dinheiro agora, e o que ainda não está ligado."
      />

      {isPending ? (
        <LinhasFantasma linhas={6} />
      ) : isError ? (
        <SemNadaAinda
          titulo="Não consegui ler a mídia da carteira"
          explicacao="A consulta falhou. Enquanto ela não responder, não dá para afirmar quanto está sendo investido."
        />
      ) : (data?.clients.length ?? 0) === 0 ? (
        <SemNadaAinda
          titulo="Nenhum cliente nesta empresa"
          explicacao="Quando houver cliente cadastrado, a mídia dele aparece aqui."
        />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-nevoa" />
              <input
                type="text"
                value={busca}
                onChange={(evento) => setBusca(evento.target.value)}
                placeholder="Buscar cliente…"
                className="w-full rounded-md border border-grafite-elevado bg-carbono py-1.5 pl-8 pr-3 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
              />
            </div>
            {comNumero.length > 0 && (
              <p className="font-mono text-[11px] text-nevoa">
                <span className="text-branco-cru">{dinheiro(investido)}</span> em 30 dias ·{' '}
                {comNumero.length} cliente(s) com campanha lida
              </p>
            )}
          </div>

          {/*
            * O QUE FALTA LIGAR VEM ANTES DO QUE JÁ ESTÁ RODANDO. Um cliente
            * com tráfego não vinculado é dinheiro fora do radar, e essa é a
            * única informação desta tela sobre a qual dá pra agir hoje.
            */}
          {semVinculo.length > 0 && (
            <Secao titulo={`${semVinculo.length} cliente(s) sem conta de anúncio vinculada`}>
              <div className="flex flex-wrap gap-2">
                {semVinculo.map((c) => (
                  <Link
                    key={c.client_id}
                    href={`/clients/${c.client_id}`}
                    className="group inline-flex items-center gap-2 rounded-lg border border-dashed border-grafite-elevado px-3 py-2 text-[13px] text-nevoa transition-colors hover:border-roxo-eletrico/50 hover:text-branco-cru"
                  >
                    <Link2 size={13} />
                    {c.client_name}
                    <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
                  </Link>
                ))}
              </div>
            </Secao>
          )}

          {comProblema.length > 0 && (
            <Secao titulo="Vinculados, mas sem leitura agora">
              <div className="space-y-2">
                {comProblema.map((c) => (
                  <div key={c.client_id} className="rounded-lg border border-aviso/40 bg-aviso/5 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <LogoDaPlataforma />
                      <p className="font-heading text-sm font-semibold text-branco-cru">{c.client_name}</p>
                    </div>
                    <p className="mt-0.5 text-[13px] text-aviso">
                      {c.connected && !c.data_available ? c.reason : ''}
                    </p>
                  </div>
                ))}
              </div>
            </Secao>
          )}

          {comNumero.length > 0 && (
            <Secao titulo="Campanhas com leitura dos últimos 30 dias">
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {comNumero.map((c) => (
                  <CartaoDeCliente key={c.client_id} cliente={c} />
                ))}
              </div>
            </Secao>
          )}
        </>
      )}
    </div>
  );
}

/**
 * A LOGO DA PLATAFORMA. `/media/overview` só lê `client_meta_accounts` hoje —
 * Google Ads tem a própria tabela (`client-google-ads-accounts.ts`) e o
 * próprio resolver de acesso, mas ainda não entra nesta agregação. Até esse
 * merge acontecer, todo cartão aqui é Meta, de verdade, não um placeholder.
 */
function LogoDaPlataforma() {
  return <Image src="/logos/meta.png" alt="Meta" width={16} height={16} unoptimized className="shrink-0 rounded-[4px]" />;
}

function CartaoDeCliente({ cliente }: { cliente: MediaOverviewClientWire }) {
  if (!cliente.connected || !cliente.data_available) return null;
  const i = cliente.insights;

  return (
    <Link
      href={`/clients/${cliente.client_id}`}
      className="group block rounded-lg border border-grafite-elevado bg-grafite px-4 py-3.5 transition-colors hover:border-roxo-eletrico/50"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <LogoDaPlataforma />
          <p className="font-heading text-sm font-semibold text-branco-cru">{cliente.client_name}</p>
        </div>
        <StatusLabel estado="ok">ligado</StatusLabel>
      </div>
      <p className="mt-2 font-heading text-xl font-semibold text-branco-cru">{dinheiro(i?.spend)}</p>
      <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">investido em 30 dias</p>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 border-t border-grafite-elevado pt-2.5 text-[12px] text-nevoa">
        <span>
          <span className="text-branco-cru">{numero(i?.results)}</span> resultados
        </span>
        <span>
          <span className="text-branco-cru">{numero(i?.clicks)}</span> cliques
        </span>
        <span>
          CTR <span className="text-branco-cru">{typeof i?.ctr === 'number' ? `${i.ctr.toFixed(2)}%` : 'sem dado'}</span>
        </span>
      </div>
      {cliente.account_label && (
        <p className="mt-2 truncate font-mono text-[10px] text-nevoa/70">{cliente.account_label}</p>
      )}
    </Link>
  );
}
