export interface ChatResult {
  executionId: string | null;
  status: 'queued' | 'unavailable';
  agent: string;
  error?: string;
}
