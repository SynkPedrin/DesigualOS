/**
 * O INVENTÁRIO REAL DAS FERRAMENTAS DO MCP.
 *
 * Extraído do código de `apps/mcp/src/tools/` em 29/09/2026 — nome, escopo,
 * nível de acesso e descrição são os que estão lá, não uma lista plausível.
 *
 * POR QUE UMA CONSTANTE E NÃO UMA CHAMADA: o servidor MCP não está publicado.
 * Ele foi commitado como incompleto e deixado fora do deploy de propósito
 * (sem teste, token inválido devolvendo 500, OAuth nunca exercitado ponta a
 * ponta). Sem servidor no ar não existe fonte viva pra consultar, e um fetch
 * que falha em silêncio seria pior que uma lista que declara a própria origem.
 *
 * No dia em que ele subir, isto vira uma chamada ao próprio servidor e este
 * arquivo morre. Até lá, quem lê a tela de Ferramentas está vendo o que existe
 * escrito, com o aviso de que nada disso está servindo ainda.
 */

export interface FerramentaMcp {
  nome: string;
  escopo: string;
  acesso: 'READ' | 'WRITE';
  descricao: string;
}

export const FERRAMENTAS_MCP: FerramentaMcp[] = [
  { nome: 'get_client_context', escopo: 'clients.read', acesso: 'READ', descricao: 'O RESUMO OPERACIONAL de um cliente, pronto para trabalhar: quem é, o que está aberto, o que está atrasado,' },
  { nome: 'get_client_recent_events', escopo: 'clients.read', acesso: 'READ', descricao: 'O que aconteceu com este cliente recentemente, na ordem em que aconteceu.' },
  { nome: 'search_clients', escopo: 'clients.read', acesso: 'READ', descricao: 'Procura clientes da agência pelo nome. Devolve só os clientes da organização desta pessoa.' },
  { nome: 'get_current_organization', escopo: 'desigual.read', acesso: 'READ', descricao: 'A organização (agência) a que este funcionário pertence, e o tamanho da carteira dela.' },
  { nome: 'get_current_permissions', escopo: 'desigual.read', acesso: 'READ', descricao: 'O que esta pessoa pode fazer pelo Desigual OS: scopes efetivos e o teto do papel dela.' },
  { nome: 'get_current_user', escopo: 'desigual.read', acesso: 'READ', descricao: 'Quem é o funcionário que está falando com você agora: nome, e-mail, papel na agência e organização.' },
  { nome: 'get_health', escopo: 'desigual.read', acesso: 'READ', descricao: 'Saúde do Desigual OS: banco, ClickUp, memória, event store, e as chamadas MCP das últimas 24h.' },
  { nome: 'get_recent_changes', escopo: 'desigual.read', acesso: 'READ', descricao: 'O que MUDOU na operação num período — não o que está aberto. Vem do histórico próprio do Desigual OS.' },
  { nome: 'get_recent_events', escopo: 'desigual.read', acesso: 'READ', descricao: 'O que mudou na agência recentemente, por todo mundo. Responde "o que aconteceu hoje?" e "o que mudou desde ontem?".' },
  { nome: 'get_client_preferences', escopo: 'memory.read', acesso: 'READ', descricao: 'O que a agência já aprendeu sobre como este cliente gosta de ser atendido: preferências, restrições e vetos.' },
  { nome: 'get_recent_decisions', escopo: 'memory.read', acesso: 'READ', descricao: 'As últimas decisões registradas, com data e autor. Responde "qual foi a última decisão tomada para essa campanha?".' },
  { nome: 'recall', escopo: 'memory.read', acesso: 'READ', descricao: 'Busca a memória institucional da agência: decisões, regras, preferências de cliente, aprendizados.' },
  { nome: 'search_memory', escopo: 'memory.read', acesso: 'READ', descricao: 'Procura na memória institucional da agência: decisões, aprendizados, preferências de cliente e feedback registrado.' },
  { nome: 'log_operational_event', escopo: 'memory.write', acesso: 'WRITE', descricao: 'Registra na memória da agência algo que ACONTECEU e que outro funcionário vai precisar saber depois:' },
  { nome: 'log_work', escopo: 'memory.write', acesso: 'WRITE', descricao: 'Registra que um trabalho foi concluído, para que os colegas e o gestor vejam.' },
  { nome: 'remember', escopo: 'memory.write', acesso: 'WRITE', descricao: 'Registra conhecimento durável da agência: uma decisão, uma regra, uma preferência de cliente, um aprendizado.' },
  { nome: 'save_client_feedback', escopo: 'memory.write', acesso: 'WRITE', descricao: 'Guarda um retorno que o CLIENTE deu, com as palavras dele. Ex.: "não querem mais comunicação promocional agressiva".' },
  { nome: 'save_learning', escopo: 'memory.write', acesso: 'WRITE', descricao: 'Guarda um aprendizado de processo da agência: o que funcionou, o que não funcionou, o que evitar da próxima vez.' },
  { nome: 'get_blockers', escopo: 'tasks.read', acesso: 'READ', descricao: 'O que está travando a operação: tarefas atrasadas sem responsável, e tarefas antigas sem prazo definido.' },
  { nome: 'get_client_operation', escopo: 'tasks.read', acesso: 'READ', descricao: 'O estado operacional de UM cliente: tarefas abertas, atrasadas, sem dono, aguardando aprovação, e quem sustenta.' },
  { nome: 'get_employee_context', escopo: 'tasks.read', acesso: 'READ', descricao: 'O que uma pessoa da equipe tem na mão: carga, clientes, tarefas atrasadas. Responde "quem está segurando isso?"' },
  { nome: 'get_employee_workload', escopo: 'tasks.read', acesso: 'READ', descricao: 'Quanta coisa cada pessoa da equipe tem em aberto, e quanto disso está atrasado. Responde "quem está sobrecarregado?".' },
  { nome: 'get_my_tasks', escopo: 'tasks.read', acesso: 'READ', descricao: 'As tarefas que estão com ESTE funcionário. Use quando ele perguntar "o que eu tenho para hoje?".' },
  { nome: 'get_operation_overview', escopo: 'tasks.read', acesso: 'READ', descricao: 'O estado da agência inteira agora: carteira, trabalho interno separado, atrasos, tarefas sem responsável,' },
  { nome: 'get_operation_summary', escopo: 'tasks.read', acesso: 'READ', descricao: 'O panorama da operação inteira: quantas tarefas abertas, quantas atrasadas, quantas sem dono, e a distribuição por cliente.' },
  { nome: 'get_overdue_tasks', escopo: 'tasks.read', acesso: 'READ', descricao: 'As tarefas que passaram do prazo e continuam abertas, da mais atrasada para a menos.' },
  { nome: 'get_task', escopo: 'tasks.read', acesso: 'READ', descricao: 'Uma tarefa específica, com status, responsável, prazo e comentários.' },
  { nome: 'search_tasks', escopo: 'tasks.read', acesso: 'READ', descricao: 'Procura tarefas da agência. Filtra por cliente, por texto no título, por janela de prazo e por atraso.' },
  { nome: 'add_task_comment', escopo: 'tasks.write', acesso: 'WRITE', descricao: 'Registra um comentário na tarefa. Use para deixar decisão, contexto ou retorno de cliente onde o trabalho está.' },
  { nome: 'complete_task', escopo: 'tasks.write', acesso: 'WRITE', descricao: 'Marca uma tarefa como concluída. Relê depois para confirmar que o status mudou de verdade.' },
  { nome: 'create_task', escopo: 'tasks.write', acesso: 'WRITE', descricao: 'Cria uma tarefa para um cliente. ANTES de criar, procura tarefa equivalente e PARA se encontrar algo parecido —' },
  { nome: 'update_task', escopo: 'tasks.write', acesso: 'WRITE', descricao: 'Altera uma tarefa que JÁ EXISTE: título, briefing, prazo, prioridade, status ou responsável.' },
  { nome: 'get_campaign_performance', escopo: 'traffic.read', acesso: 'READ', descricao: 'Desempenho de mídia de um cliente: investimento, impressões, cliques, CTR, CPC, leads, CPL e conversões, quando existirem.' },
];

/** Agrupa por escopo, que é como a permissão é concedida — não por arquivo. */
export function porEscopo(lista: FerramentaMcp[] = FERRAMENTAS_MCP): Map<string, FerramentaMcp[]> {
  const mapa = new Map<string, FerramentaMcp[]>();
  for (const f of lista) {
    const atual = mapa.get(f.escopo);
    if (atual) atual.push(f);
    else mapa.set(f.escopo, [f]);
  }
  return mapa;
}
