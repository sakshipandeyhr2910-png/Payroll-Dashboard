import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { dashboardAuthPlugin } from './vite-plugins/dashboardAuthPlugin';
import { snapshotPlugin } from './vite-plugins/snapshotPlugin';
import { rayontaraApiPlugin } from './vite-plugins/rayontaraApiPlugin';
import { rayontaraAppraisalApiPlugin } from './vite-plugins/rayontaraAppraisalApiPlugin';
import { rayontaraLoanApiPlugin } from './vite-plugins/rayontaraLoanApiPlugin';
import { rayontaraMealApiPlugin } from './vite-plugins/rayontaraMealApiPlugin';
import { rayontaraRecoveryApiPlugin } from './vite-plugins/rayontaraRecoveryApiPlugin';
import { rayontaraTdsApiPlugin } from './vite-plugins/rayontaraTdsApiPlugin';
import { rayontaraLeaveApiPlugin } from './vite-plugins/rayontaraLeaveApiPlugin';
import { rayontaraArrearApiPlugin } from './vite-plugins/rayontaraArrearApiPlugin';
import { rayontaraWfhApiPlugin } from './vite-plugins/rayontaraWfhApiPlugin';

export default defineConfig(({ mode, command }) => {
  // Third arg '' loads ALL vars from .env (not just VITE_-prefixed ones) into this Node-side
  // config function. These are only used to configure the server plugin below — never passed to
  // `define`/`import.meta.env`, so they never end up in the client-side JS bundle.
  const env = loadEnv(mode, process.cwd(), '');

  // Every plugin below only does anything via configureServer/configurePreviewServer (confirmed —
  // none of them touch transform/resolveId/load/etc., so none affect `vite build`'s actual output)
  // — they exist purely to proxy Koenig's APIs for `npm run dev`/`npm run preview`. Production
  // instead runs api/**/*.ts (see README's "Deploying to Vercel"), which never imports this file at
  // all. But a couple of these plugins run an eager self-test at construction time (e.g.
  // rayontaraAppraisalApiPlugin's Koenig-decryption check), which requires real credentials to be
  // present — harmless for local dev (where .env has them), but it made `vite build` itself fail on
  // Vercel, since Vercel's build environment has no reason to also carry every one of these
  // dev-only credentials. Skipping construction entirely for `command === 'build'` removes that
  // coupling rather than just papering over the self-test.
  const isBuild = command === 'build';

  return {
    plugins: [
      // Registered first so its /api/* auth check runs before any entity-specific API plugin —
      // see vite-plugins/dashboardAuthPlugin.ts.
      ...(isBuild ? [] : [
        dashboardAuthPlugin({
          username: env.DASHBOARD_USERNAME,
          password: env.DASHBOARD_PASSWORD,
        }),
        snapshotPlugin(),
      ]),
      react(),
      ...(isBuild ? [] : [
        rayontaraApiPlugin({
          base: env.PMS_API_BASE,
          username: env.PMS_USERNAME,
          password: env.PMS_PASSWORD,
          role: env.PMS_ROLE,
          apiKey: env.PMS_API_KEY,
        }),
        rayontaraAppraisalApiPlugin({
          base: env.APPRAISAL_API_BASE,
          username: env.APPRAISAL_USERNAME,
          password: env.APPRAISAL_PASSWORD,
          role: env.APPRAISAL_ROLE,
          apiKey: env.APPRAISAL_API_KEY,
          decryptPassword: env.KITES_DECRYPT_PASSWORD,
          decryptSalt: env.KITES_DECRYPT_SALT,
        }),
        rayontaraLoanApiPlugin({
          base: env.LOAN_API_BASE,
          username: env.LOAN_USERNAME,
          password: env.LOAN_PASSWORD,
          role: env.LOAN_ROLE,
          apiKey: env.LOAN_API_KEY,
        }),
        rayontaraMealApiPlugin({
          base: env.MEAL_API_BASE,
          username: env.MEAL_USERNAME,
          password: env.MEAL_PASSWORD,
          role: env.MEAL_ROLE,
          apiKey: env.MEAL_API_KEY,
        }),
        rayontaraRecoveryApiPlugin({
          base: env.RECOVERY_API_BASE,
          username: env.RECOVERY_USERNAME,
          password: env.RECOVERY_PASSWORD,
          role: env.RECOVERY_ROLE,
          apiKey: env.RECOVERY_API_KEY,
        }),
        rayontaraTdsApiPlugin({
          base: env.TDS_API_BASE,
          username: env.TDS_USERNAME,
          password: env.TDS_PASSWORD,
          role: env.TDS_ROLE,
          apiKey: env.TDS_API_KEY,
        }),
        rayontaraLeaveApiPlugin({
          base: env.LEAVE_API_BASE,
          username: env.LEAVE_USERNAME,
          password: env.LEAVE_PASSWORD,
          role: env.LEAVE_ROLE,
          apiKey: env.LEAVE_API_KEY,
        }),
        rayontaraArrearApiPlugin({
          base: env.ARREAR_API_BASE,
          username: env.ARREAR_USERNAME,
          password: env.ARREAR_PASSWORD,
          role: env.ARREAR_ROLE,
          apiKey: env.ARREAR_API_KEY,
          decryptPassword: env.KITES_DECRYPT_PASSWORD,
          decryptSalt: env.KITES_DECRYPT_SALT,
        }),
        rayontaraWfhApiPlugin({
          base: env.WFH_API_BASE,
          username: env.WFH_USERNAME,
          password: env.WFH_PASSWORD,
          role: env.WFH_ROLE,
          apiKey: env.WFH_API_KEY,
        }),
      ]),
    ],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      // Vite's DNS-rebinding protection blocks any Host header it doesn't recognize by default —
      // this allowlists the tunnel domains used for temporary public sharing (see the "share the
      // dashboard" flow) without disabling the check entirely for arbitrary hosts. trycloudflare
      // is cloudflared's quick-tunnel domain (no account); loca.lt was the earlier, less reliable
      // localtunnel attempt — left in case that's ever used again instead.
      allowedHosts: ['.loca.lt', '.trycloudflare.com'],
    },
  };
});
