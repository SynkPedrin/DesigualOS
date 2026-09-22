import { NextResponse } from 'next/server';

/**
 * P1-04 (release readiness audit, 22/09/2026): "não é possível certificar
 * equivalência entre web, API, worker e nodes" — sem isto não dava pra
 * provar QUAL commit o front publicado está servindo. A Vercel injeta
 * VERCEL_GIT_COMMIT_SHA em build/runtime automaticamente; em dev local
 * (sem Vercel), cai no fallback do checkout, mesmo padrão de
 * `getReleaseInfo` na API/worker (packages/logging).
 */
// Resolvido uma vez, no module load do processo do servidor Next — não a
// cada request, senão "build_time" mentiria sendo a hora do último GET.
const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME ?? new Date().toISOString();

export function GET(): NextResponse {
  return NextResponse.json({
    release_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RELEASE_SHA ?? 'unknown',
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    build_time: BUILD_TIME,
  });
}
