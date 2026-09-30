'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ShieldCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { LinhasFantasma, SemNadaAinda } from '@/components/control/primitives';

/**
 * CONSENTIMENTO DE INTEGRAÇÃO — a seção 19 do briefing.
 *
 * Antes de conectar as fontes da empresa, quem responde por ela vê o que o
 * Desigual vai poder fazer com aquele dado. Depois, consegue descobrir de novo:
 * quem autorizou e quando.
 *
 * TRÊS DECISÕES DE ESCRITA, e nenhuma é estética:
 *
 * 1. LINGUAGEM DE GENTE, não jurídica. A seção 19 é explícita: isto é
 *    consentimento TÉCNICO, não substitui contrato nem DPA. Escrever como
 *    advogado faria a tela mentir sobre a própria natureza — e ninguém leria.
 *
 * 2. O QUE O PRODUTO NÃO FAZ aparece junto do que ele faz, com o mesmo peso.
 *    A promessa honesta vale tanto quanto a permissão: a seção 64 proíbe
 *    prometer "lemos todas as conversas do Claude", porque é falso e porque
 *    seria assustador se fosse verdade.
 *
 * 3. O TEXTO EXATO vai junto no registro. Guardar só a data diria "ela
 *    concordou" sem dizer com o quê — e o que a tela mostra muda com o tempo.
 */

interface Fonte {
  id: string;
  nome: string;
  permite: string[];
}

interface Consentimento {
  id: string;
  quando: string | null;
  quem: string | null;
  fontes: string[];
  texto_apresentado: string | null;
}

export function Consentimento() {
  const queryClient = useQueryClient();
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());

  const { data: catalogo, isPending } = useQuery({
    queryKey: ['consent', 'fontes'],
    queryFn: () => apiFetch<{ fontes: Fonte[]; nao_faz: string[] }>('/consent/fontes'),
    staleTime: 5 * 60_000,
  });

  const { data: historico } = useQuery({
    queryKey: ['consent'],
    queryFn: () => apiFetch<{ consentimentos: Consentimento[] }>('/consent'),
    staleTime: 30_000,
  });

  const registrar = useMutation({
    mutationFn: (corpo: { fontes: string[]; texto_apresentado: string }) =>
      apiFetch<{ id: string; quando: string }>('/consent', { method: 'POST', body: JSON.stringify(corpo) }),
    onSuccess: () => {
      setMarcadas(new Set());
      void queryClient.invalidateQueries({ queryKey: ['consent'] });
    },
  });

  if (isPending) return <LinhasFantasma linhas={5} />;
  if (!catalogo) {
    return (
      <SemNadaAinda
        titulo="Não consegui carregar as permissões"
        explicacao="Sem essa lista não dá para pedir autorização — e pedir autorização sem dizer para quê seria pior que não pedir."
      />
    );
  }

  const ultimo = historico?.consentimentos[0] ?? null;
  // Capturado depois da guarda acima: o TypeScript não estreita `catalogo`
  // dentro de uma função declarada no mesmo escopo.
  const dados = catalogo;

  /** O texto que a pessoa LÊ, montado do mesmo dado que vai para o registro. */
  function textoApresentado(fontes: string[]): string {
    const detalhe = dados.fontes
      .filter((f) => fontes.includes(f.id))
      .map((f) => `${f.nome}: ${f.permite.join('; ')}`)
      .join('\n');
    return `Autorizo o Desigual OS a conectar e usar:\n${detalhe}\n\nO Desigual NÃO: ${dados.nao_faz.join('; ')}.`;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-grafite-elevado bg-grafite px-5 py-4">
        <div className="flex items-center gap-2.5">
          <ShieldCheck size={16} className="text-sinal" />
          <p className="font-heading text-[15px] font-semibold text-branco-cru">O que o Desigual vai poder fazer</p>
        </div>
        <p className="mt-1 text-[13px] text-nevoa">
          Marque as fontes que a empresa autoriza. Isto é um registro operacional — não substitui contrato nem
          termos.
        </p>

        <div className="mt-4 space-y-3">
          {catalogo.fontes.map((f) => {
            const marcada = marcadas.has(f.id);
            return (
              <button
                key={f.id}
                type="button"
                onClick={() =>
                  setMarcadas((atual) => {
                    const proxima = new Set(atual);
                    if (proxima.has(f.id)) proxima.delete(f.id);
                    else proxima.add(f.id);
                    return proxima;
                  })
                }
                aria-pressed={marcada}
                className={[
                  'flex w-full gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
                  marcada
                    ? 'border-roxo-eletrico/60 bg-roxo-eletrico/10'
                    : 'border-grafite-elevado hover:border-nevoa/40',
                ].join(' ')}
              >
                <span
                  className={[
                    'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border',
                    marcada ? 'border-roxo-eletrico bg-roxo-eletrico' : 'border-nevoa/50',
                  ].join(' ')}
                >
                  {marcada && <Check size={11} className="text-branco-cru" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium text-branco-cru">{f.nome}</span>
                  <ul className="mt-1 space-y-0.5">
                    {f.permite.map((p) => (
                      <li key={p} className="text-[13px] text-nevoa">
                        · {p}
                      </li>
                    ))}
                  </ul>
                </span>
              </button>
            );
          })}
        </div>

        {/* O QUE ELE NÃO FAZ, com o mesmo peso do que faz. */}
        <div className="mt-5 rounded-md border border-grafite-elevado bg-carbono px-4 py-3">
          <p className="text-[13px] font-medium text-branco-cru">O Desigual não:</p>
          <ul className="mt-1 space-y-0.5">
            {catalogo.nao_faz.map((n) => (
              <li key={n} className="text-[13px] text-nevoa">
                · {n}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={marcadas.size === 0 || registrar.isPending}
            onClick={() =>
              registrar.mutate({
                fontes: [...marcadas],
                texto_apresentado: textoApresentado([...marcadas]),
              })
            }
            className="rounded-md bg-roxo-eletrico px-4 py-2 text-[14px] font-medium text-branco-cru transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {registrar.isPending ? 'Registrando...' : 'Autorizar as fontes marcadas'}
          </button>
          {marcadas.size === 0 && <span className="text-[13px] text-nevoa">Marque ao menos uma fonte.</span>}
          {registrar.isError && (
            <span className="text-[13px] text-erro">Não consegui registrar. A autorização não foi gravada.</span>
          )}
        </div>
      </div>

      {/* QUEM AUTORIZOU E QUANDO — a metade que a seção 19 pede e que some se
        * a tela for só um botão de aceite. */}
      <div className="rounded-lg border border-grafite-elevado bg-grafite px-5 py-4">
        <p className="font-heading text-[15px] font-semibold text-branco-cru">Autorizações registradas</p>
        {!historico ? (
          <LinhasFantasma linhas={2} />
        ) : historico.consentimentos.length === 0 ? (
          <p className="mt-1 text-[13px] text-nevoa">
            Nenhuma ainda. Enquanto não houver, nenhuma fonte foi autorizada por esta via.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {historico.consentimentos.map((c) => (
              <li key={c.id} className="rounded-md border border-grafite-elevado bg-carbono px-3 py-2">
                <p className="text-[13px] text-branco-cru">
                  {c.fontes.join(', ')} — por {c.quem ?? 'alguém'}
                </p>
                <p className="mt-0.5 text-[12px] text-nevoa">
                  {c.quando ? new Date(c.quando).toLocaleString('pt-BR') : 'sem data'}
                  {c.id === ultimo?.id && ' · mais recente'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
