# Gestão Empresarial: auditoria dos dados do Operand

Data da auditoria: 22/10/2026. Fase 1 (somente leitura).
Origem: pasta `DADOS OPERAND/` (fora do Git, nunca modificada).

Este documento traz **só agregados**: contagens, formatos, taxas de preenchimento.
Nenhum nome, documento, e-mail ou telefone aparece aqui. A pasta de origem tem dado
pessoal e comercial e o repositório é público.

## 1. O que existe de verdade

| Arquivo | Conteúdo | Linhas de dados | Colunas |
|---|---|---|---|
| Relatório de Clientes.xlsx | cadastro de clientes | 760 | 7 |
| Relatório de Fornecedores.xlsx | cadastro de fornecedores | 254 | 8 |
| Relatório de Fornecedores (1).xlsx | **cópia idêntica** do anterior | 254 | 8 |
| Relatório de Veículos.xlsx | cadastro de "veículos" | 74 | 8 |
| lancamentos_derivado_2026-10-22.csv | lançamentos a receber | 171 | 17 |
| backup_manifest.json, coverage_matrix.csv, missing_data.md | metadados do backup | n/a | n/a |

Os dois arquivos de fornecedores têm hashes diferentes mas conteúdo igual: comparei linha a
linha por hash de linha, 254 iguais, 0 divergentes. Tratar como um só.

As contagens batem com a `coverage_matrix.csv` (760, 254, 74, 171). Na planilha de Clientes,
Fornecedores e Veículos **todas** as colunas são as mesmas de uma ficha de pessoa/empresa.

## 2. O que NÃO existe nos arquivos (e portanto não será importado)

O `missing_data.md` e a matriz já declaravam. Confirmei fisicamente:

- **Contas a pagar, despesas, transferências: zero.** O CSV só tem `categoria = Receitas`.
- **Propostas (49), produção (4.834 documentos), mídia, projetos/jobs, anexos:** referenciados
  na matriz como UNKNOWN. Não há arquivo. O CSV só aponta para eles por código (`rel_tipo`).
- **Prestadores e colaboradores:** nenhum relatório.
- **Dados bancários dos fornecedores:** o `missing_data.md` diz que 117 fornecedores têm dado
  bancário "mantido só no xlsx". **As planilhas fornecidas não têm coluna bancária.** A
  informação não está nestes arquivos. Fica `[FALTA]`.
- **Placa, modelo, ano de veículo:** inexistentes. Ver §4.
- **ID original do Operand nos cadastros:** inexistente. Só o CSV tem `operand_id`.
- **Conta bancária, forma de pagamento, centro de custo, data real de pagamento, juros,
  descontos, conciliação, anexos:** sem export nativo, segundo o manifesto.
- **Arquivo `lancamentos_ui_capture_2026-10-22.tsv`**, citado no manifesto: ausente.
- Os hashes dos xlsx **não estão no manifesto**, então a integridade deles não é verificável
  contra o backup; só dá para registrar o hash de hoje (abaixo).

### Hashes de hoje (sha256, 8 primeiros caracteres)

Clientes 006590da · Fornecedores 7edda093 · Fornecedores(1) f2126009 · Veículos 9fe49bdb ·
lançamentos 9c28c483 (confere com o manifesto) · matriz 651f9178 · manifesto a2d127fb ·
missing_data b56e71e8.

## 3. Qualidade dos cadastros

| Medida | Clientes (760) | Fornecedores (254) | Veículos (74) |
|---|---|---|---|
| Sem CNPJ/CPF | 454 (60%) | 125 (49%) | 26 (35%) |
| Sem e-mail | 653 (86%) | 148 (58%) | 44 (59%) |
| Sem telefone | 564 (74%) | 117 (46%) | 35 (47%) |
| Sem cidade | 461 (61%) | 112 (44%) | 27 (36%) |
| Sem estado | 458 (60%) | 119 (47%) | 28 (38%) |
| Ativo / Inativo | 407 / 353 | 231 / 23 | 70 / 4 |
| Documento com 14 dígitos (CNPJ) | 277 | 126 | 48 |
| Documento com 11 dígitos (CPF) | 26 | 1 | 0 |
| Documento com tamanho inválido | 3 | 2 | 0 |
| CNPJ com dígito verificador inválido | 2 | 2 | 1 |
| CPF com dígito verificador inválido | 1 | 0 | 0 |
| Grupos de documento duplicado | 12 (24 linhas) | 5 (10) | 1 (2) |
| Grupos de nome duplicado | 26 (52 linhas) | 6 (12) | 1 (2) |
| E-mail com formato inválido | 0 | 2 | 1 |

