'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Building2 } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { useMe } from '@/hooks/use-me';

/**
 * A FAIXA QUE DIZ EM QUAL EMPRESA VOCÊ ESTÁ.
 *
 * Existe por um motivo específico e caro: o provedor entra na conta de um
 * cliente para dar suporte, se distrai, e edita a empresa errada. Nesse momento
 * não adianta a permissão estar certa — ela estava certa, a pessoa tinha acesso
 * mesmo. O que faltou foi ela SABER onde estava.
 *
 * Por isso a faixa é persistente, colorida e fica no topo de tudo. Não é um
 * rótulo discreto na barra lateral: é uma interrupção visual proposital, do
 * mesmo jeito que um ambiente de homologação se pinta de outra cor.
 *
 * SÓ APARECE PARA QUEM ESTÁ DE FORA. Alguém que pertence apenas à própria
 * empresa não está "visitando" nada — para essa pessoa a faixa seria ruído
 * permanente, e ruído permanente vira invisível.
 */
export function ContextoDaEmpresa() {
  const { data: me } = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();

  const sair = useMutation({
    mutationFn: () =>
      apiFetch<{ organizacao_ativa: null }>('/organizations/ativa', {
        method: 'POST',
        body: JSON.stringify({ organization_id: null }),
      }),
    onSuccess: () => {
      // Invalida TUDO: sair da empresa muda o que cada tela pode ler, e deixar
      // cache do tenant anterior na tela seria mostrar dado de uma empresa
      // enquanto se diz estar noutra.
      void queryClient.invalidateQueries();
      router.push('/organizations');
    },
  });

  const ativa = me?.organizacao_ativa ?? null;
  const ehProvider = me?.eh_provider === true;

  /**
   * A faixa só faz sentido quando a pessoa está numa empresa que NÃO é a dela
   * por natureza — ou seja, quando é o provedor visitando um cliente. Sem isso,
   * todo mundo veria uma faixa dizendo o óbvio.
   */
  const visitando = ehProvider && ativa && !ativa.name.toLowerCase().includes('desigual');
  if (!visitando) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sinal/30 bg-sinal/10 px-5 py-2">
      <div className="flex items-center gap-2.5">
        <Building2 size={15} className="shrink-0 text-sinal" />
        <p className="text-[13px] text-branco-cru">
          Você está dentro de <span className="font-semibold">{ativa.name}</span>
          <span className="ml-2 text-nevoa">o que você fizer aqui é dessa empresa</span>
        </p>
      </div>
      <button
        type="button"
        onClick={() => sair.mutate()}
        disabled={sair.isPending}
        className="inline-flex items-center gap-1.5 rounded-md border border-grafite-elevado bg-carbono px-3 py-1.5 text-[13px] text-branco-cru transition-colors hover:border-nevoa/50 disabled:opacity-50"
      >
        <ArrowLeft size={13} />
        {sair.isPending ? 'Saindo...' : 'Voltar para a Desigual'}
      </button>
    </div>
  );
}
