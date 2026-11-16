export const openrouterEndpoint = 'https://openrouter.ai/api';

export const aiExecutionLimits = {
  tags: { timeoutMs: 45000, maxOutputTokens: 1024 },
  defaultTimeoutMs: 300000,
  // ADR 0070: providers stop a transcription after about a minute; the reservation is a ceiling
  // per second of audio (catalog rates for speech-to-text run from 3 to 100 micro-dollars).
  transcription: { timeoutMs: 120000, reserveMicrosPerSecond: 100 },
};
