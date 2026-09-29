# Bento — o que ele controla da operação, e o que não

Levantado do código em 28/09/2026, depois do dia de correções. Não é projeção:
cada linha aqui foi conferida no fonte ou medida contra o ClickUp/banco reais.

---

## 1. O que ele FAZ, e está provado no ClickUp real

| Ação | Como foi verificado |
|---|---|
| Criar task com briefing, responsável, prazo, prioridade, tag, anexo | ciclo real, lista QA |
| Alterar prazo, data de início, responsável (add/remove/troca), status, prioridade | ciclo real |
| Aplicar e remover tag | ciclo real |
| Criar checklist com itens | ciclo real |
| Anexar arquivo do chat na task | ciclo real |
| Comentar; responder na thread de um comentário | código + teste |
| Apagar task (com confirmação em duas voltas) | ciclo real |
| Campo personalizado por NOME, resolvendo a opção real da lista | teste; **nunca rodou no ClickUp real** |
| Dependência entre tasks | teste; **nunca rodou no ClickUp real** |
| Subtarefa (task com pai) | teste; **nunca rodou no ClickUp real** |
| Segmentar campanha em N tasks, uma por função | teste; **nunca rodou no ClickUp real** |
| Exportar briefing pro Notion (`@notion`) | ciclo real — mas hoje **bloqueado**, ver §3 |

## 2. O que ele NÃO sabe fazer no ClickUp

Nenhuma destas existe no código. Não é trava — é ausência.

- **Mover task entre listas ou spaces.** A API v2 não move de verdade; depende do ClickApp "Tasks in Multiple Lists" ou da v3. Entregar sem testar duplicaria a task em duas listas.
- **Criar lista, pasta ou space.** Tecnicamente simples, operacionalmente pesado: é o agente mexendo na estrutura do workspace, e erro aqui não tem undo.
- **Watchers (seguidores).** Sem endpoint estável na v2.
- **Time tracking** (iniciar/parar cronômetro). E hoje seria pior que inútil: gravaria hora trabalhada no nome do dono do token.
- **Campo personalizado de DATA, relacionamento ou múltipla escolha.** O resolvedor cobre dropdown, número, moeda, checkbox e texto. Os outros três tipos passariam valor no formato errado.
- **Editar ou apagar comentário.**
- **Arquivar task**, **recorrência**, **mover para outro status board**.

## 3. O que está TRAVADO agora

### 3.1 A cerca de QA continua ligada
`CLICKUP_TEST_LIST_ID=901421333717` está no `.env`. Ela tranca toda escrita na
lista de QA, e só não atrapalha porque existe uma válvula de escape
(`writeScope.authorizedForProduction`) que a pessoa autenticada aciona.

O risco não é hoje — é o próximo caminho de escrita. Foi exatamente assim que a
Tammy ficou travada: o caminho novo do core nasceu sem repassar a válvula, e
toda alteração dela virou "Escrita BLOQUEADA". **Recomendação: desligar a cerca
agora que a operação é real, ou aceitar que todo caminho novo precisa lembrar
dela.**

### 3.2 `@notion` é um beco sem saída
O `@notion` responde "conecte em Configurações → Integrações". Lá **não há
botão**, porque faltam `NOTION_CLIENT_ID/SECRET/REDIRECT_URI` — o OAuth por
pessoa exige uma integração PÚBLICA criada no portal do Notion. E o card nem
está publicado (o deploy do front é anterior a ele).

**Ou abre, ou desliga o gatilho até abrir.** Hoje ele promete e não entrega.

### 3.3 Estimativa de tempo é aceita e ignorada
O ClickUp responde `200` e descarta `time_estimate` quando o ClickApp "Time
Estimates" está desligado no space. O read-back pega e o Bento diz que não
confirmou — mas a pessoa vai continuar pedindo. **Ligar o ClickApp resolve.**

### 3.4 Identidade: tudo aparece como o dono do token
Toda escrita é atribuída ao dono do `CLICKUP_API_KEY` (Pedro Gabriel). A Tammy
recebeu "Pedro atribuiu essa task a você" quando quem atribuiu foi o Bento a
pedido dela. Já existe um usuário **Bento Desigual** no workspace; basta um
token pessoal dele em `CLICKUP_BOT_API_KEY`. Enquanto isso, a procedência fica
num comentário na própria task.

