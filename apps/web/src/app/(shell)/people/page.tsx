'use client';

import Link from 'next/link';
import { ControlHeader, LinhasFantasma, Secao, SemNadaAinda, StatusLabel } from '@/components/control/primitives';
import { useCollaborators } from '@/hooks/use-collaborators';
import type { Collaborator } from '@/lib/api/contracts';

/**
 * EQUIPE — quem está usando a inteligência, para quê, e quem não está.
 *
 * Antes esta tela se chamava "Pessoas" e era um cadastro: nome, papel, último
 * acesso. Cadastro é o que o sistema sabe; não é o que um supervisor procura.
 * Quem supervisiona abre isto para responder três coisas, e nenhuma delas é
 * "quem existe":
 *
 *   - quem está de fato usando o Claude, e para quê;
 *   - quem NÃO está — que costuma ser a informação mais acionável das duas,
 *     porque pessoa que parou de usar não reclama, só volta a fazer à mão;
 *   - de quem o trabalho não dá para acompanhar, por falta de vínculo com o
 *     ClickUp.
 *
 * O ÚLTIMO É O QUE MAIS DÓI E O QUE MAIS SOME. Sem o e-mail casado com o
 * ClickUp, as tarefas daquela pessoa não são alcançadas por nenhuma consulta do
 * sistema — ela fica invisível para a operação inteira, em silêncio, e ninguém
 * descobre até perguntar "cadê as tarefas do fulano?" e receber "nenhuma".
 * Por isso aparece como aviso, não como uma coluna vazia.
 */
export default function EquipePage() {
  const { data, isPending, isError } = useCollaborators();

  const pessoas = data?.collaborators ?? [];
  const semClickUp = pessoas.filter((p) => !p.clickup);
  const semUso = pessoas.filter((p) => (p.atividade?.conversas_30d ?? 0) === 0);

  return (
    <div className="mx-auto max-w-[1200px]">
      <ControlHeader
        title="Equipe"
        description="Quem usa a inteligência, para quê, e de quem o trabalho dá para acompanhar."
      />

      {isPending ? (
        <LinhasFantasma linhas={6} />
      ) : isError ? (
        <SemNadaAinda
          titulo="Não consegui ler a equipe"
          explicacao="A consulta falhou. Enquanto ela não responder, não dá para afirmar quem está ou não usando."
        />
      ) : pessoas.length === 0 ? (
        <SemNadaAinda
          titulo="Nenhuma pessoa cadastrada"
          explicacao="Quando alguém for convidado para o sistema, aparece aqui."
        />
      ) : (
        <>
          {/*
            * O QUE PRECISA DE AÇÃO VEM ANTES DA LISTA. Uma tabela com uma coluna
            * vazia não é um alerta: é algo que se aprende a ignorar na segunda
            * visita. Os dois avisos só existem quando têm o que dizer.
            */}
          {data?.clickupSynced === false && (
            <div className="mb-6 rounded-lg border border-grafite-elevado bg-grafite px-4 py-3">
              <p className="text-[13px] text-nevoa">
                Não consegui falar com o ClickUp agora, então{' '}
                <span className="text-branco-cru">não dá para afirmar quem está vinculado</span>. A coluna de
                vínculo abaixo está em branco por isso, não por ausência de vínculo.
              </p>
            </div>
          )}

          {data?.clickupSynced !== false && semClickUp.length > 0 && (
            <div className="mb-6 rounded-lg border border-aviso/40 bg-aviso/5 px-4 py-3">
              <p className="font-heading text-sm font-semibold text-branco-cru">
                {semClickUp.length === 1
                  ? '1 pessoa sem vínculo com o ClickUp'
                  : `${semClickUp.length} pessoas sem vínculo com o ClickUp`}
              </p>
              <p className="mt-1 text-[13px] text-nevoa">
                As tarefas de {semClickUp.map((p) => p.name).join(', ')} não são alcançadas por nenhuma consulta
                do sistema. Perguntar &ldquo;o que o fulano tem em aberto?&rdquo; responde{' '}
                <span className="text-branco-cru">nada</span> — e parece que não há trabalho, quando o que falta é
                o vínculo.
              </p>
            </div>
          )}

          <Secao titulo={`${pessoas.length} pessoa(s)`}>
            <div className="space-y-2.5">
              {pessoas.map((p) => (
                <Cartao key={p.userId} pessoa={p} clickupIndisponivel={data?.clickupSynced === false} />
              ))}
            </div>
          </Secao>

          {semUso.length > 0 && (
            <Secao titulo="Sem usar há mais de 30 dias">
              <p className="text-[13px] text-nevoa">
                {semUso.map((p) => p.name).join(', ')}. Não é cobrança — é o sinal de que a ferramenta não
                entrou no dia dessas pessoas, e isso se resolve conversando, não medindo.
              </p>
            </Secao>
          )}
        </>
      )}
    </div>
  );
}

