import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createLogger } from '@desigual-os/logging';
import { createWorkspace, destroyWorkspace, type MotionWorkspace } from '../workspace/workspace.js';
import { PROTECTED_FILES, restoreProtectedFiles, writeScaffold, type ScaffoldConfig } from './scaffold.js';
import { bundleMotion } from './bundle.js';
import { encodedDimension, extractReviewFrames, previewScale, renderMotion } from './render.js';
import { findMissingStaticFiles, runTechnicalQa } from '../qa/technical.js';
import { isMotionError } from '../errors.js';

/**
 * §47 K, L, N, O — contra o Remotion de verdade.
 *
 * Bundle e render reais. É mais lento que um mock e é o único jeito de provar
 * o que interessa: que erro de build vira BUILD_FAILED com a mensagem do
 * compilador dentro, que erro de runtime vira RENDER_FAILED, e que um render
 * bom passa no QA técnico. Um mock provaria só que o mock foi escrito certo.
 */
const logger = createLogger({ service: 'motion-test' });
const criados: MotionWorkspace[] = [];

const config: ScaffoldConfig = {
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 30,
  durationSeconds: 1,
  brandName: 'Teste',
};

async function projeto(nome: string, motion: string): Promise<MotionWorkspace> {
  const workspace = await createWorkspace(`test-${nome}-${Date.now()}`);
  criados.push(workspace);
  await writeScaffold(workspace, config);
  await fs.writeFile(path.join(workspace.project, 'src', 'Motion.tsx'), motion, 'utf8');
  return workspace;
}

afterAll(async () => {
  for (const workspace of criados) await destroyWorkspace(workspace).catch(() => undefined);
});

const MOTION_OK = `import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { MOTION_CONFIG } from './config';

export const Motion: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ backgroundColor: '#1b3f2a', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ opacity, color: '#FFDE00', fontSize: 140, fontWeight: 800 }}>{MOTION_CONFIG.brandName}</div>
    </AbsoluteFill>
  );
};
`;

describe('O — render concluído corretamente (§47-O)', () => {
  it('bundle, preview, frames e QA técnico cheio', async () => {
    const workspace = await projeto('ok', MOTION_OK);
    const { serveUrl } = await bundleMotion(workspace);
    const render = await renderMotion({ workspace, serveUrl, quality: 'preview', logger });

    expect(render.sizeBytes).toBeGreaterThan(1024);
    const frames = await extractReviewFrames({ workspace, serveUrl, count: 4 });
    expect(frames).toHaveLength(4);

    const qa = await runTechnicalQa({
      file: render.file,
      expected: {
        width: render.width,
        height: render.height,
        fps: config.fps,
        durationSeconds: config.durationSeconds,
      },
      frames,
      runtimeErrors: [],
      missingAssets: [],
    });
    expect(qa.score).toBe(100);
    expect(qa.failures).toEqual([]);
  }, 180_000);
});

describe('K — erro de build (§47-K)', () => {
  it('vira BUILD_FAILED com a mensagem do compilador, não um 500 mudo', async () => {
    const workspace = await projeto(
      'build',
      `import { NaoExiste } from './modulo-que-nao-existe';
export const Motion: React.FC = () => <NaoExiste />;
`,
    );
    const erro = await bundleMotion(workspace).catch((error: unknown) => error);
    expect(isMotionError(erro)).toBe(true);
    if (!isMotionError(erro)) throw erro;
    expect(erro.code).toBe('BUILD_FAILED');
    // O detalhe é o que volta pro agente consertar (§22): sem ele, a
    // tentativa de correção seria um chute.
    expect(erro.detail).toContain('modulo-que-nao-existe');
    // E o texto que vai pro chat não tem stack nenhuma.
    expect(erro.userMessage).not.toContain('webpack');
  }, 180_000);
});

describe('L — erro de render (§47-L)', () => {
  it('componente que explode em runtime vira RENDER_FAILED', async () => {
    const workspace = await projeto(
      'render',
      `import { AbsoluteFill } from 'remotion';

export const Motion: React.FC = () => {
  const nada = null as unknown as { cena: { titulo: string } };
  return <AbsoluteFill>{nada.cena.titulo}</AbsoluteFill>;
};
`,
    );
    const { serveUrl } = await bundleMotion(workspace);
    const erro = await renderMotion({ workspace, serveUrl, quality: 'preview', logger }).catch(
      (error: unknown) => error,
    );
    expect(isMotionError(erro)).toBe(true);
    if (!isMotionError(erro)) throw erro;
    expect(erro.code).toBe('RENDER_FAILED');
  }, 180_000);
});

