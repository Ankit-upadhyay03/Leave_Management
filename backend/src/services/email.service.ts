import nodemailer from 'nodemailer';
import { COMPANY_NAME, APP_URL } from '../config';

const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: SMTP_PORT,
  // Port 465 uses implicit TLS; 587 upgrades via STARTTLS.
  secure: SMTP_PORT === 465,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
  // Fail fast instead of hanging ~2 min on a blocked/slow port, so the retry can kick in.
  connectionTimeout: 15000,
  greetingTimeout: 10000,
  socketTimeout: 20000,
  // Pool connections and cap the rate, so a dropped socket is replaced rather than
  // reused, and Gmail's per-connection limits aren't tripped under a burst.
  pool: true,
  maxConnections: 3,
  maxMessages: 50,
});

/** Shared leave detail fields used across the approval templates. */
export interface LeaveDetails {
  leaveType: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  isHalfDay: boolean;
}

const FROM = () => process.env.SMTP_FROM || `"${COMPANY_NAME} Leave Management" <${process.env.SMTP_USER}>`;

/** Escape user-supplied text so a reason or remark can't inject markup into the email. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "15 Aug 2026 (Saturday)" from a YYYY-MM-DD string. */
function prettyDate(ymd: string): string {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return String(ymd);
  const date = new Date(y, m - 1, d);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return `${d} ${months[m - 1]} ${y} (${days[date.getDay()]})`;
}

/** Deep link to the review screen, scrolled to the specific request. */
function reviewLink(requestId: string): string {
  return `${APP_URL}/manager/pending?request=${encodeURIComponent(requestId)}`;
}

function dashboardLink(): string {
  return `${APP_URL}/leave/history`;
}

// ---------- Shared layout pieces ----------

function wrapper(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f9;">
<div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px 16px;">
  <div style="background:#1a237e;color:#ffffff;padding:22px 28px;border-radius:10px 10px 0 0;">
    <div style="font-size:18px;font-weight:600;">${esc(COMPANY_NAME)}</div>
    <div style="font-size:13px;opacity:.85;margin-top:2px;">Leave Management System</div>
  </div>
  <div style="background:#ffffff;padding:28px;border-radius:0 0 10px 10px;box-shadow:0 2px 10px rgba(0,0,0,.06);">
    ${bodyHtml}
  </div>
  <p style="color:#9aa0a6;font-size:11px;text-align:center;margin:16px 0 0;line-height:1.6;">
    This is an automated message from the ${esc(COMPANY_NAME)} Leave Management System.<br/>
    Please do not reply directly to this email.
  </p>
</div>
</body></html>`;
}

function detailsTable(d: LeaveDetails): string {
  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:7px 0;color:#5f6368;width:150px;vertical-align:top;font-size:14px;">${label}</td>
      <td style="padding:7px 0;color:#202124;font-weight:600;font-size:14px;">${value}</td>
    </tr>`;

  return `
  <div style="background:#f8f9fb;border-left:4px solid #1a237e;border-radius:8px;padding:16px 20px;margin:20px 0;">
    <div style="font-weight:700;color:#1a237e;margin-bottom:8px;font-size:15px;">Leave Details</div>
    <table style="width:100%;border-collapse:collapse;">
      ${row('Leave Type', esc(d.leaveType))}
      ${row('From', prettyDate(d.fromDate))}
      ${row('To', prettyDate(d.toDate))}
      ${row('Duration', `${d.days} day(s)`)}
      ${row('Half Day', d.isHalfDay ? 'Yes' : 'No')}
      ${row('Reason', esc(d.reason))}
    </table>
  </div>`;
}

function actionButton(href: string, label: string, color = '#1a237e'): string {
  return `
  <div style="text-align:center;margin:26px 0;">
    <a href="${href}" style="background:${color};color:#ffffff;padding:13px 30px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
      ${label}
    </a>
    <div style="color:#9aa0a6;font-size:11px;margin-top:10px;">
      If the button does not work, copy this link into your browser:<br/>
      <span style="color:#5f6368;word-break:break-all;">${href}</span>
    </div>
  </div>`;
}

