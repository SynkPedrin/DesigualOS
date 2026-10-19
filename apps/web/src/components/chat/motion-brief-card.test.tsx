import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMotionBriefRequestWire } from '@/lib/api/contracts';
import {
  MotionBriefCard,
  buildMotionBrief,
  initialBriefFields,
  type MotionBriefFields,
} from './motion-brief-card';

/**
 * O POST /chat real é mockado no nível do apiFetch: o que se testa aqui é o
 * ENVELOPE — o card precisa mandar motion_brief só com o que foi preenchido,
 * com client_id/conversation_id do fio original e o texto "Gerar motion: ...".
 */
const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({ apiFetch: apiFetchMock }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function emptyFields(overrides: Partial<MotionBriefFields> = {}): MotionBriefFields {
  return { ...initialBriefFields(undefined), duration: '', ...overrides };
}

afterEach(() => {
  document.body.innerHTML = '';
  apiFetchMock.mockReset();
});

describe('buildMotionBrief', () => {
  it('campo vazio NÃO vai: formulário zerado gera objeto vazio', () => {
    expect(buildMotionBrief(emptyFields())).toEqual({});
  });

  it('monta só com os campos preenchidos, trimados', () => {
    const brief = buildMotionBrief(
      emptyFields({ campaignName: '  Verão 2027 ', objective: 'Vender agora', cta: 'Compre agora', tone: 'Premium' }),
    );
    expect(brief).toEqual({ campaignName: 'Verão 2027', objective: 'Vender agora', cta: 'Compre agora', tone: 'Premium' });
  });

  it('oferta agrupa nome/valor/condição e só existe se algo nela foi preenchido', () => {
    expect(buildMotionBrief(emptyFields({ price: 'R$ 297' })).offer).toEqual({ price: 'R$ 297' });
    const completa = buildMotionBrief(emptyFields({ offerName: 'Tênis Runner', price: 'R$ 297', condition: '12x de R$ 29,70' }));
    expect(completa.offer).toEqual({ name: 'Tênis Runner', price: 'R$ 297', condition: '12x de R$ 29,70' });
    expect(buildMotionBrief(emptyFields()).offer).toBeUndefined();
  });

  it('valor e condição passam verbatim — são fatos comerciais, nunca reformatados', () => {
    const brief = buildMotionBrief(emptyFields({ price: 'De R$ 497 por R$ 297', condition: '12x de R$ 29,70 sem juros' }));
    expect(brief.offer?.price).toBe('De R$ 497 por R$ 297');
    expect(brief.offer?.condition).toBe('12x de R$ 29,70 sem juros');
  });

  it('duração só vai quando é inteiro positivo; fps atravessa do prefill', () => {
    expect(buildMotionBrief(emptyFields({ duration: 'abc' })).duration).toBeUndefined();
    expect(buildMotionBrief(emptyFields({ duration: '0' })).duration).toBeUndefined();
    expect(buildMotionBrief(emptyFields({ duration: '15', fps: 30 }))).toEqual({ duration: 15, fps: 30 });
  });

  it('duração default do formulário (15s) é enviada', () => {
    expect(buildMotionBrief(initialBriefFields(undefined))).toEqual({ duration: 15 });
  });
});

describe('initialBriefFields (prefill do motion_brief_request)', () => {
  it('aplica campaignName, duration, fps e aspectRatio do prefill', () => {
    const fields = initialBriefFields({ campaignName: 'Verão 2027', duration: 20, fps: 30, aspectRatio: '9:16' });
    expect(fields.campaignName).toBe('Verão 2027');
    expect(fields.duration).toBe('20');
    expect(fields.fps).toBe(30);
    expect(fields.aspectRatio).toBe('9:16');
  });

  it('sem prefill, duração cai no default 15', () => {
    expect(initialBriefFields(undefined).duration).toBe('15');
  });
});

describe('MotionBriefCard montado', () => {
  const request: ChatMotionBriefRequestWire = {
    client_id: 'client-1',
    prefill: { campaignName: 'Verão 2027', duration: 20, fps: 30, aspectRatio: '9:16' },
  };

  async function mount() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const client = new QueryClient();
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <MotionBriefCard request={request} conversationId="conv-1" />
        </QueryClientProvider>,
      );
    });
    return { host, root };
  }

  it('renderiza o prefill nos campos', async () => {
    const { host } = await mount();
    const campaign = host.querySelector<HTMLInputElement>('input[placeholder="Ex.: Coleção Verão 2027"]');
    const duration = host.querySelector<HTMLInputElement>('input[type="number"]');
    expect(campaign?.value).toBe('Verão 2027');
    expect(duration?.value).toBe('20');
    const activeChip = host.querySelector('button[aria-pressed="true"], button.border-roxo-eletrico\\/70');
    expect(activeChip?.textContent).toContain('9:16');
  });

  it('submete POST /chat com motion_brief só dos campos preenchidos e colapsa pro resumo', async () => {
    apiFetchMock.mockResolvedValue({
      execution_id: 'exec-1',
      status: 'queued',
      agent: 'otto',
      conversation_id: 'conv-1',
    });
    const { host } = await mount();

    const submit = host.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit).toBeTruthy();
    await act(async () => {
      submit!.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = apiFetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('/chat');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body) as Record<string, unknown>;
    expect(body.client_id).toBe('client-1');
    expect(body.conversation_id).toBe('conv-1');
    expect(body.message).toBe('Gerar motion: Verão 2027');
    expect(body.motion_brief).toEqual({ campaignName: 'Verão 2027', duration: 20, fps: 30, aspectRatio: '9:16' });

    expect(host.textContent).toContain('Briefing enviado');
  });

  it('falha no POST mostra erro e mantém o formulário aberto', async () => {
    apiFetchMock.mockRejectedValue(new Error('500'));
    const { host } = await mount();
    const submit = host.querySelector<HTMLButtonElement>('button[type="submit"]');
    await act(async () => {
      submit!.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(host.textContent).toContain('Não consegui enviar o briefing');
    expect(host.querySelector('button[type="submit"]')).toBeTruthy();
  });
});
