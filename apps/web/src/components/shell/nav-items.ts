import {
  Activity,
  BarChart3,
  Bot,
  BookOpen,
  Boxes,
  Brain,
  Building2,
  CheckSquare,
  ClipboardCheck,
  Coins,
  Gauge,
  GitBranch,
  Heart,
  History,
  KeyRound,
  LayoutDashboard,
  MessageSquare,
  Plug,
  Radar,
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
 * A NAVEGAÇÃO, reorganizada para quem SUPERVISIONA a operação (30/09/2026).
 *
 * O que estava errado, e a culpa é de como eu vinha trabalhando: a cada
 * necessidade eu ACRESCENTAVA uma tela. Chegou a quase trinta itens visíveis de
 * uma vez. Trinta portas abertas não é poder de escolha — é a pessoa não saber
 * por onde começar, e um supervisor com pressa fecha o sistema e volta pro
 * ClickUp.
 *
 * A correção não é apagar nada. NENHUMA rota foi removida: tudo continua
 * existindo, no mesmo endereço, e alcançável. O que muda é o que aparece SEM
 * pedir. As seções técnicas nascem recolhidas, e quem precisa delas abre.
 *
 * A pergunta que organiza a lista deixou de ser "que partes o sistema tem" e
 * passou a ser "o que um supervisor faz num dia":
 *
 *   1. algo pegou fogo?            -> Visão geral, Sinais
 *   2. como está a operação?       -> Clientes, Equipe
 *   3. o que o sistema aprendeu?   -> Memória, Decisões
 *   4. e o motor?                  -> recolhido, para quem for mexer nele
 *
 * Seis itens de saída, contra vinte e nove. O resto continua a um clique.
 */

export type NavSection = 'dia' | 'conhecimento' | 'sistema' | 'interno';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  section: NavSection;
  /** Some backend permissions (costs:read, nodes:read) are master-only, colaborador gets 403.
   * Hide the nav item rather than let a colaborador hit an error. */
  masterOnly?: boolean;
  /**
   * Só para quem opera no nível da PLATAFORMA (o provedor). Diferente de
   * `masterOnly`: master é papel forte dentro de uma empresa; provider é quem
   * atende várias. O administrador de um cliente é master da empresa dele e
   * NÃO deve ver a lista de empresas do provedor — que é a carteira comercial.
   */
  providerOnly?: boolean;
}

export interface NavSectionDef {
  id: NavSection;
  label: string;
  /**
   * Nasce recolhida. É o que separa "o que eu uso" de "o que existe": as duas
   * seções de baixo somam vinte e três itens e servem a quem foi caçar uma
   * coisa específica, não a quem abriu o sistema para trabalhar.
   */
  recolhida?: boolean;
  /** Uma linha dizendo para que serve. Rótulo sozinho não ensina ninguém. */
  ajuda?: string;
}

export const NAV_SECTIONS: NavSectionDef[] = [
  { id: 'dia', label: 'Operação', ajuda: 'O que precisa de você hoje.' },
  { id: 'conhecimento', label: 'Inteligência', ajuda: 'O que o sistema aprendeu e decidiu.' },
  {
    id: 'sistema',
    label: 'Sistema',
    recolhida: true,
    ajuda: 'Saúde, permissões e integrações. Abra quando algo não estiver batendo.',
  },
  {
    id: 'interno',
    label: 'Ferramentas internas',
    recolhida: true,
    ajuda: 'O motor: chat, agentes, Studio e automações.',
  },
];

