'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ControlHeader, Secao } from '@/components/control/primitives';
import { LinhaDoSistema } from '@/components/control/linha-do-sistema';
import { FeedDeAtividade } from '@/components/control/feed-de-atividade';
import { ResumoDaOperacao } from '@/components/control/resumo-da-operacao';
import { SinaisEmAberto } from '@/components/control/sinais-em-aberto';
import { PainelDoDono } from '@/components/control/painel-do-dono';

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

      {/*
        * O PANORAMA VEM PRIMEIRO. A pergunta de quem abre esta tela é "como
        * está a agência", não "como está o servidor" — e por muito tempo esta
        * home respondia a segunda. O estado técnico continua logo abaixo, para
        * o dia em que a pergunta for essa.
        */}
      <Secao titulo="A agência agora">
        <PainelDoDono />
      </Secao>

      {/*
        * O ESTADO TÉCNICO EM UMA LINHA, e não mais numa faixa de seis cartões.
        *
        * Os seis continuam inteiros em /health, e "Inteligência conectada"
        * passou para /integrations, que é onde se vai quando a pergunta é essa.
        * O motivo é o relato de quem usa: a tela estava poluída de informação,
        * e a maior parte dela era infraestrutura respondendo "tudo bem" todo
        * dia — seis cartões que não mudam são seis cartões que se aprende a
        * pular, inclusive no dia em que um deles muda.
        */}
      <LinhaDoSistema />

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
