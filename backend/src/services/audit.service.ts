import { v4 as uuidv4 } from 'uuid';
import pool from '../database/pool';
import { RowDataPacket } from 'mysql2';

export class AuditService {
  /**
   * Append an audit entry. Never throws: a logging failure must not break the
   * operation being logged.
   */
  static async log(
    userId: string | null,
    action: string,
    entityType?: string | null,
    entityId?: string | null,
    details?: string | null,
    ipAddress?: string | null
  ): Promise<void> {
    try {
      await pool.execute(
        'INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          uuidv4(),
          userId ?? null,
          action,
          entityType ?? null,
          entityId ?? null,
          details ? String(details).slice(0, 2000) : null,
          ipAddress ? String(ipAddress).slice(0, 45) : null,
        ]
      );
    } catch (error) {
      console.error('Audit log write failed:', { action, entityId, error });
    }
  }

  static async getLogs(
    filters: any = {},
    page: number = 1
  ): Promise<{ logs: any[]; total: number; page: number; totalPages: number }> {
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const whereClauses: string[] = [];
    const params: any[] = [];

    if (filters.user_id) { whereClauses.push('al.user_id = ?'); params.push(filters.user_id); }
    if (filters.action) { whereClauses.push('al.action = ?'); params.push(filters.action); }
    if (filters.entity_type) { whereClauses.push('al.entity_type = ?'); params.push(filters.entity_type); }
    if (filters.from_date) { whereClauses.push('al.created_at >= ?'); params.push(filters.from_date); }
    if (filters.to_date) { whereClauses.push('al.created_at <= ?'); params.push(`${filters.to_date} 23:59:59`); }

    const whereClause = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';
    const offset = (safePage - 1) * 20;

    const [countRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM audit_logs al ${whereClause}`,
      params
    );
    const total = parseInt(countRows[0].total);

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT al.*, e.name as user_name, e.employee_code
       FROM audit_logs al
       LEFT JOIN employees e ON al.user_id = e.id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT 20 OFFSET ${offset}`,
      params
    );

    return { logs: rows, total, page: safePage, totalPages: Math.max(1, Math.ceil(total / 20)) };
  }

  /** Distinct action names, for populating a filter dropdown. */
  static async getActions(): Promise<string[]> {
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT DISTINCT action FROM audit_logs ORDER BY action');
    return rows.map(r => r.action);
  }
}