Particularidades que o importador precisa tratar:

- **Vazio vem de dois jeitos:** célula vazia e célula com um espaço (`" "`). No estado, 458
  de 760 clientes estão em branco, 88 deles só com espaço. Normalizar com `trim` antes de
  contar como preenchido.
- **Telefone sem DDD** (9 dígitos) em 4 clientes, 2 fornecedores e 2 veículos. Não completar
  DDD por dedução; guardar como veio e marcar `[CONFIRMAR]`.
- **Documentos duplicados** entre linhas diferentes: pode ser filial, pode ser cadastro
  repetido. **Não fundir.** Vão para a fila de revisão.
- **Sobreposição entre cadastros** por documento: 7 clientes também são fornecedores, 2
  clientes também são "veículos", 38 documentos de fornecedor também estão em "veículos".
  Uma mesma empresa pode ser cliente e fornecedor; o modelo precisa permitir os dois papéis
  sobre uma só entidade (decisão na Arquitetura).
- O campo Situação só tem `Ativo` e `Inativo`.
- Nome mais longo: 74 caracteres. Não há problema de tamanho de campo.

## 4. "Veículos" provavelmente são veículos de mídia, não carros

Hipótese, a confirmar com a equipe antes de modelar:

- A planilha tem CNPJ e razão social, não placa, modelo ou ano.
- Para uma agência, "veículo" é quem exibe a campanha (outdoor, rádio, jornal).
- O CSV de lançamentos tem `rel_tipo = midia` em 45 linhas, e nomes como "Topdoor" e
  "Apoio Outdoor" aparecem como cedente.
- 38 dos 48 documentos de "veículos" também são fornecedores.

Consequência: o cadastro "Veículos" será modelado como **veículo de mídia** (um tipo de
fornecedor), não como frota. Se a leitura estiver errada, a correção é só renomear o tipo,
porque nenhuma coluna de frota foi inventada.

## 5. Lançamentos (CSV)

171 linhas, 17 colunas, nenhuma linha com largura quebrada (parser CSV real, não split por vírgula).

| Campo | Observação |
|---|---|
| operand_id | 171 distintos, sem repetição. Chave de idempotência. |
| categoria | 100% `Receitas`. |
| status | Quitado 122, Cancelado 42, Em Aberto 7. |
| faturamento | **vazio nas 171 linhas.** |
| doc_nf | **vazio nas 171 linhas.** Nenhum número de nota. |
| parcela | preenchida em 121; formato `N/N` em todas. 50 vazias. |
| competência / vencimento | formato `dd/mm/aaaa` em todas; vencimentos de 2021 a 2026. |
| relacionado | `producao` 100, `midia` 45, `proposta` 26. Aponta para registros que **não estão** nos arquivos. |
| sacado_cedente | 31 nomes distintos (normalizar acento e caixa não reduz). **8** casam exatamente com um cliente (39 linhas), **22 casam com um fornecedor**, **1 não casa com ninguém** (2 linhas). Ver §5.1. |

### 5.1 Quem é o "sacado/cedente" dos lançamentos

Resultado do cruzamento por nome exato normalizado (sem acento, caixa, espaços), contra os
dois cadastros:

| Casamento | Cedentes | Linhas |
|---|---|---|
| com um cliente | 8 | 39 |
| com um fornecedor | 22 | 130 |
| nenhum | 1 | 2 |

Receita cujo "sacado" é, pelo nome, um **fornecedor** é estranha. Hipóteses, nenhuma
confirmada: (a) a agência repassa mídia e o Operand registra o veículo no campo; (b) o
campo na verdade guarda o cedente do título, não o pagador; (c) o mesmo nome existe como
cliente e como fornecedor e o cruzamento por nome não distingue. **Por isso o importador não
atribui cliente a lançamento por nome.** Todo cedente vai para a fila de vínculo e a pessoa
decide, com a sugestão visível.

