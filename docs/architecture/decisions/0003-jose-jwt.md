# ADR 0003: usar `jose` para validar os JWTs do Supabase Auth

## Contexto

A ADR 0001 já decidiu que o frontend autentica direto com o Supabase Auth e manda o `access_token` (JWT) pro Orchestrator. O Orchestrator precisa validar esse token contra as chaves públicas (JWKS) do projeto Supabase, sem segredo compartilhado (formato de assinatura assimétrica, já confirmado pelo formato novo de chave `sb_publishable_`/`sb_secret_` deste projeto). Isso não está na lista de dependências da seção 4 do prompt mestre.

## Decisão

Usar `jose` (`createRemoteJWKSet` + `jwtVerify`) em `packages/auth`. É a biblioteca padrão de fato para verificação de JWT/JWKS em Node moderno (ESM nativo, zero dependências, mantida ativamente), e já faz cache do JWKS remoto sozinha.

## Consequência

Uma dependência nova (`jose`) em `packages/auth`. Nenhuma outra parte do sistema precisa dela diretamente.
