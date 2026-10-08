'use client';

import { useEffect, useState } from 'react';
import { Check, Link2, Unlink } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError } from '@/lib/api/client';
import { useConnectMeta, useDisconnectMeta, useMetaIntegration } from '@/hooks/use-meta-integration';
import {
  useConnectGoogleAds,
  useDisconnectGoogleAds,
  useGoogleAdsIntegration,
} from '@/hooks/use-google-ads-integration';
import { useConnectMicrosoftCalendar, useMicrosoftCalendarIntegration } from '@/hooks/use-microsoft-calendar';

/**
 * CONEXÃO OAUTH — o botão que faltava.
 *
 * Meta Ads, Google Ads, Google Calendar e Microsoft Calendar tinham rota de
 * authorize na API, hook de conexão no front e cartão na vitrine de
 * Integrações — e NENHUM lugar pra clicar. O cartão apontava pra âncora
 * "#conectar", que só continha ClickUp, Notion, Motion e WhatsApp: a pessoa
 * clicava, a tela rolava, e não acontecia nada (relato do Pedro, 08/10/2026).
 *
 * Todos têm exatamente a mesma forma de status (`{ connected, configured }`) e
 * o mesmo gesto (pedir authorize_url ao servidor e mandar o browser pra lá),
 * então um componente só atende todos. Repetir cartões quase iguais seria
 * criar vários lugares pra divergir.
 *
 * `configured: false` significa que o SERVIDOR não tem as credenciais —
 * situação diferente de "não conectado", e o botão fica desabilitado com o
 * motivo escrito, em vez de abrir um fluxo que morreria no provedor.
 */

interface ConexaoProps {
  nome: string;
  descricao: string;
  descricaoConectado: string;
  /** O que falta no servidor quando `configured` é false — nomeado, não genérico. */
  variaveis: string[];
  status: { connected: boolean; configured: boolean } | undefined;
  carregando: boolean;
  conectar: () => void;
  conectando: boolean;
  erroConectar: unknown;
  desconectar?: (() => void) | undefined;
  desconectando?: boolean | undefined;
  /** Parâmetro que o callback devolve na URL (ex.: ?meta=conectado). */
  paramCallback: string;
}

const MENSAGENS: Record<string, { text: string; tone: 'ok' | 'erro' }> = {
  conectado: { text: 'Conectado com sucesso.', tone: 'ok' },
  recusado: { text: 'A autorização foi recusada no provedor. Nada mudou aqui.', tone: 'erro' },
  erro_config: { text: 'O servidor está sem as credenciais desta integração.', tone: 'erro' },
  erro_parametros: { text: 'O provedor devolveu um retorno incompleto. Tente de novo.', tone: 'erro' },
  erro_state: { text: 'O pedido de conexão expirou ou não confere. Tente de novo.', tone: 'erro' },
  erro_troca: { text: 'Não foi possível concluir a autorização. Tente de novo.', tone: 'erro' },
};

function mensagemDeErro(error: unknown, padrao: string): string {
  return error instanceof ApiRequestError ? error.message : padrao;
}

