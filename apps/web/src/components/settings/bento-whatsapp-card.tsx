'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, QrCode, RefreshCw, Smartphone, Unlink, X } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsMaster } from '@/hooks/use-is-master';
import {
  useBentoWhatsappAdminStatus,
  useBentoWhatsappLinks,
  useBentoWhatsappMe,
  useCodigoDeConexaoBentoWhatsapp,
  useConfirmarVinculoBentoWhatsapp,
  useDesvincularBentoWhatsapp,
  useGerarCodigoBentoWhatsapp,
  useIniciarSessaoBentoWhatsapp,
  useLigarCanalBentoWhatsapp,
  useProvisionarSessaoBentoWhatsapp,
  useQrBentoWhatsapp,
  useRecusarCodigoBentoWhatsapp,
  useRevogarVinculoBentoWhatsapp,
  type BentoWhatsappCodeWire,
} from '@/hooks/use-bento-whatsapp';
import { ApiRequestError } from '@/lib/api/client';

/**
 * BENTO NO WHATSAPP — o mesmo Bento, por outro canal.
 *
 * Duas partes:
 *   1. Para qualquer colaborador: vincular o próprio número. O código mostrado
 *      aqui é enviado AO Bento pelo WhatsApp; quando ele chega, esta tela
 *      pergunta "este número é seu?" — e só o "sim" daqui cria o vínculo.
 *   2. Para master: estado da sessão, QR, vínculos, falhas recentes.
 *
 * O código aparece uma vez (o servidor guarda só o hash). Recarregar a página
 * perde o texto do código, não o pedido: dá para gerar outro.
 */

function erroLegivel(erro: unknown, padrao: string): string {
  return erro instanceof ApiRequestError ? erro.message : padrao;
}

function quandoRelativo(iso: string | null | undefined): string {
  if (!iso) return 'nunca';
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

function Contagem({ ate }: { ate: string }) {
  const [, forcar] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forcar((n) => n + 1), 1_000);
    return () => clearInterval(t);
  }, []);
  const restante = Math.max(0, new Date(ate).getTime() - Date.now());
  const min = Math.floor(restante / 60_000);
  const seg = Math.floor((restante % 60_000) / 1_000);
  return (
    <span className="font-mono tabular-nums">
      {restante === 0 ? 'expirado' : `${min}:${String(seg).padStart(2, '0')}`}
    </span>
  );
}

