import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from './nav-items';

/**
 * TODO DESTINO DA BARRA LATERAL TEM QUE EXISTIR NO REPOSITÓRIO, não só no disco.
 *
 * Em 09/10/2026 o item "Desigual · Agência" apontava para `/agencia`, e
 * `app/(shell)/agencia/page.tsx` estava UNTRACKED. Em checkout limpo, clicar no
 * nome da agência dava 404 — e ninguém via, porque na máquina de quem
 * desenvolve o arquivo está lá. No mesmo dia apareceu um segundo caso: o
 * `bento-bolha.tsx`, importado pelo shell e fora do repositório.
 *
 * Os dois têm a mesma forma: o produto funciona porque o arquivo está no
 * DISCO, e o deploy sai do DIRETÓRIO. Some no primeiro deploy feito de clone
 * limpo, sem erro nenhum, só a tela deixando de existir.
 *
 * Por isso este teste pergunta ao GIT, não ao sistema de arquivos. Checar
 * `existsSync` passaria nos dois casos e não protegeria de nada.
 */

/** Caminhos que o Next resolve para a mesma rota, em ordem de preferência. */
function arquivosPossiveis(href: string): string[] {
  const rota = href.split('?')[0]!.replace(/\/$/, '');
  const base = rota === '' || rota === '/' ? 'src/app/(shell)/page' : `src/app/(shell)${rota}/page`;
  return [`${base}.tsx`, `${base}.ts`];
}

function existeNoGit(caminho: string): boolean {
  try {
    // `-e` sai com 0 se o objeto existe no HEAD e 1 se não. Qualquer outro
    // problema (não é repo, git ausente) lança, e aí o teste falha dizendo
    // isso, em vez de aprovar por engano.
    execFileSync('git', ['cat-file', '-e', `HEAD:apps/web/${caminho}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * DÍVIDA CONHECIDA EM 09/10/2026, com data porque ela tem que encolher.
 *
 * Estas páginas existem no disco e NÃO no repositório. Funcionam para quem
 * desenvolve e somem no primeiro deploy feito de clone limpo. Não foram
 * adotadas aqui porque são de outra sessão e adotar trabalho de terceiro sem
 * perguntar é pior que a dívida.
 *
 * A lista está aqui para o portão valer HOJE contra caso NOVO, em vez de
 * esperar alguém resolver o passado. Ela não é um depósito: o segundo teste
 * abaixo reprova se uma entrada daqui já tiver sido commitada, obrigando a
 * remoção. Dívida registrada que ninguém remove vira permissão permanente.
 */
const PENDENTES_DE_COMMIT = ['/inbox', '/demands'] as const;

describe('destinos da navegação', () => {
  const internos = NAV_ITEMS.filter((item) => item.href.startsWith('/') && !item.href.startsWith('//'));

  it('a barra lateral tem itens para conferir', () => {
    // Guarda contra o teste virar vácuo se `NAV_ITEMS` mudar de forma: um
    // teste que não encontra nada para checar passa sem checar nada.
    expect(internos.length).toBeGreaterThan(5);
  });

  it('todo href da barra lateral tem página COMMITADA', () => {
    const quebrados = internos
      .filter((item) => !arquivosPossiveis(item.href).some(existeNoGit))
      .filter((item) => !PENDENTES_DE_COMMIT.includes(item.href as (typeof PENDENTES_DE_COMMIT)[number]))
      .map((item) => `${item.label} → ${item.href}`);

    expect(
      quebrados,
      'Estes itens da barra lateral levam a rotas que não existem no HEAD. ' +
        'Em checkout limpo elas dão 404, mesmo funcionando nesta máquina. ' +
        'Commite a página junto do link.',
    ).toEqual([]);
  });

  it('a lista de pendentes só encolhe', () => {
    const jaCommitadas = PENDENTES_DE_COMMIT.filter((href) => arquivosPossiveis(href).some(existeNoGit));

    expect(
      jaCommitadas,
      'Estas rotas já estão commitadas e continuam na lista de pendentes. ' +
        'Tire-as de PENDENTES_DE_COMMIT: dívida registrada que ninguém remove vira permissão permanente.',
    ).toEqual([]);
  });
});
