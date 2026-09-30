'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ClaudeMark, ControlHeader, Secao, StatusLabel, type Estado } from '@/components/control/primitives';
import { useClickUpIntegration } from '@/hooks/use-clickup-integration';
import { useNotionIntegration } from '@/hooks/use-notion-integration';

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

  return (
    <div className="mx-auto max-w-[1200px]">
      <ControlHeader
        title="Integrações"
        description="Os sistemas que a inteligência alcança, e o estado de cada ligação."
      />

      <Secao titulo="Inteligência">
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <Cartao
            nome="Claude"
            logo={<ClaudeMark size={28} />}
            estado="desconhecido"
            texto="Sem conexões"
            detalhe="depende do MCP, que ainda não foi publicado"
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
            href="/settings"
          />
          <Cartao
            nome="Notion"
            logo={<Image src="/brand/notion.png" alt="" width={28} height={28} unoptimized className="rounded-[4px]" />}
            estado={notionPendente ? 'desconhecido' : notion?.connected ? 'ok' : 'atencao'}
            texto={notionPendente ? 'Consultando' : notion?.connected ? 'Conectado' : 'Desconectado'}
            detalhe="documentos e bases"
            href="/settings"
          />
        </div>
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
