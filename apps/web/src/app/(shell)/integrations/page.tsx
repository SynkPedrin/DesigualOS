'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ClaudeMark, ControlHeader, Secao, StatusLabel, type Estado } from '@/components/control/primitives';
import { useClickUpIntegration } from '@/hooks/use-clickup-integration';
import { useNotionIntegration } from '@/hooks/use-notion-integration';
import { useMcpStatus } from '@/hooks/use-mcp-status';
import { Consentimento } from '@/components/settings/consentimento';
import { ClickUpIntegrationSection } from '@/components/settings/clickup-integration-card';
import { NotionIntegrationSection } from '@/components/settings/notion-integration-card';
import { MotionProvidersSection } from '@/components/settings/motion-providers-card';
import { InteligenciaConectada } from '@/components/control/inteligencia-conectada';

/**
 * INTEGRAÇÕES — com o que a inteligência fala.
 *
 * O estado de cada uma vem da própria integração quando existe endpoint
 * (`/integrations/clickup/status`, `/integrations/notion/status`). Onde não
 * existe, o cartão diz o que é e por que não há estado — nunca um verde por
 * omissão, que numa tela de integração é a mentira mais fácil de contar.
 */
export default function IntegrationsPage() {
  const { data: clickup, isPending: clickupPendente } = useClickUpIntegration();
  const { data: notion, isPending: notionPendente } = useNotionIntegration();
  const { data: mcp, isPending: mcpPendente } = useMcpStatus();

  return (
    <div className="mx-auto max-w-[1200px]">
      <ControlHeader
        title="Integrações"
        description="Os sistemas que a inteligência alcança, e o estado de cada ligação."
      />

      {/*
        * VEIO DA HOME. Lá ocupava uma seção inteira para responder uma pergunta
        * que quase ninguém faz ao abrir o sistema de manhã — "quantas pessoas
        * estão conectadas pelo MCP". Aqui ela é a primeira pergunta da tela,
        * porque quem abre Integrações veio justamente perguntar isso.
        */}
      <Secao titulo="Inteligência conectada">
        <InteligenciaConectada />
      </Secao>

      <Secao titulo="Inteligência">
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {/*
            * O ESTADO DO CLAUDE É LIDO, não escrito aqui.
            *
            * Este cartão dizia "Sem conexões — depende do MCP, que ainda não
            * foi publicado". Era verdade quando foi escrito e falso horas
            * depois: o servidor subiu e a equipe conectou. Exatamente o mesmo
            * defeito que a tela de MCP já tinha cometido e que foi corrigido
            * lá — a afirmação por constante envelhece sem avisar, e ninguém
            * revisa um cartão que "sempre disse isso".
            */}
          <Cartao
            nome="Claude"
            logo={<ClaudeMark size={28} />}
            estado={mcpPendente ? 'desconhecido' : (mcp?.pessoas_conectadas ?? 0) > 0 ? 'ok' : 'atencao'}
            texto={
              mcpPendente
                ? 'Consultando'
                : (mcp?.pessoas_conectadas ?? 0) > 0
                  ? `${mcp!.pessoas_conectadas} pessoa(s) conectada(s)`
                  : 'Ninguém conectado'
            }
            detalhe={
              mcpPendente
                ? 'lendo o estado'
                : (mcp?.chamadas_24h ?? 0) > 0
                  ? `${mcp!.chamadas_24h} chamada(s) em 24h`
                  : 'memória, tarefas e contexto da empresa'
            }
            href="/mcp"
          />
        </div>
      </Secao>

      <Secao titulo="Operação">
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <Cartao
            nome="ClickUp"
            estado={clickupPendente ? 'desconhecido' : clickup?.connected ? 'ok' : 'atencao'}
            texto={clickupPendente ? 'Consultando' : clickup?.connected ? 'Conectado' : 'Desconectado'}
            detalhe="tarefas, prazos, responsáveis"
            href="#conectar"
          />
          <Cartao
            nome="Notion"
            logo={<Image src="/brand/notion.png" alt="" width={28} height={28} unoptimized className="rounded-[4px]" />}
            estado={notionPendente ? 'desconhecido' : notion?.connected ? 'ok' : 'atencao'}
            texto={notionPendente ? 'Consultando' : notion?.connected ? 'Conectado' : 'Desconectado'}
            detalhe="documentos e bases"
            href="#conectar"
          />
        </div>
      </Secao>

      {/*
        * O CONSENTIMENTO FICA JUNTO DAS INTEGRAÇÕES, não perdido em
        * Configurações: é aqui que alguém decide conectar, e a autorização
        * precisa estar no mesmo lugar da decisão.
        */}
      {/*
        * CONECTAR ACONTECE ONDE A FONTE É MOSTRADA. Estes três blocos viviam em
        * Configurações, e os cartões acima linkavam PARA LÁ — duas portas pro
        * mesmo ajuste, que é como duas telas divergem.
        */}
      <Secao titulo="Conectar e ajustar">
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-lg border border-grafite-elevado bg-grafite px-5 py-4">
            <ClickUpIntegrationSection />
            <NotionIntegrationSection />
          </div>
          <div className="rounded-lg border border-grafite-elevado bg-grafite px-5 py-4">
            <MotionProvidersSection />
          </div>
        </div>
      </Secao>

      <Secao titulo="Autorização da empresa">
        <Consentimento />
      </Secao>
    </div>
  );
}

function Cartao({
  nome,
  logo,
  estado,
  texto,
  detalhe,
  href,
}: {
  nome: string;
  logo?: React.ReactNode;
  estado: Estado;
  texto: string;
  detalhe: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-grafite-elevado bg-grafite px-4 py-4 transition-colors hover:border-nevoa/30"
    >
      <div className="flex items-center gap-2.5">
        {logo}
        <p className="font-heading text-base font-semibold text-branco-cru">{nome}</p>
      </div>
      <div className="mt-2">
        <StatusLabel estado={estado}>{texto}</StatusLabel>
      </div>
      <p className="mt-1.5 font-mono text-[11px] text-nevoa">{detalhe}</p>
    </Link>
  );
}
