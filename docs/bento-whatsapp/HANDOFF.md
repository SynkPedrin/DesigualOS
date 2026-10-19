# Bento no WhatsApp — handoff de operação

Um único Bento, um único Brain, vários canais. O WhatsApp entra em
`submitChatTurn` (`apps/api/src/chat/turn-service.ts`), a mesma função do
`POST /chat` da web: mesmo roteamento (`agent_hint: AUTO`), contexto
operacional com o recorte do usuário, worker, modelos, ações e confirmações.
Quem responde pode ser Bento, Jarbas, Otto ou Suzy conforme a pergunta (como na
web); resposta de outro agente chega com o nome dele em negrito.

## Ativar (sem editar variável de servidor)

Pré-requisito (já usado pelo Inbox): `OPENWA_BASE_URL`, `OPENWA_ADMIN_API_KEY`,
`OPENWA_WEBHOOK_URL` ou `API_PUBLIC_URL`, container `openwa` no ar.

1. Integrações > **Bento no WhatsApp** (conta master) > **Conectar número do Bento**.
   Cria a sessão no OpenWA, chave escopada só a ela, webhook com segredo
   próprio; tudo cifrado em `organization_connectors` (provider `bento_whatsapp`).
2. **Mostrar QR** e escanear com o celular do número +55 18 99798-7295
   (WhatsApp Business). Só quem está com o celular faz isto.
3. Cada colaborador: Integrações > Bento no WhatsApp > **Vincular meu WhatsApp**,
   envia o código ao Bento, confirma o número na tela.
4. Teste real: mandar "o que tenho pra hoje?" do número vinculado e comparar
   com o chat web.

Opcional por variável: `BENTO_WHATSAPP_AGENT_HINT=BENTO` (fixa o Bento),
`BENTO_WHATSAPP_TRANSCRIPTION=none`, `BENTO_WHATSAPP_DOCUMENTS_ENABLED=false`,
`BENTO_WHATSAPP_ALLOWED_GROUPS`. Transcrição liga sozinha quando há
`OPENAI_API_KEY` (custo novo na conta OpenAI).

## Rollback

- Painel: **Desligar o canal** (instantâneo, sessão preservada).
- Servidor: `BENTO_WHATSAPP_ENABLED=false` é a chave geral e vence o painel.
- Nada de migração a desfazer: tabelas `bento_whatsapp_*` são aditivas.

## Estado das provas

| Item | Estado |
|---|---|
| Gateway, identidade, dedupe, anti-loop, assinatura, provisionamento | TESTADO COM MOCK |
| Equivalência web × WhatsApp (mesma função, mesmo usuário/permissões) | TESTADO COM MOCK |
| Sessão real no OpenWA, QR, mensagem real, resposta real | NÃO EXECUTADO |
| Equivalência factual com Brain/ClickUp ao vivo | NÃO EXECUTADO |
| Grupos: responde só "chama no privado" (decisão de privacidade) | IMPLEMENTADO |
| Resposta em áudio (TTS) | NÃO EXISTE no projeto |

Limites conhecidos: imagem vira anexo do turno, mas só lê quem tem leitura de
imagem; ação por áudio exige "sim" antes de ir ao Brain.

## Regra de ouro: o Bento só RESPONDE a quem escreve para ele

Incidente em 19/10/2026: ao conectar o número, o aparelho entregou uma rajada de
mensagens e o Bento mandou o aviso "ainda não reconheço este número" a 24
contatos diferentes em ~1 minuto. Causa: ele respondia a QUALQUER remetente
desconhecido. Hoje:

1. **Silêncio com quem não está vinculado.** Número desconhecido não recebe nada
   (fica registrado como `unlinked_silent`). A única exceção é quem manda um
   código de vínculo (`BENTO-XXXX-XXXX`), que é um pedido explícito.
2. **Mensagem antiga é ignorada.** Conta a idade da mensagem (não do envelope):
   mais de 3 minutos = histórico, não pedido.
3. **Disjuntor de saída.** Mais de 5 conversas diferentes em 1 minuto trava todo
   envio por 15 min e registra erro `DISJUNTOR DE SAÍDA ACIONADO`.
4. Grupos: silêncio, exceto grupo autorizado + menção (e mesmo assim só chama
   para o privado).

Antes de reconectar o número depois de uma parada, confira no log da API que não
há `DISJUNTOR DE SAÍDA ACIONADO` e que `bento_whatsapp_inbound` não tem linhas
`replied` com `reason = 'unlinked'` novas.
