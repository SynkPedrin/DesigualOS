# Servidor da API nos EUA, ao lado do banco

**Por quê (medido em 19/10/2026).** A API rodava na VPS da Locaweb (Brasil) e o
banco é o Supabase em `us-east-1`. Cada consulta custava ~125 ms só de ida e
volta, e uma tela típica faz 10–20 consultas em sequência: tarefas do ClickUp
3,3 s, agenda 2,3 s, aprovações/quinzenas/inbox/clientes ~2 s. Com a API no
mesmo lugar do banco, a consulta cai para ~1–2 ms e a tela passa a pagar a
distância Brasil–EUA uma vez só (o navegador até a API), não uma por consulta.

## Desenho

```
navegador (BR) ──HTTPS──► api.citavel.ai  ── servidor EUA (us-east-1) ──┐
                                 api + worker + redis                     │ ~1–2 ms
                                         │                               ▼
                                         │ Tailscale (privado)     Supabase us-east-1
                                         ▼
                         VPS Locaweb (BR): OpenWA (WhatsApp, Chrome por número)
```

- O **OpenWA fica na VPS atual**: as sessões do WhatsApp (e os navegadores que
  cada número usa) não mudam de lugar, ninguém escaneia QR de novo.
- A API fala com o OpenWA pelo **Tailscale** (`OPENWA_BASE_URL=http://100.99.14.75:2785`),
  com `OPENWA_BIND=100.99.14.75` no `.env` da VPS para a porta escutar só na rede privada.
- O OpenWA avisa a API pelo endereço público: `OPENWA_WEBHOOK_URL=https://api.citavel.ai/openwa/webhook`.
  Os webhooks já registrados nas sessões apontam para `http://api:3001/...` (nome
  interno do compose) e precisam ser atualizados na virada (passo 6).

## Servidor

- Região: **AWS `us-east-1` (Virgínia)** — o mesmo datacenter do Supabase. Lightsail
  ou EC2. Costa leste de outro provedor (DigitalOcean NYC, Hetzner Ashburn) também
  serve, com ~5–10 ms por consulta em vez de ~1–2 ms.
- Tamanho: 2 vCPU / 4 GB basta (API, worker e Redis; o WhatsApp não vai para lá).
- Ubuntu 24.04, Docker, Tailscale na mesma rede (tailnet) da VPS e dos Node Agents.

## Virada

1. Servidor novo com Docker e Tailscale; clonar o repositório em `/opt/desigual-os`.
2. Copiar o `.env` da VPS e ajustar: `OPENWA_BASE_URL`, `OPENWA_WEBHOOK_URL` (acima).
3. Copiar o volume de mídia do WhatsApp (`whatsapp_media`) da VPS para o servidor novo.
4. Na VPS: `OPENWA_BIND=100.99.14.75` no `.env` e `docker compose ... up -d --no-deps openwa`.
5. No servidor novo: `docker compose -f docker-compose.prod.yml --env-file .env up -d --build redis api worker`
   (o `openwa` NÃO sobe lá). Conferir `GET /health` pelo IP.
6. Atualizar o webhook de cada sessão do OpenWA para `OPENWA_WEBHOOK_URL` (admin API do OpenWA).
7. Nginx + TLS no servidor novo para `api.citavel.ai`; trocar o DNS para o IP novo.
8. Na VPS, parar `api` e `worker` (o `redis` dela deixa de ser usado). Manter por alguns
   dias como volta rápida: reverter o DNS devolve tudo como era.
