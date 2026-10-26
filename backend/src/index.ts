import dotenv from 'dotenv';

dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import connectPgSimple from 'connect-pg-simple';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import env from './config/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { pool } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { logger } from './middleware/logger.js';
import { loadUser } from './middleware/auth.js';
import { ensureBootstrapAdmin } from './services/bootstrap.js';
import { loadInstruction } from './services/instruction.js';
import authRouter from './routes/auth.js';
import conversationsRouter from './routes/conversations.js';
import messagesRouter from './routes/messages.js';
import chatRouter from './routes/chat.js';
import adminRouter from './routes/admin.js';
import toolsRouter from './routes/tools.js';

// Load mandatory corporate instruction at startup.
// Throws if missing/empty so the app fails fast.
let CORPORATE_INSTRUCTION: string;
try {
  CORPORATE_INSTRUCTION = loadInstruction();
  console.log("Corporate instruction loaded successfully.");
} catch (err) {
  console.error("FATAL: Failed to load mandatory Instruction.md:", err instanceof Error ? err.message : err);
  process.exit(1);
}

const PgSessionStore = connectPgSimple(session);

const app = express();

if (env.TRUST_PROXY) {
  app.set('trust proxy', 1);
}

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

const allowedOrigins = env.CORS_ORIGIN
  ? env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  : true;

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
app.use(express.json({ limit: '15mb' }));
app.use(logger);

let startupReady = false;
let startupError: Error | null = null;

async function initializeDatabaseAtStartup(): Promise<void> {
  try {
    if (env.AUTO_MIGRATE) {
      console.log('Running automatic database migrations...');
      await runMigrations();
    }
    await ensureBootstrapAdmin();
    startupReady = true;
  } catch (err) {
    startupError = err instanceof Error ? err : new Error(String(err));
    console.error('Startup initialization failed:', startupError.message);
    if (env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
}

const startupReadyPromise = initializeDatabaseAtStartup();

// Ensure database migrations & admin bootstrap have completed before touching PgSessionStore.
// Rejects API and health requests with 503 if startup initialization failed.
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/health') {
    await startupReadyPromise;
    if (!startupReady || startupError) {
      res.status(503).json(
        req.path === '/health'
          ? { status: 'unhealthy', error: 'Startup initialization failed' }
          : { error: { message: 'Сервис временно недоступен: ошибка инициализации БД.' } }
      );
      return;
    }
  }
  next();
});

// Session middleware (cookie-based auth, stored in PostgreSQL).
app.use(
  session({
    store: new PgSessionStore({
      pool,
      tableName: 'sessions',
      createTableIfMissing: false,
    }),
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: env.SESSION_MAX_AGE_MS,
      // In production this is secure: true behind HTTPS (works with trust proxy = 1).
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  })
);

// Refresh the session user from the DB on every request.
app.use(loadUser);

// Rate limit all API routes.
// Auth routes get a separate, stricter limit to prevent brute-force attacks.
app.use(
  '/api/v1/auth',
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: { message: 'Слишком много попыток входа. Попробуйте позже.' },
    },
  })
);

// General API rate limit for all other routes.
app.use(
  '/api/v1',
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: { message: 'Слишком много запросов. Попробуйте позже.' },
    },
  })
);

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/conversations', conversationsRouter);
app.use('/api/v1/messages', messagesRouter);
app.use('/api/v1/chat', chatRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/tools', toolsRouter);

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('Health check DB error', err);
    res.status(503).json({ status: 'unhealthy' });
  }
});

app.get('/api/v1/placeholder', (_req, res) => {
  res.json({ message: 'This is a placeholder endpoint.' });
});

// Unified Container SPA Static Serving:
// When SERVE_STATIC_SPA is enabled and the compiled React frontend bundle is present,
// serve static files and route non-API GET requests to index.html.
const currentDir = dirname(fileURLToPath(import.meta.url));
const spaCandidateDirs = [
  env.FRONTEND_DIST_PATH ? resolve(env.FRONTEND_DIST_PATH) : '',
  resolve(currentDir, '../frontend-dist'),
  resolve(currentDir, '../../dist'),
  resolve(currentDir, '../../../dist'),
].filter(Boolean);

const resolvedSpaDir = spaCandidateDirs.find((dir) =>
  existsSync(resolve(dir, 'index.html'))
);

if (env.SERVE_STATIC_SPA && resolvedSpaDir) {
  console.log(`Serving compiled frontend SPA from: ${resolvedSpaDir}`);
  app.use(express.static(resolvedSpaDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/health') {
      next();
      return;
    }
    res.sendFile(resolve(resolvedSpaDir, 'index.html'));
  });
}

app.use(errorHandler);

const port = env.PORT || 3000;

const server = app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});

const shutdown = () => {
  console.log('Shutting down server...');

  server.close(() => {
    console.log('HTTP server closed.');

    pool.end(() => {
      console.log('Database pool closed.');
      process.exit(0);
    });
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);