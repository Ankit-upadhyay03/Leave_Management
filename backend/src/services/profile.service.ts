import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import pool from '../database/pool';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { AppError } from '../middleware/errorHandler';
import { EmailService } from './email.service';
import { AuditService } from './audit.service';

const OTP_EXPIRY_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 60;

export class ProfileService {
  /** Update the fields an employee may change about themselves (currently address). */
  static async updateProfile(userId: string, fields: { address?: string | null }, ip?: string): Promise<void> {
    const address = fields.address === undefined ? undefined : (fields.address?.toString().trim() || null);

    if (address !== undefined && address && address.length > 500) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Address must not exceed 500 characters');
    }

    if (address === undefined) return; // nothing to update

    const [result] = await pool.execute<ResultSetHeader>(
      'UPDATE employees SET address = ? WHERE id = ?',
      [address, userId]
    );
    if (result.affectedRows === 0) throw new AppError(404, 'NOT_FOUND', 'User not found');

    await AuditService.log(userId, 'PROFILE_UPDATED', 'employee', userId, 'Address updated', ip);
  }

  /** Store the uploaded avatar path and return the previous one (so it can be deleted). */
  static async updateAvatar(userId: string, avatarUrl: string, ip?: string): Promise<string | null> {
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT avatar_url FROM employees WHERE id = ?', [userId]);
    if (rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'User not found');
    const previous = rows[0].avatar_url as string | null;

    await pool.execute('UPDATE employees SET avatar_url = ? WHERE id = ?', [avatarUrl, userId]);
    await AuditService.log(userId, 'AVATAR_UPDATED', 'employee', userId, 'Profile picture updated', ip);
    return previous;
  }

  /**
   * Begin an email change: generate a 6-digit code, mail it to the NEW address,
   * and store only its hash. The change isn't applied until the code is verified.
   */
  static async requestEmailChange(userId: string, newEmailRaw: string, ip?: string): Promise<{ expiryMinutes: number }> {
    const newEmail = String(newEmailRaw || '').trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Enter a valid email address');
    }

    const [me] = await pool.execute<RowDataPacket[]>('SELECT name, email FROM employees WHERE id = ?', [userId]);
    if (me.length === 0) throw new AppError(404, 'NOT_FOUND', 'User not found');
    if (me[0].email === newEmail) {
      throw new AppError(400, 'VALIDATION_ERROR', 'That is already your current email address');
    }

    // Email is the login identity, so it must be unique across all accounts.
    const [taken] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM employees WHERE email = ? AND id != ?',
      [newEmail, userId]
    );
    if (taken.length > 0) {
      throw new AppError(409, 'EMAIL_TAKEN', 'That email address is already in use');
    }

    // Rate-limit resends so the mailbox isn't flooded.
    const [recent] = await pool.execute<RowDataPacket[]>(
      `SELECT created_at FROM email_otp
       WHERE employee_id = ? AND new_email = ? AND consumed = false
         AND created_at > (NOW() - INTERVAL ${OTP_RESEND_COOLDOWN_SECONDS} SECOND)
       ORDER BY created_at DESC LIMIT 1`,
      [userId, newEmail]
    );
    if (recent.length > 0) {
      throw new AppError(429, 'OTP_COOLDOWN', 'Please wait a minute before requesting another code');
    }

    // Invalidate any earlier pending codes for this user.
    await pool.execute('UPDATE email_otp SET consumed = true WHERE employee_id = ? AND consumed = false', [userId]);

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = await bcrypt.hash(code, 10);

    await pool.execute(
      `INSERT INTO email_otp (id, employee_id, new_email, code_hash, expires_at)
       VALUES (?, ?, ?, ?, (NOW() + INTERVAL ${OTP_EXPIRY_MINUTES} MINUTE))`,
      [uuidv4(), userId, newEmail, codeHash]
    );

    // Fire-and-forget: the OTP row is already persisted, so don't make the client
    // wait on a slow SMTP handshake. A send failure is logged, not surfaced as an
    // error, so the verification input still opens and the user can request a resend.
    EmailService.sendEmailVerificationOtp({
      to: newEmail,
      name: me[0].name,
      code,
      expiryMinutes: OTP_EXPIRY_MINUTES,
    }).catch(err => console.error('OTP email send failed:', err));

    await AuditService.log(userId, 'EMAIL_CHANGE_REQUESTED', 'employee', userId, `Verification code sent to ${newEmail}`, ip);
    return { expiryMinutes: OTP_EXPIRY_MINUTES };
  }

  /** Verify the code and, on success, apply the new email. */
  static async verifyEmailChange(userId: string, codeRaw: string, ip?: string): Promise<{ email: string }> {
    const code = String(codeRaw || '').trim();

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, new_email, code_hash, attempts, expires_at
       FROM email_otp
       WHERE employee_id = ? AND consumed = false
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) {
      throw new AppError(400, 'NO_PENDING_OTP', 'No pending email change. Request a new code.');
    }

    const otp = rows[0];

    if (new Date(otp.expires_at).getTime() < Date.now()) {
      await pool.execute('UPDATE email_otp SET consumed = true WHERE id = ?', [otp.id]);
      throw new AppError(400, 'OTP_EXPIRED', 'This code has expired. Request a new one.');
    }

    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      await pool.execute('UPDATE email_otp SET consumed = true WHERE id = ?', [otp.id]);
      throw new AppError(429, 'OTP_LOCKED', 'Too many incorrect attempts. Request a new code.');
    }

    const ok = await bcrypt.compare(code, otp.code_hash);
    if (!ok) {
      await pool.execute('UPDATE email_otp SET attempts = attempts + 1 WHERE id = ?', [otp.id]);
      throw new AppError(400, 'OTP_INVALID', 'Incorrect code. Please try again.');
    }

    // Re-check uniqueness at apply time in case someone else claimed it meanwhile.
    const [taken] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM employees WHERE email = ? AND id != ?',
      [otp.new_email, userId]
    );
    if (taken.length > 0) {
      await pool.execute('UPDATE email_otp SET consumed = true WHERE id = ?', [otp.id]);
      throw new AppError(409, 'EMAIL_TAKEN', 'That email address is already in use');
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('UPDATE employees SET email = ? WHERE id = ?', [otp.new_email, userId]);
      await conn.execute('UPDATE email_otp SET consumed = true WHERE id = ?', [otp.id]);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await AuditService.log(userId, 'EMAIL_CHANGED', 'employee', userId, `Email changed to ${otp.new_email}`, ip);
    return { email: otp.new_email };
  }
}