### 5.2 Valores (exatos, em Decimal)

| Status | Linhas | Valor |
|---|---|---|
| Quitado | 122 | R$ 125.658,49 |
| Em Aberto | 7 | R$ 1.698,00 |
| Cancelado | 42 | R$ 192.095,10 |
| **Total bruto** | 171 | **R$ 319.451,59** |
| **Sem cancelados** | 129 | **R$ 127.356,49** |

O total de R$ 319.451,59 que aparece na matriz **inclui R$ 192.095,10 cancelados** (60%).
Qualquer indicador de receita que some o bruto está errado. Cancelado não é receita.

- `valor_brl` e `valor_num` concordam nas 171 linhas (0 divergências de valor).
- Nenhum valor zero ou negativo.
- Nenhuma chave natural (título + parcela + valor + vencimento) repetida: não há duplicata provável.
- Os 7 "Em Aberto" vencem entre 08/10/2026 e 27/10/2026: 2 já venceram (08 e 09/10) em
  relação a hoje, 22/10/2026.
- A matriz registra 1 divergência no CSV; a checagem acima não reproduz divergência de
  valor, então ela é de outra natureza (provavelmente a contagem da UI contra o derivado) e
  fica registrada como **não reproduzida**.

### O que isso significa para o histórico

A matriz marca lançamentos como `PARTIAL`. Os números confirmam: só receitas, 2021 a 2026,
sem despesas. Toda tela de indicador consolidado (DRE, fluxo de caixa, resultado) deve
mostrar, enquanto o histórico for parcial:

> Histórico importado parcialmente. Indicadores financeiros consolidados podem não representar a operação completa.

## 6. Regras de importação derivadas da auditoria

1. **Idempotência por chave de origem.** Lançamento: `operand_id`. Cadastros não têm ID
   original: chave = origem + tipo + hash do conteúdo normalizado, e a reimportação do mesmo
   arquivo (mesmo sha256) é recusada com aviso, nunca duplica.
2. **Staging primeiro.** Nada vai direto para as tabelas finais. Cada linha entra em staging
   com status `novo`, `duplicado_provavel`, `invalido`, `precisa_vinculo`.
3. **Cliente de lançamento só por vínculo explícito.** 23 dos 31 cedentes não casam com
   cliente por nome exato, e 22 casam com fornecedor. Atribuição e fusão automática por nome
   são proibidas. Ficam em fila com sugestão e confirmação humana.
4. **Cancelado importa como cancelado**, com valor preservado, e fica fora dos totais de
   receita. Não apagar, não zerar.
5. **Em Aberto não vira vencido por dedução na importação.** O status de vencimento é
   calculado pela data, na leitura.
6. **Campo ausente fica nulo.** Sem NF, sem conta bancária, sem forma de pagamento, sem
   centro de custo: nulo, nunca preenchido. Nenhum lançamento financeiro é criado para
   "fechar" lacuna.
7. **Documento inválido** (dígito verificador) entra marcado `documento_invalido`, sem
   corrigir.
8. **Valores em Decimal** (centavos inteiros ou `numeric(14,2)`), nunca `float`.
9. **Telefone, e-mail e documento** são normalizados só para comparar; o original é
   guardado como veio.

## 7. Pendências que dependem de uma pessoa

- Confirmar se "Veículos" são veículos de mídia.
- Fornecer os dados bancários dos 117 fornecedores, se forem necessários (não estão nos
  arquivos).
- Fornecer despesas/contas a pagar, propostas, produção e anexos, se existirem em outro export.
- Decidir, para os 31 cedentes, se cada um é cliente, fornecedor/veículo ou outro. Só 8
  casam com cliente. A tela de vínculo existe para isso.
- Confirmar os hashes dos xlsx contra o backup original.

## 8. Como a auditoria foi feita

Leitor mínimo de xlsx (zip + XML, sem biblioteca nova) e `csv` do Python em modo isolado
(`python3 -I`), ambos em scripts **fora** da pasta de dados. Saída restrita a contagens.
Nenhum arquivo da pasta de origem foi aberto para escrita.
