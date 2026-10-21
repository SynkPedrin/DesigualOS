'use client';

import Link from 'next/link';
import { AlertTriangle, Link2 } from 'lucide-react';
import { LinhasFantasma, SemNadaAinda, StatusLabel, Tabela, Td, Th } from '@/components/control/primitives';
import { Surface } from '@/components/ui/surface';
import { useMediaOverview } from '@/hooks/use-media-overview';
import type { MediaOverviewClientWire } from '@/lib/api/contracts';
import { ProviderLogo } from './hub-parts';

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const NUMERO = new Intl.NumberFormat('pt-BR');
const dinheiro = (v: number | null | undefined) => (typeof v === 'number' ? MOEDA.format(v) : '—');
const numero = (v: number | null | undefined) => (typeof v === 'number' ? NUMERO.format(v) : '—');

/**
 * "Tabela": a carteira por CLIENTE (um cliente por linha), a leitura de antes da galeria. Fica como
 * visão porque responde a outra pergunta: "quem ainda não tem conta ligada?". Cliente sem conta
 * aparece, e em destaque: tráfego rodando fora do radar é o que mais custa.
 */
export function CarteiraPorCliente({ busca }: { busca: string }) {
  const { data, isPending, isError } = useMediaOverview();
  if (isPending) return <LinhasFantasma linhas={6} />;
  if (isError) return <SemNadaAinda titulo="Não consegui ler a carteira" explicacao="A consulta falhou; enquanto ela não responder, não dá para afirmar quanto está sendo investido." />;
  const termo = busca.trim().toLowerCase();
  const rows = (data?.clients ?? []).filter((c) => !termo || c.client_name.toLowerCase().includes(termo));
  if (rows.length === 0) return <SemNadaAinda titulo="Nenhum cliente corresponde" explicacao="Ajuste a busca para ver a carteira." />;
  return (
    <Surface className="overflow-hidden">
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
            {rows.map((c) => (
              <Linha key={c.client_id} c={c} />
            ))}
          </tbody>
        </Tabela>
      </div>
    </Surface>
  );
}

function Linha({ c }: { c: MediaOverviewClientWire }) {
  const lendo = c.connected && c.data_available;
  const i = lendo ? c.insights : null;
  return (
    <tr className="transition-colors hover:bg-grafite/60">
      <Td className="max-w-[14rem] truncate"><Link href={`/midias/${c.client_id}`} className="text-branco-cru hover:text-roxo-eletrico">{c.client_name}</Link></Td>
      <Td>{c.connected ? <ProviderLogo provider="meta" /> : <span className="text-nevoa">sem plataforma</span>}</Td>
      <Td className="max-w-[10rem] truncate font-mono text-[11px] text-nevoa">{c.connected ? (c.account_label ?? c.account_id) : 'não vinculada'}</Td>
      <Td className="text-right tabular-nums">{lendo ? dinheiro(i?.spend) : <Ausente />}</Td>
      <Td className="text-right tabular-nums">{lendo ? numero(i?.impressions) : <Ausente />}</Td>
      <Td className="text-right tabular-nums">{lendo ? numero(i?.clicks) : <Ausente />}</Td>
      <Td className="text-right tabular-nums">{lendo ? numero(i?.results) : <Ausente />}</Td>
      <Td>
        {!c.connected ? (
          <Link href={`/midias/${c.client_id}`} className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-grafite-elevado px-2 py-0.5 text-[11px] text-nevoa transition-colors hover:border-roxo-eletrico hover:text-branco-cru"><Link2 size={11} /> vincular</Link>
        ) : lendo ? (
          <StatusLabel estado="ok">lendo</StatusLabel>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-aviso" title={c.connected && !c.data_available ? c.reason : undefined}><AlertTriangle size={11} /> sem leitura</span>
        )}
      </Td>
    </tr>
  );
}

const Ausente = () => <span className="text-[11px] text-nevoa">sem leitura</span>;
