# Prompts de sistema completos dos agentes

Esta pasta guarda os prompts de sistema completos (formato "manual de operação",
escritos por Endrigo em 08/09/2026) para cada agente de conversa da Agência
Desigual. **Não são o mesmo texto que vive em `packages/types/src/personalities.ts`.**

## Por que não estão em `personalities.ts`

`personalities.ts` é injetado como texto **prepended à mensagem** enviada por
HTTP para os serviços reais (`bento-qa`, `agentes-desigual`), não como um
system prompt de verdade. Testado ao vivo em 08/09/2026:

- Bento passa a vazar o próprio prompt como resposta a partir de ~2000
  caracteres de instrução combinada.
- Jarbas retorna `answer: null` de forma consistente a partir de ~900
  caracteres.

Os prompts desta pasta têm 9-13 mil caracteres cada - muito além do que esse
canal aguenta. Colá-los em `personalities.ts` quebraria os dois agentes por
completo, não os melhoraria.

## Onde eles devem ser implantados

Dentro do código-fonte real de cada serviço, nas máquinas físicas:

- **Bento**: `bento-qa`, na máquina do Bento (100.93.182.83). Provavelmente em
  algo como `src/llm.js` ou onde quer que o system prompt da chamada de LLM
  seja montado hoje.
- **Jarbas**: `agentes-desigual`, na máquina do Jarbas (100.118.12.97).

Isso exige acesso SSH a essas máquinas, que ainda não foi liberado (chave
pública `id_ed25519_desigual_os` gerada, aguardando ser adicionada ao
`~/.ssh/authorized_keys` de cada máquina). Assim que o acesso existir, o
conteúdo destes arquivos deve substituir (ou informar a reescrita de) o
system prompt real de cada serviço.

## Arquivos

- `bento.md` - prompt completo do Bento (57 seções).
- `jarbas.md` - prompt completo do Jarbas (78 seções).
