---
tags: [regras, seguranca, desigual-os]
---

# Regras de Ouro (invioláveis)

Fonte: prompt mestre do projeto, seção 2. Valem para todas as fases em [[00 - Indice]].

1. **Não alterar os cérebros dos agentes.** Os Obsidian Vaults de [[Bento]], [[Jarbas]] e [[Suzy]] ficam locais em cada Mac Mini. Nunca movidos, copiados ou sincronizados para o servidor central.
2. **Não substituir os agentes existentes.** OpenClaw e os agentes já existem nas máquinas. O Orchestrator é camada de coordenação por cima, não reescrita.
3. **Nenhuma máquina exposta publicamente.** Toda comunicação passa por Tailscale (rede privada) e autenticação de node.
4. **O Orchestrator nunca acessa filesystem dos Macs diretamente.** Só conversa com o Node Agent de cada máquina, via HTTPS/WebSocket.
5. **Toda comunicação entre agentes passa pelo Orchestrator.** Agentes nunca conversam entre si direto (evita loops, garante rastreabilidade, limites de token, timeout, auditoria).
6. **Chaves de API nunca chegam ao frontend.** Segredos vivem no servidor, atrás de Secret Manager.
7. **Toda ação relevante gera `execution_id` e entra em `audit_logs`.**
8. **O sistema é modular e extensível.** Adicionar um quinto agente é registrar node, capabilities, tools e regras. Nunca reconstruir o núcleo.

## Regra de estilo de texto da casa

Nunca usar travessão (em dash) em nenhum texto gerado (UI, docs, comentários). Usar vírgula, dois pontos ou parênteses. Esta própria nota segue a regra.

## Idioma

Código e comentários técnicos: inglês. UI, textos de produto e documentação de negócio: português do Brasil. Este vault é documentação de projeto, então fica em português.