function signature(): string {
  return `
  <p style="color:#3c4043;font-size:14px;line-height:1.7;margin:22px 0 0;">
    Best regards,<br/>
    <strong>Leave Management System</strong><br/>
    ${esc(COMPANY_NAME)}
  </p>`;
}

// ---------- Delivery ----------

async function send(to: string, subject: string, html: string, text: string, label: string): Promise<void> {
  if (!process.env.SMTP_USER) {
    console.log(`[EMAIL SKIPPED — SMTP not configured] ${label} -> ${to}`);
    console.log(`  Subject: ${subject}`);
    return;
  }
  try {
    const info = await transporter.sendMail({ from: FROM(), to, subject, html, text });
    // accepted/rejected + server response make delivery traceable against the Sent box.
    console.log(
      `${label} email sent to ${to} | id=${info.messageId} | accepted=[${(info.accepted || []).join(', ')}]` +
        ` | rejected=[${(info.rejected || []).join(', ')}] | response=${info.response}`
    );
  } catch (error) {
    // Email is a side effect: never let a delivery failure break the operation.
    console.error(`${label} email FAILED for ${to}:`, error);
  }
}

/** Plain-text mirror of the leave details block, for clients without HTML. */
function detailsText(d: LeaveDetails): string {
  return [
    'Leave Details:',
    `  Leave Type: ${d.leaveType}`,
    `  From: ${prettyDate(d.fromDate)}`,
    `  To: ${prettyDate(d.toDate)}`,
    `  Duration: ${d.days} day(s)`,
    `  Half Day: ${d.isHalfDay ? 'Yes' : 'No'}`,
    `  Reason: ${d.reason}`,
  ].join('\n');
}

export class EmailService {
  // =====================================================
  // 1. Employee submits leave -> notify their Manager
  // =====================================================
  static async sendLeaveRequestToManager(params: {
    to: string;
    managerName: string;
    employeeName: string;
    employeeCode: string;
    department: string;
    requestId: string;
    leave: LeaveDetails;
  }): Promise<void> {
    const { to, managerName, employeeName, employeeCode, department, requestId, leave } = params;
    const link = reviewLink(requestId);

    const html = wrapper(`
      <p style="color:#202124;font-size:15px;margin:0 0 4px;">Dear ${esc(managerName)},</p>
      <p style="color:#3c4043;font-size:14px;line-height:1.7;margin:12px 0;">
        I hope you are doing well.
      </p>
      <p style="color:#3c4043;font-size:14px;line-height:1.7;margin:12px 0;">
        <strong>${esc(employeeName)}</strong> (Employee ID: ${esc(employeeCode)}), from the
        <strong>${esc(department)}</strong> department, has submitted a leave request for your review.
      </p>
      ${detailsTable(leave)}
      <p style="color:#3c4043;font-size:14px;line-height:1.7;margin:12px 0;">
        Kindly review the request and provide your approval or rejection using the link below:
      </p>
      ${actionButton(link, 'Review Leave Request')}
      <p style="color:#3c4043;font-size:14px;line-height:1.7;margin:12px 0;">
        Your timely response will help us keep the employee's leave records up to date.
      </p>
      <p style="color:#3c4043;font-size:14px;line-height:1.7;margin:12px 0;">
        Thank you for your time and consideration.
      </p>
      ${signature()}
    `);

    const text = [
      `Dear ${managerName},`, '',
      'I hope you are doing well.', '',
      `${employeeName} (Employee ID: ${employeeCode}), from the ${department} department, has submitted a leave request for your review.`, '',
      detailsText(leave), '',
      'Kindly review the request and provide your approval or rejection using the link below:', '',
      `Review Leave Request: ${link}`, '',
      "Your timely response will help us keep the employee's leave records up to date.", '',
      'Thank you for your time and consideration.', '',
      'Best regards,', 'Leave Management System', COMPANY_NAME,
    ].join('\n');

    await send(to, `Leave Request for Approval — ${employeeName} (${employeeCode})`, html, text, 'Leave request (manager)');
  }

