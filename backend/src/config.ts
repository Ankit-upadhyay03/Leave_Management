/**
 * Centralised configuration with fail-fast validation.
 *
 * A missing JWT_SECRET previously fell back to a hard-coded literal, which meant a
 * misconfigured deployment would boot successfully while signing tokens anyone could forge.
 */

const INSECURE_DEFAULTS = ['default-secret-change-me', 'your-secret-key-change-in-production', 'secret', 'changeme'];

function requireSecret(name: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(
      `FATAL: ${name} is not set. Add it to your .env file before starting the server.`
    );
  }
  if (value.length < 16) {
    throw new Error(`FATAL: ${name} must be at least 16 characters long.`);
  }
  if (INSECURE_DEFAULTS.includes(value)) {
    throw new Error(`FATAL: ${name} is set to a known placeholder value. Use a unique random secret.`);
  }
  return value;
}

export const JWT_SECRET = requireSecret('JWT_SECRET', process.env.JWT_SECRET);

export const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/** Shown in email signatures. */
export const COMPANY_NAME = process.env.COMPANY_NAME || 'PeopleXM';

/** Base URL used to build links inside outgoing email. */
export const APP_URL = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
