import { Composition } from 'remotion';
import { DURACAO_TOTAL_EM_FRAMES, FPS } from '../src/components/tutorial/roteiro';
import { TutorialVideo } from '../src/components/tutorial/tutorial-video';

/**
 * Entrada só para o Remotion Studio e para renderizar quadros de conferência.
 * O produto toca a composição pelo <Player>, não por aqui — esta pasta fica
 * fora de `src/`, então o build do Next nem a enxerga.
 */
export const RemotionRoot = () => (
  <Composition
    id="TutorialDesigualOS"
    component={TutorialVideo}
    durationInFrames={DURACAO_TOTAL_EM_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