export function ConexaoOAuth({
  nome,
  descricao,
  descricaoConectado,
  variaveis,
  status,
  carregando,
  conectar,
  conectando,
  erroConectar,
  desconectar,
  desconectando,
  paramCallback,
}: ConexaoProps) {
  const [aviso, setAviso] = useState<{ text: string; tone: 'ok' | 'erro' } | null>(null);

  // Lido de window.location em vez de useSearchParams, igual aos cards do
  // ClickUp e do Notion: evita exigir Suspense boundary só pra mostrar um aviso.
  useEffect(() => {
    const valor = new URLSearchParams(window.location.search).get(paramCallback);
    if (!valor) return;
    setAviso(MENSAGENS[valor] ?? null);
    window.history.replaceState({}, '', window.location.pathname);
  }, [paramCallback]);

  if (carregando) return <Skeleton className="h-24 w-full" />;

  const conectado = status?.connected === true;
  const semCredencial = status?.configured === false;

  return (
    <div className="mt-4 rounded-lg border border-grafite-elevado p-4">
      {aviso && (
        <p
          className={`mb-3 rounded-md px-3 py-2 text-sm ${
            aviso.tone === 'ok' ? 'bg-sinal/10 text-sinal' : 'bg-erro/10 text-erro'
          }`}
        >
          {aviso.text}
        </p>
      )}

      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-branco-cru">{nome}</p>
          <p className="mt-1 text-sm text-nevoa">{conectado ? descricaoConectado : descricao}</p>
        </div>
        {conectado && <Check size={16} className="mt-1 shrink-0 text-sinal" />}
      </div>

      {semCredencial && (
        <div className="mb-3 rounded-md border border-aviso/40 bg-aviso/10 px-3 py-2.5 text-sm text-aviso">
          <p className="font-medium">Falta configurar {nome} no servidor.</p>
          <p className="mt-1 text-[13px]">Preencha no .env do Orchestrator:</p>
          <ul className="mt-1.5 font-mono text-[11px]">
            {variaveis.map((v) => (
              <li key={v}>· {v}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-2">
        {conectado && desconectar ? (
          <button
            type="button"
            onClick={desconectar}
            disabled={desconectando === true}
            className="inline-flex items-center gap-2 rounded-md border border-grafite-elevado px-3 py-1.5 text-sm text-nevoa transition-colors hover:text-branco-cru disabled:opacity-40"
          >
            <Unlink size={14} />
            {desconectando === true ? 'Desconectando…' : 'Desconectar'}
          </button>
        ) : (
          <button
            type="button"
            onClick={conectar}
            disabled={conectando || semCredencial}
            className="inline-flex items-center gap-2 rounded-md bg-roxo-eletrico px-3 py-1.5 text-sm text-branco-cru transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Link2 size={14} />
            {conectando ? 'Abrindo…' : `Conectar ${nome}`}
          </button>
        )}
      </div>

      {Boolean(erroConectar) && (
        <p className="mt-2 text-sm text-erro">{mensagemDeErro(erroConectar, 'Não consegui iniciar a conexão.')}</p>
      )}
    </div>
  );
}

/** Mídia paga: as duas contas de anúncio que o sistema lê. */
export function MidiaConnectSection() {
  const meta = useMetaIntegration();
  const conectarMeta = useConnectMeta();
  const desconectarMeta = useDisconnectMeta();
  const ads = useGoogleAdsIntegration();
  const conectarAds = useConnectGoogleAds();
  const desconectarAds = useDisconnectGoogleAds();

  return (
    <>
      <ConexaoOAuth
        nome="Meta Ads"
        descricao="Conecte sua conta pra que os agentes leiam campanhas, criativos e resultados do Meta."
        descricaoConectado="Conectado. Os agentes já leem suas campanhas do Meta."
        variaveis={['META_APP_ID', 'META_APP_SECRET', 'META_REDIRECT_URI']}
        status={meta.data}
        carregando={meta.isPending}
        conectar={() => conectarMeta.mutate()}
        conectando={conectarMeta.isPending}
        erroConectar={conectarMeta.error}
        desconectar={() => desconectarMeta.mutate()}
        desconectando={desconectarMeta.isPending}
        paramCallback="meta"
      />
      <ConexaoOAuth
        nome="Google Ads"
        descricao="Conecte sua conta pra que os agentes leiam campanhas e desempenho do Google Ads."
        descricaoConectado="Conectado. Os agentes já leem suas campanhas do Google Ads."
        variaveis={[
          'GOOGLE_ADS_CLIENT_ID',
          'GOOGLE_ADS_CLIENT_SECRET',
          'GOOGLE_ADS_REDIRECT_URI',
          'GOOGLE_ADS_DEVELOPER_TOKEN',
        ]}
        status={ads.data}
        carregando={ads.isPending}
        conectar={() => conectarAds.mutate()}
        conectando={conectarAds.isPending}
        erroConectar={conectarAds.error}
        desconectar={() => desconectarAds.mutate()}
        desconectando={desconectarAds.isPending}
        paramCallback="google_ads"
      />
    </>
  );
}

/**
 * Calendário: só Microsoft.
 *
 * O Google Calendar foi retirado a pedido da operação, que usa Outlook — a
 * rota, o hook e o fluxo continuam existindo no código, então voltar atrás é
 * acrescentar o bloco de novo, não reimplementar.
 *
 * Sem `desconectar`: a API não expõe DELETE pra essa conexão (o vínculo é por
 * conta de calendário, em outra tela). Oferecer um botão que não tem rota
 * atrás seria pior que não oferecer.
 */
export function CalendarioConnectSection() {
  const microsoft = useMicrosoftCalendarIntegration();
  const conectarMicrosoft = useConnectMicrosoftCalendar();

  return (
    <>
      <ConexaoOAuth
        nome="Microsoft Calendar"
        descricao="Conecte sua agenda do Outlook/Microsoft 365 pra que as reuniões apareçam no Calendário."
        descricaoConectado="Conectado. Sua agenda da Microsoft aparece no Calendário."
        variaveis={[
          'MICROSOFT_CALENDAR_CLIENT_ID',
          'MICROSOFT_CALENDAR_CLIENT_SECRET',
          'MICROSOFT_CALENDAR_REDIRECT_URI',
        ]}
        status={microsoft.data}
        carregando={microsoft.isPending}
        conectar={() => conectarMicrosoft.mutate()}
        conectando={conectarMicrosoft.isPending}
        erroConectar={conectarMicrosoft.error}
        paramCallback="microsoft_calendar"
      />
    </>
  );
}
