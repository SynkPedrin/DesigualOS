'use client';

import { use, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowLeft, Check, LogIn, Mail, RotateCw, Trash2, UserPlus, X } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { ControlHeader, LinhasFantasma, Secao, SemNadaAinda, Tabela, Td, Th } from '@/components/control/primitives';
import {
  useConfigurarEmpresa,
  useConvidarParaEmpresa,
  useMembrosDaEmpresa,
  useOrganizacao,
  useReenviarConvite,
  useRemoverMembro,
  useRevogarConvite,
  useTrocarPapelDeMembro,
  type FichaDaEmpresa,
  type PapelDeEmpresa,
} from '@/hooks/use-organizacao';
import { useMe } from '@/hooks/use-me';

/**
 * A FICHA DA EMPRESA — o que havia entre "criei a empresa" e "consigo usar a
 * empresa", e que não existia.
 *
 * UMA TELA, NÃO SEIS ABAS. A configuração inteira de uma conta cabe numa
 * rolagem: identidade, aparência, quem trabalha lá, estado. Cada aba a mais
 * seria um lugar onde um campo se esconde — e o pedido desta rodada foi
 * explicitamente por MENOS tela, não por mais.
 *
 * O QUE ESTA TELA NÃO INVENTA: ela não mostra gráfico de uma empresa que não
 * teve atividade, não estima saúde e não preenche campo vazio com padrão
 * escrito como se fosse escolha. Campo em branco aparece em branco, com o
 * padrão do produto dito ao lado em texto — "sem isto, o assistente se chama
 * Bento" é informação; escrever "Bento" na caixa seria uma configuração que
 * ninguém fez.
 */
export default function FichaDaEmpresaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: ficha, isPending, isError, error } = useOrganizacao(id);

  if (isPending) {
    return (
      <div className="mx-auto max-w-[900px]">
        <ControlHeader title="Empresa" />
        <LinhasFantasma linhas={5} />
      </div>
    );
  }

  if (isError || !ficha) {
    const msg = error instanceof Error ? error.message : '';
    return (
      <div className="mx-auto max-w-[900px]">
        <ControlHeader title="Empresa" />
        <SemNadaAinda
          titulo={/não encontrad/i.test(msg) ? 'Esta empresa não está disponível para você' : 'Não consegui ler a empresa'}
          explicacao={
            /não encontrad/i.test(msg)
              ? 'Ou ela não existe, ou sua conta não responde por ela. Quem só trabalha numa empresa não configura a identidade dela.'
              : 'A consulta falhou. Isto não quer dizer que a empresa sumiu, quer dizer que não deu para olhar agora.'
          }
          acao={
            <Link href="/organizations" className="text-[13px] text-roxo-eletrico hover:underline">
              Voltar para Empresas
            </Link>
          }
        />
      </div>
    );
  }

  return <Ficha ficha={ficha} />;
}

function Ficha({ ficha }: { ficha: FichaDaEmpresa }) {
  return (
    <div className="mx-auto max-w-[900px]">
      <Link
        href="/organizations"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-nevoa transition-colors hover:text-branco-cru"
      >
        <ArrowLeft size={13} />
        Empresas
      </Link>

      <ControlHeader
        title={ficha.nome}
        description={`desigual.app/${ficha.slug} · criada ${ficha.criada_em ? new Date(ficha.criada_em).toLocaleDateString('pt-BR') : 'em data não registrada'}`}
        actions={<Entrar ficha={ficha} />}
      />

      <Numeros ficha={ficha} />
      <Atividade ficha={ficha} />
      <Identidade ficha={ficha} />
      <Pessoas ficha={ficha} />
      <Estado ficha={ficha} />
    </div>
  );
}

/**
 * Os quatro números da empresa. São CONTAGENS, não métricas de saúde: zero
 * cliente numa empresa criada hoje é o estado correto, e pintar isso de alerta
 * ensinaria a ignorar alerta.
 */
