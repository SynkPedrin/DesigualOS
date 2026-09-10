import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { createLogger } from '@desigual-os/logging';
import type { AgentName } from '@desigual-os/types';
import { requireEnv } from './env';
import * as schema from './schema/index';

const logger = createLogger({ service: 'database:seed' });

const AGENTS: Array<{ name: AgentName; displayName: string; description: string }> = [
  { name: 'bento', displayName: 'Bento', description: 'Inteligência institucional da agência.' },
  { name: 'jarbas', displayName: 'Jarbas', description: 'Performance e tráfego pago.' },
  { name: 'suzy', displayName: 'Suzy', description: 'Social selling e comunicação.' },
  { name: 'studio', displayName: 'Studio', description: 'Criação multimídia em GPU.' },
  { name: 'otto', displayName: 'Otto', description: 'Direção criativa e inteligência criativa.' },
];

const ROLES: Array<{ name: 'master' | 'colaborador'; description: string }> = [
  { name: 'master', description: 'Administrador master, vê e opera tudo.' },
  { name: 'colaborador', description: 'Usa agentes, sem ações administrativas.' },
];

// Matriz de permissões do Tool Gateway (seção 6.6 do prompt mestre).
const AGENT_TOOLS: Array<{
  agent: (typeof AGENTS)[number]['name'];
  tool: string;
  access: 'none' | 'read' | 'write';
  requiresApproval?: boolean;
}> = [
  { agent: 'bento', tool: 'clickup', access: 'write' },
  // Deletar tarefa é o exemplo citado na seção 6.6 (ação crítica), diferente
  // de criar tarefa: precisa de aprovação de um master antes de executar
  // (ver packages/tool-gateway/src/gateway.ts).
  { agent: 'bento', tool: 'clickup.delete_task', access: 'write', requiresApproval: true },
  { agent: 'bento', tool: 'studio', access: 'write' },
  { agent: 'bento', tool: 'obsidian', access: 'read' },
  { agent: 'bento', tool: 'meta_ads', access: 'none' },
  { agent: 'bento', tool: 'instagram', access: 'none' },

  // requiresApproval:true aqui não era o caso até 08/09/2026: a matriz
  // permitia write sem aprovação pra mexer em budget real de cliente, e o
  // "[AGUARDA_APROVACAO]" do prompt (personalities.ts) não tinha nenhuma
  // barreira técnica correspondente - era confiança cega no LLM externo.
  // Ver requestToolCall/extractApprovalProposal (gateway.ts, text.ts) para
  // o enforcement de verdade.
  { agent: 'jarbas', tool: 'meta_ads', access: 'write', requiresApproval: true },
  { agent: 'jarbas', tool: 'google_ads', access: 'write' },
  { agent: 'jarbas', tool: 'clickup', access: 'write' },
  { agent: 'jarbas', tool: 'studio', access: 'write' },

  { agent: 'suzy', tool: 'instagram', access: 'write', requiresApproval: true },
  { agent: 'suzy', tool: 'whatsapp', access: 'write' },
  { agent: 'suzy', tool: 'clickup', access: 'write' },
  { agent: 'suzy', tool: 'meta_ads', access: 'none' },

  { agent: 'studio', tool: 'gpu', access: 'write' },
  { agent: 'studio', tool: 'storage', access: 'write' },
  { agent: 'studio', tool: 'clickup', access: 'write' },
  { agent: 'studio', tool: 'instagram', access: 'write', requiresApproval: true },

  // Otto entrega trabalho de execução visual pro Studio e lê o contexto de
  // clientes no Obsidian (mesmo mínimo coerente do Bento); clickup pra
  // registrar o acompanhamento das campanhas que ele concebe.
  { agent: 'otto', tool: 'studio', access: 'write' },
  { agent: 'otto', tool: 'obsidian', access: 'read' },
  { agent: 'otto', tool: 'clickup', access: 'write' },
];

