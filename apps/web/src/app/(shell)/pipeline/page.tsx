'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, FileText, Paperclip, Plus, Settings2, SquareKanban, Upload, X, Search } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { EntityAvatar } from '@/components/ui/entity-avatar';
import {
  usePipelines,
  useCriarPipeline,
  useAtualizarPipeline,
  useApagarPipeline,
  useCriarCartao,
  useAtualizarCartao,
  useApagarCartao,
  useMoverCartao,
  enviarAnexo,
} from '@/hooks/use-pipelines';
import type { PipelineBoardWire } from '@/lib/api/contracts';
import { ApiRequestError } from '@/lib/api/client';
import { formatarCentavos, resumoDoQuadro } from '@/lib/pipeline-resumo';
import { useIsMaster } from '@/hooks/use-is-master';
import { useCollaborators } from '@/hooks/use-collaborators';
import { ClientDemandsPanel } from '@/components/clients/client-demands-panel';
import { ClientTasksPanel } from '@/components/clients/client-tasks-panel';
import { ClientStudioGallery } from '@/components/clients/client-studio-gallery';
import { toast } from '@/stores/toast-store';
import {
  CLICKUP_STATUSES_DISPONIVEIS,
  PIPELINE_STAGE_COLORS,
  type PipelineBoard,
  type PipelineCard,
  type PipelineStage,
  type PipelineStageColor,
  type PipelineTipo,
} from '@/mocks/pipeline';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * PIPELINES — mais de um quadro, cada um de um tipo (demo "dia real de
 * operação", 07/10/2026):
 *
 *   cliente     — funil comercial, estágio livre (nome/ordem/cor configuráveis).
 *   tarefas     — um cartão por tarefa do ClickUp; estágio = status real da
 *                 tarefa, só pode usar status que existe no ClickUp
 *                 (`CLICKUP_STATUSES_DISPONIVEIS`) — nunca inventado.
 *   colaborador — carga de trabalho por pessoa.
 *
 * Tudo em estado local da demo — não existe endpoint de pipeline ainda.
 */

const TIPO_LABEL: Record<PipelineTipo, string> = { cliente: 'Cliente', tarefas: 'Tarefas (ClickUp)', colaborador: 'Colaborador' };

const STAGE_COLOR_CLASSES: Record<PipelineStageColor, { dot: string; bar: string }> = {
  'roxo-eletrico': { dot: 'bg-roxo-eletrico', bar: 'bg-roxo-eletrico' },
  info: { dot: 'bg-info', bar: 'bg-info' },
  aviso: { dot: 'bg-aviso', bar: 'bg-aviso' },
  sinal: { dot: 'bg-sinal', bar: 'bg-sinal' },
  erro: { dot: 'bg-erro', bar: 'bg-erro' },
  ametista: { dot: 'bg-ametista', bar: 'bg-ametista' },
};

const STAGE_COLOR_LABEL: Record<PipelineStageColor, string> = {
  'roxo-eletrico': 'Roxo', info: 'Azul', aviso: 'Amarelo', sinal: 'Verde', erro: 'Vermelho', ametista: 'Lilás',
};

function extensaoIcone(nome: string): string {
  const ext = nome.split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'imagem';
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx'].includes(ext)) return 'doc';
  if (['ppt', 'pptx'].includes(ext)) return 'ppt';
  return 'arquivo';
}

interface AnexoLocal {
  id: string;
  nome: string;
  url: string;
  tipo: string;
}

interface NovaPipelineEntrada {
  nome: string;
  tipo: PipelineTipo;
  escopo: 'agencia' | 'pessoal';
  stages: PipelineStage[];
}

function NovaPipelineModal({ onCreate, onClose }: { onCreate: (entrada: NovaPipelineEntrada) => void; onClose: () => void }) {
  const { isMaster } = useIsMaster();
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<PipelineTipo>('cliente');
  /**
   * PESSOAL é o padrão, e de propósito: o quadro de alguém é a escolha segura
   * (só essa pessoa vê), enquanto o da agência aparece pra empresa inteira.
   * Quem quer o compartilhado escolhe; ninguém publica sem querer.
   */
  const [escopo, setEscopo] = useState<'agencia' | 'pessoal'>('pessoal');
  const [statusSelecionados, setStatusSelecionados] = useState<Set<string>>(new Set(CLICKUP_STATUSES_DISPONIVEIS.map((s) => s.status)));

  function alternarStatus(status: string) {
    setStatusSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(status)) novo.delete(status);
      else novo.add(status);
      return novo;
    });
  }

  function criar() {
    if (!nome.trim()) return;
    let stages: PipelineStage[];
    if (tipo === 'tarefas') {
      stages = CLICKUP_STATUSES_DISPONIVEIS.filter((s) => statusSelecionados.has(s.status)).map((s) => ({ id: s.status, label: s.status, color: s.color, clickupStatus: s.status }));
    } else if (tipo === 'colaborador') {
      stages = [
        { id: 'disponivel', label: 'Disponível', color: 'sinal' },
        { id: 'com-carga', label: 'Com carga', color: 'info' },
        { id: 'sobrecarregado', label: 'Sobrecarregado', color: 'erro' },
      ];
    } else {
      stages = [
        { id: 'novo', label: 'Novo', color: 'info' },
        { id: 'andamento', label: 'Em andamento', color: 'aviso' },
        { id: 'concluido', label: 'Concluído', color: 'sinal' },
      ];
    }
    onCreate({ nome: nome.trim(), tipo, escopo, stages });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-carbono/80 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg border border-grafite-elevado bg-grafite p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-base font-semibold text-branco-cru">Nova pipeline</h2>
          <button type="button" onClick={onClose} className="text-nevoa hover:text-branco-cru"><X size={18} /></button>
        </div>

        <div className="space-y-3">
          {/* DE QUEM É O QUADRO — a primeira pergunta, antes do nome, porque é
              a que muda quem enxerga tudo o que vier depois. */}
          <div>
            <label className="mb-1 block text-xs text-nevoa">De quem é</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setEscopo('pessoal')}
                className={cn(
                  'rounded-md border px-3 py-2 text-left text-sm transition-colors',
                  escopo === 'pessoal'
                    ? 'border-roxo-eletrico bg-roxo-eletrico/10 text-branco-cru'
                    : 'border-grafite-elevado text-nevoa hover:text-branco-cru',
                )}
              >
                <span className="block font-medium">Meu</span>
                <span className="block text-[11px] text-nevoa">Só você vê. Organize como quiser.</span>
              </button>
              <button
                type="button"
                onClick={() => isMaster && setEscopo('agencia')}
                disabled={!isMaster}
                title={isMaster ? undefined : 'Só um administrador cria quadro da agência'}
                className={cn(
                  'rounded-md border px-3 py-2 text-left text-sm transition-colors',
                  escopo === 'agencia'
                    ? 'border-roxo-eletrico bg-roxo-eletrico/10 text-branco-cru'
                    : 'border-grafite-elevado text-nevoa hover:text-branco-cru',
                  !isMaster && 'cursor-not-allowed opacity-40 hover:text-nevoa',
                )}
              >
                <span className="block font-medium">Da agência</span>
                <span className="block text-[11px] text-nevoa">
                  {isMaster ? 'Todo mundo da empresa vê.' : 'Só administrador.'}
                </span>
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-nevoa">Nome</label>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Produção de vídeo"
              autoFocus
              className="w-full rounded-md border border-grafite-elevado bg-carbono px-2.5 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-nevoa">Esta pipeline organiza...</label>
            <div className="grid grid-cols-3 gap-2">
              {(['cliente', 'tarefas', 'colaborador'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipo(t)}
                  className={cn(
                    'rounded-md border px-2 py-2 text-xs font-medium transition-colors',
                    tipo === t ? 'border-roxo-eletrico/60 bg-roxo-eletrico/15 text-branco-cru' : 'border-grafite-elevado text-nevoa hover:text-branco-cru',
                  )}
                >
                  {TIPO_LABEL[t]}
                </button>
              ))}
            </div>
          </div>

          {tipo === 'tarefas' && (
            <div>
              <label className="mb-1 block text-xs text-nevoa">Estágios, só os status que existem no ClickUp</label>
              <div className="space-y-1.5 rounded-md border border-grafite-elevado bg-carbono p-2.5">
                {CLICKUP_STATUSES_DISPONIVEIS.map((s) => (
                  <label key={s.status} className="flex items-center gap-2 text-sm text-branco-cru">
                    <input type="checkbox" checked={statusSelecionados.has(s.status)} onChange={() => alternarStatus(s.status)} className="accent-roxo-eletrico" />
                    {s.status}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-nevoa">Mover um cartão entre estágios muda o status da tarefa no ClickUp.</p>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-nevoa hover:text-branco-cru">Cancelar</button>
          <button
            type="button"
            onClick={criar}
            disabled={!nome.trim() || (tipo === 'tarefas' && statusSelecionados.size === 0)}
            className="rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-40"
          >
            Criar pipeline
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfigurarPipelineModal({ board, onSave, onClose }: { board: PipelineBoard; onSave: (stages: PipelineStage[]) => void; onClose: () => void }) {
  const [rascunho, setRascunho] = useState<PipelineStage[]>(board.stages);

  function mover(index: number, direcao: -1 | 1) {
    setRascunho((atual) => {
      const novo = [...atual];
      const alvo = index + direcao;
      if (alvo < 0 || alvo >= novo.length) return atual;
      [novo[index], novo[alvo]] = [novo[alvo]!, novo[index]!];
      return novo;
    });
  }
  function renomear(id: string, label: string) {
    setRascunho((atual) => atual.map((s) => (s.id === id ? { ...s, label } : s)));
  }
  function recolorir(id: string, color: PipelineStageColor) {
    setRascunho((atual) => atual.map((s) => (s.id === id ? { ...s, color } : s)));
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-carbono/80 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg border border-grafite-elevado bg-grafite p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-base font-semibold text-branco-cru">Configurar "{board.nome}"</h2>
          <button type="button" onClick={onClose} className="text-nevoa hover:text-branco-cru"><X size={18} /></button>
        </div>
        <p className="mb-4 text-xs text-nevoa">Nome, ordem e cor de cada estágio.</p>

        <div className="space-y-2">
          {rascunho.map((stage, index) => (
            <div key={stage.id} className="flex items-center gap-2 rounded-md border border-grafite-elevado bg-carbono p-2.5">
              <div className="flex shrink-0 flex-col">
                <button type="button" disabled={index === 0} onClick={() => mover(index, -1)} className="text-nevoa hover:text-branco-cru disabled:opacity-20"><ArrowUp size={14} /></button>
                <button type="button" disabled={index === rascunho.length - 1} onClick={() => mover(index, 1)} className="text-nevoa hover:text-branco-cru disabled:opacity-20"><ArrowDown size={14} /></button>
              </div>
              <input
                value={stage.label}
                onChange={(e) => renomear(stage.id, e.target.value)}
                disabled={Boolean(stage.clickupStatus)}
                title={stage.clickupStatus ? 'Nome vem do status do ClickUp, não dá pra editar aqui' : undefined}
                className="min-w-0 flex-1 rounded-md border border-grafite-elevado bg-grafite px-2.5 py-1.5 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none disabled:opacity-60"
              />
              <div className="flex shrink-0 gap-1">
                {PIPELINE_STAGE_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    title={STAGE_COLOR_LABEL[color]}
                    onClick={() => recolorir(stage.id, color)}
                    className={cn('size-5 rounded-full ring-offset-2 ring-offset-carbono transition-all', STAGE_COLOR_CLASSES[color].dot, stage.color === color ? 'ring-2 ring-branco-cru' : 'opacity-50 hover:opacity-80')}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-nevoa hover:text-branco-cru">Cancelar</button>
          <button type="button" onClick={() => { onSave(rascunho); onClose(); }} className="rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow">
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

interface NovoCartaoEntrada {
  stage_id: string;
  name: string;
  responsavel: string | null;
  valor: string | null;
  nota: string;
}

function NovoCartaoModal({ board, onCreate, onClose }: { board: PipelineBoard; onCreate: (entrada: NovoCartaoEntrada) => void; onClose: () => void }) {
  const { data: collaboratorsData } = useCollaborators();
  const colaboradores = collaboratorsData?.collaborators ?? [];
  const [nome, setNome] = useState('');
  const [estagio, setEstagio] = useState(board.stages[0]?.id ?? '');
  const [responsavel, setResponsavel] = useState('');
  const [valor, setValor] = useState('');
  const [nota, setNota] = useState('');

  function submeter() {
    if (!nome.trim()) return;
    // Entrada, não entidade: o id e as datas são do servidor. Inventá-los aqui
    // criava um cartão que existia na tela e em lugar nenhum.
    onCreate({
      stage_id: estagio,
      name: nome.trim(),
      responsavel: responsavel || null,
      valor: valor.trim() || null,
      nota: nota.trim(),
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-carbono/80 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-lg border border-grafite-elevado bg-grafite p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-base font-semibold text-branco-cru">{board.tipo === 'cliente' ? 'Novo lead' : 'Novo cartão'}</h2>
          <button type="button" onClick={onClose} className="text-nevoa hover:text-branco-cru"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-nevoa">Nome</label>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Padaria Dona Luzia" autoFocus className="w-full rounded-md border border-grafite-elevado bg-carbono px-2.5 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-nevoa">Estágio</label>
            <select value={estagio} onChange={(e) => setEstagio(e.target.value)} className="w-full rounded-md border border-grafite-elevado bg-carbono px-2.5 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none">
              {board.stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-nevoa">Responsável</label>
            <select value={responsavel} onChange={(e) => setResponsavel(e.target.value)} className="w-full rounded-md border border-grafite-elevado bg-carbono px-2.5 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none">
              <option value="">Selecione</option>
              {colaboradores.map((c) => <option key={c.userId} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          {board.tipo === 'cliente' && (
            <div>
              <label className="mb-1 block text-xs text-nevoa">Valor estimado (opcional)</label>
              <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Ex.: R$ 2.000/mês" className="w-full rounded-md border border-grafite-elevado bg-carbono px-2.5 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none" />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs text-nevoa">Nota</label>
            <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} placeholder="Contexto rápido" className="w-full resize-none rounded-md border border-grafite-elevado bg-carbono px-2.5 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none" />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-nevoa hover:text-branco-cru">Cancelar</button>
          <button type="button" onClick={submeter} disabled={!nome.trim()} className="rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-40">
            Criar
          </button>
        </div>
      </div>
    </div>
  );
}

function CartaoDetalheModal({
  card,
  anexos,
  enviando,
  onAnexar,
  onRemoverAnexo,
  onSalvar,
  onApagar,
  onClose,
}: {
  card: PipelineCard;
  anexos: AnexoLocal[];
  enviando: boolean;
  onAnexar: (files: FileList) => void;
  onRemoverAnexo: (id: string) => void;
  onSalvar: (campos: { name: string; responsavel: string | null; valor: string | null; nota: string }) => void;
  onApagar: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'Visão geral' | 'Demandas' | 'Tarefas' | 'Arquivos' | 'Anexos'>('Visão geral');
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(card.name);
  const [responsavel, setResponsavel] = useState(card.responsavel ?? '');
  const [valor, setValor] = useState(card.valor ?? '');
  const [nota, setNota] = useState(card.nota);
  const tabs = card.clientId ? (['Visão geral', 'Demandas', 'Tarefas', 'Arquivos', 'Anexos'] as const) : (['Visão geral', 'Anexos'] as const);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-carbono/80 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-grafite-elevado bg-grafite" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-grafite-elevado px-5 py-4">
          <div className="flex items-center gap-3">
            <EntityAvatar name={card.name} kind={card.clientId ? 'client' : 'person'} size="md" />
            <div>
              <h2 className="font-heading text-base font-semibold text-branco-cru">{card.name}</h2>
              <p className="text-xs text-nevoa">{card.responsavel} · {formatRelativeTime(card.atualizadoEm)}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-nevoa hover:text-branco-cru"><X size={18} /></button>
        </div>

        <div className="flex shrink-0 gap-1 border-b border-grafite-elevado px-3 py-2">
          {tabs.map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={cn('rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors', tab === t ? 'bg-grafite-elevado text-branco-cru' : 'text-nevoa hover:text-branco-cru')}>
              {t}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === 'Visão geral' && !editando && (
            <div className="space-y-3 text-sm">
              {card.valor && <p className="text-sinal">{card.valor}</p>}
              <p className="whitespace-pre-wrap text-branco-cru">{card.nota || <span className="text-nevoa">Sem nota.</span>}</p>
              {card.clientId && (
                <Link href={`/clients?id=${card.clientId}`} className="inline-block text-sm text-roxo-eletrico hover:underline">
                  Abrir ficha completa do cliente →
                </Link>
              )}
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditando(true)}
                  className="rounded-md border border-grafite-elevado px-3 py-1.5 text-xs text-branco-cru transition-colors hover:border-nevoa/50"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={onApagar}
                  className="rounded-md border border-erro/40 px-3 py-1.5 text-xs text-erro transition-colors hover:bg-erro/10"
                >
                  Apagar cartão
                </button>
              </div>
            </div>
          )}

          {tab === 'Visão geral' && editando && (
            <div className="space-y-3 text-sm">
              <div>
                <label className="mb-1 block text-xs text-nevoa">Nome</label>
                <input value={nome} onChange={(e) => setNome(e.target.value)} className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru outline-none focus:border-roxo-eletrico" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-nevoa">Responsável</label>
                  <input value={responsavel} onChange={(e) => setResponsavel(e.target.value)} className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru outline-none focus:border-roxo-eletrico" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-nevoa">Valor</label>
                  <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Ex.: R$ 4.500/mês" className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru outline-none focus:border-roxo-eletrico" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-nevoa">Nota</label>
                <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={4} className="w-full resize-none rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru outline-none focus:border-roxo-eletrico" />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onSalvar({ name: nome.trim() || card.name, responsavel: responsavel.trim() || null, valor: valor.trim() || null, nota });
                    setEditando(false);
                  }}
                  className="rounded-md bg-roxo-eletrico px-3 py-1.5 text-xs font-medium text-branco-cru"
                >
                  Salvar
                </button>
                <button type="button" onClick={() => setEditando(false)} className="rounded-md border border-grafite-elevado px-3 py-1.5 text-xs text-nevoa">
                  Cancelar
                </button>
              </div>
            </div>
          )}
          {tab === 'Demandas' && card.clientId && <ClientDemandsPanel clientId={card.clientId} />}
          {tab === 'Tarefas' && card.clientId && <ClientTasksPanel clientId={card.clientId} clickupUrl={null} />}
          {tab === 'Arquivos' && card.clientId && <ClientStudioGallery clientId={card.clientId} />}
          {tab === 'Anexos' && (
            <div className="space-y-3">
              <label
                className={cn(
                  'flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-grafite-elevado py-6 text-sm text-nevoa transition-colors',
                  enviando ? 'cursor-wait opacity-60' : 'cursor-pointer hover:border-roxo-eletrico/50 hover:text-branco-cru',
                )}
              >
                <Upload size={16} />
                {enviando ? 'Enviando...' : 'Anexar imagem, PDF, .docx ou .pptx'}
                <input
                  type="file"
                  multiple
                  /* `.doc` e `.ppt` (formatos binários antigos) ficam de fora
                     porque o servidor os recusa — oferecer um upload que falha
                     sempre é pior que não oferecer. */
                  accept="image/*,.pdf,.docx,.pptx,.md,.txt,.csv"
                  disabled={enviando}
                  className="hidden"
                  onChange={(e) => e.target.files && onAnexar(e.target.files)}
                />
              </label>
              {anexos.length === 0 ? (
                <p className="text-center text-xs text-nevoa">Nenhum arquivo anexado ainda.</p>
              ) : (
                <ul className="space-y-1.5">
                  {anexos.map((a) => {
                    const tipoIcone = extensaoIcone(a.nome);
                    return (
                      <li key={a.id} className="flex items-center gap-2 rounded-md border border-grafite-elevado bg-carbono px-3 py-2">
                        {tipoIcone === 'imagem' ? (
                          <img src={a.url} alt={a.nome} className="size-8 shrink-0 rounded object-cover" />
                        ) : (
                          <FileText size={16} className={cn('shrink-0', tipoIcone === 'pdf' ? 'text-erro' : 'text-nevoa')} />
                        )}
                        <a href={a.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm text-branco-cru underline">{a.nome}</a>
                        <button type="button" onClick={() => onRemoverAnexo(a.id)} className="shrink-0 text-nevoa hover:text-erro"><X size={14} /></button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * OS QUADROS AGORA SÃO DE VERDADE.
 *
 * Até 08/10/2026 esta tela era fixture em `useState`: funcionava na
 * demonstração e, em produção, se recusava a abrir — mostrava "Pipeline ainda
 * não está conectada", porque exibir funil e faturamento inventados pra quem
 * decide pelo número seria pior que tela vazia. A recusa estava certa; o que
 * faltava era o outro lado.
 *
 * Agora existe (`/pipelines`), e com a regra de propriedade que o produto
 * pedia: a AGÊNCIA tem os quadros dela, que todo mundo da empresa vê, e CADA
 * PESSOA tem os seus, que ela cria e organiza do jeito que funciona pra ela.
 */
export default function PipelinePage() {
  return <PipelineBoardUI />;
}

/**
 * A API fala snake_case (convenção da casa no fio) e esta tela foi escrita em
 * camelCase, com `boardId`/`stageId`/`atualizadoEm` espalhados por umas
 * quatrocentas linhas de JSX. Traduzir aqui, num lugar só, em vez de renomear
 * tudo: o que mudou foi de onde o dado vem, não como a tela desenha.
 */
function daApi(boards: PipelineBoardWire[]): { boards: PipelineBoard[]; cards: PipelineCard[] } {
  return {
    boards: boards.map((b) => ({
      id: b.id,
      nome: b.nome,
      tipo: b.tipo,
      stages: b.stages as PipelineStage[],
    })),
    cards: boards.flatMap((b) =>
      b.cards.map((c) => ({
        id: c.id,
        boardId: c.board_id,
        stageId: c.stage_id,
        name: c.name,
        clientId: c.client_id,
        ...(c.clickup_task_id ? { taskId: c.clickup_task_id } : {}),
        responsavel: c.responsavel ?? 'Sem responsável',
        valor: c.valor,
        nota: c.nota,
        anexos: c.anexos,
        atualizadoEm: c.atualizado_em,
      })),
    ),
  };
}

function PipelineBoardUI() {
  const { data, isPending, isError, error } = usePipelines();
  const criarPipeline = useCriarPipeline();
  const atualizarPipeline = useAtualizarPipeline();
  const criarCartao = useCriarCartao();
  const atualizarCartao = useAtualizarCartao();
  const apagarCartao = useApagarCartao();
  const apagarPipeline = useApagarPipeline();
  const moverCartaoMut = useMoverCartao();
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);
  const [busca, setBusca] = useState('');
  const [responsavelFiltro, setResponsavelFiltro] = useState('');

  const { boards, cards } = useMemo(() => daApi(data?.boards ?? []), [data]);
  /** Selo de "da agência" / "meu", direto do servidor. */
  const escopoPorQuadro = useMemo(
    () => new Map((data?.boards ?? []).map((b) => [b.id, b.escopo] as const)),
    [data],
  );

  const [boardIdEscolhido, setBoardId] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [colunaSobre, setColunaSobre] = useState<string | null>(null);
  const [criandoCartao, setCriandoCartao] = useState(false);
  const [criandoPipeline, setCriandoPipeline] = useState(false);
  const [configurando, setConfigurando] = useState(false);
  const [cartaoAberto, setCartaoAberto] = useState<string | null>(null);

  /**
   * O quadro escolhido, OU o primeiro que existir. Guardar só o id e resolver
   * aqui evita o estado inválido clássico: o quadro selecionado é apagado (ou
   * a lista chega depois da primeira renderização) e o `.find()` devolve
   * `undefined` num lugar que esperava objeto.
   */
  const board = boards.find((b) => b.id === boardIdEscolhido) ?? boards[0] ?? null;
  const boardId = board?.id ?? null;
  const cartoesDoBoard = useMemo(() => cards.filter((c) => c.boardId === boardId), [cards, boardId]);

  /** Quem aparece como responsável NESTE quadro — a lista do filtro sai do dado, não de um cadastro à parte. */
  const responsaveis = useMemo(
    () => [...new Set(cartoesDoBoard.map((c) => c.responsavel).filter((r): r is string => Boolean(r)))].sort(),
    [cartoesDoBoard],
  );

  /**
   * O FILTRO MUDA O QUE SE VÊ, NÃO O QUE SE CONTA.
   *
   * Os indicadores do topo são do QUADRO inteiro: se eles seguissem o filtro,
   * "valor no quadro" mudaria ao digitar na busca, e um número que se move
   * conforme a pesquisa não serve pra decidir nada. Quem filtra quer achar um
   * cartão, não redefinir o total.
   */
  const cartoesVisiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return cartoesDoBoard.filter((c) => {
      if (responsavelFiltro && c.responsavel !== responsavelFiltro) return false;
      if (!termo) return true;
      return [c.name, c.responsavel, c.valor, c.nota].some((campo) => campo?.toLowerCase().includes(termo));
    });
  }, [cartoesDoBoard, busca, responsavelFiltro]);

  const resumo = useMemo(() => resumoDoQuadro(board?.stages ?? [], cartoesDoBoard), [board, cartoesDoBoard]);
  const maiorColuna = useMemo(
    () => [...resumo.estagios].sort((a, b) => b.quantidade - a.quantidade)[0] ?? null,
    [resumo],
  );
  const semResponsavel = useMemo(() => cartoesDoBoard.filter((c) => !c.responsavel).length, [cartoesDoBoard]);
  const cartaoSelecionado = cards.find((c) => c.id === cartaoAberto) ?? null;

  function moverCartao(cardId: string, novoEstagio: string) {
    const card = cards.find((c) => c.id === cardId);
    if (!card || !board) return;
    const stage = board.stages.find((s) => s.id === novoEstagio);
    moverCartaoMut.mutate(
      { boardId: board.id, cardId, stage_id: novoEstagio },
      {
        /**
         * O aviso de "atualizado no ClickUp" só sai DEPOIS que o servidor
         * confirmou. Antes ele era disparado junto com a chamada, sempre, e
         * dizia que a tarefa tinha mudado de status lá quando nada tinha sido
         * escrito — toast verde é afirmação, e afirmação precisa de resposta.
         */
        onSuccess: () => {
          if (board.tipo === 'tarefas' && stage?.clickupStatus) {
            toast(`"${card.name}" → ${stage.label}, status atualizado no ClickUp.`, 'success');
          }
        },
        onError: (erro) =>
          toast(`Não consegui mover "${card.name}": ${erro instanceof Error ? erro.message : 'erro desconhecido'}`, 'error'),
      },
    );
  }

  if (isPending) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader eyebrow="Operação" title="Pipelines" description="Cliente, tarefas do ClickUp ou carga da equipe, cada quadro do seu jeito." />
        <div className="mt-6 flex gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-64 flex-1 animate-pulse rounded-lg border border-grafite-elevado bg-grafite/40" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader eyebrow="Operação" title="Pipelines" description="Cliente, tarefas do ClickUp ou carga da equipe, cada quadro do seu jeito." />
        <EmptyState
          icon={SquareKanban}
          title="Não consegui carregar seus quadros"
          /**
           * O `detalhe` do corpo entra junto quando existe. É onde a API põe o
           * que FAZER — por exemplo o comando da migration quando as tabelas
           * ainda não foram criadas. Mostrar só `message` deixaria a metade
           * acionável do erro no servidor.
           */
          description={[
            error instanceof Error ? error.message : 'A API não respondeu.',
            error instanceof ApiRequestError ? (error.body as { detalhe?: string } | undefined)?.detalhe : undefined,
          ]
            .filter(Boolean)
            .join(' ')}
        />
      </div>
    );
  }

  if (!board) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader eyebrow="Operação" title="Pipelines" description="Cliente, tarefas do ClickUp ou carga da equipe, cada quadro do seu jeito." />
        <EmptyState
          icon={SquareKanban}
          title="Nenhum quadro ainda"
          description="Crie o primeiro. Um quadro pessoal é seu e só seu, você organiza as colunas do jeito que funciona pra você. O da agência todo mundo da empresa vê."
        />
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setCriandoPipeline(true)}
            className="inline-flex items-center gap-2 rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-colors hover:bg-roxo-eletrico/90"
          >
            <Plus size={15} /> Criar pipeline
          </button>
        </div>
        {criandoPipeline && (
          <NovaPipelineModal
            onCreate={(entrada) =>
              criarPipeline.mutate(entrada, { onSuccess: (novo) => setBoardId(novo.id) })
            }
            onClose={() => setCriandoPipeline(false)}
          />
        )}
      </div>
    );
  }

  /**
   * O arquivo SOBE antes de virar anexo. A versão anterior guardava
   * `URL.createObjectURL(f)`: um endereço válido só dentro da aba que o criou,
   * então o anexo sumia no recarregamento e nunca existiu pra mais ninguém —
   * inclusive pra quem compartilha o quadro da agência.
   */
  async function anexarArquivos(cardId: string, files: FileList) {
    if (!board) return;
    const atuais = cards.find((c) => c.id === cardId)?.anexos ?? [];
    setEnviandoAnexo(true);
    try {
      const novos = await Promise.all(Array.from(files).map((f) => enviarAnexo(f)));
      atualizarCartao.mutate({ boardId: board.id, cardId, anexos: [...atuais, ...novos] });
    } catch (erro) {
      toast(`Não consegui enviar o arquivo: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`, 'error');
    } finally {
      setEnviandoAnexo(false);
    }
  }

  function removerAnexo(cardId: string, anexoId: string) {
    if (!board) return;
    const atuais = cards.find((c) => c.id === cardId)?.anexos ?? [];
    atualizarCartao.mutate({ boardId: board.id, cardId, anexos: atuais.filter((a) => a.id !== anexoId) });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <PageHeader
          eyebrow="Operação"
          title="Pipelines"
          description="Cliente, tarefas do ClickUp ou carga da equipe, cada quadro do seu jeito."
          actions={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  /**
                   * Confirmação nativa, e de propósito: apagar um quadro é a
                   * única ação aqui que some com o trabalho de organização
                   * de alguém — e, num quadro da agência, com o de todo
                   * mundo. O cartão vai pro soft delete e dá pra restaurar
                   * no banco, mas quem clicou não sabe disso.
                   */
                  if (!window.confirm(`Apagar o quadro "${board.nome}"? Os cartões vão junto.`)) return;
                  apagarPipeline.mutate(board.id, {
                    onSuccess: () => {
                      setBoardId(null);
                      toast(`Quadro "${board.nome}" apagado.`, 'success');
                    },
                    onError: (erro) => toast(erro instanceof Error ? erro.message : 'Não consegui apagar o quadro.', 'error'),
                  });
                }}
                className="flex items-center gap-2 rounded-md border border-grafite-elevado bg-grafite px-3.5 py-2 text-sm font-medium text-nevoa transition-colors hover:border-erro/50 hover:text-erro"
              >
                Apagar quadro
              </button>
              {board.tipo !== 'tarefas' && (
                <button type="button" onClick={() => setConfigurando(true)} className="flex items-center gap-2 rounded-md border border-grafite-elevado bg-grafite px-3.5 py-2 text-sm font-medium text-branco-cru transition-colors hover:border-roxo-eletrico/50">
                  <Settings2 size={15} /> Configurar
                </button>
              )}
              <button type="button" onClick={() => setCriandoCartao(true)} className="flex items-center gap-2 rounded-md border border-grafite-elevado bg-grafite px-3.5 py-2 text-sm font-medium text-branco-cru transition-colors hover:border-roxo-eletrico/50">
                <Plus size={15} /> Novo cartão
              </button>
              <button type="button" onClick={() => setCriandoPipeline(true)} className="flex items-center gap-2 rounded-md bg-roxo-eletrico px-3.5 py-2 text-sm font-semibold text-branco-cru transition-all hover:opacity-90 hover:shadow-glow">
                <Plus size={15} /> Nova pipeline
              </button>
            </div>
          }
        />
      </div>

      {/* DE QUEM É CADA QUADRO, visível sem precisar abrir. Os da agência
          primeiro — são o chão comum; depois os seus. Sem o selo, um quadro
          compartilhado e um pessoal são indistinguíveis, e a pessoa reorganiza
          o da empresa inteira achando que mexe no dela. */}
      <div className="mt-4 flex shrink-0 flex-wrap items-center gap-1 border-b border-grafite-elevado pb-2">
        {[...boards]
          .sort((a, b) => Number(escopoPorQuadro.get(b.id) === 'agencia') - Number(escopoPorQuadro.get(a.id) === 'agencia'))
          .map((b) => {
            const daAgencia = escopoPorQuadro.get(b.id) === 'agencia';
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => setBoardId(b.id)}
                className={cn('flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors', boardId === b.id ? 'bg-roxo-eletrico text-branco-cru' : 'text-nevoa hover:bg-grafite-elevado')}
              >
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider',
                    daAgencia ? 'bg-sinal/20 text-sinal' : 'bg-grafite-elevado text-nevoa',
                  )}
                >
                  {daAgencia ? 'agência' : 'meu'}
                </span>
                {b.nome} <span className="opacity-70">· {TIPO_LABEL[b.tipo]}</span>
              </button>
            );
          })}
      </div>

      {/*
        INDICADORES DO QUADRO — só o que o dado sustenta.

        O mockup mostra cinco, e dois deles não têm como ser calculados com
        honestidade: "taxa de conversão" exige saber qual coluna significa
        ganho, e as colunas aqui são livres, criadas por quem usa o quadro. Um
        número de conversão inventado numa tela de funil é a pior espécie de
        número errado, porque é exatamente o que alguém usa pra decidir. Então
        ficaram quatro, todos derivados dos cartões reais.
      */}
      <div className="mt-4 grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { rotulo: 'Cartões no quadro', valor: String(resumo.total), detalhe: `${board.stages.length} coluna(s)` },
          {
            rotulo: 'Valor no quadro',
            valor: resumo.somaCentavos > 0 ? formatarCentavos(resumo.somaCentavos) : ', ',
            // Dizer quantos ficaram de fora é o que separa uma soma de uma
            // soma confiável: sem isso o total parece cobrir o quadro inteiro.
            detalhe: resumo.semValor > 0 ? `${resumo.semValor} sem valor legível` : 'todos com valor',
            destaque: resumo.somaCentavos > 0,
          },
          {
            rotulo: 'Maior acúmulo',
            valor: maiorColuna && maiorColuna.quantidade > 0 ? String(maiorColuna.quantidade) : ', ',
            detalhe: maiorColuna && maiorColuna.quantidade > 0 ? maiorColuna.label : 'quadro vazio',
          },
          {
            rotulo: 'Sem responsável',
            valor: String(semResponsavel),
            detalhe: semResponsavel > 0 ? 'ninguém tocando' : 'todos atribuídos',
            alerta: semResponsavel > 0,
          },
        ].map((kpi) => (
          <div key={kpi.rotulo} className="rounded-lg border border-grafite-elevado bg-grafite/60 px-4 py-3 transition-colors hover:border-roxo-eletrico/40">
            <p className="font-mono text-[10px] uppercase tracking-wider text-nevoa">{kpi.rotulo}</p>
            <p className={cn('mt-1 font-heading text-2xl font-semibold tabular-nums', kpi.destaque ? 'text-sinal' : kpi.alerta ? 'text-aviso' : 'text-branco-cru')}>
              {kpi.valor}
            </p>
            <p className="mt-0.5 text-[11px] text-nevoa">{kpi.detalhe}</p>
          </div>
        ))}
      </div>

      {/* Busca e filtro agem sobre o que APARECE, nunca sobre os números acima. */}
      <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-nevoa" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cartão, responsável ou nota..."
            className="w-full rounded-md border border-grafite-elevado bg-carbono py-2 pl-9 pr-3 text-sm text-branco-cru outline-none transition-colors placeholder:text-nevoa focus:border-roxo-eletrico"
          />
        </div>
        {responsaveis.length > 0 && (
          <select
            value={responsavelFiltro}
            onChange={(e) => setResponsavelFiltro(e.target.value)}
            className="rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru outline-none focus:border-roxo-eletrico"
          >
            <option value="">Todos os responsáveis</option>
            {responsaveis.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
        {(busca || responsavelFiltro) && (
          <button
            type="button"
            onClick={() => { setBusca(''); setResponsavelFiltro(''); }}
            className="rounded-md border border-grafite-elevado px-3 py-2 text-sm text-nevoa transition-colors hover:text-branco-cru"
          >
            Limpar · {cartoesVisiveis.length} de {resumo.total}
          </button>
        )}
      </div>

      <div className="mt-4 flex min-h-0 flex-1 gap-4 overflow-x-auto pb-2">
        {board.stages.map((stage) => {
          const cartoesDoEstagio = cartoesVisiveis.filter((c) => c.stageId === stage.id);
          const daColuna = resumo.estagios.find((e) => e.id === stage.id);
          const cor = STAGE_COLOR_CLASSES[stage.color];
          return (
            <div
              key={stage.id}
              onDragOver={(e) => { e.preventDefault(); setColunaSobre(stage.id); }}
              onDragLeave={() => setColunaSobre((atual) => (atual === stage.id ? null : atual))}
              onDrop={(e) => {
                e.preventDefault();
                const cardId = e.dataTransfer.getData('text/plain');
                if (cardId) moverCartao(cardId, stage.id);
                setArrastando(null);
                setColunaSobre(null);
              }}
              className={cn('flex w-96 shrink-0 flex-col overflow-hidden rounded-lg border bg-carbono/40 transition-colors', colunaSobre === stage.id ? 'border-roxo-eletrico/60 bg-roxo-eletrico/5' : 'border-grafite-elevado')}
            >
              <div className={cn('h-1.5 shrink-0', cor.bar)} />
              <div className="flex shrink-0 items-center justify-between border-b border-grafite-elevado px-4 py-3.5">
                <div className="flex items-center gap-2">
                  <span className={cn('size-2.5 rounded-full', cor.dot)} />
                  <h2 className="font-heading text-base font-semibold text-branco-cru">{stage.label}</h2>
                </div>
                <div className="flex items-center gap-2">
                  {/* A soma aparece ao lado da contagem, como no mockup — e some
                      quando não há valor legível nenhum, em vez de mostrar R$ 0,
                      que afirmaria que a coluna não vale nada. */}
                  {daColuna && daColuna.somaCentavos > 0 && (
                    <span className="font-mono text-[11px] text-sinal" title={daColuna.semValor > 0 ? `${daColuna.semValor} cartão(ões) sem valor legível ficaram fora desta soma` : undefined}>
                      {formatarCentavos(daColuna.somaCentavos)}
                      {daColuna.semValor > 0 && <span className="text-nevoa">{` +${daColuna.semValor}`}</span>}
                    </span>
                  )}
                  <span className="rounded-full bg-grafite-elevado px-2.5 py-1 text-xs font-semibold text-nevoa">{cartoesDoEstagio.length}</span>
                </div>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto p-3">
                {cartoesDoEstagio.length === 0 ? (
                  <p className="py-6 text-center text-sm text-nevoa">Nenhum cartão aqui.</p>
                ) : (
                  cartoesDoEstagio.map((card) => {
                    const anexos = card.anexos.length;
                    return (
                      <div
                        key={card.id}
                        draggable
                        onDragStart={(e) => { e.dataTransfer.setData('text/plain', card.id); e.dataTransfer.effectAllowed = 'move'; setArrastando(card.id); }}
                        onDragEnd={() => setArrastando(null)}
                        onClick={() => setCartaoAberto(card.id)}
                        className={cn('cursor-grab rounded-lg border border-grafite-elevado bg-grafite p-4 shadow-sm transition-opacity hover:border-roxo-eletrico/40 active:cursor-grabbing', arrastando === card.id && 'opacity-40')}
                      >
                        <div className="flex items-start gap-3">
                          <EntityAvatar name={card.name} kind={card.clientId ? 'client' : 'person'} size="md" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-base font-semibold text-branco-cru">{card.name}</p>
                            {card.valor && <p className="font-mono text-sm text-sinal">{card.valor}</p>}
                          </div>
                        </div>
                        <p className="mt-2.5 line-clamp-2 text-sm text-nevoa">{card.nota}</p>
                        <div className="mt-3 flex items-center justify-between gap-2 border-t border-grafite-elevado/60 pt-2.5">
                          <span className="truncate text-xs text-nevoa">{card.responsavel}</span>
                          <span className="flex shrink-0 items-center gap-2 text-xs text-nevoa">
                            {anexos > 0 && <span className="flex items-center gap-0.5"><Paperclip size={12} /> {anexos}</span>}
                            {formatRelativeTime(card.atualizadoEm)}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {criandoCartao && (
        <NovoCartaoModal
          board={board}
          onCreate={(entrada) => criarCartao.mutate({ boardId: board.id, ...entrada })}
          onClose={() => setCriandoCartao(false)}
        />
      )}
      {criandoPipeline && (
        <NovaPipelineModal
          onCreate={(entrada) => criarPipeline.mutate(entrada, { onSuccess: (novo) => setBoardId(novo.id) })}
          onClose={() => setCriandoPipeline(false)}
        />
      )}
      {configurando && (
        <ConfigurarPipelineModal
          board={board}
          onSave={(stages) => atualizarPipeline.mutate({ boardId: board.id, stages })}
          onClose={() => setConfigurando(false)}
        />
      )}
      {cartaoSelecionado && (
        <CartaoDetalheModal
          card={cartaoSelecionado}
          anexos={cartaoSelecionado.anexos}
          enviando={enviandoAnexo}
          onAnexar={(files) => void anexarArquivos(cartaoSelecionado.id, files)}
          onRemoverAnexo={(anexoId) => removerAnexo(cartaoSelecionado.id, anexoId)}
          onSalvar={(campos) => atualizarCartao.mutate({ boardId: board.id, cardId: cartaoSelecionado.id, ...campos })}
          onApagar={() => {
            apagarCartao.mutate({ boardId: board.id, cardId: cartaoSelecionado.id });
            setCartaoAberto(null);
          }}
          onClose={() => setCartaoAberto(null)}
        />
      )}
    </div>
  );
}
