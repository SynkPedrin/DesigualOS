'use client';

import { useState } from 'react';
import { Pencil, Plug, ShieldCheck, Trash2, Unplug, UserPlus } from 'lucide-react';
import {
  useDeleteUser,
  useInviteUser,
  useUpdateUserName,
  useUpdateUserRole,
  useUpdateUserStatus,
} from '@/hooks/use-admin-users';
import { formatRelativeTime } from '@/lib/format';
import { ApiRequestError } from '@/lib/api/client';
import { ROLE_NAMES, type AdminUser, type RoleName } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

/**
 * gestao-de-acessos.tsx — a parte da Equipe que SÓ um administrador vê.
 *
 * Antes isto morava em /admin, uma tela escondida atrás de
 * Configurações → Administração, junto de fila, embedding e episódio de
 * agente. Quem monta a operação não vai procurar "como dou acesso a alguém"
 * dentro de uma tela chamada Admin: vai procurar em Equipe, que é onde as
 * pessoas estão. A rota /admin continua existindo e funcionando — o que mudou
 * é onde o trabalho acontece.
 *
 * A REGRA QUE ESTA TELA PRECISA RESPEITAR, e que o backend aplica de verdade:
 * criar conta é privilégio de administrador (papel master + users:write, ver
 * apps/api/src/admin/routes.ts). Aqui o formulário simplesmente não existe
 * para quem não é — esconder não é a segurança, é a honestidade: oferecer um
 * botão que responde 403 ensina a pessoa a desconfiar da tela.
 */

export const ROTULO_DO_PAPEL: Record<RoleName, string> = {
  master: 'Administrador',
  colaborador: 'Colaborador',
};

/** O que cada papel PODE, em uma linha — a pergunta real de quem escolhe no select. */
const O_QUE_O_PAPEL_PODE: Record<RoleName, string> = {
  master: 'Administra pessoas, acessos, custos e a infraestrutura.',
  colaborador: 'Trabalha na operação. Não cria contas nem mexe em acessos.',
};

function textoDoErro(erro: unknown, padrao: string): string {
  return erro instanceof ApiRequestError ? erro.message : padrao;
}

/**
 * SUCESSO PELA METADE: a conta foi criada de verdade e algo DEPOIS falhou — o
 * e-mail de aviso (Resend em sandbox só entrega para o dono da conta) ou o
 * registro local de papel e empresa. Não existe código HTTP para isso, então o
 * acordo com a API é o prefixo da mensagem; não é chute, ela monta essa string
 * de propósito.
 *
 * O texto exibido é o DA API, não um genérico: desde 08/10/2026 ela diz qual
 * metade falhou, e as duas pedem ações diferentes (avisar a pessoa por outro
 * canal × convidar de novo depois de consertar o banco). Um texto fixo
 * descreveria só um dos casos e mentiria no outro.
 */
function ehSucessoPelaMetade(mensagem: string): boolean {
  return mensagem.startsWith('Convite criado');
}

/**
 * "NOT FOUND" NÃO É UMA MENSAGEM PARA UM HUMANO — e foi literalmente o que a
 * tela mostrou num convite real (07/10/2026). Quando a API não responde, ou
 * responde algo que o `apiFetch` não conseguiu ler como JSON, o que sobra é o
 * `statusText` cru do HTTP: "Not Found", "Internal Server Error", "Bad
 * Gateway". Nenhum deles diz o que aconteceu nem o que fazer.
 *
 * Estas são as únicas mensagens que a tela REESCREVE. Erro que a própria API
 * redigiu (e-mail já convidado, papel inválido, permissão faltando) passa
 * direto: ele foi escrito para ser lido, e substituí-lo por um texto genérico
 * seria esconder a informação melhor atrás da pior.
 */
const RECADO_TECNICO: Record<string, string> = {
  'Not Found':
    'O sistema não encontrou essa rota na API. Em geral isso é o Orchestrator reiniciando ou fora do ar, confira se ele está rodando e tente de novo.',
  'Failed to fetch':
    'Não consegui falar com a API. Confira se o Orchestrator está rodando e tente de novo.',
  'Internal Server Error': 'A API falhou ao processar o convite. O time técnico consegue ver o motivo no log dela.',
  'Bad Gateway': 'A API não respondeu. Confira se o Orchestrator está rodando e tente de novo.',
  'Service Unavailable': 'A API está fora do ar no momento. Tente de novo em instantes.',
};

