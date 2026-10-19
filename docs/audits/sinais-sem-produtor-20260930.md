# Duas regras de sinal esperam um evento que ninguém emite

**Data:** 30/09/2026
**Status:** medido e confirmado. A correção é uma decisão de produto, não um bug a consertar às pressas.

## A pergunta

Ao ligar a tela de Sinais, ficou a dúvida de por que `proactive_signals` tinha
UMA linha (criada naquele dia por um teste) se as regras de `task.overdue` e
`creative.rejected` existem no código há tempo. Duas explicações estavam na
mesa: o worker não rodava aquela janela, ou as condições nunca bateram nos dados
reais.

**As duas estavam erradas.**

## A medição

Todos os eventos que o `operational_events` já recebeu, desde sempre:

```
  438 x task.updated         (último 2026-09-30 02:09)
  289 x task.created         (último 2026-09-30 02:09)
    7 x CONNECTION_CREATED   (último 2026-09-30 09:40)
    1 x CLIENT_DECISION      (último 2026-09-30 09:40)
  ---
    0 x task.overdue
    0 x creative.rejected
  não processados: 0
```

E onde esses dois tipos aparecem no repositório inteiro:

| arquivo | papel |
|---|---|
| `apps/worker/src/processors/operational-events.ts` | lista de tipos RECONHECIDOS |
| `packages/orchestrator/src/event-intelligence.ts` | o handler que gera o sinal |
| `packages/context-engine/src/build-change-context.ts` | mapa de rótulo ("venceu") |

Os três são consumidores. **Nenhum produtor existe.**

## A conclusão, e a causa exata

Não é worker parado (zero eventos não-processados no banco inteiro) e não é
condição que não bateu. É um **consumidor esperando uma mensagem que nenhum
remetente envia**.

A causa está em `apps/api/src/clickup/routes.ts:174`. O `type` do evento é
gerado MECANICAMENTE a partir do nome que o ClickUp manda:

```ts
type: changed.event.replace(/^task/, 'task.').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase(),
// 'taskCreated' -> 'task.created'
```

Duas consequências, e elas têm razões DIFERENTES — o que importa, porque pedem
correções diferentes:

**1. `task.overdue` nunca vai nascer por esse caminho, e é estrutural.**
"Ficou atrasada" não é algo que o ClickUp EMPURRA: não existe esse evento no
lado deles. É estado DERIVADO, que só aparece comparando `due_date` com agora —
exige varredura periódica, não push. O sistema já sabe fazer essa comparação
(`classificarStatusFuncional`, `get_blockers`); o que não existe é ela gerar
evento.

**2. `creative.rejected` também não, por outro motivo.**
O mapeador só produz `task.*` (o `replace` parte de `/^task/`), nunca
`creative.*`. E é puramente mecânico: olha o NOME do evento, nunca o VALOR do
status novo. Para existir, precisaria de uma segunda camada inspecionando
`status`/`status_type` do payload e decidindo "isto é rejeição de criativo".
Essa camada não existe.

A fila nunca esteve entupida. Ela nunca teve o que receber.

*(Causa apurada pela outra sessão em `clickup/routes.ts` e conferida aqui; a
contagem de eventos foi medida pelas duas independentemente, com o mesmo
resultado.)*

## Por que isso importa mais do que parece

É a mesma família de achados que esta semana produziu em série, e todos custaram
a mesma coisa — a impressão de que o sistema faz algo que ele não faz:

- `dependencies` usado em 0 de 253 tasks (a agência usa subtarefa)
- tags em 8% das tasks
- pasta "CLIENTES ATIVOS" em 411 de 411 (não separa nada)
- `proactive_signals` sem consumidor até hoje
- e agora: duas regras sem produtor

Em todos, o código está correto e a realidade não passa por ele. Teste unitário
passa: o handler faz o que promete quando recebe o evento. O que nenhum teste
perguntava é se o evento chega.

**Há 146 tarefas atrasadas na operação** (medido em outra apuração desta mesma
semana) e **zero eventos `task.overdue`**. A informação existe; o caminho até o
sinal, não.

## O que fazer — e a escolha é de produto

1. **Escrever os produtores — são dois, não um.**
   - `task.overdue`: job que varre tasks com prazo vencido e emite o evento,
     com dedupe por dia (o `dedupeKey` do handler já prevê:
     `event.task_overdue:<entityId>:<dia>`). É o caminho que faz as 146
     atrasadas virarem aviso.
   - `creative.rejected`: uma camada no webhook que olhe o VALOR do status, não
     o nome do evento. Mexe em `apps/api/src/clickup/routes.ts`.
2. **Ou apagar as duas regras.** Se ninguém quer esse aviso, código que espera
   evento inexistente é pior que ausência: quem lê o handler acredita que o
   produto avisa sobre prazo vencido.

O que NÃO vale é deixar como está. Hoje qualquer pessoa que abrir
`event-intelligence.ts` conclui que o sistema avisa quando uma task vence — e
ele nunca avisou uma vez.

## Antes de escrever o produtor, medir

Se a opção 1 for escolhida: 146 avisos de uma vez, no primeiro dia, é uma
enxurrada que ensina a ignorar a tela de Sinais na primeira visita — o defeito
que a própria tela foi desenhada pra evitar. Vale decidir o recorte (só as que
vencem hoje? só as de cliente ativo? severidade por dias de atraso?) ANTES de
ligar, e não depois de alguém receber 146 cartões.
