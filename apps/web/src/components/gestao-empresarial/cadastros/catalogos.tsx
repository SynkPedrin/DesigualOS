'use client';

import { useState } from 'react';
import { Pencil, Plus, Power } from 'lucide-react';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { BOTAO, BOTAO_SECUNDARIO, Campo, CampoDinheiro, CAMPO, Carregando, Dialogo, Dinheiro, Selo, Tabela, TD, TH, Vazio, mensagemDeErro } from '../kit';
import { categorias, centros, servicos, type CategoriaWire, type CentroWire, type ServicoWire } from '@/hooks/use-gestao-cadastros';
import { toast } from '@/stores/toast-store';
import { cn } from '@/lib/utils';

function Cabecalho({ novo, onNovo, nota }: { novo: string; onNovo: () => void; nota?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-nevoa">{nota}</p>
      <button type="button" onClick={onNovo} className={BOTAO}><Plus size={14} aria-hidden /> {novo}</button>
    </div>
  );
}

function BotoesDeLinha({ nome, ativo, onEditar, onAlternar, ocupado }: { nome: string; ativo: boolean; onEditar: () => void; onAlternar: () => void; ocupado: boolean }) {
  return (
    <td className={cn(TD, 'whitespace-nowrap text-right')}>
      <button type="button" aria-label={`Editar ${nome}`} onClick={onEditar} className={cn(BOTAO_SECUNDARIO, 'px-2 py-1')}><Pencil size={14} /></button>{' '}
      <button type="button" aria-label={`${ativo ? 'Desativar' : 'Ativar'} ${nome}`} disabled={ocupado} onClick={onAlternar} className={cn(BOTAO_SECUNDARIO, 'px-2 py-1')}><Power size={14} /></button>
    </td>
  );
}

