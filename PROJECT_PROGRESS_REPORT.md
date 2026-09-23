# 📋 Project Progress Report
## Employee Leave Management System (LMS)
### Date: July 2026

---

## 🎯 Project Overview

**Project Name:** Employee Leave Management System (LMS)  
**Type:** Enterprise-Level Internal Web Application  
**Purpose:** Automate the leave management process for an organization with role-based access for Employees, Managers, and Administrators.

---

## 🛠️ Tech Stack Used

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| Backend | Node.js + Express.js + TypeScript |
| Database | MySQL |
| Authentication | JWT (JSON Web Tokens) |
| Email Service | Nodemailer (Gmail SMTP) |
| File Processing | XLSX library (Excel/CSV parsing) |
| Styling | Custom CSS (no external UI library) |

---

## ✅ Features Completed

### 1. Authentication & Security Module
- ✅ Enterprise login (No public signup)
- ✅ Role-based dashboard routing (Employee/Manager/Admin)
- ✅ JWT-based authentication with 30-minute session timeout
- ✅ Account lockout after 5 failed login attempts (15 min)
- ✅ Temporary password generation for new accounts
- ✅ Forced password change on first login
- ✅ Password policy enforcement (8+ chars, uppercase, lowercase, number, special char)
- ✅ Password history tracking
- ✅ Audit logging for all security events

### 2. Admin Dashboard & User Management
- ✅ Admin creates all user accounts (Employee, Manager, Admin)
- ✅ Auto-generated Employee ID (PXM001, PXM002, ...)
- ✅ Country code dropdown for phone numbers (+91 India default)
- ✅ Categorized searchable designation dropdown (20+ categories)
- ✅ Department management (CRUD)
- ✅ User activation/deactivation (soft delete)
- ✅ Password reset by admin
- ✅ Role change (promotion: Employee → Manager → Admin)
- ✅ Welcome email sent automatically on account creation
- ✅ Organization overview with stats on dashboard

### 3. Leave Configuration (Admin)
- ✅ Create/Edit/Deactivate leave types
- ✅ Set yearly leave allocation (Casual: 12, Sick: 10, Earned: 18)
- ✅ Prorated balance for mid-year joiners
- ✅ Yearly balance reset on Jan 1

### 4. Holiday Management (Admin)
- ✅ Add/Edit/Delete holidays
- ✅ **Bulk import from Excel/CSV file**
- ✅ Download template file
- ✅ Duplicate date detection
- ✅ Year-wise holiday view
- ✅ Auto-recalculation of pending leave requests when holidays change

### 5. Employee Module
- ✅ Employee Dashboard (balances, pending requests, upcoming holidays)
- ✅ Apply for Leave (full day / half day)
- ✅ Date validation (no past dates, no overlap, balance check)
- ✅ Leave balance displayed in real-time
- ✅ Cancel pending requests
- ✅ Leave history with filters (status, date range)
- ✅ Company holiday calendar view
- ✅ Weekend & holiday exclusion in day calculation

### 6. Manager Module
- ✅ Manager Dashboard (pending approvals, team stats)
- ✅ View pending leave requests from team
- ✅ Approve leave (auto balance deduction)
- ✅ Reject leave with mandatory remarks
- ✅ Team leave calendar (monthly view)
- ✅ Team leave history with filters
- ✅ Team balance overview

### 7. Notifications & Email
- ✅ In-app notifications for all leave actions
- ✅ Welcome email on account creation
- ✅ **Leave approval email** with details
- ✅ **Leave rejection email** with reason and polite message
- ✅ Professional HTML email templates

### 8. Reports (Admin)
- ✅ Employee Leave Report (date range)
- ✅ Department-wise Report
- ✅ Monthly Leave Report

### 9. Audit Logging
- ✅ User login/logout tracking
- ✅ User creation/modification
- ✅ Leave actions (apply, approve, reject, cancel)
- ✅ Holiday CRUD operations
- ✅ Password resets

---

## 📚 What I Learned from This Project

### Technical Skills

1. **Full-Stack Architecture**
   - How frontend (React) communicates with backend (Express API) via REST
   - Vite proxy configuration for development
   - Separation of concerns: Routes → Services → Database

2. **Database Design (MySQL)**
   - Relational schema design with foreign keys
   - UUID-based primary keys for distributed systems
   - DECIMAL handling in MySQL (string vs number gotcha)
   - ON DUPLICATE KEY UPDATE for upserts

3. **Authentication & Security**
   - JWT token generation and verification
   - BCrypt password hashing
   - Role-based middleware (RBAC)
   - Account lockout mechanism
   - Temporary password + forced change workflow

