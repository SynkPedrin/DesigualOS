/**
 * Workspace Builder (Parte A do prompt de refinamento "FINAL PRODUCT
 * REFINEMENT", §5-13, 06/10/2026): o módulo que um colaborador vê na
 * navegação E pode de fato acionar na API — as duas coisas sempre juntas
 * (§79: esconder item de menu sem bloquear a rota não é controle de acesso).
 *
 * Lista FECHADA aos módulos que já têm uma rota/tela real por trás. O prompt
 * mestre cita mais nomes (Briefings, Arquivos, Criativos, Kanban, Jarbas,
 * Otto) que ainda não têm uma página ou endpoint próprio — criar um toggle
 * para eles seria fingir controle sobre algo que não existe (regra geral do
 * prompt: nada de UI falsa). Quando a tela nascer, o módulo entra aqui.
 */
export const WORKSPACE_MODULES = [
  'hoje',
  'clientes',
  'inbox',
  'demandas',
  'tarefas',
  'aprovacoes',
  'operacao',
  'integracoes',
  'calendario',
  'studio',
  'bento',
  /** Mídia paga — ganhou item de navegação próprio ("Mídias", /midias) em
   *  08/10/2026, além da aba "Mídia" já existente na ficha do cliente.
   *  Habilitar/desabilitar aqui decide se o item/aba aparece E se a API
   *  aceita a chamada — não só a primeira coisa. */
  'meta_ads',
  'google_ads',
  /** Relatórios PDF de performance (§46-51) — sem item de navegação próprio, vive na aba "Mídia" do cliente, como meta_ads/google_ads. */
  'relatorios',
  /** Automações agendadas (§67 do prompt "CALENDAR + AUTOMATIONS + BENTO V2",
   *  06/10/2026) — a engine (`/automations`) e a tela (`/workflows`) já
   *  existiam, só escondidas da navegação comercial atrás de `administracao:
   *  true`; este módulo é o que promove a tela pro produto. Opcional pro
   *  colaborador comum (fica de fora de MODULOS_PADRAO_COLABORADOR), incluído
   *  nos templates de gestão. */
  'automations',
] as const;

export type WorkspaceModule = (typeof WORKSPACE_MODULES)[number];

export function isWorkspaceModule(value: string): value is WorkspaceModule {
  return (WORKSPACE_MODULES as readonly string[]).includes(value);
}

export const WORKSPACE_TEMPLATES = {
  atendimento: {
    label: 'Atendimento',
    modules: ['hoje', 'clientes', 'inbox', 'demandas', 'aprovacoes', 'calendario', 'bento'],
  },
  trafego: {
    label: 'Gestor de Tráfego',
    modules: ['hoje', 'clientes', 'meta_ads', 'google_ads', 'relatorios', 'tarefas', 'calendario', 'bento'],
  },
  designer: {
    label: 'Designer',
    modules: ['hoje', 'demandas', 'tarefas', 'aprovacoes', 'studio', 'calendario', 'bento'],
  },
  editor_video: {
    label: 'Editor de Vídeo',
    modules: ['hoje', 'demandas', 'tarefas', 'aprovacoes', 'studio', 'calendario', 'bento'],
  },
  gestao: {
    label: 'Gestão',
    modules: ['hoje', 'clientes', 'inbox', 'demandas', 'tarefas', 'aprovacoes', 'operacao', 'meta_ads', 'google_ads', 'relatorios', 'integracoes', 'studio', 'calendario', 'bento', 'automations'],
  },
  administrador: {
    label: 'Administrador',
    modules: [...WORKSPACE_MODULES],
  },
} as const satisfies Record<string, { label: string; modules: readonly WorkspaceModule[] }>;

export type WorkspaceTemplateId = keyof typeof WORKSPACE_TEMPLATES;

export const WORKSPACE_TEMPLATE_IDS = Object.keys(WORKSPACE_TEMPLATES) as WorkspaceTemplateId[];

/**
 * O padrão de quem NUNCA foi configurado — não existe linha em
 * `workspace_configs` ainda. DELIBERADAMENTE DIFERENTE do template
 * "atendimento": aqui a régua é "o que a navegação já mostrava pra todo
 * colaborador ANTES do Workspace Builder existir" (hoje, clientes, inbox,
 * demandas, tarefas, aprovações, integrações, bento — nenhum tinha
 * masterOnly/administracao em nav-items.ts), não o recorte estreito que o
 * prompt pede pro papel de Atendimento. Ligar este recurso não pode destravar
 * nada, mas também não pode TRANCAR ninguém que já trabalhava — zero
 * colaborador perde acesso a algo que já usava só porque o Workspace Builder
 * nasceu. Mídia (meta_ads/google_ads), Operação e Studio ficam de fora do
 * padrão por serem capacidades novas ou já restritas, nunca por regressão.
 *
 * `calendario` ENTRA no padrão mesmo sendo novo (06/10/2026) — diferente de
 * mídia/operação/studio, não é uma capacidade sensível ou de nicho: o prompt
 * trata agenda como "camada temporal da operação" que toda pessoa tem (ver
 * exemplos de Jamille/Alicia/Gui), e não existe regressão possível pra um
 * módulo que não tinha tela nenhuma ontem.
 *
 * Master sempre vê tudo (equivalente ao template "administrador").
 */
const MODULOS_PADRAO_COLABORADOR: readonly WorkspaceModule[] = ['hoje', 'clientes', 'inbox', 'demandas', 'tarefas', 'aprovacoes', 'integracoes', 'calendario', 'bento'];

export function modulosPadrao(ehMaster: boolean): readonly WorkspaceModule[] {
  return ehMaster ? WORKSPACE_TEMPLATES.administrador.modules : MODULOS_PADRAO_COLABORADOR;
}
