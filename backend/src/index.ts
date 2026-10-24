import dotenv from 'dotenv';

dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import connectPgSimple from 'connect-pg-simple';
import env from './config/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { pool } from './db/index.js';
import { logger } from './middleware/logger.js';
import { loadUser } from './middleware/auth.js';
import { ensureBootstrapAdmin } from './services/bootstrap.js';
import { loadInstruction } from './services/instruction.js';
import authRouter from './routes/auth.js';
import conversationsRouter from './routes/conversations.js';
import messagesRouter from './routes/messages.js';
import chatRouter from './routes/chat.js';
import adminRouter from './routes/admin.js';

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

app.use(helmet());
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(logger);

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
      // In production this should be secure: true behind HTTPS.
      secure: process.env.NODE_ENV === 'production',
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

app.use(errorHandler);

const port = env.PORT || 3000;

const server = app.listen(port, async () => {
  console.log(`Backend listening on port ${port}`);

  try {
    await ensureBootstrapAdmin();
  } catch (err) {
    console.error(
      'Bootstrap admin initialization failed:',
      err instanceof Error ? err.message : err
    );
    if (env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
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