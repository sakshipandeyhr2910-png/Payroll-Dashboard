import { kv } from './kv.js';

// Replaces each vite-plugins/rayontara*ApiPlugin.ts's own module-level `let cachedToken` — those
// relied on the Vite dev/preview server being one long-lived process; a Vercel function has no
// such process to hold state in, so the upstream PMS/Appraisal/Loan/Meal/Recovery/TDS/Leave/Arrear
// access token is cached in KV instead, keyed per API.
//
// TTL note: none of the upstream Kites APIs document how long an issued accessToken/deviceToken
// pair actually stays valid. 15 minutes is a conservative guess, not a confirmed figure — chosen
// to keep re-authentication frequent enough that an unexpectedly short real lifetime still mostly
// works (the caller retries once on a fetch failure anyway, see each api/**/​*.ts handler).
const TOKEN_TTL_SECONDS = 15 * 60;

function cacheKey(apiName: string): string {
  return `token:${apiName}`;
}

// Returns the cached token for `apiName`, or calls `fetchFn` (the real GetToken exchange) on a
// cache miss and stores the result. Callers that get a downstream auth failure using this token
// should call refreshCachedToken to force a new one rather than calling this again (a miss here
// would just serve the same stale cached value back).
export async function getCachedToken<T>(apiName: string, fetchFn: () => Promise<T>): Promise<T> {
  const key = cacheKey(apiName);
  try {
    const cached = await kv.get<T>(key);
    if (cached) return cached;
  } catch (err) {
    console.error(`[tokenCache] KV read failed for ${key}, fetching fresh token`, err);
  }
  return refreshCachedToken(apiName, fetchFn);
}

// Forces a fresh token exchange and overwrites the cache — used when a cached token turned out to
// be rejected downstream (expired/invalidated server-side before its cached TTL ran out), mirroring
// the old plugins' "retry once with a freshly fetched token" behavior.
export async function refreshCachedToken<T>(apiName: string, fetchFn: () => Promise<T>): Promise<T> {
  const fresh = await fetchFn();
  try {
    await kv.set(cacheKey(apiName), fresh, { ex: TOKEN_TTL_SECONDS });
  } catch (err) {
    console.error(`[tokenCache] KV write failed for ${cacheKey(apiName)}`, err);
  }
  return fresh;
}

// Runs `work` with the cached token for `apiName`; if it throws (the token was rejected
// downstream — expired/invalidated server-side before our cached TTL ran out, or simply never
// cached yet with a stale value), refreshes the token once and retries `work` exactly once more.
// This is the same "fetch-or-reuse, retry once on failure with a forced-fresh token" shape every
// vite-plugins/rayontara*ApiPlugin.ts used around its own module-level `cachedToken` variable.
export async function withCachedToken<TToken, TResult>(
  apiName: string,
  fetchTokenFn: () => Promise<TToken>,
  work: (token: TToken) => Promise<TResult>,
): Promise<TResult> {
  const token = await getCachedToken(apiName, fetchTokenFn);
  try {
    return await work(token);
  } catch {
    const fresh = await refreshCachedToken(apiName, fetchTokenFn);
    return await work(fresh);
  }
}