function Numeros({ ficha }: { ficha: FichaDaEmpresa }) {
  const itens = [
    { rotulo: 'clientes', valor: ficha.numeros.clientes },
    { rotulo: 'pessoas', valor: ficha.numeros.pessoas },
    { rotulo: 'conversas', valor: ficha.numeros.conversas },
    { rotulo: 'coisas aprendidas', valor: ficha.numeros.memorias },
  ];

  return (
    <div className="mb-8 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {itens.map((i) => (
        <div key={i.rotulo} className="rounded-lg border border-grafite-elevado bg-grafite px-3.5 py-3">
          <p className="font-heading text-[22px] font-semibold text-branco-cru">
            {i.valor.toLocaleString('pt-BR')}
          </p>
          <p className="mt-0.5 text-[13px] text-nevoa">{i.rotulo}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * COMO A EMPRESA SE MEXEU, dia a dia.
 *
 * É o que separa a ficha de um cadastro: quatro contagens dizem o tamanho da
 * conta, a curva diz se ela está viva. Numa operação de agência, uma conta que
 * para de se mexer é a primeira evidência de um cliente indo embora — e ela
 * aparece semanas antes do aviso.
 *
 * DIA SEM MOVIMENTO É DESENHADO, não pulado. Um gráfico que só liga os dias com
 * dado transforma uma semana parada numa linha contínua, que é precisamente o
 * sinal que ele deveria dar.
 *
 * E a janela é DECLARADA. Numa empresa criada ontem ela tem dois dias, e dizer
 * "últimos 30 dias" ali seria afirmar 28 dias de silêncio que nunca existiram.
 */
function Atividade({ ficha }: { ficha: FichaDaEmpresa }) {
  const serie = ficha.atividade.map((d) => ({
    ...d,
    rotulo: new Date(`${d.dia}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
  }));

  const total = serie.reduce((s, d) => s + d.mensagens, 0);
  const dias = serie.length;

  const legenda =
    dias === 0
      ? 'Sem janela para medir ainda.'
      : dias < 30
        ? `Desde que a empresa existe, ${dias} dia(s).`
        : 'Últimos 30 dias.';

  return (
    <Secao titulo="Movimento">
      <div className="rounded-lg border border-grafite-elevado bg-grafite px-5 py-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[13px] text-nevoa">{legenda}</p>
          <p className="text-[13px] text-nevoa">
            {ficha.ultima_atividade
              ? `última atividade ${new Date(ficha.ultima_atividade).toLocaleDateString('pt-BR')}`
              : 'nenhuma atividade registrada'}
          </p>
        </div>

        {total === 0 ? (
          /**
           * NÃO DESENHA UMA LINHA RETA NO ZERO. Um gráfico achatado parece uma
           * medição que deu zero; a frase diz que não houve movimento, que é
           * outra coisa — e numa empresa criada hoje é o estado correto, não
           * um alerta.
           */
          <div className="rounded-md border border-grafite-elevado bg-carbono px-4 py-8 text-center">
            <p className="text-[14px] text-branco-cru">Nenhum movimento neste período.</p>
            <p className="mt-1 text-[13px] text-nevoa">
              {ficha.numeros.pessoas === 0
                ? 'Ninguém foi adicionado a esta empresa ainda.'
                : 'A empresa existe e tem gente, mas ninguém conversou com o assistente dela.'}
            </p>
          </div>
        ) : (
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={serie} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad-movimento" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#a78bfa" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a32" vertical={false} />
                <XAxis dataKey="rotulo" tick={{ fill: '#8b8b96', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tick={{ fill: '#8b8b96', fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: '#15151a', border: '1px solid #2a2a32', borderRadius: 8, fontSize: 13 }}
                  labelStyle={{ color: '#e8e6e3' }}
                />
                <Area
                  type="monotone"
                  dataKey="mensagens"
                  name="mensagens"
                  stroke="#a78bfa"
                  fill="url(#grad-movimento)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="execucoes"
                  name="execuções"
                  stroke="#38bdf8"
                  fill="#38bdf8"
                  fillOpacity={0.12}
                  strokeWidth={1.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </Secao>
  );
}

function Entrar({ ficha }: { ficha: FichaDaEmpresa }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const jaEstaAqui = me?.organizacao_ativa?.id === ficha.id;

  const abrir = useMutation({
    mutationFn: () =>
      apiFetch('/organizations/ativa', {
        method: 'POST',
        body: JSON.stringify({ organization_id: ficha.id }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      router.push('/');
    },
  });

  if (ficha.status !== 'ativa') {
    return <span className="text-[13px] text-aviso">Suspensa, reative abaixo para poder entrar.</span>;
  }

  return (
    <button
      type="button"
      onClick={() => abrir.mutate()}
      disabled={abrir.isPending || jaEstaAqui}
      className="inline-flex items-center gap-1.5 rounded-md bg-roxo-eletrico px-3.5 py-2 text-[13px] font-medium text-branco-cru transition-opacity hover:opacity-90 disabled:opacity-40"
    >
      <LogIn size={14} />
      {jaEstaAqui ? 'Você está aqui' : abrir.isPending ? 'Entrando...' : 'Entrar nesta empresa'}
    </button>
  );
}

/**
 * Identidade e aparência na MESMA seção, e isso é decisão: o nome do assistente
 * e a cor da marca são a mesma pergunta — "como esta empresa se apresenta". O
 * que elas mudam aparece ao lado enquanto se digita, porque escolher cor sem
 * ver a cor é escolher no escuro.
 */
function Identidade({ ficha }: { ficha: FichaDaEmpresa }) {
  const salvar = useConfigurarEmpresa(ficha.id);

  const [nome, setNome] = useState(ficha.nome);
  const [slug, setSlug] = useState(ficha.slug);
  const [assistente, setAssistente] = useState(ficha.identidade.nome_assistente ?? '');
  const [boasVindas, setBoasVindas] = useState(ficha.identidade.mensagem_boas_vindas ?? '');
  const [cor, setCor] = useState(ficha.identidade.cor_primaria ?? '');

  /** Quando a gravação volta, o servidor é quem manda — o slug normalizado
   *  raramente é o que foi digitado. */
  useEffect(() => {
    setNome(ficha.nome);
    setSlug(ficha.slug);
    setAssistente(ficha.identidade.nome_assistente ?? '');
    setBoasVindas(ficha.identidade.mensagem_boas_vindas ?? '');
    setCor(ficha.identidade.cor_primaria ?? '');
  }, [ficha]);

  const mudou =
    nome !== ficha.nome ||
    slug !== ficha.slug ||
    assistente !== (ficha.identidade.nome_assistente ?? '') ||
    boasVindas !== (ficha.identidade.mensagem_boas_vindas ?? '') ||
    cor !== (ficha.identidade.cor_primaria ?? '');

  const corValida = cor === '' || /^#[0-9a-f]{6}$/i.test(cor);

  return (
    <Secao titulo="Identidade">
      <div className="rounded-lg border border-grafite-elevado bg-grafite px-5 py-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Nome da empresa" valor={nome} onChange={setNome} />
          <Campo
            rotulo="Identificador"
            valor={slug}
            onChange={setSlug}
            ajuda="Aparece no endereço. Mudar quebra links antigos."
          />
          <Campo
            rotulo="Nome do assistente"
            valor={assistente}
            onChange={setAssistente}
            placeholder="Bento"
            ajuda="Em branco, o assistente se chama Bento."
          />
          <Campo
            rotulo="Cor da marca"
            valor={cor}
            onChange={setCor}
            placeholder="#7C3AED"
            ajuda={corValida ? 'Em branco, usa a cor padrão do produto.' : 'Use o formato #RRGGBB.'}
            erro={!corValida}
            enfeite={
              corValida && cor ? (
                <span
                  className="h-4 w-4 shrink-0 rounded border border-grafite-elevado"
                  style={{ backgroundColor: cor }}
                  aria-label={`Amostra da cor ${cor}`}
                />
              ) : undefined
            }
          />
        </div>

        <label className="mt-4 block">
          <span className="block text-[13px] text-nevoa">Mensagem de boas-vindas</span>
          <textarea
            value={boasVindas}
            onChange={(e) => setBoasVindas(e.target.value)}
            rows={2}
            maxLength={400}
            placeholder="O que o assistente diz na primeira conversa. Em branco, usa a saudação padrão."
            className="mt-1 w-full resize-y rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-[14px] leading-relaxed text-branco-cru placeholder:text-nevoa/50 focus:border-roxo-eletrico/60 focus:outline-none"
          />
        </label>

        {/* O QUE A PESSOA VAI VER. Prévia do cabeçalho do chat com o que está
          * escrito agora, não com o que está salvo — é para isso que ela serve. */}
        <div className="mt-4 rounded-md border border-grafite-elevado bg-carbono px-4 py-3">
          <p className="mb-2 text-[12px] uppercase tracking-wide text-nevoa/70">Como vai aparecer</p>
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-md text-[13px] font-semibold text-branco-cru"
              style={{ backgroundColor: corValida && cor ? cor : 'var(--color-roxo-eletrico, #7C3AED)' }}
            >
              {(assistente || 'Bento').slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-branco-cru">{assistente || 'Bento'}</p>
              <p className="truncate text-[13px] text-nevoa">
                {boasVindas || `Oi! Sou o assistente da ${nome || ficha.nome}. Como posso ajudar?`}
              </p>
            </div>
          </div>
        </div>

        {salvar.isError && (
          <p className="mt-3 rounded-md border border-erro/40 bg-erro/5 px-3 py-2 text-[13px] text-erro">
            {salvar.error instanceof Error ? salvar.error.message : 'Não consegui salvar.'}
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            disabled={!mudou || !corValida || nome.trim().length < 2 || salvar.isPending}
            onClick={() =>
              salvar.mutate({
                nome: nome.trim(),
                slug,
                nome_assistente: assistente.trim() || null,
                mensagem_boas_vindas: boasVindas.trim() || null,
                cor_primaria: cor.trim() || null,
              })
            }
            className="rounded-md bg-roxo-eletrico px-4 py-2 text-[14px] font-medium text-branco-cru transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {salvar.isPending ? 'Salvando...' : 'Salvar identidade'}
          </button>
          {!mudou && salvar.isSuccess && (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-sucesso">
              <Check size={13} />
              Salvo
            </span>
          )}
          {!mudou && !salvar.isSuccess && <span className="text-[13px] text-nevoa">Nada mudou ainda.</span>}
        </div>
      </div>
    </Secao>
  );
}

const ROTULO_DO_PAPEL: Record<PapelDeEmpresa, string> = { owner: 'Dono', admin: 'Admin', collaborator: 'Colaborador' };

/**
 * Quem trabalha NESTA empresa — e só nesta: convidar aqui cria vínculo de
 * EMPRESA (owner/admin/collaborator em organization_members daquela
 * organização), não o convite de plataforma de /admin. São rotas diferentes
 * de propósito (ver membros.ts) — a de plataforma nunca escopa ninguém a uma
 * empresa cliente específica.
 */
function Pessoas({ ficha }: { ficha: FichaDaEmpresa }) {
  const { data, isPending, isError } = useMembrosDaEmpresa(ficha.id);
  const trocarPapel = useTrocarPapelDeMembro(ficha.id);
  const remover = useRemoverMembro(ficha.id);
  const [confirmandoRemocao, setConfirmandoRemocao] = useState<string | null>(null);

  const membros = data?.membros ?? [];
  const convites = data?.convites_pendentes ?? [];

  return (
    <Secao titulo={membros.length === 1 ? '1 pessoa' : `${membros.length} pessoas`}>
      {isPending ? (
        <LinhasFantasma linhas={2} />
      ) : isError ? (
        <p className="text-[13px] text-erro">Não consegui carregar quem trabalha nesta empresa.</p>
      ) : membros.length === 0 && convites.length === 0 ? (
        <SemNadaAinda
          titulo="Ninguém nesta empresa ainda"
          explicacao="Convide alguém abaixo, quando aceitar, aparece aqui com o papel que tem."
        />
      ) : (
        <>
          {membros.length > 0 && (
            <Tabela>
              <thead>
                <tr>
                  <Th>Pessoa</Th>
                  <Th className="w-36">Papel</Th>
                  <Th className="w-24">Conta</Th>
                  <Th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {membros.map((m) => (
                  <tr key={m.id}>
                    <Td>
                      <span className="block text-[14px]">{m.nome ?? m.email}</span>
                      {m.nome && <span className="block text-[13px] text-nevoa">{m.email}</span>}
                    </Td>
                    <Td>
                      <select
                        value={m.papel}
                        disabled={trocarPapel.isPending}
                        onChange={(e) => trocarPapel.mutate({ userId: m.id, role: e.target.value as PapelDeEmpresa })}
                        className="rounded-md border border-grafite-elevado bg-carbono px-2 py-1 text-[13px] text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
                      >
                        {(Object.keys(ROTULO_DO_PAPEL) as PapelDeEmpresa[]).map((p) => (
                          <option key={p} value={p}>
                            {ROTULO_DO_PAPEL[p]}
                          </option>
                        ))}
                      </select>
                    </Td>
                    <Td>
                      <span className={m.ativa ? 'text-[13px] text-nevoa' : 'text-[13px] text-aviso'}>{m.ativa ? 'ativa' : 'desativada'}</span>
                    </Td>
                    <Td>
                      {confirmandoRemocao === m.id ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={remover.isPending}
                            onClick={() => remover.mutate(m.id, { onSettled: () => setConfirmandoRemocao(null) })}
                            className="text-[12px] font-medium text-erro hover:underline"
                          >
                            Remover
                          </button>
                          <button type="button" onClick={() => setConfirmandoRemocao(null)} className="text-[12px] text-nevoa hover:text-branco-cru">
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmandoRemocao(m.id)}
                          title="Remover desta empresa"
                          className="text-nevoa transition-colors hover:text-erro"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          )}
          {trocarPapel.isError && (
            <p className="mt-2 text-[13px] text-erro">{trocarPapel.error instanceof Error ? trocarPapel.error.message : 'Não consegui trocar o papel.'}</p>
          )}
          {remover.isError && (
            <p className="mt-2 text-[13px] text-erro">{remover.error instanceof Error ? remover.error.message : 'Não consegui remover.'}</p>
          )}

          {convites.length > 0 && <ConvitesPendentes ficha={ficha} convites={convites} />}
        </>
      )}

      <ConvidarPessoa ficha={ficha} />
    </Secao>
  );
}

function ConvitesPendentes({ ficha, convites }: { ficha: FichaDaEmpresa; convites: { id: string; email: string; papel: PapelDeEmpresa; convidado_em: string | null }[] }) {
  const reenviar = useReenviarConvite(ficha.id);
  const revogar = useRevogarConvite(ficha.id);
  const [idAtivo, setIdAtivo] = useState<string | null>(null);

  return (
    <div className="mt-4 rounded-md border border-grafite-elevado bg-carbono px-4 py-3">
      <p className="mb-2 text-[12px] uppercase tracking-wide text-nevoa/70">Convites pendentes</p>
      <ul className="space-y-2">
        {convites.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-[14px] text-branco-cru">{c.email}</span>
              <span className="ml-2 text-[13px] text-nevoa">{ROTULO_DO_PAPEL[c.papel]}</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={reenviar.isPending}
                onClick={() => {
                  setIdAtivo(c.id);
                  reenviar.mutate(c.id, { onSettled: () => setIdAtivo(null) });
                }}
                className="inline-flex items-center gap-1 text-[12px] text-roxo-eletrico hover:underline disabled:opacity-40"
              >
                <RotateCw size={12} />
                Reenviar
              </button>
              <button
                type="button"
                disabled={revogar.isPending}
                onClick={() => {
                  setIdAtivo(c.id);
                  revogar.mutate(c.id, { onSettled: () => setIdAtivo(null) });
                }}
                className="inline-flex items-center gap-1 text-[12px] text-erro hover:underline disabled:opacity-40"
              >
                <X size={12} />
                Revogar
              </button>
            </div>
            {idAtivo === c.id && reenviar.isError && (
              <p className="w-full text-[12px] text-erro">{reenviar.error instanceof Error ? reenviar.error.message : 'Não consegui reenviar.'}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConvidarPessoa({ ficha }: { ficha: FichaDaEmpresa }) {
  const convidar = useConvidarParaEmpresa(ficha.id);
  const [email, setEmail] = useState('');
  const [papel, setPapel] = useState<PapelDeEmpresa>('collaborator');

  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-grafite-elevado pt-4 sm:flex-row sm:items-end">
      <label className="block flex-1">
        <span className="block text-[13px] text-nevoa">Convidar para esta empresa</span>
        <span className="mt-1 flex items-center gap-2 rounded-md border border-grafite-elevado bg-carbono px-3 py-2 focus-within:border-roxo-eletrico/60">
          <Mail size={14} className="shrink-0 text-nevoa" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="pessoa@empresa.com"
            className="w-full bg-transparent text-[14px] text-branco-cru placeholder:text-nevoa/50 focus:outline-none"
          />
        </span>
      </label>
      <select
        value={papel}
        onChange={(e) => setPapel(e.target.value as PapelDeEmpresa)}
        className="rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-[14px] text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
      >
        {(Object.keys(ROTULO_DO_PAPEL) as PapelDeEmpresa[]).map((p) => (
          <option key={p} value={p}>
            {ROTULO_DO_PAPEL[p]}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!emailValido || convidar.isPending}
        onClick={() => convidar.mutate({ email: email.trim(), role: papel }, { onSuccess: () => setEmail('') })}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-roxo-eletrico px-4 py-2 text-[14px] font-medium text-branco-cru transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        <UserPlus size={14} />
        {convidar.isPending ? 'Convidando...' : 'Convidar'}
      </button>
      {convidar.isError && (
        <p className="w-full text-[13px] text-erro">{convidar.error instanceof Error ? convidar.error.message : 'Não consegui convidar.'}</p>
      )}
      {convidar.isSuccess && !convidar.isPending && email === '' && (
        <p className="w-full text-[13px] text-sucesso">
          {convidar.data?.membro_criado ? 'Adicionado, já tinha conta, entra na empresa no próximo acesso.' : 'Convite enviado.'}
        </p>
      )}
    </div>
  );
}

/**
 * Suspender é um ato COMERCIAL com efeito técnico imediato: ninguém mais entra
 * na empresa, nem quem é membro. Por isso fica no fim, separado do resto, e diz
 * o que acontece antes de acontecer.
 */
function Estado({ ficha }: { ficha: FichaDaEmpresa }) {
  const salvar = useConfigurarEmpresa(ficha.id);
  const [confirmando, setConfirmando] = useState(false);
  const suspensa = ficha.status !== 'ativa';

  if (ficha.eh_provedora) {
    return (
      <Secao titulo="Estado">
        <div className="rounded-lg border border-grafite-elevado bg-grafite px-5 py-4">
          <p className="text-[14px] text-branco-cru">Esta é a empresa que opera a plataforma.</p>
          <p className="mt-1 text-[13px] text-nevoa">
            Ela não pode ser suspensa — suspendê-la tiraria do ar inclusive a tela onde se desfaria a suspensão.
          </p>
        </div>
      </Secao>
    );
  }

  return (
    <Secao titulo="Estado">
      <div className="rounded-lg border border-grafite-elevado bg-grafite px-5 py-4">
        <p className="text-[14px] text-branco-cru">
          {suspensa ? 'Esta empresa está suspensa.' : 'Esta empresa está ativa.'}
        </p>
        <p className="mt-1 text-[13px] text-nevoa">
          {suspensa
            ? 'Ninguém consegue entrar nela, nem quem é membro. Os dados continuam todos no lugar.'
            : 'Suspender bloqueia a entrada de todo mundo, inclusive de quem é membro. Nada é apagado.'}
        </p>

        {salvar.isError && (
          <p className="mt-3 rounded-md border border-erro/40 bg-erro/5 px-3 py-2 text-[13px] text-erro">
            {salvar.error instanceof Error ? salvar.error.message : 'Não consegui mudar o estado.'}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {suspensa ? (
            <button
              type="button"
              disabled={salvar.isPending}
              onClick={() => salvar.mutate({ status: 'ativa' })}
              className="rounded-md bg-roxo-eletrico px-4 py-2 text-[14px] font-medium text-branco-cru transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {salvar.isPending ? 'Reativando...' : 'Reativar empresa'}
            </button>
          ) : confirmando ? (
            <>
              <button
                type="button"
                disabled={salvar.isPending}
                onClick={() => salvar.mutate({ status: 'suspensa' })}
                className="rounded-md border border-erro/60 bg-erro/10 px-4 py-2 text-[14px] font-medium text-erro transition-colors hover:bg-erro/20 disabled:opacity-40"
              >
                {salvar.isPending ? 'Suspendendo...' : `Confirmar: suspender ${ficha.nome}`}
              </button>
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                className="text-[13px] text-nevoa hover:text-branco-cru"
              >
                Cancelar
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmando(true)}
              className="rounded-md border border-grafite-elevado bg-carbono px-4 py-2 text-[14px] text-branco-cru transition-colors hover:border-erro/50"
            >
              Suspender empresa
            </button>
          )}
        </div>
      </div>
    </Secao>
  );
}

function Campo({
  rotulo,
  valor,
  onChange,
  placeholder,
  ajuda,
  erro,
  enfeite,
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ajuda?: string;
  erro?: boolean;
  enfeite?: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[13px] text-nevoa">{rotulo}</span>
      <span
        className={`mt-1 flex items-center gap-2 rounded-md border bg-carbono px-3 py-2 focus-within:border-roxo-eletrico/60 ${
          erro ? 'border-erro/60' : 'border-grafite-elevado'
        }`}
      >
        <input
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent text-[14px] text-branco-cru placeholder:text-nevoa/50 focus:outline-none"
        />
        {enfeite}
      </span>
      {ajuda && <span className={`mt-1 block text-[12px] ${erro ? 'text-erro' : 'text-nevoa/80'}`}>{ajuda}</span>}
    </label>
  );
}
