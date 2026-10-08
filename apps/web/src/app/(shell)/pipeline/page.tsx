'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, FileText, Paperclip, Plus, Settings2, SquareKanban, Upload, X } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { EntityAvatar } from '@/components/ui/entity-avatar';
import {
  usePipelines,
  useCriarPipeline,
  useAtualizarPipeline,
  useCriarCartao,
  useMoverCartao,
} from '@/hooks/use-pipelines';
import type { PipelineBoardWire } from '@/lib/api/contracts';
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
              <label className="mb-1 block text-xs text-nevoa">Estágios — só os status que existem no ClickUp</label>
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
                title={stage.clickupStatus ? 'Nome vem do status do ClickUp — não dá pra editar aqui' : undefined}
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
  onAnexar,
  onRemoverAnexo,
  onClose,
}: {
  card: PipelineCard;
  anexos: AnexoLocal[];
  onAnexar: (files: FileList) => void;
  onRemoverAnexo: (id: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'Visão geral' | 'Demandas' | 'Tarefas' | 'Arquivos' | 'Anexos'>('Visão geral');
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
          {tab === 'Visão geral' && (
            <div className="space-y-3 text-sm">
              {card.valor && <p className="text-sinal">{card.valor}</p>}
              <p className="text-branco-cru">{card.nota}</p>
              {card.clientId && (
                <Link href={`/clients?id=${card.clientId}`} className="inline-block text-sm text-roxo-eletrico hover:underline">
                  Abrir ficha completa do cliente →
                </Link>
              )}
            </div>
          )}
          {tab === 'Demandas' && card.clientId && <ClientDemandsPanel clientId={card.clientId} />}
          {tab === 'Tarefas' && card.clientId && <ClientTasksPanel clientId={card.clientId} clickupUrl={null} />}
          {tab === 'Arquivos' && card.clientId && <ClientStudioGallery clientId={card.clientId} />}
          {tab === 'Anexos' && (
            <div className="space-y-3">
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-grafite-elevado py-6 text-sm text-nevoa transition-colors hover:border-roxo-eletrico/50 hover:text-branco-cru">
                <Upload size={16} />
                Anexar imagem, PDF, Word, PowerPoint...
                <input
                  type="file"
                  multiple
                  accept="image/*,.pdf,.doc,.docx,.ppt,.pptx"
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
  const moverCartaoMut = useMoverCartao();

  const { boards, cards } = useMemo(() => daApi(data?.boards ?? []), [data]);
  /** Selo de "da agência" / "meu", direto do servidor. */
  const escopoPorQuadro = useMemo(
    () => new Map((data?.boards ?? []).map((b) => [b.id, b.escopo] as const)),
    [data],
  );

  const [boardIdEscolhido, setBoardId] = useState<string | null>(null);
  const [anexosPorCartao, setAnexosPorCartao] = useState<Record<string, AnexoLocal[]>>({});
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
  const cartaoSelecionado = cards.find((c) => c.id === cartaoAberto) ?? null;

  function moverCartao(cardId: string, novoEstagio: string) {
    const card = cards.find((c) => c.id === cardId);
    if (!card || !board) return;
    moverCartaoMut.mutate(
      { boardId: board.id, cardId, stage_id: novoEstagio },
      {
        onError: (erro) =>
          toast(`Não consegui mover "${card.name}": ${erro instanceof Error ? erro.message : 'erro desconhecido'}`, 'error'),
      },
    );
    if (board.tipo === 'tarefas') {
      const stage = board.stages.find((s) => s.id === novoEstagio);
      toast(`"${card.name}" → ${stage?.label ?? novoEstagio} — status atualizado no ClickUp.`, 'success');
    }
  }

  if (isPending) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader eyebrow="Operação" title="Pipelines" description="Cliente, tarefas do ClickUp ou carga da equipe — cada quadro do seu jeito." />
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
        <PageHeader eyebrow="Operação" title="Pipelines" description="Cliente, tarefas do ClickUp ou carga da equipe — cada quadro do seu jeito." />
        <EmptyState
          icon={SquareKanban}
          title="Não consegui carregar seus quadros"
          description={error instanceof Error ? error.message : 'A API não respondeu. Tente de novo em instantes.'}
        />
      </div>
    );
  }

  if (!board) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader eyebrow="Operação" title="Pipelines" description="Cliente, tarefas do ClickUp ou carga da equipe — cada quadro do seu jeito." />
        <EmptyState
          icon={SquareKanban}
          title="Nenhum quadro ainda"
          description="Crie o primeiro. Um quadro pessoal é seu e só seu — você organiza as colunas do jeito que funciona pra você. O da agência todo mundo da empresa vê."
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

  function anexarArquivos(cardId: string, files: FileList) {
    const novos: AnexoLocal[] = Array.from(files).map((f) => ({ id: `anexo-${Date.now()}-${f.name}`, nome: f.name, url: URL.createObjectURL(f), tipo: f.type }));
    setAnexosPorCartao((atual) => ({ ...atual, [cardId]: [...(atual[cardId] ?? []), ...novos] }));
  }

  function removerAnexo(cardId: string, anexoId: string) {
    setAnexosPorCartao((atual) => ({ ...atual, [cardId]: (atual[cardId] ?? []).filter((a) => a.id !== anexoId) }));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <PageHeader
          eyebrow="Operação"
          title="Pipelines"
          description="Cliente, tarefas do ClickUp ou carga da equipe — cada quadro do seu jeito."
          actions={
            <div className="flex items-center gap-2">
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

      <div className="mt-4 flex min-h-0 flex-1 gap-4 overflow-x-auto pb-2">
        {board.stages.map((stage) => {
          const cartoesDoEstagio = cartoesDoBoard.filter((c) => c.stageId === stage.id);
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
                <span className="rounded-full bg-grafite-elevado px-2.5 py-1 text-xs font-semibold text-nevoa">{cartoesDoEstagio.length}</span>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto p-3">
                {cartoesDoEstagio.length === 0 ? (
                  <p className="py-6 text-center text-sm text-nevoa">Nenhum cartão aqui.</p>
                ) : (
                  cartoesDoEstagio.map((card) => {
                    const anexos = anexosPorCartao[card.id]?.length ?? 0;
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
          anexos={anexosPorCartao[cartaoSelecionado.id] ?? []}
          onAnexar={(files) => anexarArquivos(cartaoSelecionado.id, files)}
          onRemoverAnexo={(anexoId) => removerAnexo(cartaoSelecionado.id, anexoId)}
          onClose={() => setCartaoAberto(null)}
        />
      )}
    </div>
  );
}
