'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { LinhasFantasma, Secao, SemNadaAinda, StatusLabel } from '@/components/control/primitives';
import { useOrganizations, type EmpresaResumo } from '@/hooks/use-organizations';
import { useMe } from '@/hooks/use-me';
import { NovaEmpresa } from '@/components/control/nova-empresa';

/**
 * EMPRESAS — a tela do provedor (seção 60 do briefing).
 *
 * Responde "como está cada empresa que eu atendo" e é o ponto de entrada para
 * abrir um tenant.
 *
 * DUAS COISAS QUE ELA NÃO FAZ, e as duas são decisão:
 *
 * 1. Não mostra "saudável" em verde para tudo. Saúde de empresa precisa de
 *    medição de integração e frescor de dado, que ainda não existe por tenant —
 *    e um selo verde inventado é pior que selo nenhum, porque é tranquilizador.
 *    Mostra o que dá para contar: pessoas, clientes, conhecimento, última
 *    atividade.
 *
 * 2. Não aparece para quem não é provedor. A rota devolve 403, e o item nem
 *    entra na barra lateral — uma lista de uma empresa só não é uma tela de
 *    empresas, é um espelho que sugere um poder que a pessoa não tem.
 */
export default function EmpresasPage() {
  const { data: me } = useMe();
  const { data, isPending, isError } = useOrganizations();

  if (me && me.eh_provider !== true) {
    return (
      <div className="mx-auto max-w-[1000px]">
        <PageHeader title="Empresas" description="A visão do provedor sobre as empresas atendidas." />
        <SemNadaAinda
          titulo="Esta tela é do provedor da plataforma"
          explicacao="Ela lista as empresas atendidas pela Desigual. Sua conta enxerga a própria empresa, e ela aparece nas demais telas."
        />
      </div>
    );
  }

  const empresas = data?.organizations ?? [];

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        title="Empresas"
        description="Cada empresa atendida, com o que dá para medir hoje: gente, carteira, conhecimento e última atividade."
      />

      {/* O botão vem ANTES da lista: criar empresa é a ação principal desta
        * tela, não um detalhe no rodapé. */}
      <Secao titulo="Criar">
        <NovaEmpresa />
      </Secao>

      <Secao titulo={empresas.length === 1 ? '1 empresa' : `${empresas.length} empresas`}>
        {isPending ? (
          <LinhasFantasma linhas={3} />
        ) : isError ? (
          <SemNadaAinda
            titulo="Não consegui ler as empresas"
            explicacao="A consulta falhou. Isto não quer dizer que não há empresas — quer dizer que não deu para olhar."
          />
        ) : empresas.length === 0 ? (
          <SemNadaAinda
            titulo="Nenhuma empresa cadastrada"
            explicacao="Quando a primeira empresa cliente for criada, ela aparece aqui ao lado da Desigual."
          />
        ) : (
          <div className="space-y-2.5">
            {empresas.map((e) => (
              <Cartao key={e.id} empresa={e} ativa={me?.organizacao_ativa?.id === e.id} />
            ))}
          </div>
        )}
      </Secao>
    </div>
  );
}

function quandoFoi(iso: string | null): string {
  if (!iso) return 'sem atividade ainda';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 2) return 'agora';
  if (min < 60) return `há ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? 'ontem' : `há ${dias} dias`;
}

function Cartao({ empresa: e, ativa }: { empresa: EmpresaResumo; ativa: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const abrir = useMutation({
    mutationFn: () =>
      apiFetch<{ organizacao_ativa: { id: string } | null }>('/organizations/ativa', {
        method: 'POST',
        body: JSON.stringify({ organization_id: e.id }),
      }),
    onSuccess: () => {
      /**
       * Invalida TUDO ao entrar. Cada tela lê o que a empresa ativa permite —
       * manter cache da empresa anterior mostraria dado de uma enquanto a
       * interface diz estar noutra, que é pior que uma tela vazia.
       */
      void queryClient.invalidateQueries();
      router.push('/');
    },
  });

  return (
    <div className="rounded-lg border border-grafite-elevado bg-grafite px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Building2 size={16} className="shrink-0 text-nevoa" />
          <p className="font-heading text-[15px] font-semibold text-branco-cru">{e.name}</p>
          {e.eh_provedora && (
            <span className="rounded-full border border-roxo-eletrico/50 bg-roxo-eletrico/10 px-2 py-0.5 text-[11px] text-branco-cru">
              plataforma
            </span>
          )}
        </div>
        {/*
          * "Sem atividade ainda" é um estado legítimo, não um alerta. Empresa
          * recém-criada ainda não tem movimento, e pintar isso de vermelho
          * ensinaria a ignorar o vermelho.
          */}
        <div className="flex items-center gap-3">
          <StatusLabel estado={e.ultima_atividade ? 'ok' : 'desconhecido'}>{quandoFoi(e.ultima_atividade)}</StatusLabel>
          {/*
            * DUAS AÇÕES DIFERENTES, e confundi-las foi o que deixou a empresa
            * criada mas inutilizável: "Entrar" muda o contexto de trabalho
            * (passo a operar como essa empresa); "Configurar" abre a ficha dela
            * sem virar aquela empresa — é o que o provedor faz ao ajustar a
            * conta de um cliente.
            *
            * A provedora não tem "Entrar": ela é o contexto padrão, e oferecer
            * um botão para entrar onde já se está é convidar ao clique inútil.
            */}
          <Link
            href={`/organizations/${e.id}`}
            className="rounded-md border border-grafite-elevado bg-carbono px-3 py-1.5 text-[13px] text-branco-cru transition-colors hover:border-roxo-eletrico/60"
          >
            Configurar
          </Link>
          {!e.eh_provedora && (
            <button
              type="button"
              onClick={() => abrir.mutate()}
              disabled={abrir.isPending || ativa}
              className="rounded-md border border-grafite-elevado bg-carbono px-3 py-1.5 text-[13px] text-branco-cru transition-colors hover:border-roxo-eletrico/60 disabled:opacity-50"
            >
              {ativa ? 'Você está aqui' : abrir.isPending ? 'Entrando...' : 'Entrar'}
            </button>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-nevoa">
        <span>
          <span className="text-branco-cru">{e.pessoas}</span> pessoa(s)
        </span>
        <span>
          <span className="text-branco-cru">{e.clientes}</span> cliente(s)
        </span>
        <span>
          <span className="text-branco-cru">{e.memorias.toLocaleString('pt-BR')}</span> coisas aprendidas
        </span>
      </div>
    </div>
  );
}
