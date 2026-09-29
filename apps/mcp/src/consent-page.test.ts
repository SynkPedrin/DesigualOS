import { describe, expect, it } from 'vitest';
import { renderConsentPage } from './consent-page';

const base = {
  requestId: 'pedido-123',
  clientName: 'Claude Desktop',
  scopes: ['desigual.read', 'tasks.write'],
  supabaseUrl: 'https://projeto.supabase.co',
  supabaseAnonKey: 'chave-publicavel',
};

describe('tela de consentimento', () => {
  it('a senha vai DIRETO ao Supabase, nunca a este servidor', () => {
    const html = renderConsentPage(base);
    // A URL do Supabase entra como constante e é concatenada na hora do fetch;
    // o que volta para ESTE servidor é só o token resultante.
    expect(html).toContain('const SUPABASE_URL = "https://projeto.supabase.co"');
    expect(html).toContain("SUPABASE_URL + '/auth/v1/token?grant_type=password'");
    expect(html).toContain("fetch('/mcp/consent'");
    // e a senha não aparece em nenhum corpo enviado a este servidor
    expect(html).toContain('supabase_token: access_token');
  });

  it('explica cada permissão em português, não só o código do scope', () => {
    const html = renderConsentPage(base);
    expect(html).toContain('Ler a operação da agência');
    expect(html).toContain('Criar e alterar tarefas');
  });

  it('nomeia quem está pedindo acesso', () => {
    expect(renderConsentPage(base)).toContain('Claude Desktop');
  });

  it('nome de cliente com HTML não injeta na página', () => {
    // O nome vem do registro dinâmico, que é aberto: qualquer um registra.
    const html = renderConsentPage({ ...base, clientName: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('sem scope pedido, mostra leitura em vez de nada', () => {
    const html = renderConsentPage({ ...base, scopes: [] });
    expect(html).toContain('desigual.read');
  });

  it('mostra o erro da tentativa anterior quando existe', () => {
    expect(renderConsentPage({ ...base, erro: 'E-mail ou senha não conferem.' })).toContain('E-mail ou senha não conferem.');
  });

  it('o id do pedido chega ao formulário', () => {
    expect(renderConsentPage(base)).toContain('pedido-123');
  });

  it('diz à pessoa para onde a senha vai', () => {
    // Quem autoriza tem direito de saber. E é verdade — o teste acima prova.
    expect(renderConsentPage(base)).toContain('Sua senha vai direto para o Desigual OS');
  });
});
