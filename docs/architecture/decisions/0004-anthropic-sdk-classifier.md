# ADR 0004: `@anthropic-ai/sdk` para a camada de classificação do Router

## Contexto

O AI Router (seção 6.2) é em camadas: rule engine primeiro (barato), cai pra um classifier via LLM só quando a confiança é baixa. Não está na lista de dependências da seção 4.

## Decisão

`@anthropic-ai/sdk` em `packages/router`, chamado só quando `ANTHROPIC_API_KEY` está configurada e o rule engine não teve confiança suficiente (limiar 0.7). Sem a chave, o classifier retorna `null` e o Router cai num fallback seguro (bento, baixa confiança) em vez de travar.

## Consequência

Este caminho não foi testado contra a API real: não havia `ANTHROPIC_API_KEY` configurada durante o desenvolvimento. A implementação segue a API documentada do SDK oficial (`messages.create`), mas precisa ser validada com uma chave real antes de produção. O rule engine (testado de verdade com as frases de exemplo do prompt mestre) cobre o caminho principal sem depender disso.
