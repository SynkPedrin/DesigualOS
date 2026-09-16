# Knowledge Plane — como o agente sabe o que a operação sabe

Escrito depois do primeiro teste real com a operação (16/09/2026), que produziu
três defeitos. Os três eram a mesma falha de arquitetura: **o sistema falava
sobre entidades que não existiam nele**.

## O que a operação viu

| Caso | O que aconteceu |
|---|---|
| Esther | O agente afirmou que ela era responsável pela conta D. Carvalho. |
| Jardim Europa 5 | O agente entregou a legenda de outro cliente (Jardim do Lago, Penápolis). |
| Bubbles | Uma resposta aparecia quebrada em várias caixas. |

## O que a auditoria encontrou

**Esther não existe em nenhuma fonte autorizada.** Auditado antes de qualquer
correção: 0 de 19 membros do workspace, 0 de 7.408 tasks, 0 de 1.285
comentários, 0 no banco, 0 nos vaults. A resposta certa era declarar a ausência;
o sistema inventou uma relação porque não tinha onde checar.

**Jardim Europa 5 existe, e estava vivo.** 238 tasks na Cosentino, 166 abertas,
movimentada no mesmo dia do relato. A fonte escreve "Europa V" no nome da task e
"Jardim Europa V" na descrição; a pessoa falou "Jardim Europa 5". Campanha não
era entidade, então não havia o que resolver — e o texto caiu no matcher de
cliente, que casou pela palavra solta "jardim".

## As camadas

```
ClickUp (fonte de verdade)
   |
   +-- crawlClickUp ............... lê spaces -> folders -> lists -> tasks
   |
   +-- derivarCampanhas ........... duas convenções reais (ver abaixo)
   +-- pessoas + relações ......... diretório + responsáveis, com evidência
   |
   v
campaigns / people / person_client_relations / client_knowledge_sync
   |
   +-- resolverEntidade ........... numeral, alias, especificidade, ambiguidade
   |
   v
bloco do turno (cliente, campanha, pessoas) -> agente
```

## Duas convenções de campanha, porque a operação usa as duas

1. **Explícita**: `Cliente_Campanha_Peça`. 1.578 tasks, concentradas nas contas
   grandes (D. Carvalho e Cosentino).
2. **Por repetição**: `Cliente - Assunto - PERÍODO`. 30 das listas com volume não
   usam underscore. A campanha é a frase que o time REPETE entre tasks ("Evento
   inauguração", "Apae em movimento"). Mínimo de 3 tasks; data, mês, nome do
   cliente e palavra de peça ficam fora.

Sem a segunda convenção, 38 dos 50 clientes com lista ficariam sem campanha
nenhuma — e campanha que existe e não está no registro é exatamente o bug.

## Regras que não se negociam

- **Numeral romano e arábico são a mesma coisa.** "Europa V" = "Europa 5".
- **Palavra solta não identifica entidade** quando o texto a estende com outro
  nome próprio. "Jardim" + "Europa" não é "Jardim do Lago".
- **Relação de pessoa carrega tipo e evidência.** Estar atribuído a task, comentar
  ou ser citado NÃO é responder pela conta. Trabalho pontual não é squad fixo.
- **Ambiguidade vira pergunta, nunca sorteio.**
- **Campanha de outro cliente nunca é usada**, e a recusa é explícita: o agente diz
  de quem ela é.
- **Entidade resolvida tem precedência sobre busca por similaridade.** O que o
  orquestrador resolveu é fato; o trecho parecido do vault é palpite.

## Frescor

- **Incremental**: o webhook do ClickUp re-deriva as campanhas do cliente, com
  janela de 5 min para não martelar a API.
- **Autocura**: campanha citada e não encontrada dispara re-sync daquele cliente
  e nova tentativa ANTES de responder que não existe.
- **Reconciliação**: `reconcile-knowledge.mts` reconstrói tudo e REMOVE o que a
  fonte não deriva mais — índice velho concorrendo com o novo já causou
  ambiguidade entre "Campanha Operação Blindada" e "Operação Blindada".

## Comandos

```bash
# reconciliação completa (simula sem --aplicar)
pnpm --filter @desigual-os/worker exec tsx scripts/reconcile-knowledge.mts --aplicar

# a matriz que responde "esse cliente está atualizado?"
pnpm --filter @desigual-os/worker exec tsx scripts/knowledge-coverage.mts --detalhe
```

## Limites conhecidos

- 7 clientes não têm lista no ClickUp e por isso não têm campanha derivada.
- Comentário ainda não entra no registro de pessoas: varrer os comentários de
  7.408 tasks leva mais de uma hora de API. Autores de comentário aparecem no
  ClickUp mas não viram relação — a consequência é conservadora (menos relação
  registrada), nunca uma relação inventada.
