'use client';

import { motion } from 'framer-motion';
import type { ClientSummary } from '@/lib/api/contracts';
import { EntityAvatar } from '@/components/ui/entity-avatar';
import { cn } from '@/lib/utils';

const STATUS_META: Record<string, { label: string; className: string }> = {
  active: { label: 'Ativo', className: 'border-sinal/40 bg-sinal/10 text-sinal' },
  pontual: { label: 'Pontual', className: 'border-roxo-eletrico/40 bg-roxo-eletrico/10 text-roxo-eletrico' },
  inactive: { label: 'Inativo', className: 'border-grafite-elevado bg-carbono text-nevoa' },
};

/**
 * HÁ QUANTOS DIAS, a partir de uma data. `null` quando não houve movimento ou
 * quando não deu para medir — quem chama distingue os dois casos, porque eles
 * NÃO são a mesma coisa e tratá-los juntos vira alarme inventado.
 */
export function diasParados(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const quando = new Date(iso).getTime();
  if (Number.isNaN(quando)) return null;
  return Math.floor((Date.now() - quando) / 86_400_000);
}

export function textoDaRecencia(iso: string | null | undefined): string {
  // `undefined` é a API dizendo que não conseguiu ler. Nunca vira "parado".
  if (iso === undefined) return 'movimento não medido';
  if (iso === null) return 'nunca se mexeu';
  const d = diasParados(iso);
  if (d === null) return 'movimento não medido';
  if (d <= 0) return 'mexeu hoje';
  if (d === 1) return 'mexeu ontem';
  if (d < 30) return `mexeu há ${d} dias`;
  const meses = Math.floor(d / 30);
  return meses === 1 ? 'parado há mais de um mês' : `parado há ${meses} meses`;
}

/**
 * A COR SÓ APARECE QUANDO HÁ O QUE DIZER. Pintar de verde o cliente que se
 * mexeu ontem seria pintar de verde quase toda a grade, e o que é sempre verde
 * deixa de ser lido. Só o que esfriou muda de cor — e "não medido" fica cinza,
 * nunca vermelho, porque falha de leitura não é diagnóstico.
 */
export function corDaRecencia(iso: string | null | undefined): string {
  if (iso === undefined) return 'text-nevoa/70';
  if (iso === null) return 'text-nevoa';
  const d = diasParados(iso);
  if (d === null) return 'text-nevoa/70';
  if (d >= 30) return 'text-aviso';
  return 'text-nevoa';
}

function ClientCard({ client, onOpen }: { client: ClientSummary; onOpen: (client: ClientSummary) => void }) {
  const status = STATUS_META[client.status] ?? STATUS_META.active!;

  return (
    <motion.button
      type="button"
      layoutId={`client-card-${client.id}`}
      onClick={() => onOpen(client)}
      className={cn(
        'group flex h-52 w-full flex-col justify-between rounded-2xl border p-6 text-left',
        'border-grafite-elevado bg-grafite transition-colors duration-200',
        'hover:border-roxo-eletrico/60 hover:shadow-glow',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <EntityAvatar name={client.name} kind="client" size="xl" />
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className={cn('rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider', status.className)}>
            {status.label}
          </span>
          {/*
            * A NATUREZA DA LINHA, quando não é cliente de verdade.
            *
            * O Control Plane já contava "49 na carteira · 6 internos · 3
            * fixture" e esta tela mostrava os 58 como iguais — duas telas do
            * MESMO produto discordando do que é cliente. É a mesma família do
            * 1222 x 411 e do 33 x 35: a segunda superfície sem a regra da
            * primeira.
            *
            * Cliente de verdade não ganha selo: o padrão não precisa de rótulo,
            * e rotular todo mundo é ruído. Quem precisa de aviso é a exceção.
            */}
          {client.natureza !== 'CLIENTE' && (
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider',
                client.natureza === 'FIXTURE'
                  ? 'border-erro/40 bg-erro/10 text-erro'
                  : 'border-grafite-elevado bg-carbono text-nevoa',
              )}
            >
              {client.natureza === 'FIXTURE' ? 'teste' : 'interno'}
            </span>
          )}
        </span>
      </div>

      <div>
        <p className="line-clamp-2 font-heading text-lg font-semibold leading-tight text-branco-cru">{client.name}</p>
        {/*
          * QUANDO ESTE CLIENTE SE MEXEU. É a linha que transforma a grade de um
          * catálogo numa ferramenta de gestão: conta que esfria é a primeira
          * evidência de cliente indo embora, e ela aparece semanas antes do
          * aviso. O vínculo do ClickUp vai junto, mas depois — ele responde
          * "está configurado", não "está vivo".
          */}
        <p className={cn('mt-1 truncate text-[12px]', corDaRecencia(client.ultimaAtividade))}>
          {textoDaRecencia(client.ultimaAtividade)}
        </p>
        <p className="mt-0.5 truncate font-mono text-[11px] text-nevoa/70">
          {client.clickupListId ? 'ClickUp vinculado' : 'sem vínculo no ClickUp'}
        </p>
      </div>
    </motion.button>
  );
}

/**
 * Grade de clientes: scroll fluido, tudo numa rolagem só (sem paginação).
 *
 * A versão anterior tinha um efeito de roleta 3D (cards tombando conforme a
 * distância do centro). Foi removido a pedido do Endrigo: atrapalhava a
 * leitura. Ficou só o card entrando suave, e o clique continua abrindo a
 * ficha em popup pelo `layoutId`.
 *
 * ORDEM (29/09/2026): carteira primeiro, trabalho interno depois, fixture de
 * teste por último. Nenhuma linha some — apagar do cadastro é decisão de quem
 * cuida do cadastro, não da tela — mas a ordem diz o que é o quê antes de
 * alguém precisar ler o selo.
 */
const PESO_DA_NATUREZA: Record<string, number> = { CLIENTE: 0, INTERNO: 1, FIXTURE: 2 };

export type OrdemDaGrade = 'natureza' | 'parados';

/**
 * "Parados primeiro" responde a pergunta que a ordem por natureza não responde:
 * de quem ninguém cuidou. Quem NUNCA se mexeu vai no topo — é o caso mais
 * extremo, não o mais fraco. Quem não pôde ser medido vai para o FIM: colocar
 * uma falha de leitura entre os clientes abandonados faria o erro do sistema
 * parecer um problema do cliente.
 */
export function pesoDeParado(c: ClientSummary): number {
  if (c.ultimaAtividade === undefined) return -1;
  if (c.ultimaAtividade === null) return Number.MAX_SAFE_INTEGER;
  return diasParados(c.ultimaAtividade) ?? -1;
}

export function ClientGrid({
  clients,
  onOpen,
  ordem = 'natureza',
}: {
  clients: ClientSummary[];
  onOpen: (client: ClientSummary) => void;
  ordem?: OrdemDaGrade;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {[...clients]
        .sort((a, b) =>
          ordem === 'parados'
            ? pesoDeParado(b) - pesoDeParado(a)
            : (PESO_DA_NATUREZA[a.natureza] ?? 0) - (PESO_DA_NATUREZA[b.natureza] ?? 0),
        )
        .map((client, index) => (
        <motion.div
          key={client.id}
          data-client-id={client.id}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          // Escalonado só nos primeiros: com 51 clientes, atrasar todo mundo
          // faria o último aparecer segundos depois - vira lentidão, não charme.
          transition={{ duration: 0.28, ease: 'easeOut', delay: Math.min(index, 8) * 0.035 }}
        >
          <ClientCard client={client} onOpen={onOpen} />
        </motion.div>
      ))}
    </div>
  );
}
