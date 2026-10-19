import { describe, expect, it } from 'vitest';
import { casarMembroDoClickUp } from './clickup-client';

const m = (id: number, email: string, username: string) => ({ id, email, username, profilePicture: null, initials: null, color: null });
const TIME = [m(1, 'alicia@segundocerebro.pro', 'Alicia'), m(2, 'jamile@segundocerebro.pro', 'Jamile Galdino'), m(3, 'ana@x.com', 'Ana'), m(4, 'ana@y.com', 'Ana Souza')];

describe('casarMembroDoClickUp', () => {
  it('domínios diferentes, mesma parte antes do @', () => {
    expect(casarMembroDoClickUp({ email: 'alicia@institutoalmada.org' }, TIME)?.id).toBe(1);
  });
  it('pelo nome completo quando o e-mail não casa', () => {
    expect(casarMembroDoClickUp({ email: 'jg@outro.com', nome: 'Jamile Galdino' }, TIME)?.id).toBe(2);
  });
  it('dois candidatos: não chuta', () => {
    expect(casarMembroDoClickUp({ email: 'ana@outro.com' }, TIME)).toBeNull();
  });
  it('ninguém: null', () => {
    expect(casarMembroDoClickUp({ email: 'zed@outro.com', nome: 'Zed' }, TIME)).toBeNull();
  });
});
