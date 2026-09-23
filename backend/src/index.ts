import dotenv from 'dotenv';
dotenv.config();

// Imported before anything else so a missing JWT_SECRET stops the process
// instead of silently falling back to a hard-coded default.
import './config';

import app from './app';
import pool from './database/pool';
import { AccountPurgeService } from './services/accountPurge.service';

const PORT = parseInt(process.env.PORT || '3001');

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // Daily sweep that removes accounts disabled beyond the retention window.
  AccountPurgeService.startScheduler();
});

/** Drain in-flight requests and close the pool before exiting. */
async function shutdown(signal: string) {
  console.log(`\n${signal} received, shutting down...`);
  server.close(async () => {
    try {
      await pool.end();
      console.log('Database pool closed. Goodbye.');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  });

  // Don't hang forever if a connection refuses to close.
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', reason => {
  console.error('Unhandled promise rejection:', reason);
});
