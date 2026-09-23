import pool from '../database/pool';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { AuditService } from './audit.service';

/**
 * Automatic cleanup of long-disabled accounts.
 *
 * An account that has been deactivated for longer than RETENTION_DAYS is
 * permanently removed along with its operational data (leave requests, balances,
 * notifications, password history, login attempts). Audit-log rows are kept on
 * purpose: they record that the account existed and was purged, which the leave
 * history itself no longer can.
 *
 * Guards mirror manual deletion: administrators are never auto-purged, and an
 * account that still manages active reportees is skipped until it's reassigned.
 */
const RETENTION_DAYS = 60; // "two months"

export class AccountPurgeService {
  /** Employees eligible for purge: inactive, disabled long enough, not an Admin. */
  private static async findExpiredAccounts(): Promise<{ id: string; name: string; email: string; employee_code: string }[]> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, name, email, employee_code
         FROM employees
        WHERE is_active = false
          AND role <> 'Admin'
          AND deactivated_at IS NOT NULL
          AND deactivated_at < (NOW() - INTERVAL ${RETENTION_DAYS} DAY)`
    );
    return rows as { id: string; name: string; email: string; employee_code: string }[];
  }

  /** Full cascade for one account, in a single transaction. Returns true if removed. */
  private static async purgeOne(account: { id: string; name: string; email: string; employee_code: string }): Promise<boolean> {
    // Never orphan active reportees behind a deleted manager.
    const [reportees] = await pool.execute<RowDataPacket[]>(
      'SELECT COUNT(*) as count FROM employees WHERE manager_id = ? AND is_active = true',
      [account.id]
    );
    if (parseInt(reportees[0].count) > 0) {
      console.warn(`[purge] Skipping ${account.email}: still manages active reportees.`);
      return false;
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Detach any inactive reportees so the manager row can be deleted.
      await conn.execute('UPDATE employees SET manager_id = NULL WHERE manager_id = ?', [account.id]);

      await conn.execute('DELETE FROM leave_requests WHERE employee_id = ?', [account.id]);
      await conn.execute('DELETE FROM leave_balances WHERE employee_id = ?', [account.id]);
      await conn.execute('DELETE FROM notifications WHERE recipient_id = ?', [account.id]);
      await conn.execute('DELETE FROM password_history WHERE employee_id = ?', [account.id]);
      if (account.email) {
        await conn.execute('DELETE FROM login_attempts WHERE email = ?', [account.email]);
      }

      const [del] = await conn.execute<ResultSetHeader>('DELETE FROM employees WHERE id = ?', [account.id]);
      await conn.commit();

      if (del.affectedRows === 0) return false;
    } catch (err) {
      await conn.rollback();
      console.error(`[purge] Failed to purge ${account.email}:`, err);
      return false;
    } finally {
      conn.release();
    }

    // Audit entry survives the purge (user_id is intentionally not a foreign key).
    await AuditService.log(
      account.id,
      'USER_AUTO_PURGED',
      'employee',
      account.id,
      `Account auto-deleted after ${RETENTION_DAYS} days disabled (${account.email}, ${account.employee_code || 'no code'})`
    );
    console.log(`[purge] Removed ${account.email} (disabled > ${RETENTION_DAYS} days)`);
    return true;
  }

  /** Run one sweep. Returns how many accounts were purged. Safe to call repeatedly. */
  static async runOnce(): Promise<number> {
    try {
      const expired = await AccountPurgeService.findExpiredAccounts();
      if (expired.length === 0) return 0;

      console.log(`[purge] ${expired.length} account(s) disabled over ${RETENTION_DAYS} days; purging...`);
      let purged = 0;
      for (const account of expired) {
        if (await AccountPurgeService.purgeOne(account)) purged++;
      }
      console.log(`[purge] Sweep complete: ${purged} account(s) removed.`);
      return purged;
    } catch (err) {
      // A failed sweep must never crash the server; it retries on the next interval.
      console.error('[purge] Sweep error:', err);
      return 0;
    }
  }

  /**
   * Start the daily scheduler. Runs once shortly after boot, then every 24h.
   * Returns the timer so it can be cleared on shutdown.
   */
  static startScheduler(): NodeJS.Timeout {
    const DAY_MS = 24 * 60 * 60 * 1000;
    // Small delay after boot so startup isn't competing with the first requests.
    setTimeout(() => { void AccountPurgeService.runOnce(); }, 30_000);
    const timer = setInterval(() => { void AccountPurgeService.runOnce(); }, DAY_MS);
    timer.unref?.(); // don't keep the process alive solely for this timer
    return timer;
  }
}
