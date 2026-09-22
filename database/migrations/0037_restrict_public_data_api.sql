-- Application tables are accessed via Fastify/worker, not the public data API.
-- Explicit allowlist from the repository schema; auth/storage schemas untouched.
DO $$
DECLARE resource text; principal text;
BEGIN
  FOREACH resource IN ARRAY ARRAY['agent_episodes', 'agent_evidence', 'agent_execution_states', 'agent_messages', 'agent_outcomes', 'agent_tools', 'agents', 'audit_logs', 'automation_runs', 'automations', 'campaigns', 'clickup_lists', 'clickup_spaces', 'clickup_tasks', 'clickup_workspaces', 'client_brand_kits', 'client_knowledge_sync', 'client_users', 'clients', 'conversation_context', 'conversations', 'cost_records', 'direct_message_thread_prefs', 'direct_messages', 'economy_records', 'embeddings', 'execution_blackboards', 'execution_plans', 'execution_steps', 'executions', 'health_checks', 'integration_connections', 'integration_health', 'job_attempts', 'jobs', 'knowledge_chunks', 'knowledge_documents', 'knowledge_sources', 'memories', 'messages', 'model_usage', 'node_capabilities', 'nodes', 'notifications', 'operational_events', 'organization_members', 'organizations', 'people', 'permissions', 'person_client_relations', 'proactive_signals', 'project_files', 'projects', 'roles', 'router_decisions', 'studio_assets', 'studio_brand_kits', 'studio_canvas_documents', 'studio_jobs', 'studio_projects', 'system_events', 'token_usage', 'tool_calls', 'tool_results', 'user_roles', 'users', 'workflow_steps', 'workflows'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', resource);
    FOREACH principal IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = principal) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', resource, principal);
      END IF;
    END LOOP;
  END LOOP;
END $$;

