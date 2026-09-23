import dotenv from 'dotenv';
dotenv.config();

import pool from './pool';
import { RowDataPacket } from 'mysql2';

const tables: string[] = [
  `CREATE TABLE IF NOT EXISTS departments (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS employees (
    id VARCHAR(36) PRIMARY KEY,
    employee_code VARCHAR(50) UNIQUE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    mobile VARCHAR(20),
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('Employee', 'Manager', 'Admin') NOT NULL,
    department_id VARCHAR(36),
    designation VARCHAR(100),
    manager_id VARCHAR(36),
    date_of_joining DATE,
    is_active BOOLEAN DEFAULT true,
    is_temp_password BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (manager_id) REFERENCES employees(id)
  )`,

  `CREATE TABLE IF NOT EXISTS leave_types (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    yearly_allocation DECIMAL(5,1) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS leave_balances (
    id VARCHAR(36) PRIMARY KEY,
    employee_id VARCHAR(36) NOT NULL,
    leave_type_id VARCHAR(36) NOT NULL,
    balance DECIMAL(5,1) NOT NULL DEFAULT 0,
    year INT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_balance (employee_id, leave_type_id, year),
    FOREIGN KEY (employee_id) REFERENCES employees(id),
    FOREIGN KEY (leave_type_id) REFERENCES leave_types(id),
    CONSTRAINT chk_balance_non_negative CHECK (balance >= 0)
  )`,

  `CREATE TABLE IF NOT EXISTS leave_requests (
    id VARCHAR(36) PRIMARY KEY,
    employee_id VARCHAR(36) NOT NULL,
    leave_type_id VARCHAR(36) NOT NULL,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    is_half_day BOOLEAN DEFAULT false,
    days_count DECIMAL(5,1) NOT NULL,
    reason VARCHAR(500) NOT NULL,
    status ENUM('Pending', 'Approved', 'Rejected', 'Cancelled') NOT NULL DEFAULT 'Pending',
    manager_remarks VARCHAR(500),
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id),
    FOREIGN KEY (leave_type_id) REFERENCES leave_types(id),
    CONSTRAINT chk_date_order CHECK (from_date <= to_date)
  )`,

  `CREATE TABLE IF NOT EXISTS holidays (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    holiday_date DATE NOT NULL UNIQUE,
    description VARCHAR(500),
    year INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR(36) PRIMARY KEY,
    recipient_id VARCHAR(36) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recipient_id) REFERENCES employees(id)
  )`,

  `CREATE TABLE IF NOT EXISTS login_attempts (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    success BOOLEAN NOT NULL,
    attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id VARCHAR(36),
    details TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS password_history (
    id VARCHAR(36) PRIMARY KEY,
    employee_id VARCHAR(36) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  )`,

  // One-time codes for verifying a self-service email change. The code is sent to
  // the NEW address to prove ownership before it replaces the current email.
  `CREATE TABLE IF NOT EXISTS email_otp (
    id VARCHAR(36) PRIMARY KEY,
    employee_id VARCHAR(36) NOT NULL,
    new_email VARCHAR(255) NOT NULL,
    code_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    consumed BOOLEAN DEFAULT false,
    attempts INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  )`,
];

/**
 * Indexes covering the hot filter paths. Foreign keys already index their own
 * columns, so these are the composite and non-FK lookups that were missing.
 */
const indexes: { table: string; name: string; columns: string }[] = [
  { table: 'leave_requests', name: 'idx_lr_status', columns: 'status' },
  { table: 'leave_requests', name: 'idx_lr_employee_status', columns: 'employee_id, status' },
  { table: 'leave_requests', name: 'idx_lr_dates', columns: 'from_date, to_date' },
  { table: 'leave_requests', name: 'idx_lr_submitted', columns: 'submitted_at' },
  { table: 'leave_balances', name: 'idx_lb_employee_year', columns: 'employee_id, year' },
  { table: 'holidays', name: 'idx_hol_year', columns: 'year' },
  { table: 'login_attempts', name: 'idx_la_email_time', columns: 'email, attempted_at' },
  { table: 'audit_logs', name: 'idx_al_created', columns: 'created_at' },
  { table: 'audit_logs', name: 'idx_al_user', columns: 'user_id' },
  { table: 'audit_logs', name: 'idx_al_action', columns: 'action' },
  { table: 'notifications', name: 'idx_notif_recipient_read', columns: 'recipient_id, is_read' },
  { table: 'password_history', name: 'idx_ph_employee_time', columns: 'employee_id, created_at' },
  { table: 'employees', name: 'idx_emp_active', columns: 'is_active' },
];