function Rodape({ erro, gravando, onFechar }: { erro: string | null; gravando: boolean; onFechar: () => void }) {
  return (
    <>
      {erro && <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-branco-cru">{erro}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onFechar} className={BOTAO_SECUNDARIO}>Cancelar</button>
        <button type="submit" disabled={gravando} className={BOTAO}>{gravando ? 'Salvando…' : 'Salvar'}</button>
      </div>
    </>
  );
}

const Situacao = ({ ativo }: { ativo: boolean }) => <Selo {...(ativo && { classe: 'bg-sucesso/15 text-sucesso' })}>{ativo ? 'Ativo' : 'Inativo'}</Selo>;

// ── Serviços ─────────────────────────────────────────────────────────────
export function ServicosTela() {
  const lista = servicos.useLista();
  const { criar, editar } = servicos.useAcoes();
  const [form, setForm] = useState<ServicoWire | 'novo' | null>(null);
  const alternar = (s: ServicoWire) => editar.mutate({ id: s.id, active: !s.active }, { onSuccess: () => toast(s.active ? `${s.name} desativado.` : `${s.name} ativado.`, 'success'), onError: (e) => toast(mensagemDeErro(e), 'error') });
  return (
    <div className="space-y-4">
      <Cabecalho novo="Novo serviço" onNovo={() => setForm('novo')} nota="O que a agência vende ou compra. O preço é uma sugestão para propostas, nunca uma regra." />
      {lista.isPending ? <Carregando /> : lista.isError ? <InlineSectionError message="Não conseguimos carregar os serviços." onRetry={() => void lista.refetch()} /> : lista.data.length === 0 ? (
        <Vazio titulo="Nenhum serviço cadastrado">Cadastre os serviços para escolhê-los ao montar propostas.</Vazio>
      ) : (
        <Tabela legenda="Serviços">
          <thead><tr className="border-b border-grafite-elevado"><th scope="col" className={TH}>Serviço</th><th scope="col" className={TH}>Tipo</th><th scope="col" className={TH}>Unidade</th><th scope="col" className={TH}>Preço sugerido</th><th scope="col" className={TH}>Situação</th><th scope="col" className={TH}>Ações</th></tr></thead>
          <tbody>
            {lista.data.map((s) => (
              <tr key={s.id} className={cn('border-t border-grafite-elevado/60 hover:bg-grafite-elevado/40', !s.active && 'opacity-60')}>
                <td className={cn(TD, 'font-medium')}>{s.name}</td>
                <td className={TD}>{s.kind === 'venda' ? 'Venda' : 'Compra'}</td>
                <td className={TD}>{s.unit ?? <span className="text-nevoa/60">—</span>}</td>
                <td className={TD}><Dinheiro centavos={s.defaultPriceCents} /></td>
                <td className={TD}><Situacao ativo={s.active} /></td>
                <BotoesDeLinha nome={s.name} ativo={s.active} ocupado={editar.isPending} onEditar={() => setForm(s)} onAlternar={() => alternar(s)} />
              </tr>
            ))}
          </tbody>
        </Tabela>
      )}
      {form && <FormServico servico={form === 'novo' ? null : form} onFechar={() => setForm(null)} criar={criar} editar={editar} />}
    </div>
  );
}

function FormServico({ servico, onFechar, criar, editar }: { servico: ServicoWire | null; onFechar: () => void; criar: ReturnType<typeof servicos.useAcoes>['criar']; editar: ReturnType<typeof servicos.useAcoes>['editar'] }) {
  const [nome, setNome] = useState(servico?.name ?? '');
  const [tipo, setTipo] = useState<'venda' | 'compra'>(servico?.kind ?? 'venda');
  const [unidade, setUnidade] = useState(servico?.unit ?? '');
  const [preco, setPreco] = useState<number | null>(servico?.defaultPriceCents ?? null);
  const [erro, setErro] = useState<string | null>(null);
  function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return setErro('Informe o nome do serviço.');
    const opcoes = { onSuccess: () => { toast(servico ? 'Serviço atualizado.' : 'Serviço cadastrado.', 'success'); onFechar(); }, onError: (x: unknown) => setErro(mensagemDeErro(x)) };
    if (servico) editar.mutate({ id: servico.id, name: nome, unit: unidade || null, defaultPriceCents: preco }, opcoes);
    else criar.mutate({ name: nome, kind: tipo, unit: unidade || null, defaultPriceCents: preco }, opcoes);
  }
  return (
    <Dialogo titulo={servico ? 'Editar serviço' : 'Novo serviço'} onFechar={onFechar}>
      <form onSubmit={salvar} className="space-y-3" noValidate>
        <Campo rotulo="Nome *">{(p) => <input {...p} required maxLength={200} value={nome} onChange={(e) => setNome(e.target.value)} className={CAMPO} />}</Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Tipo" ajuda={servico ? 'O tipo não muda depois de criado.' : undefined}>{(p) => <select {...p} value={tipo} disabled={!!servico} onChange={(e) => setTipo(e.target.value as 'venda' | 'compra')} className={CAMPO}><option value="venda">Venda</option><option value="compra">Compra</option></select>}</Campo>
          <Campo rotulo="Unidade" ajuda="Por exemplo: m², hora, diária.">{(p) => <input {...p} maxLength={30} value={unidade} onChange={(e) => setUnidade(e.target.value)} className={CAMPO} />}</Campo>
        </div>
        <CampoDinheiro rotulo="Preço sugerido" centavos={preco} onChange={setPreco} ajuda="Opcional." />
        <Rodape erro={erro} gravando={criar.isPending || editar.isPending} onFechar={onFechar} />
      </form>
    </Dialogo>
  );
}

