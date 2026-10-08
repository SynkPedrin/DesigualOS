import { afterEach, describe, expect, it } from 'vitest';
import { origensDoFront, urlDoApp, urlDoAppCom } from './url-do-app';

/**
 * O DEFEITO QUE ESTE ARQUIVO TRAVA, medido em 07/10/2026 no .env de produção:
 *
 *     FRONTEND_URL=http://localhost:3000,https://desigual-os.vercel.app
 *
 * A lista nasceu para o CORS (o front local e o publicado são os dois
 * legítimos). Seis outros lugares — o `redirect_to` do convite, o da
 * redefinição de senha, os callbacks de OAuth do ClickUp e do Meta, e o botão
 * do e-mail — interpolavam a variável CRUA numa URL e produziam:
 *
 *     http://localhost:3000,https://desigual-os.vercel.app/convite
 *
 * que não é endereço de lugar nenhum. A forma da variável estava documentada
 * só no comentário ao lado do CORS; agora ela tem uma função, e esta suíte é o
 * que impede o próximo lugar de voltar a concatenar na mão.
 */

const original = process.env.FRONTEND_URL;
afterEach(() => {
  if (original === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = original;
});

describe('urlDoApp — a lista tem uma primeira entrada, e é ela que vale', () => {
  it('lista: a primeira entrada é o endereço canônico', () => {
    process.env.FRONTEND_URL = 'https://app.desigual.com,https://desigual-os.vercel.app';
    expect(urlDoApp()).toBe('https://app.desigual.com');
  });

  it('valor único continua valendo como antes', () => {
    process.env.FRONTEND_URL = 'https://app.desigual.com';
    expect(urlDoApp()).toBe('https://app.desigual.com');
  });

  it('espaços em volta das vírgulas não entram na URL', () => {
    process.env.FRONTEND_URL = ' https://app.desigual.com , https://outro.com ';
    expect(urlDoApp()).toBe('https://app.desigual.com');
  });

  it('barra final é removida — senão o caminho vira //convite', () => {
    process.env.FRONTEND_URL = 'https://app.desigual.com/';
    expect(urlDoAppCom('/convite')).toBe('https://app.desigual.com/convite');
  });

  it('ausente: cai no front de dev, nunca em string vazia', () => {
    delete process.env.FRONTEND_URL;
    expect(urlDoApp()).toBe('http://localhost:3000');
  });

  it('vazia ou só vírgulas: também cai no front de dev', () => {
    process.env.FRONTEND_URL = ' , , ';
    expect(urlDoApp()).toBe('http://localhost:3000');
  });
});

describe('urlDoAppCom — o caso que quebrava na prática', () => {
  it('o convite deixa de apontar para a lista inteira colada', () => {
    process.env.FRONTEND_URL = 'http://localhost:3000,https://desigual-os.vercel.app';
    expect(urlDoAppCom('/convite')).toBe('http://localhost:3000/convite');
    expect(urlDoAppCom('/convite')).not.toContain(',');
  });

  it('aceita caminho sem barra inicial sem grudar as partes', () => {
    process.env.FRONTEND_URL = 'https://app.desigual.com';
    expect(urlDoAppCom('reset-password')).toBe('https://app.desigual.com/reset-password');
  });
});

describe('origensDoFront — o CORS continua enxergando a lista inteira', () => {
  it('devolve todas as origens, na ordem declarada', () => {
    process.env.FRONTEND_URL = 'https://app.desigual.com,https://desigual-os.vercel.app';
    expect(origensDoFront()).toEqual(['https://app.desigual.com', 'https://desigual-os.vercel.app']);
  });
});
