import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import pool from '../database/pool';
import { AppError } from '../middleware/errorHandler';
import { JwtPayload } from '../types';
import { RowDataPacket } from 'mysql2';
import { AuditService } from './audit.service';
import { JWT_SECRET } from '../config';

const JWT_EXPIRY = process.env.JWT_EXPIRY || '30m';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10');
const LOCKOUT_DURATION_MINUTES = 15;
const MAX_FAILED_ATTEMPTS = 5;
const PASSWORD_HISTORY_DEPTH = 3;

export class AuthService {
  static async login(
    email: string,
    password: string,
    ipAddress?: string
  ): Promise<{ token: string; user: JwtPayload; requirePasswordChange: boolean }> {
    const normalizedEmail = String(email).trim().toLowerCase();

    if (await AuthService.isAccountLocked(normalizedEmail)) {
      throw new AppError(
        423,
        'ACCOUNT_LOCKED',
        `Account locked due to multiple failed attempts. Try again after ${LOCKOUT_DURATION_MINUTES} minutes.`
      );
    }

    const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM employees WHERE email = ?', [normalizedEmail]);
    const user = rows[0];

    if (!user) {
      await AuthService.recordLoginAttempt(normalizedEmail, false);
      throw new AppError(401, 'AUTH_FAILED', 'Invalid email or password');
    }
    if (!user.is_active) {
      await AuthService.recordLoginAttempt(normalizedEmail, false);
      throw new AppError(401, 'AUTH_FAILED', 'Your account has been deactivated. Please contact the administrator.');
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      await AuthService.recordLoginAttempt(normalizedEmail, false);
      if (await AuthService.isAccountLocked(normalizedEmail)) {
        throw new AppError(
          423,
          'ACCOUNT_LOCKED',
          `Account locked due to multiple failed attempts. Try again after ${LOCKOUT_DURATION_MINUTES} minutes.`
        );
      }
      throw new AppError(401, 'AUTH_FAILED', 'Invalid email or password');
    }

    // Clear the failure streak so an old set of failures can't combine with a
    // future one to lock the account after a successful sign-in.
    await AuthService.clearFailedAttempts(normalizedEmail);
    await AuthService.recordLoginAttempt(normalizedEmail, true);

    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    await AuditService.log(user.id, 'LOGIN', 'employee', user.id, 'User logged in', ipAddress);

    return { token, user: payload, requirePasswordChange: !!user.is_temp_password };
  }

  static async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ipAddress?: string
  ): Promise<void> {
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM employees WHERE id = ?', [userId]);
    if (rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'User not found');

    const user = rows[0];

    if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
      throw new AppError(401, 'AUTH_FAILED', 'Current password is incorrect');
    }
    if (currentPassword === newPassword) {
      throw new AppError(400, 'VALIDATION_ERROR', 'New password must be different from your current password');
    }

    AuthService.validatePasswordStrength(newPassword);

    // Enforce the history the password_history table was created for.
    const [history] = await pool.execute<RowDataPacket[]>(
      `SELECT password_hash FROM password_history
       WHERE employee_id = ? ORDER BY created_at DESC LIMIT ${PASSWORD_HISTORY_DEPTH}`,
      [userId]
    );
    for (const old of history) {
      if (await bcrypt.compare(newPassword, old.password_hash)) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          `You cannot reuse any of your last ${PASSWORD_HISTORY_DEPTH} passwords`
        );
      }
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('INSERT INTO password_history (id, employee_id, password_hash) VALUES (?, ?, ?)', [
        uuidv4(),
        userId,
        user.password_hash,
      ]);
      await conn.execute('UPDATE employees SET password_hash = ?, is_temp_password = false WHERE id = ?', [
        newHash,
        userId,
      ]);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await AuditService.log(userId, 'PASSWORD_CHANGE', 'employee', userId, 'Password changed', ipAddress);
  }

  static validatePasswordStrength(password: string): void {
    if (!password || password.length < 8) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Password must be at least 8 characters');
    }
    if (password.length > 128) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Password must not exceed 128 characters');
    }
    if (!/[A-Z]/.test(password)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Password must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Password must contain at least one lowercase letter');
    }
    if (!/[0-9]/.test(password)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Password must contain at least one number');
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"|,.<>?]/.test(password)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Password must contain at least one special character');
    }
  }

  static async isAccountLocked(email: string): Promise<boolean> {
    const lockoutWindow = new Date();
    lockoutWindow.setMinutes(lockoutWindow.getMinutes() - LOCKOUT_DURATION_MINUTES);

    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT COUNT(*) as count FROM login_attempts WHERE email = ? AND success = false AND attempted_at > ?',
      [email, lockoutWindow]
    );
    return parseInt(rows[0].count) >= MAX_FAILED_ATTEMPTS;
  }

  static async recordLoginAttempt(email: string, success: boolean): Promise<void> {
    await pool.execute('INSERT INTO login_attempts (id, email, success) VALUES (?, ?, ?)', [
      uuidv4(),
      email,
      success,
    ]);
  }

  static async clearFailedAttempts(email: string): Promise<void> {
    await pool.execute('DELETE FROM login_attempts WHERE email = ? AND success = false', [email]);
  }

  static async getCurrentUser(userId: string): Promise<any> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, e.name, e.email, e.mobile, e.address, e.avatar_url,
              e.role, e.department_id, e.designation,
              e.manager_id, DATE_FORMAT(e.date_of_joining, "%Y-%m-%d") as date_of_joining,
              e.is_active, e.is_temp_password, e.created_at,
              d.name as department_name, m.name as manager_name
       FROM employees e
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN employees m ON e.manager_id = m.id
       WHERE e.id = ?`,
      [userId]
    );
    return rows[0] || null;
  }

  static async resetPassword(employeeId: string, adminId: string, ipAddress?: string): Promise<string> {
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT id FROM employees WHERE id = ?', [employeeId]);
    if (rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Employee not found');

    const tempPassword = AuthService.generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

    await pool.execute('UPDATE employees SET password_hash = ?, is_temp_password = true WHERE id = ?', [
      hash,
      employeeId,
    ]);
    // A reset invalidates any lockout so the user isn't blocked by old failures.
    await pool.execute(
      'DELETE FROM login_attempts WHERE email = (SELECT email FROM employees WHERE id = ?) AND success = false',
      [employeeId]
    );

    await AuditService.log(adminId, 'PASSWORD_RESET', 'employee', employeeId, 'Password reset by admin', ipAddress);
    return tempPassword;
  }

  /**
   * Cryptographically secure temporary password.
   * Guarantees one character from each required class so it always satisfies the policy.
   */
  static generateTempPassword(length = 12): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnpqrstuvwxyz';
    const digits = '23456789';
    const specials = '!@#$%^&*';
    const all = upper + lower + digits + specials;

    const pick = (set: string) => set[crypto.randomInt(0, set.length)];
    const chars = [pick(upper), pick(lower), pick(digits), pick(specials)];
    for (let i = chars.length; i < length; i++) chars.push(pick(all));

    // Fisher-Yates with a CSPRNG so the guaranteed classes aren't always in front.
    for (let i = chars.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }
}
