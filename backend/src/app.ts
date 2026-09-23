import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { errorHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimiter';
import { CORS_ORIGINS } from './config';
import path from 'path';
import { authRouter } from './routes/auth.routes';
import { leaveRequestRouter } from './routes/leaveRequest.routes';
import { leaveBalanceRouter } from './routes/leaveBalance.routes';
import { notificationRouter } from './routes/notification.routes';
import { managerRouter } from './routes/manager.routes';
import { adminRouter } from './routes/admin.routes';
import { holidayRouter } from './routes/holiday.routes';
import { profileRouter } from './routes/profile.routes';

const app = express();

// Trust the proxy so req.ip reflects the client, not the proxy, behind nginx/ALB.
app.set('trust proxy', 1);

// Security headers (CSP, HSTS, X-Frame-Options, nosniff, ...).
app.use(helmet());

// Restrict cross-origin access to known frontends instead of allowing every origin.
app.use(
  cors({
    origin(origin, callback) {
      // Same-origin/server-to-server requests arrive without an Origin header.
      if (!origin || CORS_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));

// Serve uploaded avatars. crossOriginResourcePolicy is relaxed so the image can
// be loaded by the frontend origin during local development.
app.use(
  '/uploads',
  helmet.crossOriginResourcePolicy({ policy: 'cross-origin' }),
  express.static(path.resolve(process.cwd(), 'uploads'))
);

// Health check for load balancers and uptime monitors.
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Global throttle. The login route additionally applies its own stricter limiter.
app.use('/api', apiLimiter);

app.use('/api/auth', authRouter);
app.use('/api/leave-requests', leaveRequestRouter);
app.use('/api/leave-balances', leaveBalanceRouter);
app.use('/api/notifications', notificationRouter);
app.use('/api/manager', managerRouter);
app.use('/api/admin', adminRouter);
app.use('/api/holidays', holidayRouter);
app.use('/api/profile', profileRouter);

// Unknown API paths should 404 as JSON rather than falling through to the error handler.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'NOT_FOUND', message: 'Endpoint not found' });
});

app.use(errorHandler);

export default app;
