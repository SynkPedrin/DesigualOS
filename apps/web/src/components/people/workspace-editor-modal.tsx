'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useMemberWorkspace, useSaveMemberWorkspace, useWorkspaceTemplates } from '@/hooks/use-member-workspace';
import { ApiRequestError } from '@/lib/api/client';

/** Rótulo em português pra cada módulo — vocabulário técnico (WORKSPACE_MODULES) fica em @desigual-os/types. */
const ROTULO_DO_MODULO: Record<string, string> = {
  hoje: 'Hoje',
  clientes: 'Clientes',
  inbox: 'Inbox',
  demandas: 'Demandas',
  tarefas: 'Tarefas',
  aprovacoes: 'Aprovações',
  operacao: 'Controle da agência',
  integracoes: 'Integrações',
  studio: 'Studio',
  bento: 'Bento',
  meta_ads: 'Meta Ads (aba Mídia do cliente)',
  google_ads: 'Google Ads (aba Mídia do cliente)',
  calendario: 'Calendário',
  relatorios: 'Relatórios (aba Mídia do cliente)',
  automations: 'Automações',
};

/**
 * Workspace Builder (§5-13 do prompt de refinamento, 06/10/2026): escolher um
 * template pré-seleciona os módulos; editar os checkboxes depois NÃO muda o
 * template gravado (o backend só lembra qual deu origem à lista, pra
 * pré-selecionar da próxima vez — ver workspace_configs.ts). Salvar sempre
 * manda a lista INTEIRA: não existe "adicionar um módulo", existe "este é o
 * workspace completo desta pessoa agora".
 */
export function WorkspaceEditorModal({ userId, name, onClose }: { userId: string; name: string; onClose: () => void }) {
  const templates = useWorkspaceTemplates();
  const current = useMemberWorkspace(userId);
  const save = useSaveMemberWorkspace(userId);

  const [modules, setModules] = useState<Set<string>>(new Set());
  const [templateId, setTemplateId] = useState<string | null>(null);

  useEffect(() => {
    if (current.data) {
      setModules(new Set(current.data.modules));
      setTemplateId(current.data.template_id);
    }
  }, [current.data]);

  function aplicarTemplate(id: string) {
    const template = templates.data?.templates?.find((t) => t.id === id);
    if (!template) return;
    setTemplateId(id);
    setModules(new Set(template.modules));
  }

  function alternarModulo(modulo: string) {
    setModules((atual) => {
      const novo = new Set(atual);
      if (novo.has(modulo)) novo.delete(modulo);
      else novo.add(modulo);
      return novo;
    });
  }

  const carregando = templates.isPending || current.isPending;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-carbono/80 p-4">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="w-full max-w-md rounded-lg border border-grafite-elevado bg-grafite p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-heading text-sm font-semibold uppercase tracking-wider text-branco-cru">Workspace</h2>
            <p className="mt-0.5 text-[12px] text-nevoa">{name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded p-1 text-nevoa transition-colors hover:text-branco-cru">
            <X size={16} />
          </button>
        </div>

        {carregando ? (
          <p className="py-8 text-center text-sm text-nevoa">Carregando…</p>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-nevoa">Template</label>
              <select
                value={templateId ?? ''}
                onChange={(event) => (event.target.value ? aplicarTemplate(event.target.value) : setTemplateId(null))}
                className="w-full rounded-md border border-grafite-elevado bg-carbono px-3 py-2 text-sm text-branco-cru focus:border-roxo-eletrico/60 focus:outline-none"
              >
                <option value="">Personalizado</option>
                {(templates.data?.templates ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-nevoa">Módulos</label>
              <div className="grid grid-cols-2 gap-1.5">
                {(templates.data?.modules ?? []).map((modulo) => (
                  <label key={modulo} className="flex items-center gap-2 rounded-md border border-grafite-elevado px-2.5 py-1.5 text-[13px] text-branco-cru">
                    <input type="checkbox" checked={modules.has(modulo)} onChange={() => alternarModulo(modulo)} className="accent-roxo-eletrico" />
                    {ROTULO_DO_MODULO[modulo] ?? modulo}
                  </label>
                ))}
              </div>
            </div>

            {save.isError && (
              <p className="text-xs text-erro">{save.error instanceof ApiRequestError ? save.error.message : 'Não foi possível salvar o workspace.'}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-nevoa transition-colors hover:text-branco-cru">
                Cancelar
              </button>
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => save.mutate({ template_id: templateId, modules: [...modules] }, { onSuccess: onClose })}
                className="rounded-md bg-roxo-eletrico px-4 py-2 text-sm font-medium text-branco-cru transition-all hover:opacity-90 hover:shadow-glow disabled:opacity-50 disabled:hover:shadow-none"
              >
                {save.isPending ? 'Salvando…' : 'Salvar workspace'}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
