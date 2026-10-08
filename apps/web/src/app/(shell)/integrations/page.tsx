'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Search } from 'lucide-react';
import { ClaudeMark, ControlHeader, Secao, StatusLabel, type Estado } from '@/components/control/primitives';
import { cn } from '@/lib/utils';
import { useClickUpIntegration } from '@/hooks/use-clickup-integration';
import { useNotionIntegration } from '@/hooks/use-notion-integration';
import { useMcpStatus } from '@/hooks/use-mcp-status';
import { useMe } from '@/hooks/use-me';
import { useWhatsappHealth } from '@/hooks/use-organization-connectors';
import { useMetaIntegration } from '@/hooks/use-meta-integration';
import { useGoogleAdsIntegration } from '@/hooks/use-google-ads-integration';
import { useMicrosoftCalendarIntegration } from '@/hooks/use-microsoft-calendar';
import { MidiaConnectSection, CalendarioConnectSection } from '@/components/settings/conexao-oauth-card';
import { Consentimento } from '@/components/settings/consentimento';
import { ClickUpIntegrationSection } from '@/components/settings/clickup-integration-card';
import { NotionIntegrationSection } from '@/components/settings/notion-integration-card';
import { MotionProvidersSection } from '@/components/settings/motion-providers-card';
import { WhatsAppConnectCard } from '@/components/settings/whatsapp-connect-card';
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
  const { data: me } = useMe();
  const { data: whatsapp, isPending: whatsappPendente } = useWhatsappHealth(me?.organizacao_ativa?.id ?? null);
  const { data: meta, isPending: metaPendente } = useMetaIntegration();
  const { data: googleAds, isPending: googleAdsPendente } = useGoogleAdsIntegration();
  const { data: microsoftCal, isPending: microsoftCalPendente } = useMicrosoftCalendarIntegration();
  const [busca, setBusca] = useState('');

  // Cada seção é uma lista de dados, não JSX solta: é o que permite a busca
  // filtrar cartão por cartão (e some a seção inteira se nada nela casar) sem
  // repetir a mesma lógica de filtro três vezes.
  const secoes: { titulo: string; itens: CartaoProps[] }[] = [
    {
      titulo: 'Inteligência',
      itens: [
        {
          // O ESTADO DO CLAUDE É LIDO, não escrito aqui. Este cartão dizia "Sem
          // conexões — depende do MCP, que ainda não foi publicado". Era
          // verdade quando foi escrito e falso horas depois: o servidor subiu
          // e a equipe conectou. A afirmação por constante envelhece sem
          // avisar, e ninguém revisa um cartão que "sempre disse isso".
          nome: 'Claude',
          categoria: 'Inteligência',
          bannerClassName: 'bg-grafite-elevado',
          logo: <ClaudeMark size={40} />,
          estado: mcpPendente ? 'desconhecido' : (mcp?.pessoas_conectadas ?? 0) > 0 ? 'ok' : 'atencao',
          texto: mcpPendente
            ? 'Consultando'
            : (mcp?.pessoas_conectadas ?? 0) > 0
              ? `${mcp!.pessoas_conectadas} pessoa(s) conectada(s)`
              : 'Ninguém conectado',
          href: '/mcp',
        },
      ],
    },
    {
      titulo: 'Operação',
      itens: [
        {
          nome: 'ClickUp',
          categoria: 'Tarefas',
          bannerClassName: 'bg-[#7B68EE]',
          logo: <Image src="/logos/clickup-white.svg" alt="" width={40} height={40} />,
          estado: clickupPendente ? 'desconhecido' : clickup?.connected ? 'ok' : 'atencao',
          texto: clickupPendente ? 'Consultando' : clickup?.connected ? 'Conectado' : 'Desconectado',
          href: '#conectar',
        },
        {
          nome: 'Notion',
          categoria: 'Documentos',
          bannerClassName: 'bg-branco-cru',
          logo: <Image src="/brand/notion.png" alt="" width={44} height={44} unoptimized className="rounded-[6px]" />,
          estado: notionPendente ? 'desconhecido' : notion?.connected ? 'ok' : 'atencao',
          texto: notionPendente ? 'Consultando' : notion?.connected ? 'Conectado' : 'Desconectado',
          href: '#conectar',
        },
        {
          nome: 'WhatsApp',
          categoria: 'Mensageria',
          bannerClassName: 'bg-[#25D366]',
          logo: <img src="/logos/whatsapp.webp" alt="" className="size-10 rounded-[6px]" />,
          estado: whatsappPendente ? 'desconhecido' : whatsapp?.connected ? 'ok' : 'atencao',
          texto: whatsappPendente ? 'Consultando' : whatsapp?.connected ? 'Conectado' : whatsapp?.configured ? 'Vinculado, verificando' : 'Não vinculado',
          href: '#conectar',
        },
      ],
    },
    {
      titulo: 'Mídia',
      itens: [
        {
          nome: 'Meta Ads',
          categoria: 'Mídia paga',
          bannerClassName: 'bg-branco-cru',
          logo: <Image src="/logos/meta.png" alt="" width={40} height={40} unoptimized className="rounded-[6px]" />,
          estado: metaPendente ? 'desconhecido' : meta?.connected ? 'ok' : 'atencao',
          texto: metaPendente ? 'Consultando' : meta?.connected ? 'Conectado' : 'Desconectado',
          href: '#conectar',
        },
        {
          nome: 'Google Ads',
          categoria: 'Mídia paga',
          bannerClassName: 'bg-branco-cru',
          logo: <Image src="/logos/google-ads.webp" alt="" width={40} height={40} unoptimized className="rounded-[6px]" />,
          estado: googleAdsPendente ? 'desconhecido' : googleAds?.connected ? 'ok' : 'atencao',
          texto: googleAdsPendente ? 'Consultando' : googleAds?.connected ? 'Conectado' : 'Desconectado',
          href: '#conectar',
        },
      ],
    },
    {
      // A AGENDA FALTAVA NA VITRINE. Tinha rota de authorize na API, hook no
      // front e tela de Calendário consumindo — e nenhum cartão aqui, então não
      // havia por onde conectar (relato do Pedro, 08/10/2026).
      //
      // Só Microsoft: o Google Calendar foi retirado a pedido da operação, que
      // usa Outlook. A rota e o hook continuam existindo, então voltar é
      // adicionar o cartão de novo, não reimplementar.
      titulo: 'Calendário',
      itens: [
        {
          nome: 'Microsoft Calendar',
          categoria: 'Agenda',
          bannerClassName: 'bg-branco-cru',
          logo: (
            <Image
              src="/logos/microsoft-calendar.png"
              alt=""
              width={40}
              height={40}
              unoptimized
              className="rounded-[6px]"
            />
          ),
          estado: microsoftCalPendente ? 'desconhecido' : microsoftCal?.connected ? 'ok' : 'atencao',
          texto: microsoftCalPendente ? 'Consultando' : microsoftCal?.connected ? 'Conectado' : 'Desconectado',
          href: '#conectar',
        },
      ],
    },
  ];

  const termo = busca.trim().toLowerCase();
  const secoesFiltradas = termo
    ? secoes
        .map((s) => ({ ...s, itens: s.itens.filter((i) => i.nome.toLowerCase().includes(termo) || i.categoria.toLowerCase().includes(termo)) }))
        .filter((s) => s.itens.length > 0)
    : secoes;

  return (
    <div className="mx-auto max-w-[1200px]">
      <ControlHeader
        title="Integrações"
        description="Os sistemas que a inteligência alcança, e o estado de cada ligação."
        actions={
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-nevoa" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar integração..."
              className="w-64 rounded-full border border-grafite-elevado bg-grafite py-2 pl-9 pr-4 text-sm text-branco-cru placeholder:text-nevoa focus:border-nevoa/40 focus:outline-none"
            />
          </div>
        }
      />

      {/*
        * VEIO DA HOME. Lá ocupava uma seção inteira para responder uma pergunta
        * que quase ninguém faz ao abrir o sistema de manhã — "quantas pessoas
        * estão conectadas pelo MCP". Aqui ela é a primeira pergunta da tela,
        * porque quem abre Integrações veio justamente perguntar isso. Fica de
        * fora da busca: não é um cartão de integração, é um resumo fixo.
        */}
      {!termo && (
        <Secao titulo="Inteligência conectada">
          <InteligenciaConectada />
        </Secao>
      )}

      {secoesFiltradas.length === 0 ? (
        <p className="py-10 text-center text-sm text-nevoa">Nenhuma integração encontrada para &quot;{busca}&quot;.</p>
      ) : (
        secoesFiltradas.map((s) => (
          <Secao key={s.titulo} titulo={s.titulo}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {s.itens.map((item) => (
                <Cartao key={item.nome} {...item} />
              ))}
            </div>
          </Secao>
        ))
      )}

      {/*
        * O CONSENTIMENTO FICA JUNTO DAS INTEGRAÇÕES, não perdido em
        * Configurações: é aqui que alguém decide conectar, e a autorização
        * precisa estar no mesmo lugar da decisão.
        */}
      {/*
        * CONECTAR ACONTECE ONDE A FONTE É MOSTRADA. Estes três blocos viviam em
        * Configurações, e os cartões acima linkavam PARA LÁ — duas portas pro
        * mesmo ajuste, que é como duas telas divergem.
        *
        * O id="conectar" é a âncora dos cartões de Operação acima: eles
        * apontavam para "#conectar" sem que a âncora existisse — um link que
        * prometia descer a tela e não descia. scroll-mt afasta o destino do
        * topo para a seção não nascer escondida atrás do cabeçalho.
        */}
      <div id="conectar" className="scroll-mt-6">
      <Secao titulo="Conectar e ajustar">
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-lg border border-grafite-elevado bg-grafite px-5 py-4">
            <ClickUpIntegrationSection />
            <NotionIntegrationSection />
          </div>
          <div className="rounded-lg border border-grafite-elevado bg-grafite px-5 py-4">
            <MotionProvidersSection />
          </div>
          {/*
            * OS CARTÕES DE MÍDIA E CALENDÁRIO APONTAVAM PRA CÁ E NÃO HAVIA NADA
            * PRA ELES. Clicar em "Meta Ads" rolava a tela até esta seção, que só
            * tinha ClickUp, Notion, Motion e WhatsApp — a pessoa clicava e,
            * literalmente, não acontecia nada. Os hooks de conexão já existiam
            * (useConnectMeta, useConnectGoogleAds e os dois de calendário);
            * faltava o lugar de clicar.
            */}
          <div className="rounded-lg border border-grafite-elevado bg-grafite px-5 py-4">
            <MidiaConnectSection />
          </div>
          <div className="rounded-lg border border-grafite-elevado bg-grafite px-5 py-4">
            <CalendarioConnectSection />
          </div>
          <WhatsAppConnectCard />
        </div>
      </Secao>
      </div>

      <Secao titulo="Autorização da empresa">
        <Consentimento />
      </Secao>
    </div>
  );
}

