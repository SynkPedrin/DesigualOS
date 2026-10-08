'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/hooks/use-me';
import { useConfigurarEmpresa, useOrganizacao } from '@/hooks/use-organizacao';
import { blocosVisiveisNasConfiguracoes } from '@/components/shell/nav-visibility';
import type { MeResponse } from '@/lib/api/contracts';

/**
 * EMPRESA, dentro de Configurações — a mesma identidade que a ficha em
 * /organizations/[id] edita (nome, identificador, marca, assistente,
 * boas-vindas), batendo no MESMO PATCH /organizations/:id.
 *
 * Por que um formulário próprio e não a seção extraída da ficha: a Identidade
 * de lá vem acoplada à FichaDaEmpresa inteira (números, atividade, pessoas,
 * suspensão), que é ferramenta do provedor. Extrair era cirurgia; reaproveitar
 * o hook do PATCH é o ponto de verdade única — os dois lados gravam igual.
 *
 * QUEM EDITA. A API só deixa quem responde pela empresa (owner/admin/master)
 * ou o provedor (podeConfigurar, na API) — e o GET da ficha tem a mesma guarda.
 * Por isso o colaborador NÃO busca a ficha: veria um 403 que não é erro dele.
 * Ele lê o que o /me já trouxe e recebe a frase honesta de quem pode mudar.
 */
export function podeEditarEmpresa(me: Pick<MeResponse, 'eh_provider' | 'roles'> | undefined | null): boolean {
  return me?.eh_provider === true || (me?.roles ?? []).includes('master');
}

export function EmpresaConfig() {
  const { data: me } = useMe();
  const visivel = blocosVisiveisNasConfiguracoes(me).empresa;
  const ativa = me?.organizacao_ativa ?? null;
  const editavel = podeEditarEmpresa(me);

  const { data: ficha, isPending, isError, error } = useOrganizacao(visivel && editavel ? ativa?.id : undefined);

  if (!visivel || !ativa) return null;

  return (
    <section className="mt-10">
      <h2 className="text-[15px] font-medium text-branco-cru">Empresa</h2>
      <p className="mt-1 max-w-2xl text-[13px] text-nevoa">
        Como {ativa.name} se apresenta: nome, identificador, marca e o assistente que recebe as pessoas.
      </p>

      {!editavel ? (
        <p className="mt-4 max-w-2xl rounded-lg border border-grafite-elevado bg-grafite px-4 py-3 text-[13px] text-nevoa">
          Só quem responde pela empresa pode mudar estes campos. Se algo estiver errado, fale com quem administra a
          conta.
        </p>
      ) : isPending ? (
        <Skeleton className="mt-4 h-64 w-full" />
      ) : isError || !ficha ? (
        <p className="mt-4 max-w-2xl rounded-lg border border-grafite-elevado bg-grafite px-4 py-3 text-[13px] text-nevoa">
          Não consegui ler a configuração da empresa agora
          {error instanceof Error && error.message ? `: ${error.message}` : '.'}
        </p>
      ) : (
        <FormularioEmpresa key={ficha.id} ficha={ficha} />
      )}
    </section>
  );
}

function FormularioEmpresa({ ficha }: { ficha: NonNullable<ReturnType<typeof useOrganizacao>['data']> }) {
  const salvar = useConfigurarEmpresa(ficha.id);

  const [nome, setNome] = useState(ficha.nome);
  const [slug, setSlug] = useState(ficha.slug);
  const [assistente, setAssistente] = useState(ficha.identidade.nome_assistente ?? '');
  const [boasVindas, setBoasVindas] = useState(ficha.identidade.mensagem_boas_vindas ?? '');
  const [cor, setCor] = useState(ficha.identidade.cor_primaria ?? '');

  /** A gravação devolve a ficha REAL — slug normalizado, cor em minúscula.
   *  Mostrar o que foi digitado enquanto o banco guardou outra coisa é o jeito
   *  mais fácil de alguém acreditar que salvou o que não salvou. */
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
    <Surface level="grafite" className="mt-4 p-5">
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
          {salvar.isPending ? 'Salvando...' : 'Salvar'}
        </button>
        {!mudou && salvar.isSuccess && (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-sucesso">
            <Check size={13} />
            Salvo
          </span>
        )}
        {!mudou && !salvar.isSuccess && <span className="text-[13px] text-nevoa">Nada mudou ainda.</span>}
      </div>
    </Surface>
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