  // =====================================================
  // 2. Manager submits leave -> notify their approver/Admin
  // =====================================================
  static async sendLeaveRequestToApprover(params: {
    to: string;
    approverName: string;
    managerName: string;
    employeeCode: string;
    designationOrDepartment: string;
    requestId: string;
    leave: LeaveDetails;
  }): Promise<void> {
    const { to, approverName, managerName, employeeCode, designationOrDepartment, requestId, leave } = params;
    const link = reviewLink(requestId);

    const html = wrapper(`
      <p style="color:#202124;font-size:15px;margin:0 0 4px;">Dear ${esc(approverName)},</p>
      <p style="color:#3c4043;font-size:14px;line-height:1.7;margin:12px 0;">
        I hope you are doing well.
      </p>
      <p style="color:#3c4043;font-size:14px;line-height:1.7;margin:12px 0;">
        <strong>${esc(managerName)}</strong> (Employee ID: ${esc(employeeCode)}),
        ${esc(designationOrDepartment)}, has submitted a leave request for your review.
      </p>
      ${detailsTable(leave)}
      <p style="color:#3c4043;font-size:14px;line-height:1.7;margin:12px 0;">
        Kindly review the request and take the appropriate action using the link below:
      </p>
      ${actionButton(link, 'Review Leave Request')}
      <p style="color:#3c4043;font-size:14px;line-height:1.7;margin:12px 0;">
        Thank you for your time and consideration.
      </p>
      ${signature()}
    `);

    const text = [
      `Dear ${approverName},`, '',
      'I hope you are doing well.', '',
      `${managerName} (Employee ID: ${employeeCode}), ${designationOrDepartment}, has submitted a leave request for your review.`, '',
      detailsText(leave), '',
      'Kindly review the request and take the appropriate action using the link below:', '',
      `Review Leave Request: ${link}`, '',
      'Thank you for your time and consideration.', '',
      'Best regards,', 'Leave Management System', COMPANY_NAME,
    ].join('\n');

    await send(to, `Leave Request for Approval — ${managerName} (${employeeCode})`, html, text, 'Leave request (approver)');
  }

  // =====================================================
  // 3a. Approved -> notify Employee
  // =====================================================
  static async sendLeaveApprovalEmail(params: {
    to: string;
    employeeName: string;
    approvedBy: string;
    leaveType: string;
    fromDate: string;
    toDate: string;
    days: number;
  }): Promise<void> {
    const { to, employeeName, approvedBy, leaveType, fromDate, toDate, days } = params;

    const row = (label: string, value: string) => `
      <tr>
        <td style="padding:7px 0;color:#5f6368;width:150px;font-size:14px;">${label}</td>
        <td style="padding:7px 0;color:#202124;font-weight:600;font-size:14px;">${value}</td>
      </tr>`;

    const html = wrapper(`
      <p style="color:#202124;font-size:15px;margin:0 0 4px;">Dear ${esc(employeeName)},</p>
      <p style="color:#3c4043;font-size:14px;line-height:1.7;margin:12px 0;">
        We are pleased to inform you that your leave request has been
        <strong style="color:#137333;">approved</strong>.
      </p>
      <div style="background:#e6f4ea;border-left:4px solid #137333;border-radius:8px;padding:16px 20px;margin:20px 0;">
        <div style="font-weight:700;color:#137333;margin-bottom:8px;font-size:15px;">Leave Details</div>
        <table style="width:100%;border-collapse:collapse;">
          ${row('Leave Type', esc(leaveType))}
          ${row('From', prettyDate(fromDate))}
          ${row('To', prettyDate(toDate))}
          ${row('Duration', `${days} day(s)`)}
          ${row('Approved By', esc(approvedBy))}
        </table>
      </div>
      <p style="color:#3c4043;font-size:14px;line-height:1.7;margin:12px 0;">
        Your leave balance has been updated accordingly.
      </p>
      <p style="color:#3c4043;font-size:14px;line-height:1.7;margin:12px 0;">
        We hope you have a pleasant and restful time away.
      </p>
      ${actionButton(dashboardLink(), 'View Leave History', '#137333')}
      ${signature()}
    `);

    const text = [
      `Dear ${employeeName},`, '',
      'We are pleased to inform you that your leave request has been approved.', '',
      'Leave Details:',
      `  Leave Type: ${leaveType}`,
      `  From: ${prettyDate(fromDate)}`,
      `  To: ${prettyDate(toDate)}`,
      `  Duration: ${days} day(s)`,
      `  Approved By: ${approvedBy}`, '',
      'Your leave balance has been updated accordingly.', '',
      'We hope you have a pleasant and restful time away.', '',
      'Best regards,', 'Leave Management System', COMPANY_NAME,
    ].join('\n');

    await send(to, `Leave Approved — ${prettyDate(fromDate)} to ${prettyDate(toDate)}`, html, text, 'Leave approval');
  }

