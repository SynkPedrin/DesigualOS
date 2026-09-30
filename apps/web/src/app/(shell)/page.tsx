'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ControlHeader, Secao } from '@/components/control/primitives';
import { StatusDoSistema } from '@/components/control/status-do-sistema';
import { InteligenciaConectada } from '@/components/control/inteligencia-conectada';
import { FeedDeAtividade } from '@/components/control/feed-de-atividade';
import { ResumoDaOperacao } from '@/components/control/resumo-da-operacao';
import { SinaisEmAberto } from '@/components/control/sinais-em-aberto';

/**
 * A home do CONTROL PLANE.
 *
 * O que ela substitui: um dashboard de tokens, custo e gráficos de agente. O
 * que ela responde, na ordem: como está o sistema agora, quem está conectado a
 * ele, o que andou acontecendo, e qual o estado da operação que ele governa.
 *
 * O chat NÃO está aqui, e essa é a decisão central do reposicionamento. A
 * equipe conversa no Claude; este é o lugar onde se vê e se controla o que ele
 * pode fazer. O console do Bento continua existindo, inteiro, em /chat — mudou
 * de lugar, não de estado.
 *
 * Nenhum número desta tela é decorativo, e nenhum é inventado: o que não tem
 * fonte aparece dizendo que não tem.
 */
export default function ControlPlanePage() {
  return (
    <div className="mx-auto max-w-[1400px]">
      <ControlHeader
        title="Desigual OS · Control Plane"
        description="Inteligência, memória e governança da operação."
      />

      {/*
        * ANTES DO ESTADO DO SISTEMA, de propósito. O que o sistema percebeu que
        * precisa de alguém vem antes de como o sistema está — e some sozinho
        * quando não há nada, pra não virar enfeite que se aprende a ignorar.
        */}
      <SinaisEmAberto />

      <Secao titulo="Estado do sistema">
        <StatusDoSistema />
      </Secao>

      <Secao
        titulo="Inteligência conectada"
        acao={
          <Link
            href="/integrations"
            className="inline-flex items-center gap-1 font-mono text-[11px] text-nevoa transition-colors hover:text-branco-cru"
          >
            Integrações
            <ArrowRight size={12} />
          </Link>
        }
      >
        <InteligenciaConectada />
      </Secao>

      <div className="grid gap-8 lg:grid-cols-[1.15fr_1fr]">
        <Secao
          titulo="Atividade recente"
          acao={
            <Link
              href="/activity"
              className="inline-flex items-center gap-1 font-mono text-[11px] text-nevoa transition-colors hover:text-branco-cru"
            >
              Ver tudo
              <ArrowRight size={12} />
            </Link>
          }
        >
          <FeedDeAtividade limite={10} />
        </Secao>

        <Secao
          titulo="Operação sob governo"
          acao={
            <Link
              href="/clients"
              className="inline-flex items-center gap-1 font-mono text-[11px] text-nevoa transition-colors hover:text-branco-cru"
            >
              Clientes
              <ArrowRight size={12} />
            </Link>
          }
        >
          <ResumoDaOperacao />
        </Secao>
      </div>
    </div>
  );
}
