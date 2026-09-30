'use client';

import { useEffect } from 'react';
import { useMe } from '@/hooks/use-me';

/**
 * A MARCA DA EMPRESA, aplicada em tempo de execução.
 *
 * É o que torna o produto white-label sem virar um build por cliente. A seção
 * 68 do briefing é explícita: "não criar build independente por cliente;
 * white-label deve vir de configuração. Uma aplicação. Múltiplos tenants."
 *
 * COMO FUNCIONA: sobrescreve as variáveis `--color-brand-*` no <html>. Todo
 * componente que lê um token de marca re-tematiza sozinho, sem saber que existe
 * tenant — do mesmo jeito que o tema claro já re-aponta os tokens em vez de
 * duplicar um conjunto paralelo.
 *
 * O QUE ELE NÃO FAZ, e é decisão: não aceita CSS arbitrário por empresa. A
 * seção 20 pede "personalização simples", não um editor de design. Cor fora do
 * sistema de tokens quebra contraste, acessibilidade e o resto da interface de
 * formas que ninguém testa — e o suporte vira refém de uma escolha de cor de um
 * cliente.
 *
 * ESTADO DE HOJE, dito com clareza para ninguém achar que está pronto: a
 * configuração de marca por empresa ainda NÃO existe no banco (é schema, e está
 * com a outra sessão). Então este componente hoje não muda nada — ele é o
 * encaixe pronto, não a feature entregue. Quando os campos existirem, é aqui
 * que entram, e nenhuma tela precisa mudar.
 */

export interface MarcaDaEmpresa {
  primary?: string | null;
  secondary?: string | null;
  accent?: string | null;
}

/**
 * Só aceita cor em formato conhecido. Uma string arbitrária vinda de
 * configuração entraria direto numa variável CSS — e daí num `style`, que é
 * superfície de injeção. Formato validado é mais barato que confiança.
 */
const COR_VALIDA = /^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{3}$|^(rgb|hsl)a?\([\d\s.,%/]+\)$/;

export function corSegura(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const limpo = valor.trim();
  return COR_VALIDA.test(limpo) ? limpo : null;
}

/** Aplica ao documento. Exportada para ter teste sem montar componente. */
export function aplicarMarca(raiz: HTMLElement, marca: MarcaDaEmpresa | null): void {
  const mapa: Array<[string, string | null | undefined]> = [
    ['--color-brand-primary', marca?.primary],
    ['--color-brand-secondary', marca?.secondary],
    ['--color-brand-accent', marca?.accent],
  ];

  for (const [variavel, bruto] of mapa) {
    const cor = corSegura(bruto);
    // Sem cor configurada, REMOVE a sobrescrita em vez de escrever um valor
    // padrão: assim o token volta a apontar para o da Desigual, que é o
    // comportamento certo e o único que não precisa ser mantido em dois lugares.
    if (cor) raiz.style.setProperty(variavel, cor);
    else raiz.style.removeProperty(variavel);
  }
}

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const { data: me } = useMe();
  // A configuração de marca ainda não existe no banco; quando existir, virá
  // aqui dentro de `organizacao_ativa` e nada mais precisa mudar.
  const marca = (me?.organizacao_ativa as { marca?: MarcaDaEmpresa } | null | undefined)?.marca ?? null;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    aplicarMarca(document.documentElement, marca);
  }, [marca]);

  return <>{children}</>;
}
