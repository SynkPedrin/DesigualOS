import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * O indicador de rota do `next dev` nasce no canto INFERIOR ESQUERDO — em
   * cima do rodapé da barra lateral, que é onde mora o painel de saúde da
   * infraestrutura ("Execução", "Último backup"). Ele cobria essas linhas, e
   * na tela parecia um elemento do produto espremido no canto.
   *
   * Vai para o topo da esquerda: ali ele fica sobre a faixa de contexto da
   * empresa, que é uma barra fina e sem controle clicável embaixo. Continua
   * existindo (e continua reportando erro de compilação), só não disputa mais
   * espaço com informação do produto. Só afeta desenvolvimento.
   */
  devIndicators: { position: 'top-left' },
  transpilePackages: ['@desigual-os/types'],
  images: {
    // User avatars and message attachments live in Supabase Storage, a different origin
    // than the app itself; next/image refuses unconfigured remote hosts otherwise.
    remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/**' }],
  },
};

export default nextConfig;
