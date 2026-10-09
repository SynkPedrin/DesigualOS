'use client';

import { useState } from 'react';
import Link from 'next/link';
import { UserPlus } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { LinhasFantasma, Secao, SemNadaAinda, StatusLabel } from '@/components/control/primitives';
import { useAdminUsers, useDeleteUser } from '@/hooks/use-admin-users';
import { useCollaborators } from '@/hooks/use-collaborators';
import { useIsMaster } from '@/hooks/use-is-master';
import { useMe } from '@/hooks/use-me';
import { WorkspaceEditorModal } from '@/components/people/workspace-editor-modal';
import {
  AvisoDeQuemNaoAdministra,
  ControlesDeAcesso,
  ConvitePessoa,
  NomeEditavel,
  ROTULO_DO_PAPEL,
} from '@/components/people/gestao-de-acessos';
import { BarraDeSelecao, ModalDeConfirmacaoDeExclusao } from '@/components/people/exclusao-em-massa';
import type { AdminUser, Collaborator } from '@/lib/api/contracts';
import { ApiRequestError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

/**
 * EQUIPE — quem está usando a inteligência, para quê, e quem pode o quê.
 *
 * A tela nasceu respondendo três perguntas de supervisão (quem usa, quem
 * parou, de quem o trabalho não dá para acompanhar). A partir de 07/10/2026 ela
 * responde uma quarta, que até aqui não tinha porta nenhuma no produto:
 *
 *   QUEM TEM ACESSO A ISTO, E COM QUE PODER?
 *
 * Convidar alguém, trocar papel, desativar conta e escolher as telas que a
 * pessoa vê moravam em /admin — uma tela escondida atrás de
 * Configurações → Administração, ao lado de fila, embedding e episódio de
 * agente. Ninguém montando uma operação vai procurar "como dou acesso ao
 * fulano" ali dentro: vai procurar onde as pessoas estão. A rota /admin segue
 * existindo e funcionando; o que mudou é onde o trabalho acontece.
 *
 * DUAS FONTES, DE PROPÓSITO, e elas respondem coisas diferentes:
 *
 *   GET /collaborators  o DIRETÓRIO — todo mundo vê. Uso no Claude, presença,
 *                       vínculo com o ClickUp.
 *   GET /admin/users    o ACESSO — só administrador. Papel, conta ativa,
 *                       clientes concedidos.
 *
 * Quem não administra simplesmente não pede a segunda (`enabled` no hook): a
 * tela dele nunca dependeu dela, e um 403 no console não ajuda ninguém.
 */

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

export default function EquipePage() {
  const { isMaster, isPending: papelCarregando } = useIsMaster();

  /**
   * TELA DE ADMINISTRAÇÃO, e a porta é o papel (decisão do usuário,
   * 08/10/2026). Tirar o item da barra não bastava: `/people` continua sendo
   * um endereço, e o painel da Visão geral linkava para cá. Quem não
   * administra não vê a tela — vê o motivo.
   *
   * Isto é coerência de produto, não a proteção: quem protege é a API, que
   * exige `users:write` mais papel master para qualquer mutação e recorta a
   * listagem por empresa. Esconder uma tela nunca foi defesa.
   *
   * Enquanto o /me não responde, não decide: piscar "acesso restrito" para um
   * administrador é pior que meio segundo de espera.
   */
  if (!papelCarregando && !isMaster) {
    return (
      <div className="mx-auto max-w-[1200px]">
        <PageHeader title="Equipe" description="Quem usa a inteligência, para quê, e quem pode o quê." />
        <SemNadaAinda
          titulo="Acesso restrito"
          explicacao="A Equipe é a tela de quem administra a conta: é dela que saem convites, papéis e acessos. Peça a quem administra a conta da sua empresa."
        />
      </div>
    );
  }

  return <EquipeParaAdministrador />;
}

function EquipeParaAdministrador() {
  const { data, isPending, isError } = useCollaborators();
  const { isMaster } = useIsMaster();
  const { data: me } = useMe();
  const { data: contas } = useAdminUsers(isMaster);
  const [editando, setEditando] = useState<{ userId: string; name: string } | null>(null);
  const [convidando, setConvidando] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [confirmandoLote, setConfirmandoLote] = useState(false);
  const [erroDoLote, setErroDoLote] = useState<string | null>(null);
  const excluirConta = useDeleteUser();

  const pessoas = data?.collaborators ?? [];
  const semClickUp = pessoas.filter((p) => !p.clickup);
  const semUso = pessoas.filter((p) => (p.atividade?.conversas_30d ?? 0) === 0);

  /**
   * O cruzamento é por id de usuário, não por e-mail: as duas rotas leem a
   * MESMA tabela `users`, e casar por e-mail reintroduziria exatamente o tipo
   * de erro que o vínculo com o ClickUp já sofre (e-mail diferente, pessoa
   * invisível).
   */
  const contaDe = new Map<string, AdminUser>((contas ?? []).map((c) => [c.id, c]));

  /**
   * Conta que existe no acesso e NÃO aparece no diretório é o caso do
   * convidado que ainda não entrou — ele precisa aparecer, senão o
   * administrador manda o convite e a tela não muda em nada.
   */
  const convidadosAindaSemDiretorio = (contas ?? []).filter(
    (c) => !pessoas.some((p) => p.userId === c.id),
  );

  /** Nome de cada conta, pra o modal nunca mostrar só um número — quem
   *  confirma vê exatamente quem está apagando. */
  const nomePorId = new Map<string, string>();
  for (const c of contas ?? []) nomePorId.set(c.id, c.name);

  function alternarSelecao(userId: string) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(userId)) novo.delete(userId);
      else novo.add(userId);
      return novo;
    });
  }

  async function excluirSelecionados() {
    setErroDoLote(null);
    const ids = [...selecionados];
    const resultados = await Promise.allSettled(ids.map((id) => excluirConta.mutateAsync(id)));

    /**
     * O MOTIVO É DO BACKEND, NUNCA REESCRITO AQUI. "Não consegui excluir
     * nenhuma" sem dizer por quê é exatamente o relato do Pedro de
     * 08/10/2026 sobre a mensagem em inglês da rota — só que genérico em vez
     * de técnico, mesmo problema: admin vê a recusa e não sabe se é
     * permissão, bug ou regra de negócio. A API já explica certo (pessoa com
     * histórico não pode ser apagada, só desativada) — isto só precisa
     * chegar na tela, por pessoa, em vez de um resumo que apaga a causa.
     */
    const falharam: string[] = [];
    const porPessoa: string[] = [];
    ids.forEach((id, i) => {
      const resultado = resultados[i]!;
      if (resultado.status === 'rejected') {
        falharam.push(id);
        const nome = nomePorId.get(id) ?? 'Conta';
        const motivo = resultado.reason instanceof ApiRequestError ? resultado.reason.message : 'Falha desconhecida ao excluir.';
        porPessoa.push(`${nome}: ${motivo}`);
      }
    });

    if (falharam.length > 0) {
      setErroDoLote(porPessoa.join('\n'));
      // Só fecha o lote e limpa quem de fato foi excluído — quem falhou continua
      // selecionado, pronto pra tentar de novo sem precisar marcar tudo de novo.
      setSelecionados(new Set(falharam));
      return;
    }
    setSelecionados(new Set());
    setConfirmandoLote(false);
  }

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Equipe"
        description="Quem usa a inteligência, para quê, e quem pode o quê. Convites, papéis e telas de cada pessoa ficam aqui."
        actions={
          isMaster ? (
            <button
              type="button"
              onClick={() => setConvidando((v) => !v)}
              className="flex items-center gap-2 rounded-md border border-grafite-elevado bg-grafite px-4 py-2 text-sm font-medium text-branco-cru transition-colors hover:border-roxo-eletrico/50"
            >
              <UserPlus size={15} />
              {convidando ? 'Fechar' : 'Convidar pessoa'}
            </button>
          ) : undefined
        }
      />

      {isMaster ? convidando && <ConvitePessoa onPronto={() => setConvidando(false)} /> : <AvisoDeQuemNaoAdministra />}

      {isMaster && (
        <BarraDeSelecao
          quantidade={selecionados.size}
          onLimpar={() => setSelecionados(new Set())}
          onExcluir={() => setConfirmandoLote(true)}
        />
      )}

      {isPending ? (
        <LinhasFantasma linhas={6} />
      ) : isError ? (
        <SemNadaAinda
          titulo="Não consegui ler a equipe"
          explicacao="A consulta falhou. Enquanto ela não responder, não dá para afirmar quem está ou não usando."
        />
      ) : pessoas.length === 0 && convidadosAindaSemDiretorio.length === 0 ? (
        <SemNadaAinda
          titulo="Nenhuma pessoa cadastrada"
          explicacao={
            isMaster
              ? 'Convide alguém em "Convidar pessoa" — a conta nasce dentro da empresa em que você está.'
              : 'Quando alguém for convidado para o sistema, aparece aqui.'
          }
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

          <Secao titulo={`${pessoas.length + convidadosAindaSemDiretorio.length} pessoa(s)`}>
            <div className="space-y-2.5">
              {pessoas.map((p) => {
                const conta = contaDe.get(p.userId) ?? null;
                const ehVoce = p.userId === me?.id;
                return (
                  <Cartao
                    key={p.userId}
                    pessoa={p}
                    conta={conta}
                    ehVoce={ehVoce}
                    clickupIndisponivel={data?.clickupSynced === false}
                    onConfigurarWorkspace={isMaster ? () => setEditando({ userId: p.userId, name: p.name }) : undefined}
                    selecionavel={isMaster && Boolean(conta) && !ehVoce}
                    selecionado={selecionados.has(p.userId)}
                    onToggleSelecionado={() => alternarSelecao(p.userId)}
                  />
                );
              })}
              {convidadosAindaSemDiretorio.map((c) => {
                const ehVoce = c.id === me?.id;
                return (
                  <CartaoDeConvidado
                    key={c.id}
                    conta={c}
                    ehVoce={ehVoce}
                    onConfigurarWorkspace={() => setEditando({ userId: c.id, name: c.name })}
                    selecionavel={isMaster && !ehVoce}
                    selecionado={selecionados.has(c.id)}
                    onToggleSelecionado={() => alternarSelecao(c.id)}
                  />
                );
              })}
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

      {editando && <WorkspaceEditorModal userId={editando.userId} name={editando.name} onClose={() => setEditando(null)} />}

      {confirmandoLote && (
        <ModalDeConfirmacaoDeExclusao
          quantidade={selecionados.size}
          nomes={[...selecionados].map((id) => nomePorId.get(id) ?? 'Conta')}
          excluindo={excluirConta.isPending}
          erro={erroDoLote}
          onConfirmar={excluirSelecionados}
          onCancelar={() => {
            setConfirmandoLote(false);
            setErroDoLote(null);
          }}
        />
      )}
    </div>
  );
}

