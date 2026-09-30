# Quatro testes do worker falham sob carga — medido, não resolvido

**Data:** 30/09/2026
**Status:** ABERTO. Diagnosticado até a fronteira útil; a correção não foi feita.

## Por que este documento existe

A regra do release é `NO FAKE GREEN`. Durante a validação da Fase 8 eu reportei
"worker 1462 passed" e, três execuções depois, a mesma suíte devolveu
`4 failed | 1461 passed`. As duas execuções eram do mesmo commit.

Isso significa que o verde que eu havia reportado era **parcialmente sorte**.
Registrar isso vale mais que a correção em si: um número que muda sozinho entre
execuções não é evidência de nada, e quem ler o relatório do release precisa
saber disso antes de confiar no resto.

## Os quatro

Sempre os mesmos, sempre juntos, todos da mesma família (o núcleo do Bento):

```
processors/bento-fault-injection.test.ts
processors/bento-openai-core.test.ts
processors/tammy-regression-20260928-briefing-vault-anexo.test.ts
processors/tammy-regression-20260928-escopo-de-escrita.test.ts
```

## O que foi medido

| Condição | Resultado |
|---|---|
| Suíte completa (370 arquivos), máquina com Playwright + dev servers rodando | 4 falhas |
| Suíte completa, repetida logo em seguida | 0 falhas |
| Suíte completa, terceira vez | 4 falhas, **as mesmas** |
| Suíte completa, quarta vez (máquina ociosa) | 2 falhas, ambas do mesmo conjunto |
| Só os 4 arquivos juntos, 5 execuções seguidas | 0 falhas (47/47 em todas) |
| Cada arquivo isolado | 0 falhas |

Duração dos quatro dentro da suíte: 3s, 3s, 5s e 7s — estão entre os mais
lentos do pacote.

## O que isso descarta

- **Não é serviço externo.** Os quatro arquivos mockam tudo (`vi.mock` em
  `@desigual-os/bento-core`, `@desigual-os/openai-provider`,
  `@desigual-os/tool-gateway`, `./bento-action-guard`, `./write-target`). Nada
  ali sai para a rede — a hipótese inicial de contenção no nó de inferência
  single-flight está **eliminada**.
- **Não é bug de lógica nos quatro.** 5 execuções seguidas do conjunto isolado
  passaram inteiras. Se houvesse asserção errada, apareceria ali.
- **Não é regressão do trabalho desta sessão.** Nenhum dos quatro toca o que foi
  alterado (scheduler, /mcp/status, /memories, /episodes, telas).

## Os dois testes que consegui nomear

Numa execução completa posterior (2 falhas, não 4):

```
bento-fault-injection.test.ts
  6a LEGACY create com id → estado em conversation_context (append-only)
  → pós-restart "atualiza" resolve o foco

tammy-regression-20260928-escopo-de-escrita.test.ts
  o nome do cliente NUNCA chega ao ClickUp como responsável
```

O segundo é uma cerca de segurança real: ele impede que o nome de um CLIENTE
seja gravado como RESPONSÁVEL de uma task. Um teste assim falhando de forma
intermitente é pior que um teste quebrado — ensina a ignorá-lo.

## A hipótese que sobra

**Não é contenção de banco.** Verifiquei: os dois arquivos não importam
`@desigual-os/database`; usam stores FALSOS em memória, com semântica
append-only imitando `conversation_context`. Nada ali toca Postgres, e a
hipótese de saturação do pool (`DATABASE_POOL_MAX`, default baixo) está
**eliminada**.

Sobra o caso mais incômodo: **teste totalmente mockado e mesmo assim não
determinístico**. Para um teste em memória variar entre execuções, só há três
caminhos plausíveis:

1. dependência de relógio real (`Date.now`, timer não falsificado);
2. estado de módulo compartilhado entre arquivos que caem na mesma thread do
   pool do vitest — os quatro são da mesma família e mockam os mesmos módulos;
3. promessa não aguardada vazando de um teste para o seguinte.

O fato de só falhar com a suíte INTEIRA carregada, e de 5 execuções do conjunto
isolado passarem, aponta para (2) ou (3): são exatamente os modos que precisam
de vizinhos para aparecer.

**Isto é hipótese, não conclusão.** Não capturei o `failureMessages`: as cinco
tentativas de reproduzir com captura passaram, que é o problema de todo teste
intermitente.

## O que fazer, quando for a vez

1. Capturar a mensagem: rodar a suíte completa em laço até falhar, com
   `--reporter=json`, e guardar o `failureMessages`. Sem isso, o resto é chute.
2. Se for timeout, a correção não é aumentar o timeout — é tirar a dependência
   de relógio do teste, ou marcar os quatro para rodar em série.
3. Enquanto não for corrigido: **nenhum relatório deve citar o número do worker
   a partir de uma execução só.** Duas execuções limpas seguidas, ou o número
   vem com esta ressalva.

## O que NÃO fazer

Marcar os quatro como `skip` para o número ficar bonito. Eles cobrem injeção de
falha e duas regressões reais da operação da Tammy — é cobertura que custou
caro, e desligá-la para limpar um relatório é exatamente a troca que este
projeto passou a semana desfazendo.