  // =====================================================
  // 3b. Rejected -> notify Employee
  // =====================================================
  static async sendLeaveRejectionEmail(params: {
    to: string;
    employeeName: string;
    rejectedBy: string;
    leaveType: string;
    fromDate: string;
    toDate: string;
    days: number;
    reason: string;
  }): Promise<void> {
    const { to, employeeName, rejectedBy, leaveType, fromDate, toDate, days, reason } = params;

    const row = (label: string, value: string) => `
      <tr>
        <td style="padding:7px 0;color:#5f6368;width:150px;vertical-align:top;font-size:14px;">${label}</td>
        <td style="padding:7px 0;color:#202124;font-weight:600;font-size:14px;">${value}</td>
      </tr>`;

    const html = wrapper(`
      <p style="color:#202124;font-size:15px;margin:0 0 4px;">Dear ${esc(employeeName)},</p>
      <p style="color:#3c4043;font-size:14px;line-height:1.7;margin:12px 0;">
        Thank you for submitting your leave request.
      </p>
      <p style="color:#3c4043;font-size:14px;line-height:1.7;margin:12px 0;">
        After reviewing your request, <strong>${esc(rejectedBy)}</strong> has not approved the leave
        for the requested dates.
      </p>
      <div style="background:#fce8e6;border-left:4px solid #c5221f;border-radius:8px;padding:16px 20px;margin:20px 0;">
        <div style="font-weight:700;color:#c5221f;margin-bottom:8px;font-size:15px;">Leave Details</div>
        <table style="width:100%;border-collapse:collapse;">
          ${row('Leave Type', esc(leaveType))}
          ${row('From', prettyDate(fromDate))}
          ${row('To', prettyDate(toDate))}
          ${row('Duration', `${days} day(s)`)}
          ${row('Remarks', esc(reason))}
        </table>
      </div>
      <p style="color:#3c4043;font-size:14px;line-height:1.7;margin:12px 0;">
        You may review the request details in the Leave Management System and submit a new request if required.
      </p>
      <p style="color:#3c4043;font-size:14px;line-height:1.7;margin:12px 0;">
        Thank you for your understanding.
      </p>
      ${actionButton(dashboardLink(), 'View Leave History')}
      ${signature()}
    `);

    const text = [
      `Dear ${employeeName},`, '',
      'Thank you for submitting your leave request.', '',
      `After reviewing your request, ${rejectedBy} has not approved the leave for the requested dates.`, '',
      'Leave Details:',
      `  Leave Type: ${leaveType}`,
      `  From: ${prettyDate(fromDate)}`,
      `  To: ${prettyDate(toDate)}`,
      `  Duration: ${days} day(s)`,
      `  Remarks: ${reason}`, '',
      'You may review the request details in the Leave Management System and submit a new request if required.', '',
      'Thank you for your understanding.', '',
      'Best regards,', 'Leave Management System', COMPANY_NAME,
    ].join('\n');

    await send(to, `Leave Request Update — ${prettyDate(fromDate)} to ${prettyDate(toDate)}`, html, text, 'Leave rejection');
  }

