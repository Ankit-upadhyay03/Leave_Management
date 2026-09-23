import pool from '../database/pool';
import { RowDataPacket } from 'mysql2';

export class LeaveCalculationService {
  /**
   * Format a Date as YYYY-MM-DD using its LOCAL calendar fields.
   *
   * Deliberately avoids toISOString(), which converts to UTC first and shifts the
   * calendar day for any non-UTC timezone (e.g. a MySQL DATE of 2026-08-15 read in
   * IST becomes 2026-08-14 after a UTC round-trip).
   */
  static formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /** Parse a YYYY-MM-DD string (or Date) into a local-midnight Date, free of UTC drift. */
  static parseDate(value: string | Date): Date {
    if (value instanceof Date) {
      return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  static isWeekend(date: Date): boolean {
    const day = date.getDay();
    return day === 0 || day === 6;
  }

  /** Working days in the range, excluding weekends and configured holidays. */
  static async calculateLeaveDays(fromDate: Date, toDate: Date, isHalfDay: boolean): Promise<number> {
    if (isHalfDay) return 0.5;

    const from = LeaveCalculationService.parseDate(fromDate);
    const to = LeaveCalculationService.parseDate(toDate);

    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT DATE_FORMAT(holiday_date, "%Y-%m-%d") as holiday_date FROM holidays WHERE holiday_date >= ? AND holiday_date <= ?',
      [LeaveCalculationService.formatDate(from), LeaveCalculationService.formatDate(to)]
    );
    const holidays = rows.map((h: any) => h.holiday_date);

    return LeaveCalculationService.calculateLeaveDaysSync(from, to, false, holidays);
  }

  /** Pure day-count used by both the DB path above and the unit tests. */
  static calculateLeaveDaysSync(fromDate: Date, toDate: Date, isHalfDay: boolean, holidays: string[]): number {
    if (isHalfDay) return 0.5;

    const holidaySet = new Set(holidays);
    let count = 0;
    const current = LeaveCalculationService.parseDate(fromDate);
    const end = LeaveCalculationService.parseDate(toDate);

    while (current <= end) {
      if (
        !LeaveCalculationService.isWeekend(current) &&
        !holidaySet.has(LeaveCalculationService.formatDate(current))
      ) {
        count++;
      }
      current.setDate(current.getDate() + 1);
    }

    return count;
  }

  static async getHolidaysInRange(fromDate: Date, toDate: Date): Promise<any[]> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT id, name, DATE_FORMAT(holiday_date, "%Y-%m-%d") as holiday_date, description FROM holidays WHERE holiday_date >= ? AND holiday_date <= ?',
      [
        LeaveCalculationService.formatDate(LeaveCalculationService.parseDate(fromDate)),
        LeaveCalculationService.formatDate(LeaveCalculationService.parseDate(toDate)),
      ]
    );
    return rows;
  }
}
