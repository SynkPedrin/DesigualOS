# Conectar o Desigual OS no Claude da equipe

Guia de instalação do **DESIGUAL OS MCP**. Escrito para quem vai colocar no ar e conectar as contas — não é documentação de arquitetura (essa está em `docs/architecture/desigual-os-mcp.md`).

O que isto entrega: cada pessoa continua trabalhando no Claude dela, e o Claude passa a enxergar a operação real da agência — clientes, tarefas, prazos, responsáveis, decisões — e a registrar de volta o que foi decidido e concluído. **Não é um chat.** É a camada de controle: quanto mais a equipe trabalha no Claude, mais o sistema sabe, em vez de saber menos.

---

## O que você vai precisar

- A stack do Desigual OS rodando (banco Supabase, ClickUp configurado)
- Um domínio, para o endereço público em HTTPS
- `cloudflared` instalado (`brew install cloudflared`)
- Acesso de administrador da organização Claude

---

## 1. Subir o servidor

```bash
pnpm install
pnpm --filter @desigual-os/mcp exec tsx src/server.ts
```

Confira:

```bash
curl -s http://localhost:3010/health
# {"status":"ok","service":"desigual-os-mcp","version":"0.1.0", ...}
```

### Variáveis de ambiente

Todas já existem no `.env` da stack, com uma exceção:

| Variável | Para quê | Obrigatória |
|---|---|---|
| `SUPABASE_URL` | validar quem é a pessoa que autoriza | sim |
| `SUPABASE_PUBLISHABLE_KEY` | a tela de consentimento falar com o Supabase | sim |
| `DATABASE_URL` | tokens, sessões, auditoria, e a operação | sim |
| `CLICKUP_API_KEY` / `CLICKUP_TEAM_ID` | ler e escrever tarefa | sim |
| **`MCP_PUBLIC_URL`** | **o endereço HTTPS público** | **sim, em produção** |
| `MCP_PORT` | porta local (padrão `3010`) | não |
| `MCP_CONSENT_URL` | trocar a tela de consentimento pela do app web | não |

**`MCP_PUBLIC_URL` é a que mais dá problema se ficar errada.** O servidor anuncia os endpoints de OAuth com base nela, no `/.well-known/oauth-authorization-server`. Se ela apontar para `localhost`, o Claude vai tentar autorizar contra `localhost` — e falhar sem dizer por quê.

---

## 2. Colocar em HTTPS

O Claude só conecta em HTTPS. O servidor roda no Mac Mini, atrás da Tailscale, então o caminho mais curto é um túnel.

### Rápido, para testar hoje

```bash
cloudflared tunnel --url http://localhost:3010
# devolve algo como https://coisa-aleatoria.trycloudflare.com
```

Suba o servidor apontando para essa URL:

```bash
MCP_PUBLIC_URL=https://coisa-aleatoria.trycloudflare.com \
  pnpm --filter @desigual-os/mcp exec tsx src/server.ts
```

**A URL muda toda vez que o túnel reinicia.** Serve para provar que funciona, não para deixar a equipe usando.

### Estável, para a equipe usar

```bash
cloudflared tunnel login
cloudflared tunnel create desigual-mcp
cloudflared tunnel route dns desigual-mcp mcp.desigualos.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: desigual-mcp
credentials-file: /Users/pedro/.cloudflared/<id-do-tunel>.json
ingress:
  - hostname: mcp.desigualos.com
    service: http://localhost:3010
  - service: http_status:404
```

```bash
cloudflared tunnel run desigual-mcp
```

E o servidor com `MCP_PUBLIC_URL=https://mcp.desigualos.com`.

### Deixar de pé sozinho

O supervisor da casa (`infra/supervisor.sh`) hoje cuida de API e worker. Para o MCP entrar, some `mcp` aos serviços dele: `servico_dir` → `$RAIZ/apps/mcp`, `servico_entrada` → `src/server.ts`, `servico_log` → `/tmp/desigual-mcp.log`. O túnel também precisa de supervisão — `cloudflared service install` resolve.

---

## 3. Conferir antes de conectar

```bash
node scripts/qa/login.mjs           # token do Supabase para o teste
node scripts/mcp/e2e-oauth.mjs https://mcp.desigualos.com
```

Esse script faz **exatamente o que o Claude faz**: discovery, registro dinâmico, `/authorize`, consentimento, troca do código com PKCE, `initialize`, `tools/list` e uma chamada de tool real contra o banco. Além disso confere que token inválido devolve 401, que o código é de uso único, que PKCE errado é recusado e que revogar corta o acesso na hora.

Se ele terminar com `✓ FLUXO COMPLETO OK`, pode conectar.

---

## 4. Definir o papel de cada pessoa

O papel decide o teto de acesso. Faça isto **antes** de conectar, senão todo mundo entra como `CUSTOMER_SUCCESS`.