/** Quanto tempo faz, em português de gente. */
function quandoFoi(iso: string | null): string {
  if (!iso) return 'nunca';
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? 'há 1 mês' : `há ${meses} meses`;
}

function Cartao({ pessoa: p, clickupIndisponivel }: { pessoa: Collaborator; clickupIndisponivel: boolean }) {
  const conversas = p.atividade?.conversas_30d ?? null;
  const agentes = p.atividade?.agentes ?? [];

  return (
    <div className="rounded-lg border border-grafite-elevado bg-grafite px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <p className="font-heading text-sm font-semibold text-branco-cru">{p.name}</p>
          {p.roles.includes('master') && (
            <span className="rounded-full bg-grafite-elevado px-2 py-0.5 font-mono text-[10px] text-nevoa">
              master
            </span>
          )}
          {/* Vínculo: o que permite acompanhar o trabalho da pessoa. */}
          {clickupIndisponivel ? (
            <StatusLabel estado="desconhecido">ClickUp não respondeu</StatusLabel>
          ) : p.clickup ? (
            <StatusLabel estado="ok">ClickUp ligado</StatusLabel>
          ) : (
            <StatusLabel estado="atencao">sem ClickUp</StatusLabel>
          )}
        </div>
        <p className="font-mono text-[11px] text-nevoa">visto {quandoFoi(p.lastSeenAt)}</p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px]">
        {/*
          * `null` = a API não mandou a medição. `0` = mediu e a pessoa não
          * conversou. A tela diz os dois de formas diferentes porque pedem
          * reações opostas: uma é conferir o sistema, a outra é conversar com
          * a pessoa.
          */}
        {conversas === null ? (
          <span className="text-nevoa">uso no Claude: não medido</span>
        ) : conversas === 0 ? (
          <span className="text-nevoa">
            <span className="text-branco-cru">não usou o Claude</span> nos últimos 30 dias
          </span>
        ) : (
          <span className="text-nevoa">
            <span className="text-branco-cru">{conversas}</span> conversa(s) em 30 dias · última{' '}
            {quandoFoi(p.atividade?.ultima_conversa ?? null)}
          </span>
        )}

        {/* Com QUEM ela fala diz mais sobre o trabalho dela que quantas vezes. */}
        {agentes.length > 0 && (
          <span className="flex flex-wrap items-center gap-1.5">
            {agentes.slice(0, 4).map((a) => (
              <span
                key={a.agent}
                className="rounded-full bg-grafite-elevado px-2 py-0.5 font-mono text-[10px] text-nevoa"
              >
                {a.agent} {a.total}
              </span>
            ))}
          </span>
        )}
      </div>

      {!p.clickup && !clickupIndisponivel && (
        <p className="mt-2 text-[12px] text-nevoa">
          Para as tarefas desta pessoa aparecerem nas consultas, o e-mail dela no ClickUp precisa estar
          registrado em{' '}
          <Link href="/settings" className="text-branco-cru underline underline-offset-2">
            Configurações
          </Link>
          .
        </p>
      )}
    </div>
  );
}
