import {
  Activity,
  BarChart3,
  Bot,
  BookOpen,
  Boxes,
  Brain,
  Building2,
  Calendar,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  Coins,
  ContactRound,
  Gauge,
  GitBranch,
  Heart,
  History,
  KeyRound,
  LayoutDashboard,
  Megaphone,
  MessageSquare,
  Plug,
  Radar,
  ScrollText,
  ShieldAlert,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareKanban,
  Sun,
  TriangleAlert,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { WorkspaceModule } from '@desigual-os/types';

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

/**
 * EM QUAL CONTEXTO o item aparece.
 *
 * O produto tem dois modos, e eles respondem perguntas diferentes:
 *
 *   provider  Pedro na conta Desigual: os clientes DELE e as empresas que vende.
 *   tenant    Pedro DENTRO de uma empresa: a operação daquela empresa.
 *
 * 'ambos' é o default — a maioria das telas serve aos dois. O que muda é o que
 * só faz sentido em um: "Empresas" é do provedor (um tenant não vende tenants);
 * "Equipe" e "Conhecimento" fazem sentido nos dois, mas recortados.
 */
export type ContextoDeNavegacao = 'provider' | 'tenant' | 'ambos';

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
  /**
   * Onde este item aparece. Default 'ambos'. `administracao: true` tira o item
   * da navegação comercial sem apagar a rota — ele passa a viver em
   * Configurações → Administração, para quem der suporte.
   */
  contexto?: ContextoDeNavegacao;
  /**
   * FERRAMENTA TÉCNICA. Continua existindo, no mesmo endereço, e sai da
   * navegação de quem usa o produto para trabalhar.
   *
   * A régua: o item some se entendê-lo exigir saber o que é MCP, embedding,
   * fila, episódio de agente ou evento operacional. O briefing é explícito —
   * o usuário precisa entender Empresa, Cliente, Equipe, Claude, ClickUp,
   * Atividade, Conhecimento e Bento. Nada além disso.
   */
  administracao?: boolean;
  /**
   * Workspace Builder (§5-13 do prompt de refinamento, 06/10/2026): o módulo
   * que precisa estar no workspace desta pessoa (GET /me/workspace) pra este
   * item aparecer. `undefined` = item sempre visível pra quem já passa pelos
   * outros gates acima — nem todo item da navegação tem um módulo
   * configurável por trás (ex.: Configurações).
   */
  modulo?: WorkspaceModule;
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
  /**
   * AJUSTES ficam à vista, e isso é correção de um defeito medido em
   * 02/10/2026: com a navegação reduzida a nove itens, "Integrações" e
   * "Configurações" continuavam dentro de uma seção que NASCIA RECOLHIDA. O
   * teste de navegador não achou o link de Integrações — e o usuário também
   * não acharia. Seção recolhida fazia sentido com vinte e três itens
   * técnicos; com dois itens de ajuste, ela só esconde.
   */
  {
    id: 'sistema',
    label: 'Ajustes',
    ajuda: 'Conecte ferramentas e configure a conta.',
  },
  /**
   * Vazia na navegação comercial — tudo que vivia aqui virou `administracao` e
   * mora em Configurações → Administração. A seção fica declarada porque as
   * rotas continuam existindo e o tipo as referencia.
   */
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
  // "o que eu preciso fazer agora?" (P1-L, 06/10/2026) — pessoal, não
  // confundir com "Visão geral" logo abaixo (essa é da operação inteira,
  // pra quem supervisiona; "Hoje" é a fila de quem produz).
  { href: '/today', label: 'Hoje', icon: Sun, section: 'dia', modulo: 'hoje' },
  // "qual é a minha semana?" (Calendar Core, 06/10/2026).
  { href: '/calendar', label: 'Calendário', icon: Calendar, section: 'dia', modulo: 'calendario' },
  // "como estamos agora?"
  { href: '/', label: 'Visão geral', icon: LayoutDashboard, section: 'dia' },
  // "tem algo pegando fogo?"
  { href: '/signals', label: 'Sinais', icon: Radar, section: 'dia', administracao: true },
  // Só o provedor: some da barra para quem é de uma empresa cliente.
  { href: '/organizations', label: 'Empresas', icon: Building2, section: 'dia', providerOnly: true, contexto: 'provider' },
  // "como está a conta do cliente X?"
  { href: '/clients', label: 'Clientes', icon: Users, section: 'dia', modulo: 'clientes' },
  // "o cliente mandou mensagem, alguém já viu?" (P1-A/C, 06/10/2026)
  { href: '/inbox', label: 'Inbox', icon: MessageSquare, section: 'dia', modulo: 'inbox' },
  // "o que o cliente pediu, e em que pé está?" (P1-D/E/F/G, 06/10/2026)
  // Continua em /demands e na tabela `demands` por baixo — renomear a rota/
  // schema seria mexer num dado de produção já estável só por rótulo, risco
  // que ninguém decidiu correr (08/10/2026). O que muda é só o que a pessoa
  // lê: cada "demanda" agora é o espaço de uma campanha — briefing, arquivos
  // e histórico, vinculados ao cliente.
  { href: '/demands', label: 'Campanhas', icon: ClipboardList, section: 'dia', modulo: 'demandas' },
  // Mídia paga (Meta/Google Ads) — módulo 'meta_ads' já existia e já gateava
  // 15 rotas sem item de navegação próprio (vivia só na aba Mídia da ficha do
  // cliente). Ganha página própria em 08/10/2026 (desigualos-4a) — "Mídias",
  // nunca "Campanhas", porque esse nome já é a tela acima.
  { href: '/midias', label: 'Mídias', icon: Megaphone, section: 'dia', modulo: 'meta_ads' },
  // Pipeline comercial (demo "dia real de operação", 07/10/2026): lead →
  // proposta → onboarding → ativo/pausado, quadro Kanban em /pipeline.
  { href: '/pipeline', label: 'Pipeline', icon: SquareKanban, section: 'dia' },
  // "quem tem acesso a isto, e com que poder?" (07/10/2026) — DESFAZ a troca
  // feita de manhã, que pôs "Contatos" (a aba de contatos de WhatsApp da
  // Inbox) nesta vaga e tirou a Equipe da barra. Contatos de WhatsApp
  // continuam onde sempre estiveram, dentro da Inbox; o que não tinha porta
  // nenhuma era a gestão de quem entra no sistema — e ela é diária quando se
  // está montando a operação, não eventual. É em /people que agora moram
  // convite, papel, ativação e os módulos de cada pessoa.
  // `masterOnly`, e não `modulo: 'equipe'` (decisão do usuário, 08/10/2026).
  // A Equipe deixou de ser uma tela que se liga por workspace e passou a ser
  // tela de ADMINISTRAÇÃO: é lá que se convida gente, troca papel e desativa
  // conta. Com o módulo, bastava o template "Gestão" para um colaborador ver
  // a lista — o que é defensável e não é o que se quis. Papel é a régua.
  { href: '/people', label: 'Equipe', icon: ContactRound, section: 'dia', masterOnly: true },
  // Fila pessoal de trabalho sobre o TaskProvider (P1-H, 06/10/2026) — antes
  // só alcançável via Configurações → Administração (`administracao: true`),
  // o que escondia a "Central de Tasks" exatamente de quem mais usa ela no
  // dia a dia (Design, Tráfego). `requirePermission` já era aberto a
  // colaborador; só a navegação estava fechada.
  { href: '/tasks', label: 'Tarefas', icon: CheckSquare, section: 'dia', modulo: 'tarefas' },
  // Duas filas na mesma tela (P1-I/J, 06/10/2026): a de tool-call da IA
  // (budget de Meta Ads, publicação no Instagram, deletar task do ClickUp) -
  // só master vê, `requirePermission('tool_calls','approve')` - e a de
  // recurso de negócio (brief, peça, campanha), que colaborador também usa
  // (`requirePermission('approvals','read'|'write')`). masterOnly saiu daqui
  // porque esconderia a segunda fila de quem precisa aprovar um brief.
  { href: '/approvals', label: 'Aprovações', icon: ClipboardCheck, section: 'dia', modulo: 'aprovacoes' },

  // O QUE O SISTEMA SABE. Dois itens: o acervo e o que já foi fechado.
    /**
   * "MEMÓRIA" ERA NOME DE INFRAESTRUTURA. Quem usa o produto não quer abrir a
   * memória de um sistema: quer ver o que a empresa aprendeu. O briefing é
   * explícito em remover a palavra do produto — a rota continua /memory,
   * porque mudar endereço quebraria link antigo sem ganho nenhum.
   *
   * SÓ NO CONTEXTO DA PROVEDORA (05/10/2026). É ferramenta de quem opera a
   * plataforma por dentro — dentro de um tenant, seja o provedor visitando
   * seja quem é da empresa, a barra mostra a operação e Conhecimento não faz
   * parte dela. Mesmo par de gates de "Empresas": providerOnly tira quem não
   * é provedor, contexto 'provider' tira o provedor que está dentro de tenant.
   */
  { href: '/memory', label: 'Conhecimento', icon: Brain, section: 'dia', providerOnly: true, contexto: 'provider' },
  { href: '/decisions', label: 'Decisões', icon: ScrollText, section: 'conhecimento', administracao: true },

  /**
   * SISTEMA — recolhido. Nada aqui é urgente num dia normal, e tudo aqui é
   * essencial no dia em que algo quebra.
   */
  { href: '/health', label: 'Saúde', icon: Heart, section: 'sistema', administracao: true },
  { href: '/activity', label: 'Atividade', icon: Activity, section: 'dia' },
  // "MCP" é sigla de protocolo. Quem supervisiona quer saber quais Claudes
  // estão plugados no sistema — então é esse o nome.
  { href: '/mcp', label: 'Claudes conectados', icon: Plug, section: 'sistema', administracao: true },
  { href: '/tools', label: 'Ferramentas do Claude', icon: Wrench, section: 'sistema', administracao: true },
  { href: '/permissions', label: 'Permissões', icon: KeyRound, section: 'sistema', administracao: true },
  { href: '/audit', label: 'Auditoria', icon: ShieldCheck, section: 'sistema', administracao: true },
  { href: '/errors', label: 'Incidentes', icon: TriangleAlert, section: 'sistema', administracao: true },
  { href: '/integrations', label: 'Integrações', icon: Boxes, section: 'sistema', modulo: 'integracoes' },
  { href: '/data-quality', label: 'Qualidade do dado', icon: ShieldAlert, section: 'sistema', masterOnly: true, administracao: true },
  { href: '/usage', label: 'Uso', icon: Gauge, section: 'sistema', administracao: true },
  // Engine e tela já existiam (`/automations`, `/workflows`), só escondidas da
  // navegação comercial atrás de `administracao: true` — promovida ao
  // Workspace Builder em vez de recriada (§67 do prompt "CALENDAR +
  // AUTOMATIONS + BENTO V2", 06/10/2026). Opcional pro colaborador comum,
  // incluída nos templates de gestão.
  { href: '/workflows', label: 'Automações', icon: GitBranch, section: 'sistema', modulo: 'automations' },
  { href: '/settings', label: 'Configurações', icon: Settings, section: 'sistema' },

  /**
   * INTERNO — o motor, recolhido e INTEIRO. O chat do Bento em especial: ele
   * não sumiu, continua em /chat, e quem usa chega nele em dois cliques.
   */
  { href: '/chat', label: 'Bento', icon: MessageSquare, section: 'dia', modulo: 'bento' },
  { href: '/agents', label: 'Agentes', icon: Bot, section: 'interno', administracao: true },
  { href: '/studio', label: 'Studio', icon: Sparkles, section: 'interno', administracao: true },
  /**
   * "Histórico do Bento", e não "Histórico": esta tela mostra as EXECUÇÕES dos
   * agentes — o que o Bento e os outros fizeram, por quem foi pedido e como
   * terminou. "Histórico" sozinho não dizia de quê.
   *
   * `/messages` (conversa entre pessoas do time) saiu da barra: não é
   * supervisão de operação e disputava espaço com o que é. A rota continua
   * existindo e funcionando — quem tiver o link chega nela.
   */
  { href: '/history', label: 'Histórico do Bento', icon: History, section: 'interno', administracao: true },
  { href: '/knowledge', label: 'Conhecimento', icon: BookOpen, section: 'interno', administracao: true },
  { href: '/analytics', label: 'Analytics', icon: BarChart3, section: 'interno', administracao: true },
  { href: '/costs', label: 'Tokens & Custos', icon: Coins, section: 'interno', masterOnly: true, administracao: true },
  { href: '/monitoring', label: 'Monitoramento', icon: Activity, section: 'interno', masterOnly: true, administracao: true },
  { href: '/admin', label: 'Admin', icon: ShieldCheck, section: 'interno', masterOnly: true, administracao: true },
];
