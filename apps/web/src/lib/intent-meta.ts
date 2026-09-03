const INTENT_LABELS: Record<string, string> = {
  faq_answer: 'Resposta de FAQ',
  document_summary: 'Resumo de documento',
  task_status: 'Status de tarefa',
  campaign_creation: 'Criação de campanha',
  campaign_report: 'Relatório de campanha',
  budget_analysis: 'Análise de orçamento',
  lead_followup: 'Follow-up de lead',
  content_suggestion: 'Sugestão de conteúdo',
  dm_reply_draft: 'Rascunho de resposta (DM)',
  creative_brief: 'Briefing de criativo',
  asset_variation: 'Variação de asset',
  chat_message: 'Conversa no chat',
};

export function intentLabel(intent: string): string {
  return INTENT_LABELS[intent] ?? intent.replace(/_/g, ' ');
}
