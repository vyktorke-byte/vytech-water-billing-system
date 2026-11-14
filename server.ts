import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import {
  addSseClient,
  fetchDarajaAccessToken,
  getMpesaConfig,
  getMpesaStatusSnapshot,
  getMpesaTransactionsSnapshot,
  handleConfirmationCallback,
  handleValidationCallback,
  markTransactionReconciled,
  registerC2BUrls,
  syncWorkspaceCache,
} from './server/mpesa.ts';
import { isFirestoreAdminReady } from './server/firestoreBridge.ts';

const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function getRequestOrigin(req: Request): string {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto =
    typeof forwardedProto === 'string' && forwardedProto.length > 0
      ? forwardedProto.split(',')[0].trim()
      : req.protocol || 'https';
  const host = req.get('host');
  return host ? `${proto}://${host}` : `http://localhost:${PORT}`;
}

async function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Health Check
  app.get('/api/health', (req: Request, res: Response) => {
    const cfg = getMpesaConfig();
    res.json({
      ok: true,
      service: 'vytech-water-billing-mpesa',
      environment: cfg.environment,
      shortCodes: cfg.supportedShortCodes,
      firestoreAdminReady: isFirestoreAdminReady(),
      origin: getRequestOrigin(req),
    });
  });

  // 1. Daraja OAuth 2.0 Authentication Route (Consumer Key + Secret -> Bearer Access Token)
  app.get('/api/mpesa/auth', async (req: Request, res: Response) => {
    try {
      const shortCode =
        typeof req.query.shortCode === 'string' ? req.query.shortCode.trim() : undefined;
      const result = await fetchDarajaAccessToken(shortCode);
      res.json(result);
    } catch (err) {
      const e = err as Error & { statusCode?: number; details?: unknown };
      res.status(e.statusCode || 500).json({
        error: e.message || 'Daraja authentication failed',
        details: e.details,
      });
    }
  });

  // 2. C2B Validation & Confirmation URL Registration Route
  app.post('/api/mpesa/register-urls', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        shortCode?: string;
        registerAllSupported?: boolean;
        responseType?: 'Completed' | 'Cancelled';
      };
      const result = await registerC2BUrls({
        shortCode: body.shortCode,
        registerAllSupported: Boolean(body.registerAllSupported),
        responseType: body.responseType,
        requestOrigin: getRequestOrigin(req),
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      const e = err as Error & { statusCode?: number; details?: unknown };
      res.status(e.statusCode || 500).json({
        ok: false,
        error: e.message || 'Failed to register C2B URLs with Safaricom Daraja',
        details: e.details,
      });
    }
  });

  // Safe Status Snapshot (no secrets exposed)
  app.get('/api/mpesa/status', (req: Request, res: Response) => {
    res.json(getMpesaStatusSnapshot(getRequestOrigin(req)));
  });

  // Safaricom C2B Validation Webhook
  app.post('/api/mpesa/validation', async (req: Request, res: Response) => {
    try {
      const validation = await handleValidationCallback((req.body || {}) as Record<string, unknown>);
      res.status(200).json(validation);
    } catch (err) {
      console.error('[M-Pesa Validation Error]', err);
      res.status(200).json({
        ResultCode: 0,
        ResultDesc: 'Accepted',
      });
    }
  });

  // 3. Safaricom C2B Confirmation Webhook (/api/mpesa/confirmation)
  app.post('/api/mpesa/confirmation', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const result = await handleConfirmationCallback(body);
      res.status(200).json(result);
    } catch (err) {
      console.error('[M-Pesa Confirmation Error]', err);
      res.status(500).json({
        ResultCode: 'C2B00016',
        ResultDesc: (err as Error).message || 'Failed to process M-Pesa confirmation',
      });
    }
  });

  // 4a. Real-time Server-Sent Events Stream for instant Dashboard updates
  app.get('/api/mpesa/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(
      `data: ${JSON.stringify({
        type: 'connected',
        timestamp: new Date().toISOString(),
        status: getMpesaStatusSnapshot(getRequestOrigin(req)),
      })}\n\n`
    );

    const heartbeat = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 25_000);

    req.on('close', () => {
      clearInterval(heartbeat);
    });

    addSseClient(res);
  });

  // 4b. Polling & Reconciliation Endpoints for Dashboard synchronization
  app.get('/api/mpesa/transactions', (_req: Request, res: Response) => {
    res.json(getMpesaTransactionsSnapshot());
  });

  app.post('/api/mpesa/transactions/:transId/reconcile', (req: Request, res: Response) => {
    const transId = String(req.params.transId || '');
    const updated = markTransactionReconciled(transId);
    res.json({ ok: true, transId, updated });
  });

  app.post('/api/mpesa/accounts-sync', (req: Request, res: Response) => {
    const body = (req.body || {}) as Parameters<typeof syncWorkspaceCache>[0];
    syncWorkspaceCache(body);
    res.json({ ok: true });
  });

  // Vite dev middleware or Production static build serving
  if (!IS_PRODUCTION) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Production bundle not built. Run npm run build.');
      }
    });
  }

  return app;
}

createApp()
  .then((app) => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[MajiTrack] Express + M-Pesa C2B server listening on http://0.0.0.0:${PORT}`);
      const cfg = getMpesaConfig();
      if (process.env.MPESA_AUTO_REGISTER_URLS === 'true' && cfg.hasCredentials) {
        void registerC2BUrls({ registerAllSupported: true })
          .then((reg) => {
            console.log(
              `[MajiTrack] Auto-registered M-Pesa C2B URLs for Paybill ${reg.shortCodes.join(', ')}`
            );
          })
          .catch((err) => {
            console.warn('[MajiTrack] Auto-register C2B URLs warning:', (err as Error).message);
          });
      }
    });
  })
  .catch((err) => {
    console.error('[MajiTrack] Fatal server startup error:', err);
    process.exit(1);
  });