  // =====================================================
  // 4. Account created -> welcome the new user
  // =====================================================
  static async sendWelcomeEmail(params: {
    to: string;
    name: string;
    employeeCode: string;
    tempPassword: string;
    role: string;
    designation?: string;
    department?: string;
  }): Promise<void> {
    const { to, name, employeeCode, tempPassword, role, designation, department } = params;

    const row = (label: string, value: string) => `
      <tr>
        <td style="padding:6px 0;color:#5f6368;width:140px;font-size:14px;">${label}</td>
        <td style="padding:6px 0;color:#202124;font-weight:600;font-size:14px;">${value}</td>
      </tr>`;

    const html = wrapper(`
      <p style="color:#202124;font-size:15px;margin:0 0 4px;">Dear ${esc(name)},</p>
      <p style="color:#3c4043;font-size:14px;line-height:1.7;margin:12px 0;">
        Welcome to ${esc(COMPANY_NAME)}. Your account on the Leave Management System has been created.
      </p>
      <div style="background:#f8f9fb;border-left:4px solid #1a237e;border-radius:8px;padding:16px 20px;margin:20px 0;">
        <div style="font-weight:700;color:#1a237e;margin-bottom:8px;font-size:15px;">Your Account Details</div>
        <table style="width:100%;border-collapse:collapse;">
          ${row('Employee ID', esc(employeeCode))}
          ${row('Email', esc(to))}
          ${row('Role', esc(role))}
          ${designation ? row('Designation', esc(designation)) : ''}
          ${department ? row('Department', esc(department)) : ''}
        </table>
      </div>
      <div style="background:#fef7e0;border-left:4px solid #ea8600;border-radius:8px;padding:16px 20px;margin:20px 0;">
        <div style="font-weight:700;color:#ea8600;margin-bottom:8px;font-size:15px;">Temporary Password</div>
        <div style="font-family:monospace;font-size:17px;color:#c5221f;background:#ffffff;padding:9px 13px;border-radius:5px;display:inline-block;letter-spacing:1px;">
          ${esc(tempPassword)}
        </div>
        <p style="margin:10px 0 0;font-size:12px;color:#5f6368;">
          For your security, you will be asked to set a new password the first time you sign in.
        </p>
      </div>
      ${actionButton(`${APP_URL}/login`, 'Sign In to Your Account')}
      <p style="color:#3c4043;font-size:14px;line-height:1.7;margin:12px 0;">
        If you have any questions, please contact your HR administrator.
      </p>
      ${signature()}
    `);

    const text = [
      `Dear ${name},`, '',
      `Welcome to ${COMPANY_NAME}. Your account on the Leave Management System has been created.`, '',
      'Your Account Details:',
      `  Employee ID: ${employeeCode}`,
      `  Email: ${to}`,
      `  Role: ${role}`,
      ...(designation ? [`  Designation: ${designation}`] : []),
      ...(department ? [`  Department: ${department}`] : []),
      '',
      `Temporary Password: ${tempPassword}`,
      'For your security, you will be asked to set a new password the first time you sign in.', '',
      `Sign in: ${APP_URL}/login`, '',
      'If you have any questions, please contact your HR administrator.', '',
      'Best regards,', 'Leave Management System', COMPANY_NAME,
    ].join('\n');

    await send(to, `Welcome to ${COMPANY_NAME} — Your Account Details (${employeeCode})`, html, text, 'Welcome');
  }

