'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Search } from 'lucide-react';
import { ClaudeMark, Secao, StatusLabel, type Estado } from '@/components/control/primitives';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/lib/utils';
import { useClickUpIntegration } from '@/hooks/use-clickup-integration';
import { useNotionIntegration } from '@/hooks/use-notion-integration';
import { useMcpStatus } from '@/hooks/use-mcp-status';
import { useMe } from '@/hooks/use-me';
import { useWhatsappHealth } from '@/hooks/use-organization-connectors';
import { useMetaIntegration } from '@/hooks/use-meta-integration';
import { useGoogleAdsIntegration } from '@/hooks/use-google-ads-integration';
import { useMicrosoftCalendarIntegration } from '@/hooks/use-microsoft-calendar';
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
import { WhatsappBusinessCard } from '@/components/settings/whatsapp-business-card';
import { BentoWhatsappSection } from '@/components/settings/bento-whatsapp-card';
import { useBentoWhatsappMe } from '@/hooks/use-bento-whatsapp';
import { useWhatsappOpenwaSessions } from '@/hooks/use-whatsapp-openwa';
import { InteligenciaConectada } from '@/components/control/inteligencia-conectada';
import { saudeDasIntegracoes } from '@/lib/saude-das-integracoes';

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
  const { data: openwaSessions, isPending: openwaPendente } = useWhatsappOpenwaSessions();
  const openwaConnected = openwaSessions?.some((session) => session.status === 'ready') === true;
  const { data: meta, isPending: metaPendente } = useMetaIntegration();
  const { data: googleAds, isPending: googleAdsPendente } = useGoogleAdsIntegration();
  const { data: microsoftCal, isPending: microsoftCalPendente } = useMicrosoftCalendarIntegration();
  const { data: bentoWhatsapp, isPending: bentoWhatsappPendente } = useBentoWhatsappMe();

  /**
   * O conjunto, a partir dos MESMOS estados que alimentam cada cartão — nunca
   * uma segunda contagem que possa divergir do que a tela mostra logo abaixo.
   * O WhatsApp entra pelo que ele é hoje: existe no produto e não tem conexão,
   * e omiti-lo faria o total parecer melhor do que é.
   */
  const saude = saudeDasIntegracoes([
    clickup,
    notion,
    meta,
    googleAds,
    microsoftCal,
    { connected: openwaConnected || whatsapp?.connected === true, configured: whatsapp !== undefined || (openwaSessions?.length ?? 0) > 0 },
    /**
     * O CLAUDE ENTRA NA CONTA, e não entrava.
     *
     * A faixa dizia "de 7 integrações" com OITO cartões na grade logo abaixo.
     * Os dois números saíam de listas diferentes, e quem lesse a tela tinha
     * que escolher em qual acreditar. O Claude é uma integração como as
     * outras: ele aparece como cartão, então conta.
     *
     * "Conectado" aqui é pessoa de fato conectada pelo MCP, que é o mesmo
     * critério do cartão. `configured` é sempre verdadeiro porque o servidor
     * MCP é parte do produto, não variável de ambiente que alguém esqueceu.
     */
    mcpPendente ? undefined : { connected: (mcp?.pessoas_conectadas ?? 0) > 0, configured: true },
    // Bento no WhatsApp: "conectado" é ESTA pessoa ter o número vinculado;
    // canal desligado no servidor conta como não configurado.
    bentoWhatsappPendente
      ? undefined
      : { connected: Boolean(bentoWhatsapp?.link), configured: bentoWhatsapp?.enabled === true },
  ]);
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<CartaoProps | null>(null);
  const [categoria, setCategoria] = useState<string>('todas');

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
        {
          // O mesmo Bento do chat, por outro canal: o cartão é sobre o AGENTE,
          // por isso mora em Inteligência e não junto do WhatsApp do Inbox.
          nome: 'Bento no WhatsApp',
          categoria: 'Inteligência',
          bannerClassName: 'bg-agent-bento',
          logo: <Image src="/agents/bento.png" alt="" width={44} height={44} className="rounded-full" />,
          estado: bentoWhatsappPendente
            ? 'desconhecido'
            : !bentoWhatsapp?.enabled
              ? 'atencao'
              : bentoWhatsapp.link
                ? 'ok'
                : 'atencao',
          texto: bentoWhatsappPendente
            ? 'Consultando'
            : !bentoWhatsapp?.enabled
              ? 'Canal desligado'
              : bentoWhatsapp.link
                ? 'Seu número está vinculado'
                : 'Seu número não está vinculado',
          painel: <BentoWhatsappSection />,
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
          estado: openwaPendente || whatsappPendente ? 'desconhecido' : openwaConnected || whatsapp?.connected ? 'ok' : 'atencao',
          texto: openwaPendente || whatsappPendente ? 'Consultando' : openwaConnected || whatsapp?.connected ? 'Conectado' : (openwaSessions?.length ?? 0) > 0 ? 'Sessão em configuração' : whatsapp?.configured ? 'Vinculado, verificando' : 'Não vinculado',
          painel: (
            <div className="space-y-4">
              <WhatsappBusinessCard />
              <details className="rounded-lg border border-grafite-elevado px-4 py-3 text-sm text-nevoa">
                <summary className="cursor-pointer">Conector W-API legado</summary>
                <div className="mt-3"><WhatsAppConnectCard /></div>
              </details>
            </div>
          ),
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
        // Google Calendar saiu desta lista em 14/10/2026: a agência usa só
        // Outlook (Pedro: "é sempre Microsoft, não existe Google Calendar").
      ],
    },
  ];

  const termo = busca.trim().toLowerCase();

  /** Uma lista só: a categoria já é um campo de cada cartão, então agrupar em
   *  seções fixas era uma segunda verdade sobre a mesma informação. */
  const todosOsCartoes = secoes.flatMap((s) => s.itens);

  const abas = [
    { id: 'todas', rotulo: 'Todas', quantidade: todosOsCartoes.length },
    ...[...new Set(todosOsCartoes.map((i) => i.categoria))].map((cat) => ({
      id: cat,
      rotulo: cat,
      quantidade: todosOsCartoes.filter((i) => i.categoria === cat).length,
    })),
  ];

  const visiveis = todosOsCartoes.filter((i) => {
    if (categoria !== 'todas' && i.categoria !== categoria) return false;
    if (!termo) return true;
    return i.nome.toLowerCase().includes(termo) || i.categoria.toLowerCase().includes(termo);
  });

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
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
        O ESTADO DO CONJUNTO, antes dos cartões um a um.

        O mockup mostra "Saúde das integrações: Excelente · 100% operacionais"
        com quatro de doze conectadas, e essa conta não fecha — 100% do quê?
        Numa tela de integração, verde por omissão é a mentira mais fácil de
        contar, porque ninguém confere "está tudo certo" e, quando descobre que
        não estava, já perdeu o dia procurando o problema noutro lugar.

        Aqui a saúde é a fração das CONFIGURADAS que estão conectadas, e o que
        falta configuração aparece separado: uma conexão que um clique resolve e
        uma que depende de alguém mexer no ambiente são problemas diferentes, e
        somar as duas esconde as duas.
      */}
      {!termo && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {
              rotulo: 'Conectadas',
              valor: `${saude.conectadas}`,
              detalhe: `de ${saude.total} integrações`,
              tom: saude.conectadas > 0 ? 'text-sinal' : 'text-nevoa',
            },
            {
              rotulo: 'Prontas pra conectar',
              valor: `${saude.prontas}`,
              detalhe: saude.prontas > 0 ? 'falta clicar em conectar' : 'nenhuma esperando',
              tom: saude.prontas > 0 ? 'text-aviso' : 'text-branco-cru',
            },
            {
              rotulo: 'Sem configuração',
              valor: `${saude.semConfiguracao}`,
              detalhe: saude.semConfiguracao > 0 ? 'dependem de administrador' : 'ambiente completo',
              tom: saude.semConfiguracao > 0 ? 'text-nevoa' : 'text-branco-cru',
            },
            {
              rotulo: 'Saúde',
              valor: saude.rotulo,
              detalhe:
                saude.proporcao === null
                  ? 'nada configurado ainda'
                  : `${Math.round(saude.proporcao * 100)}% das configuradas`,
              tom:
                saude.proporcao === 1
                  ? 'text-sinal'
                  : saude.proporcao === null || saude.proporcao === 0
                    ? 'text-nevoa'
                    : 'text-aviso',
            },
          ].map((k) => (
            <div key={k.rotulo} className="rounded-lg border border-grafite-elevado bg-grafite/60 px-4 py-3 transition-colors hover:border-roxo-eletrico/40">
              <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">{k.rotulo}</p>
              <p className={cn('mt-1 font-heading text-xl font-semibold', k.tom)}>{k.valor}</p>
              <p className="mt-0.5 text-[11px] text-nevoa">{k.detalhe}</p>
            </div>
          ))}
        </div>
      )}

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

      {/*
        * ABAS POR CATEGORIA, com contagem que sai das integrações REAIS.
        *
        * O mockup traz "Todas 12 · Inteligência 3 · Comunicação 3 · Gestão 4 ·
        * Mídia e Marketing 2". Os rótulos e os números aqui são derivados dos
        * cartões que existem de fato — nenhuma categoria aparece vazia só pra
        * bater com a imagem, e nenhuma integração foi inventada pra completar
        * contagem.
        */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {abas.map((aba) => (
          <button
            key={aba.id}
            type="button"
            onClick={() => setCategoria(aba.id)}
            aria-pressed={categoria === aba.id}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] transition-colors',
              categoria === aba.id
                ? 'border-roxo-eletrico/60 bg-roxo-eletrico/15 text-branco-cru'
                : 'border-grafite-elevado text-nevoa hover:border-nevoa/40 hover:text-branco-cru',
            )}
          >
            {aba.rotulo}
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 font-mono text-[10px]',
                categoria === aba.id ? 'bg-roxo-eletrico/25 text-branco-cru' : 'bg-grafite-elevado text-nevoa',
              )}
            >
              {aba.quantidade}
            </span>
          </button>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <p className="py-10 text-center text-sm text-nevoa">
          {termo ? <>Nenhuma integração encontrada para &quot;{busca}&quot;.</> : 'Nenhuma integração nesta categoria.'}
        </p>
      ) : (
        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visiveis.map((item) => (
            <Cartao key={item.nome} {...item} onAbrir={() => setAberto(item)} />
          ))}
        </div>
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
      className="group flex w-full flex-col overflow-hidden rounded-xl border border-grafite-elevado bg-grafite/40 p-4 text-left transition-colors hover:border-roxo-eletrico/40"
    >
      <div className="flex items-start justify-between gap-3">
        {/* O banner virou um quadrado de 40px: no mockup o cartão é compacto e
            cabem quatro por linha. Uma faixa de 112px por cartão empurrava o
            estado da ligação, que é o que a pessoa veio ver, pra fora da tela. */}
        <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', bannerClassName)}>
          {logo}
        </span>
        <StatusLabel estado={estado}>{texto}</StatusLabel>
      </div>

      <p className="mt-3 font-heading text-[15px] font-semibold text-branco-cru">{nome}</p>
      <span className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-nevoa">{categoria}</span>

      <span className="mt-3 inline-flex items-center gap-1.5 self-start rounded-md border border-grafite-elevado px-2.5 py-1 text-[12px] text-nevoa transition-colors group-hover:border-roxo-eletrico/50 group-hover:text-branco-cru">
        Configurar
      </span>
    </button>
  );
}