// ── Categorias ───────────────────────────────────────────────────────────
export function CategoriasTela() {
  const lista = categorias.useLista();
  const { criar, editar } = categorias.useAcoes();
  const [form, setForm] = useState<CategoriaWire | 'nova' | null>(null);
  const alternar = (c: CategoriaWire) => editar.mutate({ id: c.id, active: !c.active }, { onSuccess: () => toast(c.active ? `${c.name} desativada.` : `${c.name} ativada.`, 'success'), onError: (e) => toast(mensagemDeErro(e), 'error') });
  const porId = new Map((lista.data ?? []).map((c) => [c.id, c]));
  return (
    <div className="space-y-4">
      <Cabecalho novo="Nova categoria" onNovo={() => setForm('nova')} nota="Classificam receitas e despesas nos relatórios. Desativar não apaga: o histórico continua." />
      {lista.isPending ? <Carregando /> : lista.isError ? <InlineSectionError message="Não conseguimos carregar as categorias." onRetry={() => void lista.refetch()} /> : lista.data.length === 0 ? (
        <Vazio titulo="Nenhuma categoria cadastrada">Crie categorias de receita e de despesa para o relatório de resultado fazer sentido.</Vazio>
      ) : (
        <Tabela legenda="Categorias">
          <thead><tr className="border-b border-grafite-elevado"><th scope="col" className={TH}>Categoria</th><th scope="col" className={TH}>Tipo</th><th scope="col" className={TH}>Dentro de</th><th scope="col" className={TH}>Situação</th><th scope="col" className={TH}>Ações</th></tr></thead>
          <tbody>
            {lista.data.map((c) => (
              <tr key={c.id} className={cn('border-t border-grafite-elevado/60 hover:bg-grafite-elevado/40', !c.active && 'opacity-60')}>
                <td className={cn(TD, 'font-medium')}>{c.name}</td>
                <td className={TD}><Selo classe={c.kind === 'receita' ? 'bg-sucesso/15 text-sucesso' : 'bg-aviso/15 text-branco-cru'}>{c.kind === 'receita' ? 'Receita' : 'Despesa'}</Selo></td>
                <td className={TD}>{c.parentId ? porId.get(c.parentId)?.name ?? '—' : <span className="text-nevoa/60">Nível principal</span>}</td>
                <td className={TD}><Situacao ativo={c.active} /></td>
                <BotoesDeLinha nome={c.name} ativo={c.active} ocupado={editar.isPending} onEditar={() => setForm(c)} onAlternar={() => alternar(c)} />
              </tr>
            ))}
          </tbody>
        </Tabela>
      )}
      {form && <FormCategoria categoria={form === 'nova' ? null : form} todas={lista.data ?? []} onFechar={() => setForm(null)} criar={criar} editar={editar} />}
    </div>
  );
}