function MeuVinculo() {
  const me = useBentoWhatsappMe();
  const gerar = useGerarCodigoBentoWhatsapp();
  const confirmar = useConfirmarVinculoBentoWhatsapp();
  const recusar = useRecusarCodigoBentoWhatsapp();
  const desvincular = useDesvincularBentoWhatsapp();
  const [codigo, setCodigo] = useState<BentoWhatsappCodeWire | null>(null);
  const [copiado, setCopiado] = useState(false);

  if (me.isPending) return <Skeleton className="h-28 w-full" />;
  if (me.isError || !me.data) {
    return <p className="text-xs text-erro">Não consegui consultar seu vínculo agora.</p>;
  }
  const dados = me.data;

  if (!dados.enabled) {
    return (
      <p className="text-xs leading-relaxed text-nevoa">
        O Bento no WhatsApp ainda não está ativo. Quando a operação ligar, você vincula seu número por aqui.
      </p>
    );
  }

  if (dados.link) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Smartphone size={16} className="text-sucesso" />
            <div>
              <p className="text-sm text-branco-cru">{dados.link.phone}</p>
              <p className="text-[11px] text-nevoa">Vinculado {quandoRelativo(dados.link.linked_at)}</p>
            </div>
          </div>
          <span className="rounded-full bg-sucesso/15 px-2 py-0.5 text-[11px] font-medium text-sucesso">Vinculado</span>
        </div>
        <p className="text-xs leading-relaxed text-nevoa">
          Fale com o Bento pelo número {dados.bot_phone ?? 'do Bento'}. Ele responde com o mesmo acesso que você tem aqui.
        </p>
        <div className="flex flex-wrap gap-2">
          {dados.bot_phone && (
            <a
              href={`https://wa.me/${dados.bot_phone.replace(/\D/g, '')}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-3 py-1.5 text-xs font-medium text-branco-cru hover:opacity-90"
            >
              <ExternalLink size={13} /> Abrir conversa
            </a>
          )}
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Desvincular este número? O Bento deixa de responder por ele.')) desvincular.mutate();
            }}
            disabled={desvincular.isPending}
            className="flex items-center gap-1.5 rounded-md border border-erro/40 px-3 py-1.5 text-xs text-erro hover:bg-erro/10 disabled:opacity-50"
          >
            <Unlink size={13} /> {desvincular.isPending ? 'Desvinculando…' : 'Desvincular'}
          </button>
        </div>
      </div>
    );
  }

  const pendente = dados.pending_code;

  // O número chegou: a pessoa confirma que é dela.
  if (pendente?.status === 'claimed' && pendente.claimed_phone) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-branco-cru">
          O Bento recebeu seu código do número <span className="font-semibold">{pendente.claimed_phone}</span>.
        </p>
        <p className="text-xs text-nevoa">Este número é seu? Só confirme se reconhecer o número.</p>
        {confirmar.isError && <p className="text-xs text-erro">{erroLegivel(confirmar.error, 'Não foi possível confirmar.')}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => confirmar.mutate(pendente.id, { onSuccess: () => setCodigo(null) })}
            disabled={confirmar.isPending}
            className="flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-3 py-1.5 text-xs font-medium text-branco-cru hover:opacity-90 disabled:opacity-50"
          >
            <Check size={13} /> {confirmar.isPending ? 'Confirmando…' : 'Sim, é meu'}
          </button>
          <button
            type="button"
            onClick={() => recusar.mutate(pendente.id, { onSuccess: () => setCodigo(null) })}
            disabled={recusar.isPending}
            className="flex items-center gap-1.5 rounded-md border border-grafite-elevado px-3 py-1.5 text-xs text-nevoa hover:text-branco-cru disabled:opacity-50"
          >
            <X size={13} /> Não reconheço
          </button>
        </div>
      </div>
    );
  }

  // Código gerado nesta visita: mostra para enviar.
  if (pendente && codigo && codigo.id === pendente.id) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-nevoa">
          Envie este código para o Bento{codigo.bot_phone ? ` (${codigo.bot_phone})` : ''} pelo WhatsApp do número que você quer vincular:
        </p>
        <div className="flex items-center justify-between gap-3 rounded-md border border-grafite-elevado bg-carbono px-3 py-2.5">
          <span className="font-mono text-base tracking-wider text-branco-cru">{codigo.code}</span>
          <button
            type="button"
            aria-label="Copiar código"
            onClick={() => {
              void navigator.clipboard?.writeText(codigo.code).then(() => {
                setCopiado(true);
                setTimeout(() => setCopiado(false), 1_500);
              });
            }}
            className="text-nevoa hover:text-branco-cru"
          >
            {copiado ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {codigo.wa_link && (
            <a
              href={codigo.wa_link}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-3 py-1.5 text-xs font-medium text-branco-cru hover:opacity-90"
            >
              <ExternalLink size={13} /> Enviar pelo WhatsApp
            </a>
          )}
          <span className="text-[11px] text-nevoa">
            Expira em <Contagem ate={codigo.expires_at} />. Esperando a mensagem chegar…
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-nevoa">
        Converse com o Bento pelo WhatsApp com o mesmo acesso que você tem aqui: tarefas, prazos, clientes e processos.
        Para isso, vincule seu número.
      </p>
      {pendente && (
        <p className="text-[11px] text-aviso">Há um código gerado antes e ainda válido. Gerar outro cancela o anterior.</p>
      )}
      {gerar.isError && <p className="text-xs text-erro">{erroLegivel(gerar.error, 'Não foi possível gerar o código.')}</p>}
      <button
        type="button"
        onClick={() => gerar.mutate(undefined, { onSuccess: (novo) => setCodigo(novo) })}
        disabled={gerar.isPending}
        className="flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-3 py-1.5 text-xs font-medium text-branco-cru hover:opacity-90 disabled:opacity-50"
      >
        <Smartphone size={13} /> {gerar.isPending ? 'Gerando…' : 'Vincular meu WhatsApp ao Bento'}
      </button>
    </div>
  );
}

const ROTULO_DA_SESSAO: Record<string, { texto: string; classe: string }> = {
  ready: { texto: 'Conectado', classe: 'bg-sucesso/15 text-sucesso' },
  qr_ready: { texto: 'Aguardando QR', classe: 'bg-aviso/15 text-aviso' },
  authenticating: { texto: 'Autenticando', classe: 'bg-aviso/15 text-aviso' },
  initializing: { texto: 'Iniciando', classe: 'bg-aviso/15 text-aviso' },
  created: { texto: 'Criada, parada', classe: 'bg-aviso/15 text-aviso' },
  disconnected: { texto: 'Desconectado', classe: 'bg-erro/15 text-erro' },
  action_required: { texto: 'Ação necessária', classe: 'bg-erro/15 text-erro' },
  failed: { texto: 'Falhou', classe: 'bg-erro/15 text-erro' },
  unreachable: { texto: 'OpenWA inacessível', classe: 'bg-erro/15 text-erro' },
  not_configured: { texto: 'Não configurado', classe: 'bg-grafite-elevado text-nevoa' },
};

function PainelMaster() {
  const status = useBentoWhatsappAdminStatus(true);
  const links = useBentoWhatsappLinks(true);
  const revogar = useRevogarVinculoBentoWhatsapp();
  const iniciar = useIniciarSessaoBentoWhatsapp();
  const qr = useQrBentoWhatsapp();
  const [aguardandoQr, setAguardandoQr] = useState(false);
  const tentativasQr = useRef(0);

  /**
   * O QR só existe depois que o Chromium do OpenWA termina de subir (~20 s
   * medidos em produção em 19/10/2026). Clicar antes disso devolve "QR code is
   * not ready yet" — e antes a tela só mostrava o erro e parava. Agora ela
   * tenta de novo sozinha, de 3 em 3 s, até 90 s. Só a tentativa que dá certo
   * entra na auditoria (ver o QR é poder conectar o número).
   */
  function pedirQr() {
    tentativasQr.current = 0;
    setAguardandoQr(true);
    qr.mutate();
  }
  useEffect(() => {
    if (!aguardandoQr) return;
    if (qr.isSuccess) {
      setAguardandoQr(false);
      return;
    }
    if (!qr.isError) return;
    if (tentativasQr.current >= 30) {
      setAguardandoQr(false);
      return;
    }
    const t = setTimeout(() => {
      tentativasQr.current += 1;
      qr.mutate();
    }, 3_000);
    return () => clearTimeout(t);
  }, [aguardandoQr, qr, qr.isError, qr.isSuccess]);
  // Sessão já conectada: some o QR da tela.
  const sessaoPronta = status.data?.session?.status === 'ready';
  const codigo = useCodigoDeConexaoBentoWhatsapp();

  /**
   * O QR do WhatsApp vale ~20 s e o OpenWA gera outro a cada 20 s (medido em
   * produção, 19/10/2026). Mostrar UM QR e deixar parado fazia a pessoa
   * escanear um QR já morto ("não foi possível conectar") sem como pedir
   * outro. Enquanto o QR está na tela e a sessão espera conexão, renova de
   * 12 em 12 s, por no máximo 5 min.
   */
  const qrNaTela = Boolean(qr.data) && status.data?.session?.status === 'qr_ready';
  const renovacoes = useRef(0);
  useEffect(() => {
    if (!qrNaTela) {
      renovacoes.current = 0;
      return;
    }
    const t = setInterval(() => {
      renovacoes.current += 1;
      if (renovacoes.current > 25) return;
      if (!qr.isPending) qr.mutate();
    }, 12_000);
    return () => clearInterval(t);
  }, [qrNaTela, qr]);
  const provisionar = useProvisionarSessaoBentoWhatsapp();
  const ligar = useLigarCanalBentoWhatsapp();

  if (status.isPending) return <Skeleton className="h-40 w-full" />;
  if (status.isError || !status.data) return <p className="text-xs text-erro">Não consegui consultar o painel do canal.</p>;
  const s = status.data;
  const rotulo = ROTULO_DA_SESSAO[s.session.status] ?? { texto: s.session.status, classe: 'bg-grafite-elevado text-nevoa' };
  const volume = Object.values(s.last_24h.by_status).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s.enabled ? 'bg-sucesso/15 text-sucesso' : 'bg-grafite-elevado text-nevoa'}`}>
          Canal {s.enabled ? 'ligado' : 'desligado'}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${rotulo.classe}`}>Sessão: {rotulo.texto}</span>
        {s.session.phone && <span className="text-[11px] text-nevoa">{s.session.phone}</span>}
      </div>

      {s.source === 'nenhuma' && (
        <div className="space-y-2 rounded-md border border-grafite-elevado p-3">
          <p className="text-xs leading-relaxed text-nevoa">
            O número do Bento ainda não está conectado. Ao conectar, o sistema cria a sessão dele no OpenWA, com chave e
            webhook próprios. Depois é só escanear o QR com o celular do Bento
            {s.bot_phone ? ` (${s.bot_phone})` : ''}.
          </p>
          {!s.can_provision && (
            <p className="text-[11px] leading-relaxed text-aviso">
              O servidor ainda não tem OPENWA_ADMIN_API_KEY, OPENWA_BASE_URL e OPENWA_WEBHOOK_URL (ou API_PUBLIC_URL).
              Sem eles não há como criar a sessão.
            </p>
          )}
          <button
            type="button"
            onClick={() => provisionar.mutate()}
            disabled={provisionar.isPending || !s.can_provision}
            className="flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-3 py-1.5 text-xs font-medium text-branco-cru hover:opacity-90 disabled:opacity-50"
          >
            <Smartphone size={13} /> {provisionar.isPending ? 'Conectando…' : 'Conectar número do Bento'}
          </button>
          {provisionar.isError && <p className="text-[11px] text-erro">{erroLegivel(provisionar.error, 'Falha ao conectar.')}</p>}
        </div>
      )}

      {s.source !== 'nenhuma' && (
        <div className="flex flex-wrap items-center gap-3">
          {s.kill_switch ? (
            <p className="text-[11px] text-aviso">Canal desligado no servidor (BENTO_WHATSAPP_ENABLED=false).</p>
          ) : s.source === 'painel' ? (
            <button
              type="button"
              onClick={() => ligar.mutate(!s.enabled)}
              disabled={ligar.isPending}
              className="rounded-md border border-grafite-elevado px-3 py-1.5 text-xs text-branco-cru hover:bg-grafite-elevado disabled:opacity-50"
            >
              {s.enabled ? 'Desligar o canal' : 'Ligar o canal'}
            </button>
          ) : null}
          {s.session.status !== 'not_configured' && (
            <button
              type="button"
              onClick={() => provisionar.mutate()}
              disabled={provisionar.isPending || !s.can_provision}
              className="flex items-center gap-1.5 rounded-md border border-grafite-elevado px-3 py-1.5 text-xs text-nevoa hover:text-branco-cru disabled:opacity-50"
              title="Re-registra o webhook e reinicia a sessão se estiver parada"
            >
              <RefreshCw size={13} /> Reconectar
            </button>
          )}
        </div>
      )}

      {s.missing_config.length > 0 && (
        <p className="text-[11px] leading-relaxed text-aviso">
          Falta configurar no servidor: <span className="font-mono">{s.missing_config.join(', ')}</span>
        </p>
      )}
      {(s.session.last_error || s.session.error) && (
        <p className="text-[11px] text-erro">{s.session.last_error ?? s.session.error}</p>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-nevoa">Mensagens 24h</dt>
          <dd className="text-branco-cru tabular-nums">{volume}</dd>
        </div>
        <div>
          <dt className="text-nevoa">Respondidas</dt>
          <dd className="text-branco-cru tabular-nums">{s.last_24h.by_status.replied ?? 0}</dd>
        </div>
        <div>
          <dt className="text-nevoa">Latência p50 / p95</dt>
          <dd className="text-branco-cru tabular-nums">
            {s.last_24h.latency_ms.p50 === null
              ? '—'
              : `${(s.last_24h.latency_ms.p50 / 1000).toFixed(1)}s / ${((s.last_24h.latency_ms.p95 ?? 0) / 1000).toFixed(1)}s`}
          </dd>
        </div>
        <div>
          <dt className="text-nevoa">Última resposta do Brain</dt>
          <dd className="text-branco-cru">{quandoRelativo(s.brain.last_reply_at)}</dd>
        </div>
      </dl>

      {s.session.status !== 'ready' && s.session.status !== 'not_configured' && (
        <div className="space-y-2 rounded-md border border-grafite-elevado p-3">
          <p className="text-xs leading-relaxed text-nevoa">
            Conectar o número do Bento exige a pessoa que tem o celular dele em mãos. O QR abaixo conecta o WhatsApp do
            Bento a este sistema; ver o QR fica registrado na auditoria.
          </p>
          <div className="flex flex-wrap gap-2">
            {['created', 'disconnected', 'failed'].includes(s.session.status) && (
              <button
                type="button"
                onClick={() => iniciar.mutate()}
                disabled={iniciar.isPending}
                className="flex items-center gap-1.5 rounded-md border border-grafite-elevado px-3 py-1.5 text-xs text-branco-cru hover:bg-grafite-elevado disabled:opacity-50"
              >
                <RefreshCw size={13} /> {iniciar.isPending ? 'Iniciando…' : 'Iniciar sessão'}
              </button>
            )}
            <button
              type="button"
              onClick={pedirQr}
              disabled={qr.isPending || aguardandoQr}
              className="flex items-center gap-1.5 rounded-md border border-grafite-elevado px-3 py-1.5 text-xs text-branco-cru hover:bg-grafite-elevado disabled:opacity-50"
            >
              <QrCode size={13} /> {aguardandoQr ? 'Preparando o QR…' : qr.data ? 'Atualizar QR' : 'Mostrar QR'}
            </button>
          </div>
          {iniciar.isError && <p className="text-[11px] text-erro">{erroLegivel(iniciar.error, 'Falha ao iniciar.')}</p>}
          {aguardandoQr && (
            <p className="text-[11px] text-nevoa">
              A sessão do WhatsApp está iniciando; o QR aparece em alguns segundos, não precisa clicar de novo.
            </p>
          )}
          {!aguardandoQr && qr.isError && (
            <p className="text-[11px] text-erro">{erroLegivel(qr.error, 'QR indisponível agora.')} Clique em Mostrar QR para tentar de novo.</p>
          )}
          {qr.data && !sessaoPronta && (
            <div className="space-y-1.5">
              <img src={qr.data.qr_code} alt="QR para conectar o WhatsApp do Bento" className="size-52 rounded-md bg-white p-2" />
              <p className="text-[11px] text-nevoa">
                O QR renova sozinho a cada poucos segundos: escaneie o que está na tela. No celular do Bento: WhatsApp
                Business &gt; Aparelhos conectados &gt; Conectar um aparelho.
              </p>
            </div>
          )}
          <div className="space-y-1.5 border-t border-grafite-elevado pt-2">
            <p className="text-[11px] text-nevoa">Sem conseguir escanear? Conecte por código, sem QR:</p>
            <button
              type="button"
              onClick={() => codigo.mutate()}
              disabled={codigo.isPending}
              className="rounded-md border border-grafite-elevado px-3 py-1.5 text-xs text-branco-cru hover:bg-grafite-elevado disabled:opacity-50"
            >
              {codigo.isPending ? 'Gerando…' : 'Conectar por código'}
            </button>
            {codigo.isError && <p className="text-[11px] text-erro">{erroLegivel(codigo.error, 'Não foi possível gerar o código.')}</p>}
            {codigo.data && !sessaoPronta && (
              <div className="space-y-1">
                <p className="font-mono text-xl tracking-[0.3em] text-branco-cru">{codigo.data.pairing_code}</p>
                <p className="text-[11px] leading-relaxed text-nevoa">
                  No celular do {codigo.data.phone}: WhatsApp Business &gt; Aparelhos conectados &gt; Conectar um aparelho &gt;{' '}
                  <span className="text-branco-cru">Conectar com número de telefone</span> e digite este código. Ele expira em
                  poucos minutos.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-medium text-branco-cru">Colaboradores vinculados ({s.linked_users})</p>
        {links.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : links.data?.links.length ? (
          <ul className="divide-y divide-grafite-elevado rounded-md border border-grafite-elevado">
            {links.data.links.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs text-branco-cru">{l.user.name}</p>
                  <p className="text-[11px] text-nevoa">
                    {l.phone} · última mensagem {quandoRelativo(l.last_inbound_at)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Revogar o vínculo de ${l.user.name}?`)) revogar.mutate(l.id);
                  }}
                  disabled={revogar.isPending}
                  className="shrink-0 rounded-md border border-erro/40 px-2 py-1 text-[11px] text-erro hover:bg-erro/10 disabled:opacity-50"
                >
                  Revogar
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-nevoa">Ninguém vinculado ainda.</p>
        )}
      </div>

      {s.recent_failures.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-branco-cru">Falhas recentes</p>
          <ul className="space-y-1">
            {s.recent_failures.slice(0, 8).map((f) => (
              <li key={f.id} className="text-[11px] text-nevoa">
                <span className="text-erro">{f.reason ?? f.status}</span> · {quandoRelativo(f.at)}
                {f.error ? ` · ${f.error}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function BentoWhatsappSection() {
  const { isMaster } = useIsMaster();
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-grafite-elevado bg-grafite p-4">
        <p className="mb-3 font-heading text-base font-semibold text-branco-cru">Meu WhatsApp</p>
        <MeuVinculo />
      </div>
      {isMaster && (
        <div className="rounded-lg border border-grafite-elevado bg-grafite p-4">
          <p className="mb-3 font-heading text-base font-semibold text-branco-cru">Número do Bento</p>
          <PainelMaster />
        </div>
      )}
    </div>
  );
}