interface CartaoProps {
  nome: string;
  categoria: string;
  bannerClassName: string;
  logo?: React.ReactNode;
  estado: Estado;
  texto: string;
  href: string;
}

/**
 * Cartão estilo vitrine (banner colorido + logo + categoria + status), não a
 * contagem de "automatizações" que um marketplace de verdade mostraria — aqui
 * não existe isso pra inventar. O que entra no lugar é o estado REAL da
 * ligação, porque é exatamente o que a pessoa veio ver ao clicar.
 */
function Cartao({ nome, categoria, bannerClassName, logo, estado, texto, href }: CartaoProps) {
  return (
    <Link
      href={href}
      className="group block overflow-hidden rounded-xl border border-grafite-elevado bg-grafite transition-colors hover:border-nevoa/30"
    >
      <div className={cn('flex h-28 items-center justify-center', bannerClassName)}>{logo}</div>
      <div className="px-4 py-3.5">
        <span className="inline-block rounded-full bg-grafite-elevado px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-nevoa">
          {categoria}
        </span>
        <p className="mt-2 font-heading text-base font-semibold text-branco-cru">{nome}</p>
        <div className="mt-1.5">
          <StatusLabel estado={estado}>{texto}</StatusLabel>
        </div>
        <p className="mt-2.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-roxo-eletrico group-hover:text-branco-cru">
          Ver integração →
        </p>
      </div>
    </Link>
  );
}
