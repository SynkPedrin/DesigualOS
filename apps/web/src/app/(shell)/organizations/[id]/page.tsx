'use client';

import { use, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, LogIn } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { ControlHeader, LinhasFantasma, Secao, SemNadaAinda, Tabela, Td, Th } from '@/components/control/primitives';
import { useConfigurarEmpresa, useOrganizacao, type FichaDaEmpresa } from '@/hooks/use-organizacao';
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
              : 'A consulta falhou. Isto não quer dizer que a empresa sumiu — quer dizer que não deu para olhar agora.'
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
    return <span className="text-[13px] text-aviso">Suspensa — reative abaixo para poder entrar.</span>;
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

/**
 * Quem trabalha nesta empresa. Só LEITURA por enquanto, e a tela diz isso em
 * vez de mostrar botões que não fazem nada: convidar e trocar papel passam
 * pelo fluxo de convite, que tem tela própria e manda e-mail.
 */
function Pessoas({ ficha }: { ficha: FichaDaEmpresa }) {
  if (ficha.pessoas.length === 0) {
    return (
      <Secao titulo="Pessoas">
        <SemNadaAinda
          titulo="Ninguém nesta empresa ainda"
          explicacao="Quando alguém for convidado e aceitar, aparece aqui com o papel que tem."
        />
      </Secao>
    );
  }

  return (
    <Secao titulo={ficha.pessoas.length === 1 ? '1 pessoa' : `${ficha.pessoas.length} pessoas`}>
      <Tabela>
        <thead>
          <tr>
            <Th>Pessoa</Th>
            <Th>Papel</Th>
            <Th className="w-32">Conta</Th>
          </tr>
        </thead>
        <tbody>
          {ficha.pessoas.map((p) => (
            <tr key={p.id}>
              <Td>
                <span className="block text-[14px]">{p.nome ?? p.email}</span>
                {p.nome && <span className="block text-[13px] text-nevoa">{p.email}</span>}
              </Td>
              <Td>
                <span className="text-[13px] text-nevoa">{p.papel}</span>
                {p.responde_pela_empresa && (
                  <span className="ml-2 rounded-full border border-roxo-eletrico/50 bg-roxo-eletrico/10 px-2 py-0.5 text-[11px] text-branco-cru">
                    responde pela empresa
                  </span>
                )}
              </Td>
              <Td>
                <span className={p.ativa ? 'text-[13px] text-nevoa' : 'text-[13px] text-aviso'}>
                  {p.ativa ? 'ativa' : 'desativada'}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </Tabela>
      <p className="mt-2 text-[13px] text-nevoa">
        Convidar alguém e trocar papel acontecem em{' '}
        <Link href="/people" className="text-roxo-eletrico hover:underline">
          Pessoas
        </Link>
        , onde o convite por e-mail é enviado.
      </p>
    </Secao>
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
