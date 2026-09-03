# Teste Final — Validação ponta a ponta (pedido do Endrigo, 03/09/2026)

Rodar DEPOIS que os blocos de Clientes/Admin/Configurações estiverem prontos.
Testar **no back e no front**, não só na API.

## 1. Studio — geração real
- [ ] Gerar de verdade a imagem do **elefante**, usando o prompt original do
      Endrigo como base (o job `STU-MTL0DL2I54A21E` foi o que falhou:
      "Cria uma Imagem de UM ELEFANTE...").
- [ ] Confirmar que o arquivo aparece na Galeria com autor, workflow e máquina.
- [ ] Confirmar notificação de conclusão levando pra peça.

## 2. Chat público com os agentes
Chat visível a todo usuário com acesso de colaborador.
- [ ] Conversar com o **Bento** e receber resposta real.
- [ ] Conversar com a **Suzy** e receber resposta real.
- [ ] Conversar com o **Jarbas** e receber resposta real.

## 3. Canais de entrada dos agentes
- [ ] Mensagem privada (DM) para cada agente.
- [ ] Menção em comentário de tarefa no **ClickUp** (`@bento` etc.) com
      resposta postada de volta na thread.

## 4. Aba CHAT dentro do card do cliente
Dentro de `Clientes > [cliente]` precisa existir uma aba **Chat** onde dá pra
falar com os agentes NO CONTEXTO daquele cliente. Casos concretos pedidos:

- [ ] `@jarbas me dê um relatório de todas as campanhas do 3Net`
      -> responde ali dentro do chat do cliente, com dado real.
- [ ] `@bento quem é o responsável pelo cliente?`
      -> responde e emenda um resumo das últimas atualizações do cliente.

## 5. Cobertura
- [ ] Cada item acima verificado no **backend** (dado real gravado/lido) e no
      **frontend** (a pessoa consegue fazer pela tela).

---

## Dependência conhecida (bloqueia parte disso)

Os agentes reais (bento-qa, susy-service) vivem na Tailscale e o Orchestrator
roda fora dela hoje. Hoje existe um **túnel SSH** (localhost:8188 -> VPS ->
ComfyUI) que resolveu isso pro Studio; a mesma técnica serve pros agentes, ou
o Orchestrator sobe na VPS de vez. Ver
`Fase Extra - Enxame e Vinculacao de Maquinas 2026-09-02.md`.