function emPortugues(mensagem: string): { texto: string; cru: string | null } {
  const traduzido = RECADO_TECNICO[mensagem];
  return traduzido ? { texto: traduzido, cru: mensagem } : { texto: mensagem, cru: null };
}

export function ConvitePessoa({ onPronto }: { onPronto: () => void }) {
  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [papel, setPapel] = useState<RoleName>('colaborador');
  const convidar = useInviteUser();

  function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    convidar.mutate({ email: email.trim(), name: nome.trim() || undefined, role: papel }, { onSuccess: onPronto });
  }

  const mensagem = convidar.error instanceof ApiRequestError ? convidar.error.message : null;
  const sucessoPelaMetade = mensagem ? ehSucessoPelaMetade(mensagem) : false;

  return (
    <form
      onSubmit={enviar}
      className="mb-6 rounded-lg border border-grafite-elevado bg-grafite p-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa" htmlFor="convite-email">
            E-mail
          </label>
          <input
            id="convite-email"
            type="email"
            required
            value={email}
            onChange={(evento) => setEmail(evento.target.value)}
            placeholder="pessoa@exemplo.com"
            className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2.5 text-sm text-branco-cru placeholder:text-nevoa/50 focus:border-roxo-eletrico/60 focus:outline-none"
          />
        </div>
        <div className="min-w-[180px] flex-1">
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa" htmlFor="convite-nome">
            Nome (opcional)
          </label>
          <input
            id="convite-nome"
            type="text"
            value={nome}
            onChange={(evento) => setNome(evento.target.value)}
            className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2.5 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa" htmlFor="convite-papel">
            Papel
          </label>
          <select
            id="convite-papel"
            value={papel}
            onChange={(evento) => setPapel(evento.target.value as RoleName)}
            className="rounded-md border border-grafite-elevado bg-carbono px-3 py-2.5 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
          >
            {ROLE_NAMES.map((r) => (
              <option key={r} value={r}>
                {ROTULO_DO_PAPEL[r]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={!email.trim() || convidar.isPending}
          className="flex items-center gap-2 rounded-md bg-roxo-eletrico px-4 py-2.5 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-50 disabled:hover:shadow-none"
        >
          <UserPlus size={15} />
          {convidar.isPending ? 'Convidando…' : 'Enviar convite'}
        </button>
      </div>

      <p className="mt-2.5 text-[12px] text-nevoa">
        {O_QUE_O_PAPEL_PODE[papel]} A pessoa entra na <span className="text-branco-cru">mesma empresa</span> em que
        você está trabalhando agora, e define a própria senha pelo link do e-mail.
      </p>

      {/*
        * O ALCANCE DE "ADMINISTRADOR" DEPENDE DE ONDE VOCÊ ESTÁ, e isso não é
        * óbvio por olhar o formulário: o papel forte dentro da provedora é
        * papel de PLATAFORMA (ver ehPapelDePlataforma em packages/auth) — a
        * pessoa passa a enxergar todas as empresas, não só a sua. Dentro de um
        * tenant, o mesmo papel administra só aquela empresa. Quem está
        * convidando alguém para TESTAR um cargo precisa saber disso antes de
        * clicar, não depois.
        */}
      {papel === 'master' && (
        <p className="mt-1.5 text-[12px] text-aviso">
          Atenção: na conta da Desigual, Administrador é papel de plataforma — a pessoa passa a enxergar todas as
          empresas. Para testar um cargo, convide como Colaborador, ou entre na empresa antes de convidar.
        </p>
      )}

      {convidar.isError && sucessoPelaMetade && (
        <div className="mt-3 rounded-md border border-aviso/40 bg-aviso/10 p-3">
          <p className="font-medium text-sm text-aviso">A conta foi criada, mas nem tudo deu certo.</p>
          <p className="mt-1 text-[13px] text-aviso">{mensagem}</p>
        </div>
      )}
      {convidar.isError && !sucessoPelaMetade && (
        <div className="mt-3 rounded-md border border-erro/30 bg-erro/10 p-3">
          <p className="text-sm text-erro">{mensagem ? emPortugues(mensagem).texto : 'Não foi possível convidar.'}</p>
          {mensagem && emPortugues(mensagem).cru && (
            <p className="mt-1 font-mono text-[10px] text-nevoa">{emPortugues(mensagem).cru}</p>
          )}
        </div>
      )}
      {convidar.isSuccess && (
        <div className="mt-3 rounded-md border border-sucesso/30 bg-sucesso/10 p-3">
          <p className="text-sm text-sucesso">Convite enviado.</p>
        </div>
      )}
    </form>
  );
}

/**
 * Os controles de acesso de UMA pessoa, para pendurar no cartão dela.
 *
 * `ehVocê` desliga desativar e excluir sobre a própria conta: o administrador
 * que se desativa perde a tela que usaria para se reativar, e não existe
 * segundo administrador garantido para socorrer.
 */
export function ControlesDeAcesso({
  conta,
  ehVoce,
  onConfigurarWorkspace,
}: {
  conta: AdminUser;
  ehVoce: boolean;
  onConfigurarWorkspace: () => void;
}) {
  const trocarPapel = useUpdateUserRole();
  const trocarStatus = useUpdateUserStatus();
  const excluir = useDeleteUser();
  const [confirmando, setConfirmando] = useState(false);

  const papel: RoleName = conta.roles?.[0] ?? 'colaborador';

  /**
   * Toda falha aparece JUNTO do controle que falhou, e só quando é sobre ESTA
   * pessoa: os três hooks são compartilhados pela lista inteira, então sem
   * checar `variables` um erro ao desativar o Pedro pintaria de vermelho a
   * linha de todo mundo.
   */
  const falha =
    (trocarPapel.isError && trocarPapel.variables?.userId === conta.id
      ? textoDoErro(trocarPapel.error, 'Não foi possível trocar o papel.')
      : null) ??
    (trocarStatus.isError && trocarStatus.variables?.userId === conta.id
      ? textoDoErro(trocarStatus.error, 'Não foi possível mudar o status.')
      : null) ??
    (excluir.isError && excluir.variables === conta.id
      ? textoDoErro(excluir.error, 'Não foi possível excluir.')
      : null);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-grafite-elevado pt-3">
      <label className="sr-only" htmlFor={`papel-${conta.id}`}>
        Papel de {conta.name}
      </label>
      <select
        id={`papel-${conta.id}`}
        value={papel}
        onChange={(evento) => trocarPapel.mutate({ userId: conta.id, role: evento.target.value as RoleName })}
        className={cn(
          'rounded-md border bg-carbono px-2.5 py-1.5 text-xs font-medium focus:outline-none',
          papel === 'master' ? 'border-roxo-eletrico/60 text-roxo-eletrico' : 'border-grafite-elevado text-nevoa',
        )}
      >
        {ROLE_NAMES.map((r) => (
          <option key={r} value={r}>
            {ROTULO_DO_PAPEL[r]}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={onConfigurarWorkspace}
        className="rounded-md border border-grafite-elevado px-2.5 py-1.5 font-mono text-[11px] text-nevoa transition-colors hover:border-roxo-eletrico/50 hover:text-branco-cru"
      >
        Telas que ela vê
      </button>

      <button
        type="button"
        role="switch"
        aria-checked={conta.active}
        aria-label={conta.active ? `Desativar ${conta.name}` : `Ativar ${conta.name}`}
        disabled={ehVoce || trocarStatus.isPending}
        onClick={() => trocarStatus.mutate({ userId: conta.id, active: !conta.active })}
        title={ehVoce ? 'Você não pode desativar a própria conta.' : undefined}
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] transition-colors disabled:opacity-40',
          conta.active
            ? 'border-grafite-elevado text-nevoa hover:border-aviso/50 hover:text-aviso'
            : 'border-aviso/40 bg-aviso/10 text-aviso',
        )}
      >
        {conta.active ? 'Ativa · desativar' : 'Inativa · reativar'}
      </button>

      {!ehVoce &&
        (confirmando ? (
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => excluir.mutate(conta.id)}
              disabled={excluir.isPending}
              className="rounded-md bg-erro px-2 py-1 text-[11px] font-semibold text-branco-cru hover:opacity-90 disabled:opacity-50"
            >
              {excluir.isPending ? 'Excluindo…' : 'Confirmar exclusão'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              className="rounded-md border border-grafite-elevado px-2 py-1 text-[11px] text-nevoa hover:text-branco-cru"
            >
              Cancelar
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmando(true)}
            aria-label={`Excluir ${conta.name}`}
            title="Excluir conta"
            className="flex size-7 items-center justify-center rounded-md text-nevoa transition-colors hover:bg-erro/10 hover:text-erro"
          >
            <Trash2 size={14} />
          </button>
        ))}

      <span className="ml-auto flex flex-wrap items-center gap-1">
        <Integracoes conta={conta} />
      </span>

      {conta.clientAccess.length > 0 && (
        <span className="flex w-full flex-wrap items-center gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-nevoa">clientes:</span>
          {conta.clientAccess.map((acesso) => (
            <span
              key={acesso.clientId}
              className="rounded-full border border-grafite-elevado bg-carbono px-2 py-0.5 font-mono text-[10px] text-nevoa"
            >
              {acesso.clientName}
            </span>
          ))}
        </span>
      )}

      {falha && <p className="w-full text-[11px] text-erro">{falha}</p>}
    </div>
  );
}

/**
 * O nome da pessoa, editável no lugar onde ele aparece — e não num formulário
 * separado. Corrigir "pedro.almada" para "Pedro Almada" é o conserto mais
 * comum logo depois de um convite, porque sem nome informado a conta nasce com
 * o prefixo do e-mail.
 */
export function NomeEditavel({ userId, name }: { userId: string; name: string }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(name);
  const renomear = useUpdateUserName();

  function salvar() {
    const limpo = valor.trim();
    if (!limpo || limpo === name) {
      setEditando(false);
      setValor(name);
      return;
    }
    renomear.mutate({ userId, name: limpo }, { onSuccess: () => setEditando(false) });
  }

  if (editando) {
    return (
      <span>
        <input
          autoFocus
          aria-label={`Nome de ${name}`}
          value={valor}
          onChange={(evento) => setValor(evento.target.value)}
          onBlur={salvar}
          onKeyDown={(evento) => {
            if (evento.key === 'Enter') salvar();
            if (evento.key === 'Escape') {
              setValor(name);
              setEditando(false);
            }
          }}
          disabled={renomear.isPending}
          className="rounded-md border border-roxo-eletrico/60 bg-carbono px-2 py-0.5 font-heading text-sm font-semibold text-branco-cru focus:outline-none"
        />
        {renomear.isError && (
          <span className="ml-2 text-[11px] text-erro">{textoDoErro(renomear.error, 'Não foi possível salvar.')}</span>
        )}
      </span>
    );
  }

  return (
    <button type="button" onClick={() => setEditando(true)} className="group flex items-center gap-1.5 text-left">
      <span className="font-heading text-sm font-semibold text-branco-cru">{name}</span>
      <Pencil size={11} className="shrink-0 text-nevoa opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

/**
 * As integrações da PESSOA (não da empresa): dá pra ver quem está ligado ao
 * ClickUp, em qual workspace e desde quando sincronizou — sem nunca expor o
 * token, que não sai do servidor.
 */
function Integracoes({ conta }: { conta: AdminUser }) {
  if (conta.integrations.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {conta.integrations.map((integracao) => {
        const conectada = integracao.status === 'connected';
        return (
          <span
            key={integracao.provider}
            title={
              conectada
                ? `Workspace: ${integracao.workspaceName ?? '-'} · última sincronização: ${
                    integracao.lastSyncedAt ? formatRelativeTime(integracao.lastSyncedAt) : 'nunca'
                  }`
                : `Status: ${integracao.status}`
            }
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px]',
              conectada ? 'border-sinal/40 bg-sinal/10 text-sinal' : 'border-grafite-elevado bg-carbono text-nevoa',
            )}
          >
            {conectada ? <Plug size={9} /> : <Unplug size={9} />}
            {integracao.provider}
          </span>
        );
      })}
    </span>
  );
}

/** A linha que explica a regra para quem NÃO administra — em vez de silêncio. */
export function AvisoDeQuemNaoAdministra() {
  return (
    <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-grafite-elevado bg-grafite px-4 py-3">
      <ShieldCheck size={15} className="mt-0.5 shrink-0 text-nevoa" />
      <p className="text-[13px] text-nevoa">
        Convidar alguém, trocar papel e desativar conta são ações de{' '}
        <span className="text-branco-cru">administrador</span>. Peça a quem administra a conta da sua empresa.
      </p>
    </div>
  );
}
