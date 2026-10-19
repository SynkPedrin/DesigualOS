import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * O SHA do commit, resolvido NA HORA DO BUILD para ser assado no bundle.
 *
 * Por que isto existe, e por que não basta o `release-info.ts` ler o git em
 * runtime: a imagem de produção (Dockerfile.prod) roda `node dist/server.js`
 * num container que não tem `.git` — e nem o estágio de build tem, porque
 * `.git` está no `.dockerignore` (linha 25, e deve continuar lá: o histórico
 * inteiro no contexto de build é caro e não serve pra nada em runtime).
 *
 * Resultado medido em 08/10/2026, contra a produção no ar:
 * `GET https://api.citavel.ai/health` → `"release_sha":"unknown"`. Ou seja, o
 * campo que existe exatamente pra provar QUAL commit está rodando não provava
 * nada desde que o deploy virou container.
 *
 * Aqui o valor é resolvido na máquina que builda (que tem git, ou que recebeu
 * `RELEASE_SHA` do pipeline) e vira literal dentro do JS gerado. Depois disso
 * ele não depende mais de nada do ambiente de runtime.
 *
 * Degrada pra 'unknown' — o mesmo valor de hoje —, nunca quebra o build: um
 * build sem git e sem a variável continua produzindo um bundle que sobe.
 */
export function shaDeRelease() {
  const doAmbiente = process.env.RELEASE_SHA?.trim();
  if (doAmbiente) return doAmbiente;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * A tag da última migration, resolvida NA HORA DO BUILD pelo mesmo motivo que
 * o SHA acima — e descoberta pelo mesmo teste.
 *
 * `packages/database/src/schema-version.ts` lê
 * `database/migrations/meta/_journal.json` do disco, por caminho relativo a
 * `import.meta.url`. O Dockerfile.prod copia para a imagem apenas
 * `apps/<app>/dist`, o `package.json` do app e `Brain-Marketing`: a pasta
 * `database/` nunca entra. O `readFileSync` falha, o `catch` devolve
 * 'unknown', e ninguém fica sabendo.
 *
 * Medido em 08/10/2026: produção respondia `"schema_version":"unknown"`
 * enquanto o MESMO bundle, rodado deste checkout, respondia
 * `"0066_crazy_pride"`. O campo existe pra provar que o processo concorda com
 * o banco que ele lê, e estava provando nada.
 *
 * Copiar `database/migrations` pra imagem também resolveria, mas amarraria a
 * imagem a mais um caminho relativo frágil — o Dockerfile já carrega um aviso
 * em letras maiúsculas sobre "manter a mesma profundidade de pastas" por
 * causa do Brain-Marketing. A tag é um fato do código, conhecido no build:
 * ela pertence ao bundle, não ao sistema de arquivos de runtime.
 */
export function versaoDoSchema() {
  try {
    const caminho = new URL('../database/migrations/meta/_journal.json', import.meta.url);
    const journal = JSON.parse(readFileSync(caminho, 'utf8'));
    return journal.entries?.at(-1)?.tag ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
