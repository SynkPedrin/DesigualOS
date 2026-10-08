/**
 * ENRIQUECIMENTO VISUAL DA FICHA DE CLIENTE (demo "dia real de operação",
 * 07/10/2026) — campos que o mockup "Clientes" pede (segmento, e-mail,
 * telefone, localização, observações, badges, cliente desde, responsável) e
 * que NENHUM contrato real carrega hoje (`ClientSummary`/`ClientWorkspace`
 * não têm esses campos — não são dado fake de produção, são preenchimento de
 * tela pra demo, isolado aqui e não em `lib/api/contracts.ts`). Cliente sem
 * entrada aqui cai no fallback genérico (ver `DEMO_CLIENT_INFO_FALLBACK`).
 */
export interface DemoClientInfo {
  clienteDesde: string;
  segmento: string;
  email: string;
  telefone: string;
  localizacao: string;
  observacoes: string;
  badges: string[];
  descricaoCurta: string;
}

export const DEMO_CLIENT_INFO: Record<string, DemoClientInfo> = {
  'client-cosentino': {
    clienteDesde: 'mar 2024',
    segmento: 'Revestimentos e superfícies',
    email: 'contato@cosentino.com',
    telefone: '+55 11 91234-5678',
    localizacao: 'São Paulo, SP',
    observacoes: 'Cliente estratégico. Foco em performance e geração de demanda para a linha de arquitetura e interiores.',
    badges: ['Arquitetura', 'Alto ticket', 'Brasil'],
    descricaoCurta: 'Referência global em superfícies inovadoras de alto valor para arquitetura e design.',
  },
  'client-g4-educacao': {
    clienteDesde: 'jun 2024',
    segmento: 'Educação executiva',
    email: 'parceria@g4educacao.com',
    telefone: '+55 11 93456-7890',
    localizacao: 'São Paulo, SP',
    observacoes: 'Campanhas recorrentes de lançamento de turma — janelas curtas, aprovação rápida é crítica.',
    badges: ['Educação', 'Performance'],
    descricaoCurta: 'Escola de negócios focada em formação executiva de alta performance.',
  },
  'client-clinica-bela': {
    clienteDesde: 'ago 2024',
    segmento: 'Estética e saúde',
    email: 'marketing@clinicabela.com.br',
    telefone: '+55 11 94567-8901',
    localizacao: 'Campinas, SP',
    observacoes: 'Prefere peças com tom acolhedor, sem jargão técnico.',
    badges: ['Saúde', 'Local'],
    descricaoCurta: 'Clínica de estética avançada com foco em procedimentos não invasivos.',
  },
  'client-autovisual': {
    clienteDesde: 'jan 2025',
    segmento: 'Estética automotiva',
    email: 'contato@autovisual.com.br',
    telefone: '+55 11 95678-9012',
    localizacao: 'São Paulo, SP',
    observacoes: 'Conteúdo em vídeo é o carro-chefe — cronograma de produção semanal.',
    badges: ['Automotivo', 'Vídeo'],
    descricaoCurta: 'Rede de estética automotiva premium com unidades na grande São Paulo.',
  },
};

export const DEMO_CLIENT_INFO_FALLBACK: DemoClientInfo = {
  clienteDesde: '—',
  segmento: '[CONFIRMAR: segmento]',
  email: '[CONFIRMAR: e-mail]',
  telefone: '[CONFIRMAR: telefone]',
  localizacao: '[CONFIRMAR: localização]',
  observacoes: 'Nenhuma observação registrada ainda.',
  badges: [],
  descricaoCurta: '',
};