function Cartao({
  pessoa: p,
  conta,
  ehVoce,
  clickupIndisponivel,
  onConfigurarWorkspace,
  selecionavel = false,
  selecionado = false,
  onToggleSelecionado,
}: {
  pessoa: Collaborator;
  /** `null` = quem está olhando não administra (não pediu /admin/users), ou a
   *  pessoa não apareceu lá. Sem conta, o cartão é só o diretório. */
  conta: AdminUser | null;
  ehVoce: boolean;
  clickupIndisponivel: boolean;
  /** `undefined` = quem está olhando não pode configurar workspace alheio (não é master) — o botão nem aparece. */
  onConfigurarWorkspace?: (() => void) | undefined;
  /** `false` = sem conta pra excluir, ou é a própria conta de quem olha — o check nem aparece. */
  selecionavel?: boolean;
  selecionado?: boolean;
  onToggleSelecionado?: () => void;
}) {
  const conversas = p.atividade?.conversas_30d ?? null;
  const agentes = p.atividade?.agentes ?? [];
  const papel = conta?.roles?.[0] ?? (p.roles?.includes('master') ? 'master' : null);

  return (
    <div className={cn('rounded-lg border px-4 py-3', selecionado ? 'border-erro/50 bg-erro/5' : 'border-grafite-elevado bg-grafite')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {selecionavel && (
            <input
              type="checkbox"
              checked={selecionado}
              onChange={onToggleSelecionado}
              aria-label={`Selecionar ${p.name} para exclusão`}
              className="size-4 shrink-0 rounded border-grafite-elevado accent-erro"
            />
          )}
          {conta && onConfigurarWorkspace ? (
            <NomeEditavel userId={conta.id} name={p.name} />
          ) : (
            <p className="font-heading text-sm font-semibold text-branco-cru">{p.name}</p>
          )}
          {papel && (
            <span className="rounded-full bg-grafite-elevado px-2 py-0.5 font-mono text-[10px] text-nevoa">
              {ROTULO_DO_PAPEL[papel]}
            </span>
          )}
          {conta && !conta.active && <StatusLabel estado="atencao">conta desativada</StatusLabel>}
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

      {/* A gestão de acesso só existe com as DUAS condições: a pessoa que olha
        * administra (daí `onConfigurarWorkspace`) e a conta veio de
        * /admin/users (daí `conta`). */}
      {conta && onConfigurarWorkspace && (
        <ControlesDeAcesso conta={conta} ehVoce={ehVoce} onConfigurarWorkspace={onConfigurarWorkspace} />
      )}
    </div>
  );
}

/**
 * Convidado que ainda não entrou: existe em `users` (o convite já criou o
 * perfil e o papel) e ainda não tem nada a mostrar no diretório — nem uso, nem
 * presença, nem ClickUp. Sem este cartão, mandar um convite não muda nada na
 * tela, e a única leitura possível é "não funcionou".
 */
function CartaoDeConvidado({
  conta,
  ehVoce,
  onConfigurarWorkspace,
  selecionavel = false,
  selecionado = false,
  onToggleSelecionado,
}: {
  conta: AdminUser;
  ehVoce: boolean;
  onConfigurarWorkspace: () => void;
  selecionavel?: boolean;
  selecionado?: boolean;
  onToggleSelecionado?: () => void;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-dashed px-4 py-3',
        selecionado ? 'border-erro/50 bg-erro/5' : 'border-grafite-elevado bg-grafite/50',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {selecionavel && (
            <input
              type="checkbox"
              checked={selecionado}
              onChange={onToggleSelecionado}
              aria-label={`Selecionar ${conta.name} para exclusão`}
              className="size-4 shrink-0 rounded border-grafite-elevado accent-erro"
            />
          )}
          <NomeEditavel userId={conta.id} name={conta.name} />
          <span className="rounded-full bg-grafite-elevado px-2 py-0.5 font-mono text-[10px] text-nevoa">
            {ROTULO_DO_PAPEL[conta.roles?.[0] ?? 'colaborador']}
          </span>
          <StatusLabel estado="desconhecido">ainda não entrou</StatusLabel>
        </div>
        <p className="font-mono text-[11px] text-nevoa">{conta.email}</p>
      </div>
      <p className="mt-1.5 text-[12px] text-nevoa">
        O convite foi criado. A pessoa aparece no restante da tela depois do primeiro acesso.
      </p>
      <ControlesDeAcesso conta={conta} ehVoce={ehVoce} onConfigurarWorkspace={onConfigurarWorkspace} />
    </div>
  );
}
