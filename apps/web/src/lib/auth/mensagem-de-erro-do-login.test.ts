import { describe, expect, it } from 'vitest';
import { mensagemDeErroDoLogin } from './mensagem-de-erro-do-login';

describe('mensagem de erro do login', () => {
  it('traduz as mensagens do Supabase', () => {
    expect(mensagemDeErroDoLogin('Invalid login credentials')).toMatch(/^E-mail ou senha incorretos/);
    expect(mensagemDeErroDoLogin('Email not confirmed')).toMatch(/não foi confirmado/);
    expect(mensagemDeErroDoLogin('Request rate limit reached')).toMatch(/Muitas tentativas/);
  });
  it('mensagem desconhecida passa como veio', () => {
    expect(mensagemDeErroDoLogin('Algo novo')).toBe('Algo novo');
  });
});
