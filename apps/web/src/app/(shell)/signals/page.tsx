'use client';

import { useState } from 'react';
import { ControlHeader, LinhasFantasma, Secao, SemNadaAinda, StatusLabel } from '@/components/control/primitives';
import { useSignals, useTratarSinal, type Sinal } from '@/hooks/use-signals';

/**
 * O QUE O SISTEMA PERCEBEU SOZINHO.
 *
 * A tela que faltava para o sinal chegar em uma pessoa. O event bus já escrevia
 * em `proactive_signals` e o Claude já sabia lê-los pelo MCP — mas quem abre o
 * Desigual OS no navegador não tinha como saber que o sistema tinha notado
 * alguma coisa. Percepção que só um agente enxerga não é proatividade: é
 * trabalho feito para ninguém.
 *
 * DUAS DECISÕES QUE VALEM MAIS QUE O LAYOUT:
 *
 * 1. DÁ PRA TRATAR. O schema previa `dismissed` e `resolved` desde sempre e
 *    ninguém nunca escreveu neles. Sem isso a lista só cresce, quem lê não tem
 *    como dizer "vi, cuidei", e na terceira visita a tela vira ruído que se
 *    aprende a ignorar — que é exatamente como um painel de alerta morre.
 *
 * 2. VAZIO AQUI É BOA NOTÍCIA, e a tela diz isso. Nas outras telas, ausência é
 *    uma pergunta ("será que quebrou?"); aqui, nenhum sinal pendente significa
 *    que nada está pegando fogo. Apresentar isso com a mesma cara de "sem
 *    dados" desperdiçaria a única tela do produto em que o vazio é o objetivo.
 */
export default function SignalsPage() {
  const [status, setStatus] = useState<'pending' | 'all'>('pending');
  const { data: pagina, isPending, isError } = useSignals({ status, limite: 200 });
  const tratar = useTratarSinal();

  const lista = pagina?.signals ?? [];

  return (
    <div className="mx-auto max-w-[1200px]">
      <ControlHeader
        title="Sinais"
        description="O que o sistema percebeu sem ninguém perguntar: prazo em risco, criativo rejeitado, decisão registrada, erro encontrado."
      />

      <Secao titulo="Estado">
        <div className="flex flex-wrap items-center gap-2">
          <Pilula ativa={status === 'pending'} onClick={() => setStatus('pending')}>
            Em aberto
          </Pilula>
          <Pilula ativa={status === 'all'} onClick={() => setStatus('all')}>
            Tudo, incluindo tratados
          </Pilula>
        </div>
      </Secao>

      <Secao titulo={rotuloDaContagem(pagina)}>
        {isPending ? (
          <LinhasFantasma linhas={5} />
        ) : isError ? (
          <SemNadaAinda
            titulo="Não consegui ler os sinais"
            explicacao="A consulta falhou. Enquanto ela não responder, não dá pra afirmar que está tudo calmo, só que não deu pra olhar."
          />
        ) : lista.length === 0 ? (
          <SemNadaAinda
            titulo={status === 'pending' ? 'Nada pedindo atenção agora' : 'Nenhum sinal registrado'}
            explicacao={
              status === 'pending'
                ? 'A consulta rodou e não há sinal em aberto. Aqui, diferente das outras telas, vazio é o resultado desejado.'
                : 'O sistema ainda não gerou sinal nenhum. Quando uma regra perceber algo, prazo em risco, criativo rejeitado, decisão de cliente, aparece aqui.'
            }
          />
        ) : (
          <ul className="space-y-2.5">
            {lista.map((s) => (
              <Cartao
                key={s.id}
                sinal={s}
                onTratar={(novo) => tratar.mutate({ id: s.id, status: novo })}
                tratando={tratar.isPending}
              />
            ))}
          </ul>
        )}
      </Secao>
    </div>
  );
}

function rotuloDaContagem(pagina: { total: number; mostrando: number } | undefined): string {
  if (!pagina) return 'Sinais';
  if (pagina.total > pagina.mostrando) return `${pagina.mostrando} de ${pagina.total} sinal(is), os mais recentes`;
  return `${pagina.total} sinal(is)`;
}

/** Severidade vira cor e palavra. Só cor exclui quem não distingue vermelho. */
const SEVERIDADE: Record<string, { estado: 'ok' | 'atencao' | 'erro' | 'desconhecido'; texto: string }> = {
  critical: { estado: 'erro', texto: 'crítico' },
  high: { estado: 'erro', texto: 'alto' },
  medium: { estado: 'atencao', texto: 'médio' },
  low: { estado: 'desconhecido', texto: 'baixo' },
};

function Pilula({ ativa, onClick, children }: { ativa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors',
        ativa
          ? 'border-roxo-eletrico/60 bg-roxo-eletrico/15 text-branco-cru'
          : 'border-grafite-elevado text-nevoa hover:text-branco-cru',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Cartao({
  sinal: s,
  onTratar,
  tratando,
}: {
  sinal: Sinal;
  onTratar: (status: 'dismissed' | 'resolved') => void;
  tratando: boolean;
}) {
  const sev = SEVERIDADE[s.severity] ?? { estado: 'desconhecido' as const, texto: s.severity };
  const jaTratado = s.status === 'dismissed' || s.status === 'resolved';

  return (
    <li className="rounded-lg border border-grafite-elevado bg-grafite px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusLabel estado={sev.estado}>{sev.texto}</StatusLabel>
        <span className="font-mono text-[10px] uppercase tracking-wider text-nevoa">{s.agent}</span>
        {s.client_name && (
          <span className="rounded-full bg-grafite-elevado px-2 py-0.5 font-mono text-[10px] text-nevoa">
            {s.client_name}
          </span>
        )}
        {jaTratado && (
          <span className="rounded-full border border-grafite-elevado px-2 py-0.5 font-mono text-[10px] text-nevoa">
            {s.status === 'resolved' ? 'resolvido' : 'dispensado'}
          </span>
        )}
      </div>

      <p className="mt-2 font-heading text-sm font-semibold text-branco-cru">{s.title}</p>
      <p className="mt-1 text-sm text-nevoa">{s.body}</p>

      {/* A ação sugerida é o que separa alerta de reclamação. */}
      {s.recommended_action && (
        <p className="mt-2 rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-[13px] text-branco-cru">
          Sugerido: {s.recommended_action}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[10px] text-nevoa">
          {s.created_at ? new Date(s.created_at).toLocaleString('pt-BR') : 'sem data'} · regra {s.rule}
          {/* Confiança só aparece quando a regra declarou. Ausente não vira 0. */}
          {s.confidence !== null && ` · confiança ${Math.round(s.confidence * 100)}%`}
        </p>

        {!jaTratado && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={tratando}
              onClick={() => onTratar('resolved')}
              className="rounded-md border border-sucesso/40 bg-sucesso/10 px-2.5 py-1 font-mono text-[11px] text-sucesso transition-colors hover:bg-sucesso/20 disabled:opacity-50"
            >
              Resolvi
            </button>
            <button
              type="button"
              disabled={tratando}
              onClick={() => onTratar('dismissed')}
              className="rounded-md border border-grafite-elevado px-2.5 py-1 font-mono text-[11px] text-nevoa transition-colors hover:text-branco-cru disabled:opacity-50"
            >
              Não é problema
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
