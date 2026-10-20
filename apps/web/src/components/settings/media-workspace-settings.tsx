'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { useMediaSettings } from '@/hooks/use-media';
import { SettingsTab } from '@/components/media/media-alerts-settings';

/**
 * MÍDIA E PERFORMANCE, nas configurações do workspace.
 *
 * É a MESMA configuração que a aba Configurações de cada cliente edita
 * (tabela `media_settings`, camada "empresa"). O que se muda aqui vale como
 * padrão para todos os clientes, alertas, relatórios, mensagens de WhatsApp e
 * agentes; cada cliente ou conta pode sobrescrever na própria tela de Mídia, e
 * a tela diz de onde cada valor vem. Não existe uma cópia para a Alicia nem
 * para os agentes: eles leem daqui.
 */
export function MediaWorkspaceSettings() {
  const probe = useMediaSettings(null, null);

  // Quem não tem o módulo de Mídia recebe 403: a seção simplesmente não existe para essa pessoa.
  if (probe.isError || (!probe.isPending && !probe.data?.values)) return null;

  return (
    <section className="mt-10" aria-labelledby="midia-workspace">
      <h2 id="midia-workspace" className="text-[15px] font-medium text-branco-cru">Mídia e performance</h2>
      <p className="mt-1 max-w-2xl text-[13px] text-nevoa">
        Padrões do workspace para anúncios: período do painel, alertas, mensagens e destinos de WhatsApp, relatórios e o que os agentes podem fazer. Mudou aqui, muda na tela de Mídia, nos alertas e nos agentes.
      </p>
      <div className="mt-4">{probe.isPending ? <Skeleton className="h-48 w-full" /> : <SettingsTab clientId={null} accountId={null} />}</div>
    </section>
  );
}