export const NAV_ITEMS: NavItem[] = [
  /**
   * O DIA. Quatro itens, e cada um responde uma pergunta que alguém faz em voz
   * alta na agência.
   */
  // "como estamos agora?"
  { href: '/', label: 'Visão geral', icon: LayoutDashboard, section: 'dia' },
  // "tem algo pegando fogo?"
  { href: '/signals', label: 'Sinais', icon: Radar, section: 'dia' },
  // Só o provedor: some da barra para quem é de uma empresa cliente.
  { href: '/organizations', label: 'Empresas', icon: Building2, section: 'dia', providerOnly: true },
  // "como está a conta do cliente X?"
  { href: '/clients', label: 'Clientes', icon: Users, section: 'dia' },
  // "quem está fazendo o quê?" — antes se chamava "Pessoas", que descrevia o
  // cadastro; "Equipe" descreve o que o supervisor procura.
  { href: '/people', label: 'Equipe', icon: Users, section: 'dia' },

  // O QUE O SISTEMA SABE. Dois itens: o acervo e o que já foi fechado.
  { href: '/memory', label: 'Memória', icon: Brain, section: 'conhecimento' },
  { href: '/decisions', label: 'Decisões', icon: ScrollText, section: 'conhecimento' },

  /**
   * SISTEMA — recolhido. Nada aqui é urgente num dia normal, e tudo aqui é
   * essencial no dia em que algo quebra.
   */
  { href: '/health', label: 'Saúde', icon: Heart, section: 'sistema' },
  { href: '/activity', label: 'Atividade', icon: Activity, section: 'sistema' },
  // "MCP" é sigla de protocolo. Quem supervisiona quer saber quais Claudes
  // estão plugados no sistema — então é esse o nome.
  { href: '/mcp', label: 'Claudes conectados', icon: Plug, section: 'sistema' },
  { href: '/tools', label: 'Ferramentas do Claude', icon: Wrench, section: 'sistema' },
  { href: '/permissions', label: 'Permissões', icon: KeyRound, section: 'sistema' },
  { href: '/audit', label: 'Auditoria', icon: ShieldCheck, section: 'sistema' },
  { href: '/errors', label: 'Incidentes', icon: TriangleAlert, section: 'sistema' },
  { href: '/integrations', label: 'Integrações', icon: Boxes, section: 'sistema' },
  { href: '/data-quality', label: 'Qualidade do dado', icon: ShieldAlert, section: 'sistema', masterOnly: true },
  { href: '/usage', label: 'Uso', icon: Gauge, section: 'sistema' },
  { href: '/settings', label: 'Configurações', icon: Settings, section: 'sistema' },

  /**
   * INTERNO — o motor, recolhido e INTEIRO. O chat do Bento em especial: ele
   * não sumiu, continua em /chat, e quem usa chega nele em dois cliques.
   */
  { href: '/chat', label: 'Console do Bento', icon: MessageSquare, section: 'interno' },
  { href: '/agents', label: 'Agentes', icon: Bot, section: 'interno' },
  { href: '/workflows', label: 'Automações', icon: GitBranch, section: 'interno' },
  { href: '/studio', label: 'Studio', icon: Sparkles, section: 'interno' },
  { href: '/tasks', label: 'Tarefas', icon: CheckSquare, section: 'interno' },
  /**
   * "Histórico do Bento", e não "Histórico": esta tela mostra as EXECUÇÕES dos
   * agentes — o que o Bento e os outros fizeram, por quem foi pedido e como
   * terminou. "Histórico" sozinho não dizia de quê.
   *
   * `/messages` (conversa entre pessoas do time) saiu da barra: não é
   * supervisão de operação e disputava espaço com o que é. A rota continua
   * existindo e funcionando — quem tiver o link chega nela.
   */
  { href: '/history', label: 'Histórico do Bento', icon: History, section: 'interno' },
  { href: '/knowledge', label: 'Conhecimento', icon: BookOpen, section: 'interno' },
  { href: '/analytics', label: 'Analytics', icon: BarChart3, section: 'interno' },
  { href: '/costs', label: 'Tokens & Custos', icon: Coins, section: 'interno', masterOnly: true },
  { href: '/monitoring', label: 'Monitoramento', icon: Activity, section: 'interno', masterOnly: true },
  // Fila de aprovação humana do Tool Gateway (budget de Meta Ads, publicação
  // no Instagram, deletar task do ClickUp) - só master aprova (`requirePermission('tool_calls','approve')`).
  { href: '/approvals', label: 'Aprovações', icon: ClipboardCheck, section: 'interno', masterOnly: true },
  { href: '/admin', label: 'Admin', icon: ShieldCheck, section: 'interno', masterOnly: true },
];
