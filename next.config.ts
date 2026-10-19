import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// CI builds (NEXT_BUILD_CPUS, set by the workflow and the image build) use a fixed, small number
// of build workers and webpack's memory savings: Next defaults to one worker per core less one,
// a 5 GB build on the self-hosted runner, where several builds run at once.
const buildCpus = Number(process.env.NEXT_BUILD_CPUS);

const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  serverExternalPackages: ['argon2', 'pg'],
  ...(buildCpus >= 1
    ? { experimental: { cpus: Math.floor(buildCpus), webpackMemoryOptimizations: true } }
    : {}),
};

export default createNextIntlPlugin('./src/core/i18n/request.ts')(config);