  // =====================================================
  // 5. Admin revoked an approved leave -> notify Employee
  // =====================================================
  static async sendLeaveCancelledByAdminEmail(params: {
    to: string;
    employeeName: string;
    leaveType: string;
    fromDate: string;
    toDate: string;
    days: number;
  }): Promise<void> {
    const { to, employeeName, leaveType, fromDate, toDate, days } = params;

    const html = wrapper(`
      <p style="color:#202124;font-size:15px;margin:0 0 4px;">Dear ${esc(employeeName)},</p>
      <p style="color:#3c4043;font-size:14px;line-height:1.7;margin:12px 0;">
        We are writing to inform you that your previously approved leave has been cancelled by the administrator.
      </p>
      <div style="background:#f1f3f4;border-left:4px solid #5f6368;border-radius:8px;padding:16px 20px;margin:20px 0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:7px 0;color:#5f6368;width:150px;font-size:14px;">Leave Type</td><td style="padding:7px 0;font-weight:600;font-size:14px;">${esc(leaveType)}</td></tr>
          <tr><td style="padding:7px 0;color:#5f6368;font-size:14px;">From</td><td style="padding:7px 0;font-weight:600;font-size:14px;">${prettyDate(fromDate)}</td></tr>
          <tr><td style="padding:7px 0;color:#5f6368;font-size:14px;">To</td><td style="padding:7px 0;font-weight:600;font-size:14px;">${prettyDate(toDate)}</td></tr>
          <tr><td style="padding:7px 0;color:#5f6368;font-size:14px;">Duration</td><td style="padding:7px 0;font-weight:600;font-size:14px;">${days} day(s)</td></tr>
        </table>
      </div>
      <p style="color:#3c4043;font-size:14px;line-height:1.7;margin:12px 0;">
        The ${days} day(s) have been restored to your leave balance. Please contact your administrator
        or reporting manager if you need further clarification.
      </p>
      ${actionButton(dashboardLink(), 'View Leave History')}
      ${signature()}
    `);

    const text = [
      `Dear ${employeeName},`, '',
      'We are writing to inform you that your previously approved leave has been cancelled by the administrator.', '',
      'Leave Details:',
      `  Leave Type: ${leaveType}`,
      `  From: ${prettyDate(fromDate)}`,
      `  To: ${prettyDate(toDate)}`,
      `  Duration: ${days} day(s)`, '',
      `The ${days} day(s) have been restored to your leave balance.`,
      'Please contact your administrator or reporting manager if you need further clarification.', '',
      'Best regards,', 'Leave Management System', COMPANY_NAME,
    ].join('\n');

    await send(to, `Approved Leave Cancelled — ${prettyDate(fromDate)} to ${prettyDate(toDate)}`, html, text, 'Admin cancellation');
  }

  // =====================================================
  // 6. Verify a self-service email change -> send code to the NEW address
  // =====================================================
  static async sendEmailVerificationOtp(params: {
    to: string;
    name: string;
    code: string;
    expiryMinutes: number;
  }): Promise<void> {
    const { to, name, code, expiryMinutes } = params;

    const html = wrapper(`
      <p style="color:#202124;font-size:15px;margin:0 0 4px;">Dear ${esc(name)},</p>
      <p style="color:#3c4043;font-size:14px;line-height:1.7;margin:12px 0;">
        Use the verification code below to confirm this email address for your
        ${esc(COMPANY_NAME)} Leave Management account.
      </p>
      <div style="background:#f8f9fb;border-left:4px solid #1a237e;border-radius:8px;padding:20px;margin:20px 0;text-align:center;">
        <div style="font-family:monospace;font-size:30px;font-weight:700;letter-spacing:8px;color:#1a237e;">
          ${esc(code)}
        </div>
        <p style="margin:10px 0 0;font-size:12px;color:#5f6368;">
          This code expires in ${expiryMinutes} minutes.
        </p>
      </div>
      <p style="color:#3c4043;font-size:13px;line-height:1.7;margin:12px 0;">
        If you did not request this change, you can safely ignore this email — your
        current address will remain unchanged.
      </p>
      ${signature()}
    `);

    const text = [
      `Dear ${name},`, '',
      `Use this verification code to confirm this email address for your ${COMPANY_NAME} Leave Management account:`, '',
      `  ${code}`, '',
      `This code expires in ${expiryMinutes} minutes.`, '',
      'If you did not request this change, you can safely ignore this email.', '',
      'Best regards,', 'Leave Management System', COMPANY_NAME,
    ].join('\n');

    await send(to, `Your verification code: ${code}`, html, text, 'Email verification');
  }
}
