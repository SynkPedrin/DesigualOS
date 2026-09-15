import { describe, expect, it } from 'vitest';
import { extractPreferences, preferenceContent, preferenceSubject } from './preference-extraction';

describe('extractPreferences — o que VIRA memória', () => {
  it('instrução de cliente com aspecto explícito', () => {
    const [p] = extractPreferences('Para o Cliente Teste QA, prefira headlines curtas, diretas e sem emojis.');
    expect(p?.scope).toBe('client');
    // O nome sai SEM a palavra "cliente": quem resolve pro id faz busca
    // tolerante, e "cliente Envu" nunca é o nome real do cliente.
    expect(p?.clientName).toBe('Teste QA');
    expect(p?.aspect).toBe('headline');
    expect(p?.value).toMatch(/curtas/);
  });

  it('forma "Cliente X agora prefere ..." (supersessão)', () => {
    const [p] = extractPreferences('Cliente Teste QA agora prefere headlines editoriais, longas, e pode usar emojis.');
    expect(p?.clientName).toBe('Teste QA');
    expect(p?.aspect).toBe('headline');
    expect(p?.value).toMatch(/editoriais/);
  });

  it('proibição também é preferência', () => {
    const [p] = extractPreferences('Para o Cliente Atlas, nunca use emojis nas legendas.');
    expect(p?.aspect).toBe('emoji');
  });

  it('sem cliente, só salva quando pedem pra guardar', () => {
    expect(extractPreferences('use headlines curtas')).toHaveLength(0);
    const [p] = extractPreferences('Guarde isso: sempre use headlines curtas e diretas.');
    expect(p?.scope).toBe('user');
  });
});

describe('extractPreferences — o que NÃO vira memória', () => {
  it.each([
    'ok',
    'valeu',
    'obrigado',
    'faz outra',
    'gostei dessa headline',
    'Bento, quantas tarefas vencem hoje?',
    'cria um post pro Cliente Atlas',
    'Oi, tudo bem?',
  ])('%s', (m) => {
    expect(extractPreferences(m)).toHaveLength(0);
  });

  it('instrução sem aspecto reconhecível não vira regra solta', () => {
    expect(extractPreferences('Para o Cliente Atlas, prefira o caminho mais rápido.')).toHaveLength(0);
  });

  it('texto gigante (provavelmente briefing colado) não vira preferência', () => {
    expect(extractPreferences('Para o Cliente Atlas, prefira headlines curtas. ' + 'x'.repeat(500))).toHaveLength(0);
  });
});

describe('subject — identidade do fato (base da supersessão)', () => {
  it('mesmo cliente + mesmo aspecto = mesmo subject', () => {
    expect(preferenceSubject('cli-1', 'headline')).toBe('cliente:cli-1:headline');
  });
  it('aspectos diferentes convivem', () => {
    expect(preferenceSubject('cli-1', 'headline')).not.toBe(preferenceSubject('cli-1', 'emoji'));
  });
  it('clientes diferentes NÃO colidem (isolamento)', () => {
    expect(preferenceSubject('cli-1', 'headline')).not.toBe(preferenceSubject('cli-2', 'headline'));
  });
});

describe('preferenceContent', () => {
  it('vira texto curto e acionável pro prompt', () => {
    const [p] = extractPreferences('Para o Cliente Atlas, prefira headlines curtas e sem emojis.');
    expect(preferenceContent(p!)).toMatch(/^Preferência de headline: /);
  });
});
