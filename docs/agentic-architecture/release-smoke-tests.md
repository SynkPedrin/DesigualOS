# Release Smoke Tests — validação AO VIVO (na sua máquina)

Estes são os testes que NÃO puderam ser rodados no ambiente de implementação
(precisam de ClickUp/LLM/Supabase reais e, alguns, de ações de escrita). Rode num
**workspace de TESTE / Cliente Teste**, nunca destrutivamente em produção (§85).
Pré-requisitos: `.env` com credenciais de teste, `AGENT_LOOP_V2=bento,otto`,
worker + api rodando, migration `agent_evidence` aplicada.

Como inspecionar: cada resposta agêntica traz `metadata.agentic` com
`termination_reason`, `plan_steps` (com status), `evidence_count`, `claims`,
`ungrounded_facts`, `strategies_tried`. Use isso pra confirmar o comportamento.

## Bento
1. **Factual** — "Bento, quantas tarefas vencem hoje?"
   Esperado: consulta ClickUp real, `evidence_count > 0`, número correto, `claims`
   com fatos ligados a evidência, `ungrounded_facts = 0`.
2. **Por responsável** — "Quantas tarefas do Pedro?"
   Esperado: resolução de entidade (membro real), contagem correta, evidência.
3. **Create + read-back** — "Crie uma task de teste pro Pedro vencendo hoje."
   Esperado: recibo "VERIFICADA", `metadata.verified=true`, task existe com
   título/responsável/prazo conferidos por leitura.
4. **Idempotência** — repita o MESMO pedido do item 3.
   Esperado: NÃO cria duplicata; resposta "já existe uma task com esse nome".
5. **Briefing** — "Crie uma task e gere um briefing completo, anexe."
   Esperado: task criada, briefing anexado como comentário e `comment_verified=true`.
6. **Operations intelligence** — "Bento, como está a operação?"
   Esperado: caminho estruturado (briefing), PRIORIZAÇÃO com motivo, RISCOS,
   PRÓXIMAS AÇÕES — sem receber isso no prompt.
7. **Priorização** — "Bento, o que eu deveria priorizar hoje?"
   Esperado: ranking com motivo por item (§137).
8. **Autônomo** — "Organize minha operação; resolva o que puder e me traga só o que
   depende de mim." Esperado: trace com plan_steps executados, verificação, e só as
   decisões humanas retornadas.
9. **Replanning** — force uma tool a falhar (ex: task_id inválido).
   Esperado: `termination_reason` coerente (replan/dead-end), sem inventar.
10. **Grounding** — pergunte por um dado que não existe.
    Esperado: reconhece ausência; não inventa; `ungrounded_facts` não vira fato afirmado.

## Memória (multi-sessão)
11. **Persistência A→B** — Sessão 1: ensine uma preferência relevante do Cliente X.
    Sessão 2 (nova): pergunte algo relacionado. Esperado: memória recuperada.
12. **Isolamento** — repita para Cliente Y. Esperado: preferência de X NÃO aparece.
13. **Supersessão** — mude a preferência de X. Esperado: nova execução usa a atual.

## Otto
14. **Creative state / brand** — peça uma campanha para um cliente com DNA.
    Esperado: recupera brand/DNA; se faltar contexto, declara lacuna (não inventa).
15. **Research** — peça algo que dependa de dado atual de mercado.
    Esperado: pesquisa REAL (tool call), múltiplas fontes, evidência `type:web`.
16. **Quality + self-revision** — force uma copy genérica.
    Esperado: reprova na porta anti-genérico → replan → revisão; genérica
    persistente NÃO é entregue como aprovada.

## Regressão
17. **Jarbas** — pergunta de performance. Esperado: comportamento inalterado
    (Jarbas não entra no loop V2; read-only).
18. **Chat/streaming/anexos/auth** — enviar mensagem, ver streaming, histórico,
    anexo, login. Esperado: sem regressão, sem erro de console no frontend.

Registre o resultado de cada item; o Release Gate (§129) só fecha com todos verdes.