// RBAC de usuário (seção 6.8), separado da matriz de ferramentas por agente
// acima. master é curinga; colaborador tem acesso operacional, sem admin.
const PERMISSIONS: Array<{ role: 'master' | 'colaborador'; resource: string; action: string }> = [
  { role: 'master', resource: '*', action: '*' },

  { role: 'colaborador', resource: 'chat', action: 'write' },
  { role: 'colaborador', resource: 'executions', action: 'read' },
  { role: 'colaborador', resource: 'clients', action: 'read' },
  // Projetos (clientes) são compartilhados pela equipe agora (pedido do
  // usuário, 2026-09-03): colaborador também cria projeto, não só master.
  { role: 'colaborador', resource: 'clients', action: 'write' },
  { role: 'colaborador', resource: 'studio', action: 'write' },
  { role: 'colaborador', resource: 'knowledge', action: 'read' },
  { role: 'colaborador', resource: 'clickup', action: 'write' },
];

async function main(): Promise<void> {
  const connectionString = requireEnv('DATABASE_URL');
  const client = postgres(connectionString, { ssl: 'require', prepare: false, max: 1 });
  const db = drizzle(client, { schema });

  // onConflictDoNothing().returning() só devolve as linhas que ELE inseriu
  // agora, não as que já existiam. Re-rodar o seed depois de adicionar um
  // 5º agente só inseria esse (os outros 4 já existem, "conflitam" e saem
  // do returning()) e o fallback "sem nada inserido, busca tudo" nunca
  // disparava porque insertedAgents.length > 0 (tinha 1 item, o novo) -
  // agentsByName ficava só com o agente novo, e o loop de agent_tools
  // quebrava achando que bento/jarbas/suzy/studio não existiam. Sempre
  // buscar tudo do banco depois do insert resolve isso sem depender de
  // quantas linhas o insert realmente afetou.
  logger.info('Seeding agents');
  await db.insert(schema.agents).values(AGENTS).onConflictDoNothing({ target: schema.agents.name });
  const agentsByName = new Map((await db.select().from(schema.agents)).map((agent) => [agent.name, agent]));

  logger.info('Seeding roles');
  await db.insert(schema.roles).values(ROLES).onConflictDoNothing({ target: schema.roles.name });
  const rolesByName = new Map((await db.select().from(schema.roles)).map((role) => [role.name, role]));

  logger.info('Seeding RBAC permissions');
  for (const entry of PERMISSIONS) {
    const role = rolesByName.get(entry.role);
    if (!role) {
      throw new Error(`Role ${entry.role} was not seeded before permissions`);
    }
    await db
      .insert(schema.permissions)
      .values({ roleId: role.id, resource: entry.resource, action: entry.action })
      .onConflictDoNothing({ target: [schema.permissions.roleId, schema.permissions.resource, schema.permissions.action] });
  }

  logger.info('Seeding agent_tools permission matrix');
  for (const entry of AGENT_TOOLS) {
    const agent = agentsByName.get(entry.agent);
    if (!agent) {
      throw new Error(`Agent ${entry.agent} was not seeded before agent_tools`);
    }
    await db
      .insert(schema.agentTools)
      .values({
        agentId: agent.id,
        tool: entry.tool,
        access: entry.access,
        requiresApproval: entry.requiresApproval ?? false,
      })
      .onConflictDoNothing({ target: [schema.agentTools.agentId, schema.agentTools.tool] });
  }

  // Backfill de segurança: onConflictDoNothing acima NUNCA atualiza uma
  // linha que já existia (ex: banco seedado antes de 08/09/2026, quando
  // jarbas/meta_ads e suzy/instagram entraram sem requiresApproval). Sem
  // isto, rodar o seed de novo num banco já populado não corrigia nada -
  // a matriz continuava permitindo a ação sem aprovação em produção.
  logger.info('Corrigindo requiresApproval em linhas de agent_tools já existentes (backfill de segurança)');
  const criticalTools: Array<{ agent: 'jarbas' | 'suzy'; tool: string }> = [
    { agent: 'jarbas', tool: 'meta_ads' },
    { agent: 'suzy', tool: 'instagram' },
  ];
  for (const { agent: agentName, tool } of criticalTools) {
    const agent = agentsByName.get(agentName);
    if (!agent) continue;
    await db
      .update(schema.agentTools)
      .set({ requiresApproval: true })
      .where(and(eq(schema.agentTools.agentId, agent.id), eq(schema.agentTools.tool, tool)));
  }

  logger.info('Seed complete');
  await client.end();
}

main().catch((error: unknown) => {
  logger.error({ error }, 'Seed failed');
  process.exit(1);
});
