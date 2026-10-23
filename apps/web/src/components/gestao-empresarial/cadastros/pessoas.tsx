'use client';

import { useState } from 'react';
import { Archive, Pencil, Plus, RotateCcw, Search, X } from 'lucide-react';
import { InlineSectionError } from '@/components/ui/inline-section-error';
import { BOTAO, BOTAO_SECUNDARIO, Campo, CAMPO, Carregando, Dialogo, Paginacao, Selo, Tabela, TD, TH, Vazio, mensagemDeErro } from '../kit';
import { PAPEIS, ROTULO_PAPEL, useAcoesDePessoa, usePessoa, usePessoas, type Papel, type PessoaWire } from '@/hooks/use-gestao-cadastros';
import { toast } from '@/stores/toast-store';
import { cn } from '@/lib/utils';

/** CPF/CNPJ com máscara só para ler; o que vale para o sistema são os dígitos. */
export function mascararDocumento(p: Pick<PessoaWire, 'document' | 'documentKind' | 'rawDocument'>): string {
  const d = p.document;
  if (!d) return '';
  if (p.documentKind === 'cpf') return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (p.documentKind === 'cnpj') return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return p.rawDocument ?? d;
}

function SeloDeDocumento({ p }: { p: PessoaWire }) {
  if (!p.document) return <span className="text-nevoa/60">Sem documento</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="tabular-nums">{mascararDocumento(p)}</span>
      {p.documentValid === false && <Selo classe="bg-red-500/15 text-red-500">Documento inválido</Selo>}
    </span>
  );
}

interface Config {
  role: Papel;
  singular: string;
  plural: string;
  novo: string;
  tipoDeMidia?: boolean;
}

