import {
  Activity,
  BarChart3,
  Bot,
  BookOpen,
  ClipboardCheck,
  Coins,
  GitBranch,
  History,
  Inbox,
  LayoutDashboard,
  MessageSquare,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Some backend permissions (costs:read, nodes:read) are master-only, colaborador gets 403.
   * Hide the nav item rather than let a colaborador hit an error. */
  masterOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/chat', label: 'Chat', icon: MessageSquare },
  { href: '/messages', label: 'Mensagens', icon: Inbox },
  { href: '/agents', label: 'Agentes', icon: Bot },
  { href: '/clients', label: 'Clientes', icon: Users },
  { href: '/studio', label: 'Studio', icon: Sparkles },
  { href: '/workflows', label: 'Workflows', icon: GitBranch },
  { href: '/history', label: 'Histórico', icon: History },
  { href: '/knowledge', label: 'Conhecimento', icon: BookOpen },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/costs', label: 'Tokens & Custos', icon: Coins, masterOnly: true },
  { href: '/monitoring', label: 'Monitoramento', icon: Activity, masterOnly: true },
  // Fila de aprovação humana do Tool Gateway (budget de Meta Ads, publicação
  // no Instagram, deletar task do ClickUp) - só master aprova (`requirePermission('tool_calls','approve')`).
  { href: '/approvals', label: 'Aprovações', icon: ClipboardCheck, masterOnly: true },
  { href: '/admin', label: 'Admin', icon: ShieldCheck, masterOnly: true },
  { href: '/settings', label: 'Configurações', icon: Settings },
];