---

## 4. O que ele NÃO CONTROLA — e isso é o mais importante deste documento

### 4.1 As RESPOSTAS não passam pelo GPT
Este é o maior descompasso entre o que se espera e o que acontece.

| caminho | motor |
|---|---|
| decidir a ação (planner) | **OpenAI** |
| escrever o briefing | **OpenAI** (`gpt-5.6-sol`) |
| **responder pergunta** | node `bento-qa` em `100.93.182.83:8791` — **outro modelo, outra máquina** |

Leitura, análise e conversa saem por um serviço externo que este repositório não
controla. Toda a qualidade construída no briefing **não se aplica** a elas.

### 4.2 Intents que saem do caminho novo
`read_tasks`, `get_task`, `analyze_tasks` e `delete_task` retornam `null` no
core e caem no caminho legado. Funcionam — mas não recebem o que foi construído
hoje (briefing, prioridade, procedência, proatividade).

### 4.3 O custo é invisível
`ai_usage_ledger` nunca é escrito: `recordOpenAIUsage` existe e não é chamado
por ninguém. Com o briefing agora em `sol` (~US$ 0,027 medido por briefing),
o gasto cresce e **não aparece em lugar nenhum**.

### 4.4 A nota de qualidade mede preenchimento, não verdade
`evaluateBriefing` conta lacuna declarada contra o score. Medido: o briefing
escrito pelo modelo local, que preenchia tudo com ficção plausível, tirou
**0.895**; o da OpenAI, que declara `[CONFIRMAR: ...]`, tirou **0.571**. A nota
premia quem inventa.

### 4.5 Latência
Criação com briefing: ~50s + ~30s da leitura sênior. Na produção já se viu 3–4
min por turno. A causa dominante (consulta síncrona antes do ack) foi
endereçada, mas o teto do navegador (120s) segue sendo o limite real.

---

## 5. Travas que DEVEM continuar

Nenhuma destas é problema. São o que impede estrago.

| Trava | O que faz |
|---|---|
| `BENTO_WRITE_ENABLED=false` | kill switch: volta tudo a somente-leitura em um passo |
| `BENTO_EXTERNAL_WRITE_ENABLED` (default `false`) | mensagem com potencial de escrita nunca sai pro serviço externo |
| Confirmação em duas voltas no delete | com read-back de ausência |
| Cardinalidade | plano com mais mutações que o pedido é bloqueado |
| Orçamento de mutação | 10 por execução |
| Pessoa não resolvida bloqueia | nunca atribui por aproximação |
| Cliente nunca é pessoa | responsável igual ao nome do cliente vira pergunta |
| Dêitico não atravessa conversa | "apaga essa" em chat novo não alcança a task de ontem |

---

## 6. O conhecimento de cliente, por número

28 clientes ativos. Dos 9 campos críticos do briefing:

- **20 clientes** com 6/9 — dossiê sólido no vault
- **2** com 3/9 (Agência Desigual, John Deere)
- **5** com 0 — mas **4 são registros de teste**; só `🔥 Construtora e Imobiliária Cosentino` parece duplicata de `Cosentino`

Três campos estão em **0/27 clientes reais**, e nenhum código resolve:
**mensagem principal**, **canal** e **critério de aprovação**. Nenhum dossiê
declara. É preenchimento de vault.

---

## 7. O que eu faria, em ordem

1. **Decidir o `@notion`**: credencial ou desligar. Promessa quebrada custa mais que funcionalidade ausente.
2. **Ligar o ledger.** Você está gastando OpenAI às cegas.
3. **Um ciclo real de campanha** na lista de QA — é a funcionalidade que cria N tasks e nunca rodou fora do teste.
4. **Desligar a cerca de QA** (`CLICKUP_TEST_LIST_ID`), já que a operação é real.
5. **Decidir sobre as respostas**: ou o `bento-qa` externo passa a usar GPT, ou as perguntas continuam num padrão diferente do briefing.
6. **Preencher os três campos** no vault dos 20 clientes.
