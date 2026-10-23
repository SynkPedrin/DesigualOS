import { Selo } from '../kit';

const TONS = {
  neutro: 'bg-grafite-elevado text-nevoa',
  info: 'bg-roxo-eletrico/15 text-roxo-eletrico',
  ok: 'bg-sucesso/15 text-sucesso',
  aviso: 'bg-aviso/15 text-branco-cru',
  ruim: 'bg-red-500/15 text-red-500',
} as const;

const STATUS: Record<string, { rotulo: string; tom: keyof typeof TONS }> = {
  rascunho: { rotulo: 'Rascunho', tom: 'neutro' },
  enviada: { rotulo: 'Enviada', tom: 'info' },
  aprovada: { rotulo: 'Aprovada', tom: 'ok' },
  recusada: { rotulo: 'Recusada', tom: 'ruim' },
  expirada: { rotulo: 'Expirada', tom: 'aviso' },
  cancelada: { rotulo: 'Cancelada', tom: 'neutro' },
  vigente: { rotulo: 'Vigente', tom: 'ok' },
  encerrado: { rotulo: 'Encerrado', tom: 'neutro' },
  cancelado: { rotulo: 'Cancelado', tom: 'neutro' },
  aberto: { rotulo: 'Aberto', tom: 'info' },
  faturado: { rotulo: 'Faturado', tom: 'ok' },
  aberta: { rotulo: 'Aberta', tom: 'info' },
  cotando: { rotulo: 'Cotando', tom: 'aviso' },
  em_producao: { rotulo: 'Em produção', tom: 'aviso' },
  entregue: { rotulo: 'Entregue', tom: 'ok' },
  recebida: { rotulo: 'Recebida', tom: 'neutro' },
  escolhida: { rotulo: 'Escolhida', tom: 'ok' },
  descartada: { rotulo: 'Descartada', tom: 'neutro' },
};

export const rotuloDoStatus = (s: string) => STATUS[s]?.rotulo ?? s;

export function SeloDeStatus({ status }: { status: string }) {
  const s = STATUS[status] ?? { rotulo: status, tom: 'neutro' as const };
  return <Selo classe={TONS[s.tom]}>{s.rotulo}</Selo>;
}

/** Texto do botão que leva a proposta/contrato/pedido para o próximo estado. */
export const ACAO_DE_STATUS: Record<string, string> = {
  enviada: 'Marcar como enviada',
  aprovada: 'Aprovar',
  recusada: 'Registrar recusa',
  expirada: 'Marcar como expirada',
  cancelada: 'Cancelar',
  rascunho: 'Voltar a rascunho',
  vigente: 'Tornar vigente',
  encerrado: 'Encerrar',
  cancelado: 'Cancelar',
  em_producao: 'Iniciar produção',
  entregue: 'Marcar como entregue',
};
