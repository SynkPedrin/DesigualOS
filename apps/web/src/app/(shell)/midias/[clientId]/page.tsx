'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, FileText, Link2 } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { EntityAvatar } from '@/components/ui/entity-avatar';
import { ClientMetaAdsPanel } from '@/components/clients/client-meta-ads-panel';
import { ClientGoogleAdsPanel } from '@/components/clients/client-google-ads-panel';
import { ClientReportsPanel } from '@/components/clients/client-reports-panel';
import { useClients } from '@/hooks/use-clients';
import { useClientMetaAccounts } from '@/hooks/use-client-meta-accounts';
import { useClientGoogleAdsAccounts } from '@/hooks/use-client-google-ads-accounts';
import { cn } from '@/lib/utils';

/**
 * CENTRAL DE TRÁFEGO DE UM CLIENTE (pedido do Pedro, 13/10/2026).
 *
 * O que ela conserta, na ordem em que ele reclamou: clicar num cliente dentro
 * de Mídias levava pra FICHA DELE em /clients, que responde "quem é este
 * cliente". Quem está em Mídias já sabe quem o cliente é e quer saber como os
 * anúncios dele estão indo. São duas perguntas diferentes e a navegação
 * respondia a errada.
 *
 * POR QUE ROTA NOVA, e não mais uma aba na ficha: a ficha do cliente já tem
 * oito abas e pertence a "atendimento"; esta tela pertence a "tráfego", tem
 * outro dono na operação e outro ritmo de uso. Também é adição limpa — a
 * vitrine de /midias, que é de outra sessão, não precisa ser reescrita pra
 * isto existir.
 *
 * OS PAINÉIS SÃO OS QUE JÁ EXISTEM. `ClientMetaAdsPanel` e
 * `ClientGoogleAdsPanel` já trazem tabela de campanhas, e o do Meta já traz a
 * galeria de criativos no ar. Reescrevê-los pra "ficar bonito numa tela nova"
 * criaria duas disciplinas de número sobre o mesmo dado, que é o defeito que
 * esta equipe passou a semana caçando.
 */

type Plataforma = 'meta' | 'google';

const ROTULO: Record<Plataforma, string> = { meta: 'Meta Ads', google: 'Google Ads' };

export default function CentralDeTrafegoPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = use(params);
  const [plataforma, setPlataforma] = useState<Plataforma>('meta');

  const clientes = useClients();
  const cliente = (clientes.data ?? []).find((c) => c.id === clientId);

  /**
   * O VÍNCULO DE CONTA É POR CLIENTE, e é o que decide se há o que mostrar.
   * A aba da plataforma sem conta amarrada não some: ela aparece com o
   * caminho pra amarrar. Esconder a aba faria parecer que a plataforma não
   * existe pra este cliente, quando o que falta é uma ligação de um minuto.
   */
  const contasMeta = useClientMetaAccounts(clientId);
  const contasGoogle = useClientGoogleAdsAccounts(clientId);
  const temMeta = (contasMeta.data?.length ?? 0) > 0;
  const temGoogle = (contasGoogle.data?.length ?? 0) > 0;
  const temAlguma = temMeta || temGoogle;

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-6">
      <div className="sticky top-0 z-20 -mx-8 bg-carbono px-8 pt-8">
        <Link
          href="/midias"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-nevoa transition-colors hover:text-branco-cru"
        >
          <ArrowLeft size={12} />
          Mídias
        </Link>

        <div className="mb-6 mt-3 flex flex-wrap items-center justify-between gap-4 border-b border-grafite-elevado pb-5">
          <div className="flex min-w-0 items-center gap-3">
            {clientes.isPending ? (
              <Skeleton className="size-12" />
            ) : (
              <EntityAvatar name={cliente?.name ?? 'Cliente'} kind="client" size="lg" />
            )}
            <div className="min-w-0">
              <h1 className="truncate font-heading text-xl font-semibold tracking-tight text-branco-cru">
                {clientes.isPending ? 'Carregando…' : (cliente?.name ?? 'Cliente')}
              </h1>
              <p className="text-sm text-nevoa">Central de tráfego: resultados, campanhas e criativos.</p>
            </div>
          </div>

          <Link
            href={`/clients/${clientId}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-grafite-elevado px-3 py-1.5 text-sm text-nevoa transition-colors hover:text-branco-cru"
          >
            Ficha do cliente
            <ExternalLink size={13} />
          </Link>
        </div>
      </div>

      {/* AS DUAS PLATAFORMAS, lado a lado e nomeadas. O Pedro pediu "por
          cliente E por plataforma": a troca aqui é o segundo eixo. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(['meta', 'google'] as Plataforma[]).map((p) => {
          const temConta = p === 'meta' ? temMeta : temGoogle;
          return (
            <button
              key={p}
              type="button"
              onClick={() => setPlataforma(p)}
              aria-pressed={plataforma === p}
              className={cn(
                'flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors',
                plataforma === p ? 'bg-roxo-eletrico text-branco-cru' : 'text-nevoa hover:bg-grafite-elevado hover:text-branco-cru',
              )}
            >
              {ROTULO[p]}
              {/* Ponto só quando há conta: ausência de ponto é ausência de
                  vínculo, não "não medi". O painel abaixo explica qual é. */}
              {temConta && <span className="size-1.5 rounded-full bg-sinal" />}
            </button>
          );
        })}
      </div>

      {!contasMeta.isPending && !contasGoogle.isPending && !temAlguma && (
        <Surface className="flex flex-wrap items-center justify-between gap-4 border-aviso/40 bg-aviso/5 p-5">
          <div className="min-w-0">
            <p className="font-medium text-branco-cru">Este cliente ainda não tem conta de anúncios vinculada.</p>
            <p className="mt-1 text-sm text-nevoa">
              Sem vínculo não há o que ler: campanha, criativo e resultado vêm da conta, não do cliente. O vínculo é por
              cliente e fica na ficha dele.
            </p>
          </div>
          <Link
            href={`/clients/${clientId}`}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-roxo-eletrico px-4 py-2.5 text-sm font-medium text-branco-cru transition-opacity hover:opacity-90"
          >
            <Link2 size={14} />
            Vincular conta
          </Link>
        </Surface>
      )}

      {plataforma === 'meta' ? <ClientMetaAdsPanel clientId={clientId} /> : <ClientGoogleAdsPanel clientId={clientId} />}

      {/* RELATÓRIO EM PDF no fim, porque é o que se faz DEPOIS de olhar: o
          PDF é o que vai pro cliente, e sai do mesmo dado desta tela. */}
      <Surface className="flex flex-col gap-3 p-5">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-nevoa" />
          <h2 className="font-heading text-base font-semibold text-branco-cru">Relatório para o cliente</h2>
        </div>
        <ClientReportsPanel clientId={clientId} />
      </Surface>
    </div>
  );
}
