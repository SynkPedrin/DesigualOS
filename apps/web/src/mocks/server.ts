import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/** For future test suites (Node environment), mirrors src/mocks/browser.ts. */
export const server = setupServer(...handlers);
