'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';

/**
 * CRIAR EMPRESA — o fluxo que faltava para isto ser produto e não tabela.
 *
 * Medido antes de escrever: `insert(schema.organizations)` não aparecia uma vez
 * no monorepo. A tela de Empresas listava o que o SQL tinha colocado lá.
 *
 * UM PASSO SÓ, e é decisão de produto: a seção 7 do briefing pede "evitar
 * wizard enorme". Empresa nova precisa existir em menos de um minuto — cor,
 * logo e equipe se ajustam depois, em Aparência e em Equipe. Um assistente de
 * cinco etapas antes da empresa existir transforma "criar cliente" numa tarefa
 * que se adia.
 *
 * SÓ O NOME É OBRIGATÓRIO. O identificador se deriva dele e aparece enquanto a
 * pessoa digita — para ela ver o endereço que vai usar depois, e poder mudar
 * antes, em vez de descobrir um slug estranho quando for compartilhar um link.
 */

/** Espelha `normalizarSlug` da API. Aqui só para PREVER o que vai acontecer. */
function preverSlug(bruto: string): string {
  return bruto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

interface Resposta {
  id: string;
  nome: string;
  slug: string;
  donoVinculado: boolean;
  avisoSobreDono: string | null;
}

export function NovaEmpresa() {
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  const [nomeAssistente, setNomeAssistente] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);

  const criar = useMutation({
    mutationFn: (corpo: Record<string, unknown>) =>
      apiFetch<Resposta>('/organizations', { method: 'POST', body: JSON.stringify(corpo) }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['organizations'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      setAviso(r.avisoSobreDono);
      // Fecha só quando não há recado. Fechar com aviso pendente esconderia a
      // única informação que a pessoa precisa ler.
      if (!r.avisoSobreDono) fechar();
    },
  });

  function fechar() {
    setAberto(false);
    setNome('');
    setSlug('');
    setEmail('');
    setNomeAssistente('');
    criar.reset();
  }

  const slugPrevisto = preverSlug(slug || nome);

  if (!aberto) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="inline-flex items-center gap-2 rounded-md bg-roxo-eletrico px-4 py-2 text-[14px] font-medium text-branco-cru transition-opacity hover:opacity-90"
        >
          <Plus size={16} />
          Nova empresa
        </button>
        {aviso && (
          <p className="rounded-md border border-aviso/40 bg-aviso/5 px-3 py-2 text-[13px] text-nevoa">{aviso}</p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-grafite-elevado bg-grafite px-5 py-4">
      <div className="flex items-center justify-between">
        <p className="font-heading text-[15px] font-semibold text-branco-cru">Nova empresa</p>
        <button type="button" onClick={fechar} aria-label="Cancelar" className="text-nevoa hover:text-branco-cru">
          <X size={16} />
        </button>
      </div>
      <p className="mt-1 text-[13px] text-nevoa">
        Só o nome é obrigatório. Cor, logo e equipe se ajustam depois, dentro da empresa.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Nome da empresa" valor={nome} onChange={setNome} placeholder="Construtora Cosentino" />
        <Campo
          rotulo="Identificador"
          valor={slug}
          onChange={setSlug}
          placeholder={slugPrevisto || 'construtora-cosentino'}
          ajuda={slugPrevisto ? `Vai ficar: ${slugPrevisto}` : 'Derivado do nome'}
        />
        <Campo
          rotulo="E-mail de quem vai administrar"
          valor={email}
          onChange={setEmail}
          placeholder="opcional"
          ajuda="Se a pessoa já tiver conta, ela entra como administradora."
        />
        <Campo
          rotulo="Nome do assistente"
          valor={nomeAssistente}
          onChange={setNomeAssistente}
          placeholder="Bento"
          ajuda="Como a IA se chama dentro desta empresa."
        />
      </div>

      {criar.isError && (
        <p className="mt-3 rounded-md border border-erro/40 bg-erro/5 px-3 py-2 text-[13px] text-erro">
          {criar.error instanceof Error ? criar.error.message : 'Não consegui criar a empresa.'}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={nome.trim().length < 2 || criar.isPending}
          onClick={() =>
            criar.mutate({
              nome: nome.trim(),
              ...(slug.trim() ? { slug: slug.trim() } : {}),
              ...(email.trim() ? { email_do_dono: email.trim() } : {}),
              ...(nomeAssistente.trim() ? { nome_assistente: nomeAssistente.trim() } : {}),
            })
          }
          className="rounded-md bg-roxo-eletrico px-4 py-2 text-[14px] font-medium text-branco-cru transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {criar.isPending ? 'Criando...' : 'Criar empresa'}
        </button>
        {nome.trim().length < 2 && <span className="text-[13px] text-nevoa">Escreva o nome da empresa.</span>}
      </div>
    </div>
  );
}

function Campo({
  rotulo,
  valor,
  onChange,
  placeholder,
  ajuda,
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ajuda?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[13px] text-nevoa">{rotulo}</span>
      <input
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-[14px] text-branco-cru placeholder:text-nevoa/50 focus:border-roxo-eletrico/60 focus:outline-none"
      />
      {ajuda && <span className="mt-1 block text-[12px] text-nevoa/80">{ajuda}</span>}
    </label>
  );
}