function FormCategoria({ categoria, todas, onFechar, criar, editar }: { categoria: CategoriaWire | null; todas: CategoriaWire[]; onFechar: () => void; criar: ReturnType<typeof categorias.useAcoes>['criar']; editar: ReturnType<typeof categorias.useAcoes>['editar'] }) {
  const [nome, setNome] = useState(categoria?.name ?? '');
  const [tipo, setTipo] = useState<'receita' | 'despesa'>(categoria?.kind ?? 'receita');
  const [pai, setPai] = useState(categoria?.parentId ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const possiveisPais = todas.filter((c) => c.kind === tipo && !c.parentId);
  function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return setErro('Informe o nome da categoria.');
    const opcoes = { onSuccess: () => { toast(categoria ? 'Categoria atualizada.' : 'Categoria criada.', 'success'); onFechar(); }, onError: (x: unknown) => setErro(mensagemDeErro(x)) };
    if (categoria) editar.mutate({ id: categoria.id, name: nome }, opcoes);
    else criar.mutate({ name: nome, kind: tipo, parentId: pai || null }, opcoes);
  }
  return (
    <Dialogo titulo={categoria ? 'Editar categoria' : 'Nova categoria'} onFechar={onFechar}>
      <form onSubmit={salvar} className="space-y-3" noValidate>
        <Campo rotulo="Nome *">{(p) => <input {...p} required maxLength={120} value={nome} onChange={(e) => setNome(e.target.value)} className={CAMPO} />}</Campo>
        {!categoria && (
          <>
            <Campo rotulo="Tipo">{(p) => <select {...p} value={tipo} onChange={(e) => { setTipo(e.target.value as 'receita' | 'despesa'); setPai(''); }} className={CAMPO}><option value="receita">Receita</option><option value="despesa">Despesa</option></select>}</Campo>
            <Campo rotulo="Subcategoria de" ajuda="Deixe em branco para uma categoria principal.">{(p) => <select {...p} value={pai} onChange={(e) => setPai(e.target.value)} className={CAMPO}><option value="">Nenhuma (principal)</option>{possiveisPais.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Campo>
          </>
        )}
        {categoria && <p className="text-xs text-nevoa">Tipo e categoria pai não mudam depois de criados, para não reclassificar o histórico.</p>}
        <Rodape erro={erro} gravando={criar.isPending || editar.isPending} onFechar={onFechar} />
      </form>
    </Dialogo>
  );
}

// ── Centros de custo ─────────────────────────────────────────────────────
export function CentrosTela() {
  const lista = centros.useLista();
  const { criar, editar } = centros.useAcoes();
  const [form, setForm] = useState<CentroWire | 'novo' | null>(null);
  const alternar = (c: CentroWire) => editar.mutate({ id: c.id, active: !c.active }, { onSuccess: () => toast(c.active ? `${c.name} desativado.` : `${c.name} ativado.`, 'success'), onError: (e) => toast(mensagemDeErro(e), 'error') });
  return (
    <div className="space-y-4">
      <Cabecalho novo="Novo centro de custo" onNovo={() => setForm('novo')} nota="Agrupam gastos por área ou projeto. Desativar não apaga lançamentos antigos." />
      {lista.isPending ? <Carregando /> : lista.isError ? <InlineSectionError message="Não conseguimos carregar os centros de custo." onRetry={() => void lista.refetch()} /> : lista.data.length === 0 ? (
        <Vazio titulo="Nenhum centro de custo cadastrado">Crie um para acompanhar para onde vai cada gasto.</Vazio>
      ) : (
        <Tabela legenda="Centros de custo">
          <thead><tr className="border-b border-grafite-elevado"><th scope="col" className={TH}>Centro de custo</th><th scope="col" className={TH}>Situação</th><th scope="col" className={TH}>Ações</th></tr></thead>
          <tbody>
            {lista.data.map((c) => (
              <tr key={c.id} className={cn('border-t border-grafite-elevado/60 hover:bg-grafite-elevado/40', !c.active && 'opacity-60')}>
                <td className={cn(TD, 'font-medium')}>{c.name}</td>
                <td className={TD}><Situacao ativo={c.active} /></td>
                <BotoesDeLinha nome={c.name} ativo={c.active} ocupado={editar.isPending} onEditar={() => setForm(c)} onAlternar={() => alternar(c)} />
              </tr>
            ))}
          </tbody>
        </Tabela>
      )}
      {form && <FormCentro centro={form === 'novo' ? null : form} onFechar={() => setForm(null)} criar={criar} editar={editar} />}
    </div>
  );
}

function FormCentro({ centro, onFechar, criar, editar }: { centro: CentroWire | null; onFechar: () => void; criar: ReturnType<typeof centros.useAcoes>['criar']; editar: ReturnType<typeof centros.useAcoes>['editar'] }) {
  const [nome, setNome] = useState(centro?.name ?? '');
  const [erro, setErro] = useState<string | null>(null);
  function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return setErro('Informe o nome do centro de custo.');
    const opcoes = { onSuccess: () => { toast(centro ? 'Centro de custo atualizado.' : 'Centro de custo criado.', 'success'); onFechar(); }, onError: (x: unknown) => setErro(mensagemDeErro(x)) };
    if (centro) editar.mutate({ id: centro.id, name: nome }, opcoes);
    else criar.mutate({ name: nome }, opcoes);
  }
  return (
    <Dialogo titulo={centro ? 'Editar centro de custo' : 'Novo centro de custo'} onFechar={onFechar}>
      <form onSubmit={salvar} className="space-y-3" noValidate>
        <Campo rotulo="Nome *">{(p) => <input {...p} required maxLength={120} value={nome} onChange={(e) => setNome(e.target.value)} className={CAMPO} />}</Campo>
        <Rodape erro={erro} gravando={criar.isPending || editar.isPending} onFechar={onFechar} />
      </form>
    </Dialogo>
  );
}
