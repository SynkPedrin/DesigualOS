/**
 * E2E REAL — Otto Motion Engine pelo FRONTEND (diagnóstico interno, 24/09/2026).
 *
 * Não é spec de CI: é a prova de aceitação dirigida por browser contra a stack
 * local (web :3000, api :3001, worker + Opus 5.5 de verdade). Gera V1, pede
 * alteração pelo chat, gera V2, e valida persistência recarregando a página.
 *
 * Uso:
 *   pnpm REAL_OPUS_E2E          (na raiz do monorepo)
 *   pnpm --filter web exec tsx scripts/motion-e2e-ui.mts
 *
 * O PREFLIGHT roda antes de abrir o browser: se o provider claude não estiver
 * CONNECTED, dispara UMA vez o probe real (POST /motion/providers/claude/test —
 * é ele que limpa o estado de quota quando o limite semanal renova). Sem quota
 * o script sai com código 1 ANTES de qualquer outra chamada, pra não gastar
 * render nem login à toa.
 *
 * Credenciais: /tmp/qa-motion-creds.json (usuário QA master criado pro teste).
 * Artefatos: artifacts/motion-frontend-e2e-<data>/
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const API = process.env.E2E_API_URL ?? 'http://localhost:3001';
const CLIENTE = process.env.E2E_CLIENTE ?? 'John Deere';
const OUT = `../../artifacts/motion-frontend-e2e-${new Date().toISOString().slice(0, 10)}`;
mkdirSync(OUT, { recursive: true });

const { email, password } = JSON.parse(readFileSync('/tmp/qa-motion-creds.json', 'utf8'));

function log(step: string, extra?: unknown) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${step}`, extra ?? '');
}

function parseEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) out[match[1]] = match[2];
  }
  return out;
}

async function apiToken(): Promise<string> {
  const root = parseEnv('../../.env');
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(root.SUPABASE_URL, root.SUPABASE_PUBLISHABLE_KEY);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session.access_token;
}

async function apiGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function apiPost<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

interface ProviderWire {
  provider: string;
  state: string;
  message: string;
}

/**
 * PREFLIGHT de quota — roda ANTES de abrir o browser. Sem o Opus 5.5 o E2E
 * real só queimaria chamadas (login, turno do Otto, abertura de sessão) pra
 * falhar no mesmo lugar de sempre: aqui ele falha barato, com o motivo.
 *
 * O POST /motion/providers/claude/test é o probe REAL (chama o CLI de
 * verdade) — é a mesma chamada do botão "Testar conexão" das settings, e é
 * ela que limpa o estado de quota registrado quando o limite semanal renova.
 * Por isso UMA tentativa só: se nem o probe reabilita, insistir é desperdício.
 */
async function preflightOpusDisponivel(token: string): Promise<void> {
  const lerClaude = async () =>
    (await apiGet<{ providers: ProviderWire[] }>(token, '/motion/providers')).providers.find(
      (p) => p.provider === 'claude',
    );

  let claude = await lerClaude();
  if (claude?.state !== 'CONNECTED') {
    log(`preflight: claude em "${claude?.state ?? 'ausente'}" — uma tentativa de probe real antes de desistir`);
    await apiPost(token, '/motion/providers/claude/test');
    claude = await lerClaude();
  }
  if (claude?.state !== 'CONNECTED') {
    console.error(`REAL_OPUS_E2E preflight: Opus 5.5 indisponível — state=${claude?.state ?? 'ausente'}`);
    console.error(`REAL_OPUS_E2E preflight: ${claude?.message ?? '(sem message do provider)'}`);
    console.error('Saindo ANTES de abrir o browser: sem quota, cada chamada seguinte seria desperdiçada.');
    process.exit(1);
  }
  log('REAL_OPUS_E2E preflight: Opus 5.5 disponível — iniciando E2E real');
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  log(`screenshot ${name}`);
}

