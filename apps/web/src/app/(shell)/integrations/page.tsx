'use client';

import { useState } from 'react';
import Image from 'next/image';
import { CalendarDays, Search } from 'lucide-react';
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
import { useGoogleCalendarIntegration } from '@/hooks/use-google-calendar';
import { MetaConnect, GoogleAdsConnect } from '@/components/settings/conexao-oauth-card';
/**
 * O painel COMPLETO, o mesmo que a página /calendar usa: conectar, escolher a
 * agenda e sincronizar. Eu tinha escrito uma segunda versão aqui que só fazia
 * o OAuth — e com o mesmo nome, o que é como um painel ganha dois donos e
 * começa a divergir. Conectar sem escolher a agenda não traz evento nenhum,
 * que é exatamente o estado em que a conexão da Microsoft está hoje no banco:
 * `integration_connections` tem a linha, `member_calendar_accounts` está
 * vazia.
 */
import { GoogleCalendarConnect } from '@/components/calendar/google-calendar-connect';
/**
 * Microsoft vinha do cartão só-de-OAuth, e isso tinha consequência medida: em
 * 08/10/2026 o banco tinha a linha em `integration_connections` (OAuth feito)
 * e `member_calendar_accounts` VAZIA — ou seja, alguém conectou pela tela de
 * Integrações, nunca viu o passo de escolher a agenda, e nenhum evento
 * chegou. A conexão existia e não servia pra nada.
 */
import { MicrosoftCalendarConnect } from '@/components/calendar/microsoft-calendar-connect';
import { IntegracaoDialog } from '@/components/settings/integracao-dialog';
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
  const { data: googleCal, isPending: googleCalPendente } = useGoogleCalendarIntegration();
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<CartaoProps | null>(null);

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
          painel: <MotionProvidersSection />,
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
          painel: <ClickUpIntegrationSection />,
        },
        {
          nome: 'Notion',
          categoria: 'Documentos',
          bannerClassName: 'bg-branco-cru',
          logo: <Image src="/brand/notion.png" alt="" width={44} height={44} unoptimized className="rounded-[6px]" />,
          estado: notionPendente ? 'desconhecido' : notion?.connected ? 'ok' : 'atencao',
          texto: notionPendente ? 'Consultando' : notion?.connected ? 'Conectado' : 'Desconectado',
          painel: <NotionIntegrationSection />,
        },
        {
          nome: 'WhatsApp',
          categoria: 'Mensageria',
          bannerClassName: 'bg-[#25D366]',
          logo: <img src="/logos/whatsapp.webp" alt="" className="size-10 rounded-[6px]" />,
          estado: whatsappPendente ? 'desconhecido' : whatsapp?.connected ? 'ok' : 'atencao',
          texto: whatsappPendente ? 'Consultando' : whatsapp?.connected ? 'Conectado' : whatsapp?.configured ? 'Vinculado, verificando' : 'Não vinculado',
          painel: <WhatsAppConnectCard />,
        },
      ],
    },
    {
      // Microsoft Calendar vive AQUI, e não numa seção própria: três cartões
      // fecham exatamente uma fileira, e uma seção só pra ele deixava um cartão
      // órfão numa linha vazia abaixo (pedido da operação, 08/10/2026).
      titulo: 'Mídia e Agenda',
      itens: [
        {
          nome: 'Meta Ads',
          categoria: 'Mídia paga',
          bannerClassName: 'bg-branco-cru',
          logo: <Image src="/logos/meta.png" alt="" width={40} height={40} unoptimized className="rounded-[6px]" />,
          estado: metaPendente ? 'desconhecido' : meta?.connected ? 'ok' : 'atencao',
          texto: metaPendente ? 'Consultando' : meta?.connected ? 'Conectado' : 'Desconectado',
          painel: <MetaConnect />,
        },
        {
          nome: 'Google Ads',
          categoria: 'Mídia paga',
          bannerClassName: 'bg-branco-cru',
          logo: <Image src="/logos/google-ads.webp" alt="" width={40} height={40} unoptimized className="rounded-[6px]" />,
          estado: googleAdsPendente ? 'desconhecido' : googleAds?.connected ? 'ok' : 'atencao',
          texto: googleAdsPendente ? 'Consultando' : googleAds?.connected ? 'Conectado' : 'Desconectado',
          painel: <GoogleAdsConnect />,
        },
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
          painel: <MicrosoftCalendarConnect />,
        },
        {
          /**
           * Google Calendar estava FALTANDO aqui (achado em 08/10/2026,
           * clicando a tela no navegador): a API tem as cinco rotas, as três
           * variáveis estão preenchidas e o status responde `configured: true`
           * — e não havia cartão. Quem usa Google em vez de Outlook não tinha
           * como conectar a agenda, sem nenhum sinal de que faltava algo.
           *
           * Ícone em vez de PNG de propósito: não há logo do Google Calendar em
           * public/logos, e reaproveitar o do Google Ads seria mostrar a marca
           * errada. Ícone neutro diz a verdade.
           */
          nome: 'Google Calendar',
          categoria: 'Agenda',
          bannerClassName: 'bg-branco-cru',
          logo: <CalendarDays size={28} className="text-carbono" />,
          estado: googleCalPendente ? 'desconhecido' : googleCal?.connected ? 'ok' : 'atencao',
          texto: googleCalPendente ? 'Consultando' : googleCal?.connected ? 'Conectado' : 'Desconectado',
          painel: <GoogleCalendarConnect />,
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
                <Cartao key={item.nome} {...item} onAbrir={() => setAberto(item)} />
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
      <Secao titulo="Autorização da empresa">
        <Consentimento />
      </Secao>

      {/*
        * O AJUSTE ABRE SOBRE O CARTÃO CLICADO, não numa seção no fim da página.
        * A seção "Conectar e ajustar" obrigava a pessoa a rolar e achar o bloco
        * certo entre vários — e cartão sem bloco correspondente rolava pra
        * lugar nenhum. Agora o painel pertence ao cartão: não existe cartão sem
        * destino, porque o destino é um campo dele.
        */}
      {aberto && (
        <IntegracaoDialog titulo={aberto.nome} onClose={() => setAberto(null)}>
          {aberto.painel}
        </IntegracaoDialog>
      )}
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
  /** O painel de ajuste desta integração — abre em modal ao clicar. */
  painel: React.ReactNode;
}

/**
 * Cartão estilo vitrine (banner colorido + logo + categoria + status), não a
 * contagem de "automatizações" que um marketplace de verdade mostraria — aqui
 * não existe isso pra inventar. O que entra no lugar é o estado REAL da
 * ligação, porque é exatamente o que a pessoa veio ver ao clicar.
 */
function Cartao({ nome, categoria, bannerClassName, logo, estado, texto, onAbrir }: CartaoProps & { onAbrir: () => void }) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="group block w-full overflow-hidden rounded-xl border border-grafite-elevado bg-grafite text-left transition-colors hover:border-nevoa/30"
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
          Configurar →
        </p>
      </div>
    </button>
  );
}
