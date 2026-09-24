import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Render de vídeo e sessão do Claude Code são lentos por natureza; os
    // testes que os tocam são marcados e pulados por padrão (ver README).
    testTimeout: 30_000,
  },
});
