// Thin re-export of the @vercel/kv client. Every serverless function and the out-of-band
// scripts/warmCodeUniverse.ts script import `kv` from here rather than from '@vercel/kv' directly,
// so there's one place to swap the client if that ever needs to change.
//
// @vercel/kv reads KV_REST_API_URL / KV_REST_API_TOKEN from process.env automatically — those are
// populated by Vercel when a Redis-compatible store is connected via the Storage/Marketplace tab
// (see README.md's "Deploying to Vercel" section), and read the same way when this project's
// scripts run outside Vercel (e.g. from GitHub Actions, with the values passed in as secrets).
export { kv } from '@vercel/kv';
