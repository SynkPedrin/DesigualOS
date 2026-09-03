import type { AgentName } from '@desigual-os/types';

export interface KnowledgeSource {
  title: string;
  updatedLabel: string;
}

/** No backend endpoint for this yet (Context Engine, in progress). Representative only. */
export const SAMPLE_KNOWLEDGE_SOURCES: Record<AgentName, KnowledgeSource[]> = {
  bento: [
    { title: 'Institucional/FAQ.md', updatedLabel: 'Há 2 dias' },
    { title: 'Institucional/Processos Internos.md', updatedLabel: 'Há 5 dias' },
    { title: 'Institucional/Politicas.md', updatedLabel: 'Há 1 semana' },
  ],
  jarbas: [
    { title: 'Trafego/Contas de Anuncio.md', updatedLabel: 'Há 1 dia' },
    { title: 'Trafego/Benchmarks de CPA.md', updatedLabel: 'Há 3 dias' },
  ],
  suzy: [
    { title: 'Social/Tom de Voz.md', updatedLabel: 'Há 4 dias' },
    { title: 'Social/Scripts de Follow-up.md', updatedLabel: 'Há 6 dias' },
  ],
  studio: [
    { title: 'Criacao/Brand Kits.md', updatedLabel: 'Há 2 dias' },
    { title: 'Criacao/Referencias Visuais.md', updatedLabel: 'Há 1 semana' },
  ],
};