describe('N — asset ausente (§47-N)', () => {
  it('staticFile apontando pro vazio é detectado ANTES de virar retângulo branco no vídeo', async () => {
    const workspace = await projeto(
      'asset',
      `import { AbsoluteFill, Img, staticFile } from 'remotion';

export const Motion: React.FC = () => (
  <AbsoluteFill>
    <Img src={staticFile('assets/logo-que-nao-existe.png')} />
  </AbsoluteFill>
);
`,
    );
    const source = await fs.readFile(path.join(workspace.project, 'src', 'Motion.tsx'), 'utf8');
    const faltando = await findMissingStaticFiles(
      [{ path: 'src/Motion.tsx', content: source }],
      path.join(workspace.project, 'public'),
    );
    expect(faltando).toEqual(['assets/logo-que-nao-existe.png']);
  });

  it('asset presente não é acusado', async () => {
    const workspace = await projeto('asset-ok', MOTION_OK);
    const publicAssets = path.join(workspace.project, 'public', 'assets');
    await fs.mkdir(publicAssets, { recursive: true });
    await fs.writeFile(path.join(publicAssets, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const faltando = await findMissingStaticFiles(
      [{ path: 'src/Motion.tsx', content: `staticFile('assets/logo.png')` }],
      path.join(workspace.project, 'public'),
    );
    expect(faltando).toEqual([]);
  });
});

describe('arquivos protegidos (§5 aplicado ao projeto)', () => {
  it('duração reescrita pelo agente é restaurada — senão o QA conferiria o vídeo contra o próprio modelo', async () => {
    const workspace = await projeto('protegido', MOTION_OK);
    const rootFile = path.join(workspace.project, 'src', 'Root.tsx');
    await fs.writeFile(rootFile, `export const RemotionRoot = () => null; // o agente "melhorou"\n`, 'utf8');

    const restaurados = await restoreProtectedFiles(workspace, config);
    expect(restaurados).toContain('src/Root.tsx');
    expect(await fs.readFile(rootFile, 'utf8')).toContain('MOTION_CONFIG.durationInFrames');
  });

  it('projeto intocado não é reescrito à toa', async () => {
    const workspace = await projeto('intocado', MOTION_OK);
    expect(await restoreProtectedFiles(workspace, config)).toEqual([]);
  });

  it('o Motion.tsx do agente NÃO é protegido — ele é o trabalho', () => {
    expect(PROTECTED_FILES).not.toContain('src/Motion.tsx');
  });

  it('numa iteração, o scaffold preserva o Motion.tsx existente (§43)', async () => {
    const workspace = await projeto('iteracao', MOTION_OK);
    await writeScaffold(workspace, config);
    const atual = await fs.readFile(path.join(workspace.project, 'src', 'Motion.tsx'), 'utf8');
    expect(atual).toBe(MOTION_OK);
  });
});

describe('dimensão do encoder', () => {
  it('arredonda pra par — H.264 não aceita ímpar (medido: 405 vira 404)', () => {
    expect(encodedDimension(1080, 0.375)).toBe(404);
    expect(encodedDimension(1920, 0.375)).toBe(720);
  });

  it('escala do preview nunca amplia', () => {
    expect(previewScale(1080, 1920)).toBeCloseTo(0.375);
    expect(previewScale(270, 480)).toBe(1);
  });

  /**
   * A propriedade que o render inteiro depende, e que faltava aqui.
   *
   * O Remotion aborta quando largura ou altura escalada não é inteira. Até
   * 09/10/2026 a escala saía de `720 / altura`, que acerta no 1080x1920 e erra
   * em qualquer razão que não se reduza — e o teste acima, sozinho, aprovava
   * as duas. Foi um 479x854 que derrubou o pipeline em produção de teste.
   *
   * Por isso este teste não confere números escolhidos a dedo: varre formatos,
   * inclusive os esquisitos, e exige inteiro nos dois eixos.
   */
  it('qualquer formato produz dimensão inteira nos dois eixos', () => {
    const formatos: Array<[number, number]> = [
      [1080, 1920], // 9:16
      [1920, 1080], // 16:9
      [1080, 1080], // 1:1
      [1080, 1350], // 4:5
      [479, 854], // o que quebrou: razão que não se reduz (mdc 1)
      [480, 854],
      [1001, 1733], // primos entre si, altura bem acima de 720
      [720, 1280],
      [360, 640],
    ];
    for (const [largura, altura] of formatos) {
      const escala = previewScale(largura, altura);
      expect(escala).toBeGreaterThan(0);
      expect(escala).toBeLessThanOrEqual(1);
      expect(Number.isInteger(largura * escala)).toBe(true);
      expect(Number.isInteger(altura * escala)).toBe(true);
    }
  });

  it('não desce abaixo de 720 de altura quando existe escala inteira que chega lá', () => {
    // 1080x1920 reduz pra 9x16, então m=45 dá exatamente 720 de altura.
    expect(1920 * previewScale(1080, 1920)).toBe(720);
    // 720x1280 reduz pra 9x16 também: m=45 sobre mdc 80.
    expect(1280 * previewScale(720, 1280)).toBe(720);
  });
});