4. **Email Integration**
   - SMTP configuration with Gmail App Passwords
   - HTML email templates with inline CSS
   - Nodemailer transporter setup
   - Non-blocking email (don't fail user creation if email fails)

5. **File Upload & Processing**
   - Multer for file uploads (multipart/form-data)
   - XLSX library for parsing Excel/CSV files
   - Excel serial date conversion
   - Bulk data import with validation

6. **React & TypeScript**
   - Context API for auth state management
   - Protected routes with role-based access
   - Searchable dropdown component (custom)
   - Form handling with validation
   - Axios interceptors for token injection and 401 handling

7. **Enterprise Software Patterns**
   - No public signup — admin-controlled user lifecycle
   - Audit trail for compliance
   - Soft delete (deactivation) vs hard delete
   - Auto-generated employee IDs
   - Prorated leave allocation for mid-year joiners

### Problem-Solving Skills

- Debugging MySQL DECIMAL comparison issues (string vs number)
- Handling CORS and proxy configuration
- Windows firewall and port forwarding for device testing
- Vite HMR (Hot Module Replacement) for development speed

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────┐
│                   FRONTEND                       │
│        React + TypeScript + Vite                 │
│   Port: 5173 (proxies /api → backend)           │
├─────────────────────────────────────────────────┤
│                   BACKEND                        │
│      Node.js + Express + TypeScript              │
│   Port: 3001                                     │
├─────────────────────────────────────────────────┤
│                  DATABASE                        │
│              MySQL (Port 3306)                   │
│   Tables: employees, departments, leave_types,   │
│   leave_balances, leave_requests, holidays,      │
│   notifications, audit_logs, login_attempts,     │
│   password_history                               │
└─────────────────────────────────────────────────┘
```

---

## 🔄 Application Workflow

```
Admin creates Employee account
        ↓
System generates temp password + sends welcome email
        ↓
Employee logs in → Forced password change
        ↓
Employee applies for leave
        ↓
System validates (balance, overlap, dates, holidays)
        ↓
Request status → "Pending"
        ↓
Manager receives notification
        ↓
Manager approves/rejects
        ↓
If Approved: Balance deducted, approval email sent
If Rejected: Reason provided, rejection email sent
        ↓
Employee sees updated status + receives email
```

---

## 📊 Database Tables (10 tables)

1. `departments` — Organization departments
2. `employees` — All users (Employee/Manager/Admin)
3. `leave_types` — Casual, Sick, Earned leave configs
4. `leave_balances` — Per employee per year balances
5. `leave_requests` — All leave applications
6. `holidays` — Company holidays
7. `notifications` — In-app notifications
8. `login_attempts` — Failed login tracking
9. `audit_logs` — All system actions
10. `password_history` — Previous passwords

---

## 🚀 How to Run the Project

### Prerequisites
- Node.js 18+
- MySQL installed and running

### Steps
```bash
# 1. Clone/Open the project
cd d:\Leave_Management

# 2. Install dependencies
cd backend && npm install
cd ../frontend && npm install

# 3. Configure database
# Edit backend/.env with MySQL credentials

# 4. Create tables
cd backend && npm run migrate

# 5. Seed demo data
npm run seed

# 6. Start backend (Port 3001)
npm run dev

# 7. Start frontend (Port 5173) — in new terminal
cd frontend && npm run dev

# 8. Open browser: http://localhost:5173
```

### Demo Credentials
| Role | Email | Password |
|------|-------|----------|
| Admin | admin@company.com | Admin@123 |
| Manager | manager@company.com | Admin@123 |
| Employee | amit@company.com | Admin@123 |

---

## 📌 Meeting Briefing Tips

### How to Start the Briefing:

1. **Introduction** (1 min)
   - "Maine ek Enterprise Leave Management System banaya hai jo real company me use hota hai."

2. **Problem Statement** (1 min)
   - "Companies me leave manually manage hota hai — emails, spreadsheets. Isme errors hote hain. This system automates the entire process."

3. **Live Demo** (5-7 min)
   - Login as Admin → Show user creation (PXM ID auto-generated, email sent)
   - Login as Employee → Apply leave → Show validation
   - Login as Manager → Approve/Reject → Show email notification
   - Show holiday import from Excel

4. **Architecture** (2 min)
   - Frontend-Backend-Database separation
   - JWT authentication
   - Role-based access control

5. **Key Learnings** (2 min)
   - Full-stack development
   - Enterprise security patterns
   - Email integration
   - File import/export
   - Database design

6. **Challenges Faced** (1 min)
   - MySQL decimal handling
   - SMTP configuration
   - Role-based routing
   - Date/timezone handling

---

## 📈 Future Scope

- [ ] Forgot Password with OTP
- [ ] Leave carry-forward rules
- [ ] Report export to PDF/Excel
- [ ] Mobile responsive improvements
- [ ] Leave calendar sync with Google Calendar
- [ ] Super Admin role
- [ ] Employee profile photo upload
- [ ] Dashboard analytics charts

---

*Report prepared on: July 30, 2026*