/**
 * Columns added after the initial schema. Applied only when missing so migrate
 * stays idempotent on an existing database.
 */
const columns: { table: string; name: string; definition: string }[] = [
  // When an account was disabled, so the auto-purge job can find accounts that
  // have been inactive long enough to remove. NULL means currently active.
  { table: 'employees', name: 'deactivated_at', definition: 'TIMESTAMP NULL DEFAULT NULL' },
  // Self-service profile fields.
  { table: 'employees', name: 'address', definition: 'VARCHAR(500) NULL DEFAULT NULL' },
  { table: 'employees', name: 'avatar_url', definition: 'VARCHAR(255) NULL DEFAULT NULL' },
];

async function columnExists(table: string, name: string): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as count FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, name]
  );
  return parseInt(rows[0].count) > 0;
}

async function indexExists(table: string, name: string): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as count FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
    [table, name]
  );
  return parseInt(rows[0].count) > 0;
}

async function migrate() {
  let failures = 0;

  try {
    for (const sql of tables) {
      const tableName = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1] ?? 'unknown';
      try {
        await pool.execute(sql);
        console.log(`  table ok: ${tableName}`);
      } catch (err: any) {
        // CHECK constraints are unsupported before MySQL 8.0.16; the app enforces
        // the same rules, so that specific failure is not fatal.
        if (err.code === 'ER_PARSE_ERROR' && sql.includes('CHECK')) {
          const withoutChecks = sql.replace(/,\s*CONSTRAINT \w+ CHECK \([^)]*\)/g, '');
          try {
            await pool.execute(withoutChecks);
            console.log(`  table ok: ${tableName} (CHECK constraints skipped, unsupported by this MySQL version)`);
            continue;
          } catch (retryErr: any) {
            failures++;
            console.error(`  FAILED table ${tableName}: ${retryErr.message}`);
            continue;
          }
        }
        failures++;
        console.error(`  FAILED table ${tableName}: ${err.message}`);
      }
    }

    for (const col of columns) {
      try {
        if (await columnExists(col.table, col.name)) {
          console.log(`  column exists: ${col.table}.${col.name}`);
          continue;
        }
        await pool.execute(`ALTER TABLE ${col.table} ADD COLUMN ${col.name} ${col.definition}`);
        console.log(`  column created: ${col.table}.${col.name}`);
      } catch (err: any) {
        if (err.code === 'ER_DUP_FIELDNAME') continue;
        failures++;
        console.error(`  FAILED column ${col.table}.${col.name}: ${err.message}`);
      }
    }

    for (const idx of indexes) {
      try {
        if (await indexExists(idx.table, idx.name)) {
          console.log(`  index exists: ${idx.name}`);
          continue;
        }
        await pool.execute(`ALTER TABLE ${idx.table} ADD INDEX ${idx.name} (${idx.columns})`);
        console.log(`  index created: ${idx.name}`);
      } catch (err: any) {
        if (err.code === 'ER_DUP_KEYNAME') continue;
        failures++;
        console.error(`  FAILED index ${idx.name}: ${err.message}`);
      }
    }

    // Report the real outcome instead of always printing success.
    if (failures > 0) {
      console.error(`\nMigration finished with ${failures} failure(s). Review the errors above.`);
      process.exitCode = 1;
    } else {
      console.log('\nMigration completed successfully.');
    }
  } catch (error) {
    console.error('Migration aborted:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