```bash
pnpm --filter @desigual-os/mcp exec tsx scripts/papeis.mts
```

Para definir:

```bash
pnpm --filter @desigual-os/mcp exec tsx scripts/papeis.mts super@institutoalmada.org SUPER_ADMIN
pnpm --filter @desigual-os/mcp exec tsx scripts/papeis.mts tammy@institutoalmada.org CUSTOMER_SUCCESS
```

| Papel | Para quem | O que muda |
|---|---|---|
| `SUPER_ADMIN` | gestão | tudo, incluindo dado administrativo |
| `MANAGER` | quem responde pela operação | tudo menos admin; único além do super que altera cliente |
| `CREATIVE` | criação | tarefa, memória e peças; **não** vê mídia paga |
| `CUSTOMER_SUCCESS` | atendimento | tarefa e memória; não altera cliente, não vê mídia |
| `TRAFFIC_MANAGER` | mídia | o de atendimento **mais** desempenho de campanha |
| `QA` | teste | igual ao atendimento |
| `VIEWER` | quem só observa | lê tarefa e cliente; **não** lê memória institucional |

**O papel vale no turno seguinte.** É lido do banco a cada chamada, não gravado no token — rebaixar alguém tem efeito imediato, sem pedir para reconectar.

---

## 5. Conectar no Claude

No painel da organização Claude, em **Connectors** (ou Settings → Connectors):

1. **Add custom connector**
2. URL: `https://mcp.desigualos.com/mcp` — com o `/mcp` no fim
3. O Claude descobre o OAuth sozinho e se registra; não há chave para colar
4. Habilite para os membros que devem usar
5. Cada pessoa, ao usar pela primeira vez, vê a tela do Desigual OS, entra com o **e-mail e a senha dela** e autoriza

A senha vai do navegador direto ao Supabase. O servidor do MCP recebe só a confirmação de que a pessoa entrou.

---

## 6. Testar de dentro do Claude

Peça, no Claude de alguém que já autorizou:

> Quem sou eu no Desigual OS e o que eu posso fazer?

Deve chamar `get_current_user` e `get_current_permissions` e responder com o nome, o papel e os scopes. Depois:

> Como está a operação hoje?

> Me dá o contexto da Cosentino antes de eu começar um criativo.

---

## 7. Cortar o acesso

**De uma pessoa**, sem mexer em ninguém mais:

```sql
UPDATE mcp_tokens SET revoked_at = now()
WHERE user_id = (SELECT id FROM users WHERE email = 'fulano@institutoalmada.org')
  AND revoked_at IS NULL;
```

Vale na hora. Rebaixar o papel para `VIEWER` tem efeito parecido e é reversível.

**De uma superfície inteira** (o Claude Desktop de todo mundo, por exemplo):

```sql
UPDATE mcp_clients SET disabled_at = now() WHERE client_name = 'Claude Desktop';
```

**De todo mundo:** desconecte o connector no painel da Claude, ou pare o túnel.

---

## Troubleshooting

| Sintoma | Causa quase sempre |
|---|---|
| Claude diz que não consegue conectar | `MCP_PUBLIC_URL` errada ou ausente — o discovery aponta para `localhost` |
| Autoriza e volta com erro | a conta não é membro de nenhuma organização, ou é membro de **mais de uma** (o servidor recusa escolher por você) |
| `401` em toda chamada | token expirado (1h) — o Claude renova sozinho; se persistir, o refresh foi revogado e é reconectar |
| `403` numa tool específica | papel sem aquele scope. Confira com `scripts/papeis.mts` |
| Tool devolve `DATA_NOT_AVAILABLE` | é resposta legítima: o dado não existe. Não é erro, e o Claude **não deve** estimar |
| `POSSIBLE_DUPLICATE` ao criar tarefa | proposital: achou tarefa parecida e parou. Confirme qual é, ou repita com `confirm_create: true` |
| Nada aparece de um cliente | ele pode não ter lista do ClickUp vinculada. `search_clients` devolve `has_task_tracking: false` nesse caso |

Logs: `/tmp/desigual-mcp.log`. Toda escrita fica em `audit_logs` com `source = 'mcp'`, `request_id` e o valor antes e depois.

---

## Limites conhecidos, hoje

- **Uma organização por pessoa.** Quem for membro de mais de uma não consegue autorizar — o servidor recusa em vez de escolher por você.
- **Registrar peça pelo MCP ainda não funciona** (`register_asset` falha alto de propósito; use o Studio).
- **Tráfego depende do serviço do Jarbas.** Sem ele, as tools de mídia devolvem `DATA_NOT_AVAILABLE` com o motivo — nunca número estimado.
- **Sem limite de taxa por usuário** além do que o SDK aplica nos endpoints de OAuth.
