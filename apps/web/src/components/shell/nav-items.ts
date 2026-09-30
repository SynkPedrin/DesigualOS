import {
  Activity,
  BarChart3,
  Bot,
  BookOpen,
  Boxes,
  Brain,
  CheckSquare,
  ClipboardCheck,
  Coins,
  Gauge,
  GitBranch,
  Heart,
  History,
  Inbox,
  KeyRound,
  LayoutDashboard,
  MessageSquare,
  Plug,
  ScrollText,
  ShieldAlert,
  Settings,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

/**
 * A navegação do CONTROL PLANE.
 *
 * Reposicionamento do produto (29/09/2026): o Desigual OS deixa de ser "mais um
 * chat de IA" e passa a ser a camada por trás — memória, contexto, permissão,
 * auditoria e saúde da inteligência da agência. O Claude continua sendo onde a
 * equipe trabalha; aqui é onde se vê e se controla o que ele pode fazer.
 *
 * O que isso significa pra esta lista, e é a decisão que mais pesa: NADA foi
 * deletado. Chat, agentes, Studio, automações e as telas de engenharia
 * continuam existindo, nas mesmas rotas, e mudaram de LUGAR — foram pra seção
 * INTERNO, no fim. Quebrar rota de um produto que a equipe já usa pra melhorar
 * a primeira impressão seria trocar um problema real por um estético.
 *
 * A ordem das seções é a ordem da pergunta que alguém faz ao abrir o sistema:
 * como está agora (VISÃO GERAL), o que ele sabe (INTELIGÊNCIA), o que ele pode
 * (CONTROLE), com o que ele fala (SISTEMA), e só então o motor (INTERNO).
 */

export type NavSection = 'overview' | 'intelligence' | 'control' | 'system' | 'internal';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  section: NavSection;
  /** Some backend permissions (costs:read, nodes:read) are master-only, colaborador gets 403.
   * Hide the nav item rather than let a colaborador hit an error. */
  masterOnly?: boolean;
  /**
   * A página existe e a fonte de dado dela ainda não. Marcada aqui pra que a
   * sidebar possa dizer isso ANTES do clique — descobrir que uma tela está
   * vazia depois de entrar nela é a forma mais cara de descobrir.
   */
  semDadoAinda?: boolean;
}

export const NAV_SECTIONS: Array<{ id: NavSection; label: string }> = [
  { id: 'overview', label: 'Visão geral' },
  { id: 'intelligence', label: 'Inteligência' },
  { id: 'control', label: 'Controle' },
  { id: 'system', label: 'Sistema' },
  { id: 'internal', label: 'Interno' },
];

export const NAV_ITEMS: NavItem[] = [
  // VISÃO GERAL — o estado agora.
  { href: '/', label: 'Overview', icon: LayoutDashboard, section: 'overview' },
  { href: '/activity', label: 'Atividade', icon: Activity, section: 'overview' },
  { href: '/health', label: 'Saúde', icon: Heart, section: 'overview' },

  // INTELIGÊNCIA — o que o sistema sabe.
  { href: '/memory', label: 'Memória', icon: Brain, section: 'intelligence' },
  { href: '/decisions', label: 'Decisões', icon: ScrollText, section: 'intelligence' },
  { href: '/clients', label: 'Clientes', icon: Users, section: 'intelligence' },
  { href: '/people', label: 'Pessoas', icon: Users, section: 'intelligence' },

  // CONTROLE — o que ele pode fazer, e o que já fez.
  { href: '/mcp', label: 'MCP', icon: Plug, section: 'control' },
  { href: '/tools', label: 'Ferramentas', icon: Wrench, section: 'control' },
  { href: '/permissions', label: 'Permissões', icon: KeyRound, section: 'control' },
  { href: '/audit', label: 'Auditoria', icon: ShieldCheck, section: 'control' },
  { href: '/errors', label: 'Incidentes', icon: TriangleAlert, section: 'control' },

  // SISTEMA — com o que ele fala, e quanto custa.
  { href: '/integrations', label: 'Integrações', icon: Boxes, section: 'system' },
  // Só master: é manutenção do cadastro, não operação.
  { href: '/data-quality', label: 'Qualidade do dado', icon: ShieldAlert, section: 'system', masterOnly: true },
  { href: '/usage', label: 'Uso', icon: Gauge, section: 'system' },
  { href: '/settings', label: 'Configurações', icon: Settings, section: 'system' },

  /**
   * INTERNO — o motor. Continua inteiro, nas mesmas rotas, só deixou de ser a
   * primeira coisa que alguém vê. O chat do Bento em especial: ele não some, e
   * quem usa continua chegando nele em dois cliques.
   */
  { href: '/chat', label: 'Console do Bento', icon: MessageSquare, section: 'internal' },
  { href: '/agents', label: 'Agentes', icon: Bot, section: 'internal' },
  { href: '/workflows', label: 'Automações', icon: GitBranch, section: 'internal' },
  { href: '/studio', label: 'Studio', icon: Sparkles, section: 'internal' },
  { href: '/messages', label: 'Mensagens', icon: Inbox, section: 'internal' },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare, section: 'internal' },
  { href: '/history', label: 'Histórico', icon: History, section: 'internal' },
  { href: '/knowledge', label: 'Conhecimento', icon: BookOpen, section: 'internal' },
  { href: '/analytics', label: 'Analytics', icon: BarChart3, section: 'internal' },
  { href: '/costs', label: 'Tokens & Custos', icon: Coins, section: 'internal', masterOnly: true },
  { href: '/monitoring', label: 'Monitoramento', icon: Activity, section: 'internal', masterOnly: true },
  // Fila de aprovação humana do Tool Gateway (budget de Meta Ads, publicação
  // no Instagram, deletar task do ClickUp) - só master aprova (`requirePermission('tool_calls','approve')`).
  { href: '/approvals', label: 'Aprovações', icon: ClipboardCheck, section: 'internal', masterOnly: true },
  { href: '/admin', label: 'Admin', icon: ShieldCheck, section: 'internal', masterOnly: true },
];