export function PessoasTela({ role, singular, plural, novo, tipoDeMidia }: Config) {
  const [busca, setBusca] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | 'ativo' | 'inativo'>('');
  const [semDocumento, setSemDocumento] = useState(false);
  const [documentoInvalido, setDocumentoInvalido] = useState(false);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<{ id: string | null } | null>(null);
  const lista = usePessoas({ role, status: status || undefined, q: q || undefined, semDocumento, documentoInvalido, page });
  const { arquivar } = useAcoesDePessoa();
  const voltar = (f: () => void) => { f(); setPage(1); };

  function alternar(p: PessoaWire) {
    const arquivando = p.status === 'ativo';
    arquivar.mutate({ id: p.id, arquivar: arquivando }, {
      onSuccess: () => toast(arquivando ? `${p.name} foi arquivado. O histórico dele continua.` : `${p.name} foi reativado.`, 'success'),
      onError: (e) => toast(mensagemDeErro(e), 'error'),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <form className="min-w-56 flex-1" role="search" onSubmit={(e) => { e.preventDefault(); voltar(() => setQ(busca.trim())); }}>
          <label htmlFor="busca-pessoas" className="sr-only">Buscar {plural}</label>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-nevoa" aria-hidden />
            <input id="busca-pessoas" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, razão social, e-mail ou documento" className={cn(CAMPO, 'pl-9')} />
          </div>
        </form>
        <div className="w-36">
          <label htmlFor="filtro-status" className="sr-only">Situação</label>
          <select id="filtro-status" value={status} onChange={(e) => voltar(() => setStatus(e.target.value as typeof status))} className={CAMPO}>
            <option value="">Todos</option>
            <option value="ativo">Ativos</option>
            <option value="inativo">Arquivados</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-nevoa"><input type="checkbox" checked={semDocumento} onChange={(e) => voltar(() => setSemDocumento(e.target.checked))} /> Sem documento</label>
        <label className="flex items-center gap-2 text-sm text-nevoa"><input type="checkbox" checked={documentoInvalido} onChange={(e) => voltar(() => setDocumentoInvalido(e.target.checked))} /> Documento inválido</label>
        <button type="button" onClick={() => setForm({ id: null })} className={BOTAO}><Plus size={14} aria-hidden /> {novo}</button>
      </div>

      {lista.isPending ? <Carregando /> : lista.isError ? <InlineSectionError message={`Não conseguimos carregar ${plural}.`} onRetry={() => void lista.refetch()} /> : lista.data.items.length === 0 ? (
        q || status || semDocumento || documentoInvalido
          ? <Vazio titulo="Nenhum resultado">Nenhum cadastro bate com esses filtros. Tire um filtro ou mude a busca.</Vazio>
          : <Vazio titulo={`Nenhum ${singular.toLowerCase()} cadastrado`}>Use “{novo}” para começar, ou importe os dados do Operand em Configurações.</Vazio>
      ) : (
        <>
          <Tabela legenda={plural}>
            <thead><tr className="border-b border-grafite-elevado"><th scope="col" className={TH}>Nome</th><th scope="col" className={TH}>Documento</th><th scope="col" className={TH}>Contato</th><th scope="col" className={TH}>Cidade</th><th scope="col" className={TH}>Papéis</th><th scope="col" className={TH}>Ações</th></tr></thead>
            <tbody>
              {lista.data.items.map((p) => (
                <tr key={p.id} className={cn('border-t border-grafite-elevado/60 hover:bg-grafite-elevado/40', p.status === 'inativo' && 'opacity-60')}>
                  <td className={TD}><span className="font-medium">{p.name}</span>{p.legalName && p.legalName !== p.name && <span className="block text-xs text-nevoa">{p.legalName}</span>}{p.status === 'inativo' && <Selo classe="mt-1">Arquivado</Selo>}</td>
                  <td className={TD}><SeloDeDocumento p={p} /></td>
                  <td className={TD}><span className="block">{p.email ?? <span className="text-nevoa/60">Sem e-mail</span>}</span><span className="block text-xs text-nevoa">{p.phone ?? 'Sem telefone'}</span></td>
                  <td className={TD}>{p.city ? `${p.city}${p.state ? ` / ${p.state}` : ''}` : p.state ?? <span className="text-nevoa/60">—</span>}</td>
                  <td className={TD}><span className="flex flex-wrap gap-1">{p.roles.map((r) => <Selo key={r} {...(r === role && { classe: 'bg-roxo-eletrico/15 text-roxo-eletrico' })}>{ROTULO_PAPEL[r]}</Selo>)}</span></td>
                  <td className={cn(TD, 'whitespace-nowrap text-right')}>
                    <button type="button" aria-label={`Editar ${p.name}`} onClick={() => setForm({ id: p.id })} className={cn(BOTAO_SECUNDARIO, 'px-2 py-1')}><Pencil size={14} /></button>{' '}
                    <button type="button" aria-label={`${p.status === 'ativo' ? 'Arquivar' : 'Reativar'} ${p.name}`} disabled={arquivar.isPending} onClick={() => alternar(p)} className={cn(BOTAO_SECUNDARIO, 'px-2 py-1')}>{p.status === 'ativo' ? <Archive size={14} /> : <RotateCcw size={14} />}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabela>
          <Paginacao page={lista.data.page} totalPages={lista.data.totalPages} total={lista.data.total} pageSize={lista.data.pageSize} onPage={setPage} />
        </>
      )}
      {form && <FormularioDePessoa id={form.id} role={role} singular={singular} tipoDeMidia={!!tipoDeMidia} onFechar={() => setForm(null)} />}
    </div>
  );
}

function FormularioDePessoa({ id, role, singular, tipoDeMidia, onFechar }: { id: string | null; role: Papel; singular: string; tipoDeMidia: boolean; onFechar: () => void }) {
  const existente = usePessoa(id);
  if (id && existente.isPending) return <Dialogo titulo={`Editar ${singular.toLowerCase()}`} onFechar={onFechar}><Carregando linhas={4} /></Dialogo>;
  if (id && (existente.isError || !existente.data)) return <Dialogo titulo={`Editar ${singular.toLowerCase()}`} onFechar={onFechar}><InlineSectionError onRetry={() => void existente.refetch()} /></Dialogo>;
  return <Corpo pessoa={id ? existente.data! : null} role={role} singular={singular} tipoDeMidia={tipoDeMidia} onFechar={onFechar} />;
}

function Corpo({ pessoa, role, singular, tipoDeMidia, onFechar }: { pessoa: PessoaWire | null; role: Papel; singular: string; tipoDeMidia: boolean; onFechar: () => void }) {
  const [v, setV] = useState({ name: pessoa?.name ?? '', legalName: pessoa?.legalName ?? '', document: pessoa?.rawDocument ?? pessoa?.document ?? '', email: pessoa?.email ?? '', phone: pessoa?.phone ?? '', city: pessoa?.city ?? '', state: pessoa?.state ?? '', notes: pessoa?.notes ?? '', mediaType: pessoa?.mediaType ?? '' });
  const [erro, setErro] = useState<string | null>(null);
  const [novoPapel, setNovoPapel] = useState<Papel | ''>('');
  const { criar, editar, adicionarPapel, removerPapel } = useAcoesDePessoa();
  const atual = usePessoa(pessoa?.id ?? null).data ?? pessoa;
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  const gravando = criar.isPending || editar.isPending;

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!v.name.trim()) return setErro('Informe o nome.');
    const corpo = { name: v.name, legalName: v.legalName, document: v.document, email: v.email, phone: v.phone, city: v.city, state: v.state, notes: v.notes, ...(tipoDeMidia && { mediaType: v.mediaType }) };
    const opcoes = { onSuccess: () => { toast(pessoa ? 'Cadastro atualizado.' : `${singular} cadastrado.`, 'success'); onFechar(); }, onError: (err: unknown) => setErro(mensagemDeErro(err)) };
    if (pessoa) editar.mutate({ id: pessoa.id, ...corpo }, opcoes);
    else criar.mutate({ ...corpo, roles: [role] }, opcoes);
  }

  const papeis = atual?.roles ?? [];
  const faltantes = PAPEIS.filter((p) => !papeis.includes(p));
  const mexer = (acao: () => void) => { setErro(null); acao(); };

  return (
    <Dialogo titulo={pessoa ? `Editar ${singular.toLowerCase()}` : `Novo ${singular.toLowerCase()}`} onFechar={onFechar} largura="max-w-xl">
      <form onSubmit={salvar} className="space-y-3" noValidate>
        {erro && <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-branco-cru">{erro}</p>}
        <Campo rotulo="Nome *">{(p) => <input {...p} required maxLength={200} value={v.name} onChange={set('name')} className={CAMPO} />}</Campo>
        <Campo rotulo="Razão social">{(p) => <input {...p} maxLength={200} value={v.legalName} onChange={set('legalName')} className={CAMPO} />}</Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="CPF ou CNPJ" ajuda="Se já existir um cadastro com este documento, o sistema não duplica.">{(p) => <input {...p} maxLength={32} value={v.document} onChange={set('document')} className={CAMPO} />}</Campo>
          <Campo rotulo="Telefone" ajuda="Com DDD.">{(p) => <input {...p} maxLength={40} value={v.phone} onChange={set('phone')} className={CAMPO} />}</Campo>
        </div>
        <Campo rotulo="E-mail">{(p) => <input {...p} type="email" maxLength={200} value={v.email} onChange={set('email')} className={CAMPO} />}</Campo>
        <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
          <Campo rotulo="Cidade">{(p) => <input {...p} maxLength={100} value={v.city} onChange={set('city')} className={CAMPO} />}</Campo>
          <Campo rotulo="UF">{(p) => <input {...p} maxLength={2} value={v.state} onChange={set('state')} className={cn(CAMPO, 'uppercase')} />}</Campo>
        </div>
        {tipoDeMidia && <Campo rotulo="Tipo de mídia" ajuda="Por exemplo: outdoor, rádio, jornal, TV.">{(p) => <input {...p} maxLength={60} value={v.mediaType} onChange={set('mediaType')} className={CAMPO} />}</Campo>}
        <Campo rotulo="Observações">{(p) => <textarea {...p} rows={2} maxLength={2000} value={v.notes} onChange={set('notes')} className={CAMPO} />}</Campo>

        {pessoa && (
          <fieldset className="space-y-2 rounded-md border border-grafite-elevado p-3">
            <legend className="px-1 text-xs text-nevoa">Papéis (a mesma empresa pode ser cliente e fornecedor)</legend>
            <div className="flex flex-wrap gap-1.5">
              {papeis.map((r) => (
                <Selo key={r} classe="bg-grafite-elevado text-branco-cru">
                  {ROTULO_PAPEL[r]}
                  <button type="button" aria-label={`Remover o papel ${ROTULO_PAPEL[r]}`} disabled={papeis.length <= 1 || removerPapel.isPending} title={papeis.length <= 1 ? 'Todo cadastro precisa ter ao menos um papel' : undefined} onClick={() => mexer(() => removerPapel.mutate({ id: pessoa.id, role: r }, { onError: (e) => setErro(mensagemDeErro(e)) }))} className="ml-1 rounded p-0.5 hover:text-red-500 disabled:opacity-30"><X size={12} /></button>
                </Selo>
              ))}
            </div>
            {faltantes.length > 0 && (
              <div className="flex gap-2">
                <label htmlFor="novo-papel" className="sr-only">Papel a acrescentar</label>
                <select id="novo-papel" value={novoPapel} onChange={(e) => setNovoPapel(e.target.value as Papel | '')} className={cn(CAMPO, 'max-w-56')}>
                  <option value="">Acrescentar papel…</option>
                  {faltantes.map((r) => <option key={r} value={r}>{ROTULO_PAPEL[r]}</option>)}
                </select>
                <button type="button" disabled={!novoPapel || adicionarPapel.isPending} onClick={() => mexer(() => adicionarPapel.mutate({ id: pessoa.id, role: novoPapel as Papel }, { onSuccess: () => setNovoPapel(''), onError: (e) => setErro(mensagemDeErro(e)) }))} className={BOTAO_SECUNDARIO}>Acrescentar</button>
              </div>
            )}
          </fieldset>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onFechar} className={BOTAO_SECUNDARIO}>Cancelar</button>
          <button type="submit" disabled={gravando} className={BOTAO}>{gravando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Dialogo>
  );
}
