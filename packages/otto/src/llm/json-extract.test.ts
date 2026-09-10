import { describe, expect, it } from 'vitest';
import { extractJsonPayload, parseJsonLoose } from './json-extract.js';

/**
 * O contrato aqui tem dois lados e os DOIS importam: desembrulhar JSON íntegro
 * (pra não gastar outra geração inteira só por causa de cerca de markdown) e
 * NÃO consertar conteúdo (pra não inventar plano criativo que o modelo não
 * entregou).
 */

describe('extractJsonPayload: desembrulha', () => {
  it('devolve JSON puro como está', () => {
    expect(extractJsonPayload('{"a":1}')).toBe('{"a":1}');
  });

  it('tira cerca de markdown com dica de linguagem', () => {
    expect(extractJsonPayload('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('tira cerca de markdown sem dica de linguagem', () => {
    expect(extractJsonPayload('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('tira prefacio em prosa antes da primeira chave', () => {
    expect(extractJsonPayload('Claro! Aqui está o plano:\n{"a":1}')).toBe('{"a":1}');
  });

  it('tira epilogo em prosa depois da ultima chave', () => {
    expect(extractJsonPayload('{"a":1}\n\nEspero que ajude!')).toBe('{"a":1}');
  });

  it('tira bloco de raciocinio vazado no corpo', () => {
    expect(extractJsonPayload('<think>preciso montar o objeto...</think>\n{"a":1}')).toBe('{"a":1}');
  });

  it('pega o objeto mais externo, nao um aninhado', () => {
    const raw = 'texto {"externo":{"interno":2}} fim';
    expect(extractJsonPayload(raw)).toBe('{"externo":{"interno":2}}');
  });

  it('funciona com array no topo', () => {
    expect(extractJsonPayload('```json\n[{"a":1}]\n```')).toBe('[{"a":1}]');
  });
});

describe('extractJsonPayload: nao inventa', () => {
  it('devolve null quando nao ha nada parecido com JSON', () => {
    expect(extractJsonPayload('nao consegui gerar o plano agora')).toBeNull();
  });

  it('devolve null pra texto vazio', () => {
    expect(extractJsonPayload('   ')).toBeNull();
  });

  it('nao fecha JSON truncado: devolve o trecho, que segue invalido', () => {
    // O modelo cortou no meio. A função NÃO completa a chave faltando; o
    // parse falha depois e a correção com o modelo acontece, como deve.
    const truncated = '{"a":1,"b":';
    expect(parseJsonLoose(truncated).ok).toBe(false);
  });
});

describe('parseJsonLoose', () => {
  it('caminho normal: JSON puro, sem reparo', () => {
    const result = parseJsonLoose('{"titulo":"Campanha"}');
    expect(result).toEqual({ ok: true, value: { titulo: 'Campanha' }, repaired: false });
  });

  it('marca repaired quando precisou desembrulhar', () => {
    const result = parseJsonLoose('```json\n{"titulo":"Campanha"}\n```');
    expect(result.ok).toBe(true);
    expect(result.ok && result.repaired).toBe(true);
    expect(result.ok && result.value).toEqual({ titulo: 'Campanha' });
  });

  it('erro honesto quando nem o desembrulho salva', () => {
    const result = parseJsonLoose('isso nao e JSON');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('invalid JSON');
  });

  it('nao troca conteudo: o valor sai igual ao que o modelo escreveu', () => {
    const payload = { concept: 'O forno como palco', slides: [1, 2, 3], nested: { deep: null } };
    const result = parseJsonLoose(`\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``);
    expect(result.ok && result.value).toEqual(payload);
  });
});