async function expectPoll(read: () => Promise<number>, esperado: number, timeoutMs: number) {
  const inicio = Date.now();
  for (;;) {
    if ((await read()) >= esperado) return;
    if (Date.now() - inicio > timeoutMs) throw new Error(`expectPoll: valor não chegou a ${esperado} em ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function falar(page: Page, texto: string): Promise<void> {
  const campo = page.getByRole('textbox').first();
  await campo.fill(texto);
  await campo.press('Enter');
}

interface MotionWire {
  motionId: string;
  status: string;
  stage: string;
  stageDetail: string | null;
  renderVersion: number;
  previewUrl: string | null;
  finalUrl: string | null;
  clientName?: string | null;
  campaignName?: string | null;
  versions?: { version: number; quality: string; url: string | null; createdAt: string }[];
  assets?: { logo: boolean; images: number; videos: number } | null;
  error: string | null;
  errorCode: string | null;
}

async function motionDaConversa(token: string, conversationId: string): Promise<string | null> {
  const data = await apiGet<{ messages: { metadata?: { motion?: { motion_id?: string } } | null }[] }>(
    token,
    `/conversations/${conversationId}/messages`,
  );
  for (const m of [...data.messages].reverse()) {
    const id = m.metadata?.motion?.motion_id;
    if (id) return id;
  }
  return null;
}

async function esperarRender(
  token: string,
  motionId: string,
  versaoMinima: number,
  timeoutMs: number,
): Promise<MotionWire> {
  const inicio = Date.now();
  let ultimoStage = '';
  for (;;) {
    const m = await apiGet<MotionWire>(token, `/motion/${motionId}`);
    if (m.stage !== ultimoStage) {
      log(`status=${m.status} stage="${m.stage}"${m.stageDetail ? ` (${m.stageDetail})` : ''} v${m.renderVersion}`);
      ultimoStage = m.stage;
    }
    if (m.status === 'completed' && m.renderVersion >= versaoMinima) return m;
    if (m.status === 'failed') throw new Error(`motion falhou: ${m.errorCode} — ${m.error}`);
    if (Date.now() - inicio > timeoutMs) throw new Error(`timeout esperando render v${versaoMinima} (status=${m.status} stage=${m.stage})`);
    await new Promise((r) => setTimeout(r, 20_000));
  }
}

async function main() {
  const token = await apiToken();
  await preflightOpusDisponivel(token);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(60_000);

  // 1. LOGIN
  await page.goto(`${BASE}/login`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: /entrar/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 45_000 });
  log('login ok');

  // 2. CHAT DO OTTO + CLIENTE
  await page.goto(`${BASE}/chat?agent=otto`);
  if (await page.getByText(/NOTIFICAÇÕES NOVAS/i).isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
  }
  const novo = page.getByRole('button', { name: /novo chat/i });
  if (await novo.isVisible().catch(() => false)) await novo.click();

  // primeira mensagem só pra o seletor de cliente aparecer (padrão release-smoke)
  await page.getByRole('textbox').first().fill('Otto, oi — só abrindo a tela antes de selecionar o cliente.');
  await page.getByRole('textbox').first().press('Enter');
  await page.getByTestId('chat-assistant-bubble').first().waitFor({ timeout: 300_000 });
  const select = page.locator('select').first();
  await select.selectOption({ label: CLIENTE });
  log(`cliente selecionado: ${CLIENTE}`);
  await shot(page, '01-chat-cliente');

  // 3. PEDIDO DE MOTION -> CARD DE BRIEFING
  const bolhas = page.getByTestId('chat-assistant-bubble');
  const antes = await bolhas.count();
  await page.getByRole('textbox').first().fill('Crie um motion para a campanha de setembro.');
  await page.getByRole('textbox').first().press('Enter');
  // espera a NOVA bolha (a anterior já está visível — contar, não esperar a última)
  await expectPoll(() => bolhas.count(), antes + 1, 300_000);
  await page.waitForTimeout(2500); // typewriter
  const textoCard = await bolhas.nth(antes).innerText();
  log('resposta do Otto:', textoCard.slice(0, 300));
  const gerarBtn = page.getByRole('button', { name: /gerar motion/i });
  await gerarBtn.waitFor({ timeout: 120_000 });
  await shot(page, '02-card-briefing');

  // 4. PREENCHE BRIEFING (sem preço: cliente não tem valor documentado — §22)
  await page.getByLabel('Campanha').fill('Tecnologia no campo — Setembro');
  await page.getByLabel('Objetivo').fill('Reforçar marca');
  await page.getByLabel('CTA').fill('Saiba mais');
  await page.getByLabel('Público').fill('Produtores rurais e operações agrícolas de médio e grande porte');
  await page.getByRole('button', { name: 'Reels/Stories 9:16' }).click();
  await page.getByRole('button', { name: 'Premium', exact: true }).click();
  await page
    .getByLabel('Observação')
    .fill('Peça institucional high-end sobre tecnologia e força da marca no agro. Não exibir preço — campanha sem oferta comercial.');
  await shot(page, '03-briefing-preenchido');
  await gerarBtn.click();
  await page.getByText(/Briefing enviado/).waitFor({ timeout: 60_000 });
  log('briefing enviado');

  // 5. V1 — acompanha pelo card + API
  await page.waitForURL(/conversation=/, { timeout: 60_000 });
  const conversationId = new URL(page.url()).searchParams.get('conversation')!;
  log('conversation:', conversationId);
  const motionId = await (async () => {
    const inicio = Date.now();
    for (;;) {
      const id = await motionDaConversa(token, conversationId).catch(() => null);
      if (id) return id;
      // O ack com metadata.motion nasce quando o worker processa o turno —
      // alguns segundos depois do clique, não no mesmo instante.
      if (Date.now() - inicio > 180_000) return null;
      await new Promise((r) => setTimeout(r, 5000));
    }
  })();
  if (!motionId) throw new Error('mensagem com metadata.motion não apareceu na conversa');
  log('motionId:', motionId);
  const v1 = await esperarRender(token, motionId, 1, 55 * 60_000);
  if (v1.clientName !== CLIENTE) throw new Error(`clientName inesperado: ${v1.clientName}`);
  log('V1 COMPLETA', { url: v1.finalUrl ?? v1.previewUrl, versions: v1.versions?.length, assets: v1.assets });
  writeFileSync(`${OUT}/v1-status.json`, JSON.stringify(v1, null, 2));
  await page.waitForTimeout(6000); // card atualiza via polling/evento
  await shot(page, '04-v1-player');

  // player toca de verdade
  const video = page.locator('video').first();
  await video.waitFor({ timeout: 60_000 });
  const duracao = await video.evaluate((el: HTMLVideoElement) => el.duration);
  log('duração do player (s):', duracao);
  if (!Number.isFinite(duracao) || duracao < 5) throw new Error(`player sem duração válida: ${duracao}`);
  await video.evaluate((el: HTMLVideoElement) => void el.play());
  await page.waitForTimeout(2000);
  await shot(page, '05-v1-playing');

  // 6. ALTERAÇÃO CONVERSACIONAL -> V2 no MESMO motion
  await page.getByRole('textbox').first().fill('Deixa a segunda cena mais dinâmica e faz o CTA entrar antes. Não altere o resto.');
  await page.getByRole('textbox').first().press('Enter');
  await page.waitForTimeout(3000);
  const v2 = await esperarRender(token, motionId, 2, 45 * 60_000);
  log('V2 COMPLETA', { url: v2.finalUrl ?? v2.previewUrl, versions: v2.versions?.map((v) => `${v.quality}v${v.version}`) });
  writeFileSync(`${OUT}/v2-status.json`, JSON.stringify(v2, null, 2));
  if (!v2.versions || v2.versions.length < 2) throw new Error('versions não preservou V1+V2');
  await page.waitForTimeout(6000);
  await shot(page, '06-v2-player');

  // nome do download
  const download = await page.getByRole('link', { name: /baixar/i }).first().getAttribute('download');
  log('download filename:', download);

  // 7. PERSISTÊNCIA — recarrega a página, player continua
  await page.reload();
  await page.locator('video').first().waitFor({ timeout: 120_000 });
  await shot(page, '07-reload-persistido');
  log('persistência ok (player presente após reload)');

  await browser.close();
  log('E2E COMPLETO ✔', { motionId, conversationId });

  // Bloco único de fechamento: tudo que alguém precisa pra auditar a rodada
  // sem reler o log inteiro (ids, URLs das duas versões, nome do download e
  // onde estão os screenshots).
  const urlV1 = v1.finalUrl ?? v1.previewUrl ?? 'n/a';
  const urlV2 = v2.finalUrl ?? v2.previewUrl ?? 'n/a';
  console.log(
    [
      '',
      '════════ RELATÓRIO — REAL_OPUS_E2E ════════',
      `motionId:       ${motionId}`,
      `conversationId: ${conversationId}`,
      `clientName:     ${v2.clientName ?? v1.clientName ?? 'n/a'}`,
      `campaignName:   ${v2.campaignName ?? v1.campaignName ?? 'n/a'}`,
      `V1:             ${urlV1}`,
      `V2:             ${urlV2}`,
      `versions:       ${(v2.versions ?? []).map((v) => `${v.quality} v${v.version}`).join(' | ') || 'n/a'}`,
      `download:       ${download ?? 'n/a'}`,
      `screenshots:    ${OUT}/ (01-chat-cliente … 07-reload-persistido)`,
      '════════════════════════════════════════════',
    ].join('\n'),
  );
}

main().catch((error) => {
  console.error('E2E FALHOU:', error);
  process.exit(1);
});
