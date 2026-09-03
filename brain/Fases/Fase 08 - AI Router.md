---
tags: [fase, desigual-os]
fase: 8
status: concluida
---

# Fase 08 - AI Router

## Escopo

Pipeline em camadas (rule engine barato primeiro, classifier LLM só se confiança baixa), saída validada por Zod (`packages/router`).

## Definition of Done

Testado de verdade com as 6 frases do prompt mestre (as duas do anexo, seção 15, mais variações de cada intent): todas roteiam pro agente certo, com o `workflow` correto pra "crie uma campanha completa" (bento → jarbas → studio → bento, `estimated_complexity: high`). Frase sem keyword nenhuma cai corretamente no classifier, que detecta a falta de `ANTHROPIC_API_KEY` e devolve um fallback seguro (bento, confiança 0) em vez de travar.

## Decisão

Discovery de node saudável (seção 6.2: "se não houver node saudável, ativa circuit breaker") fica fora deste pacote de propósito. O Router só decide intent/agente/tools/plano; se aquele agente tem node online é responsabilidade de quem for de fato despachar a tarefa (Fase 9), usando `findHealthyNodeForAgent` já construído na Fase 03. Mantém o Router sem depender do banco.

## Limitação conhecida

O classifier (`packages/router/src/classifier.ts`, ADR 0004) não foi testado contra a API real da Anthropic, porque não havia `ANTHROPIC_API_KEY` configurada. Implementação segue a API documentada do SDK oficial, mas precisa validação com chave real antes de produção. O caminho principal (rule engine) foi validado de verdade e cobre os exemplos do prompt mestre sem depender disso.

## Arquivos criados

`packages/router/*` (schema, rules, classifier, route, index).
