# Employee Leave Management System

A full-stack, role-based leave management application for organizations. Employees apply for leave and track balances, managers approve or reject requests from their direct reports, and administrators manage users, leave types, holidays, and reporting.

Built with React 18 + TypeScript on the frontend and Express + TypeScript + MySQL on the backend.

---

## Features

### Role-based access (Employee / Manager / Admin)
- **Employee** — apply for leave, view balances, track request history, view the holiday calendar, manage their own profile.
- **Manager** — everything an employee can do, plus approve/reject their team's requests, a team leave calendar, and team history.
- **Admin** — full user management, leave-type configuration, holiday management, all leave requests, and reports.

### Leave management
- Working-day calculation that excludes weekends and configurable holidays, with half-day (0.5) support.
- Transactional approval with row-level locking, so concurrent approvals can't over-deduct a leave balance.
- Auto-cancellation of pending requests when an employee is deactivated.

### Security
- JWT authentication with bcrypt password hashing.
- Forced password change on first login and password-reuse prevention (last 3 passwords).
- Login-attempt tracking with automatic account lockout.
- Helmet security headers, per-route rate limiting, and parameterized SQL throughout.

### Notifications & profile
- In-app notifications plus role-aware HTML email (via SMTP) for requests, approvals, and rejections.
- Self-service profile: editable address, profile picture upload, and email change verified by a one-time code.

### Administration
- Bulk holiday import from Excel/CSV with per-row validation.
- Audit logging of key actions.
- Automatic purge of accounts left disabled beyond a retention window.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, React Router |
| Backend | Node.js, Express, TypeScript |
| Database | MySQL |
| Auth | JWT, bcrypt |
| Email | Nodemailer (SMTP) |
| Testing | Jest, fast-check (property-based) |

---

## Project structure

```
Leave_Management/
├── backend/            # Express + TypeScript API
│   ├── src/
│   │   ├── database/   # migrations, seed, connection pool
│   │   ├── middleware/ # auth, error handling, rate limiting
│   │   ├── routes/     # API endpoints
│   │   ├── services/   # business logic
│   │   └── types/
│   └── .env.example
├── frontend/           # React + Vite client
│   └── src/
│       ├── components/
│       ├── context/
│       ├── pages/
│       └── services/
└── package.json        # workspace root
```

---

## Getting started

### Prerequisites
- Node.js 18+
- MySQL 8+

### 1. Clone and install
```bash
git clone <your-repo-url>
cd Leave_Management
npm install          # installs both workspaces
```

### 2. Configure the backend
```bash
cd backend
cp .env.example .env
```
Edit `.env` and set at minimum:
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- `JWT_SECRET` — generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- SMTP settings are optional. Without `SMTP_USER`, the app logs emails instead of sending them.

### 3. Create the database
Create an empty MySQL database matching `DB_NAME`, then run the migration and seed:
```bash
cd backend
npm run migrate     # creates tables and indexes
npm run seed        # inserts demo users, leave types, and holidays
```

### 4. Run in development
From the repo root:
```bash
npm run dev:backend    # starts the API (default port 3001)
npm run dev:frontend   # starts Vite (default port 5173)
```
Open http://localhost:5173.

---

## Default login credentials (after seeding)

All seeded accounts use the password `Admin@123`.

| Role | Email |
|------|-------|
| Admin | admin@company.com |
| Manager | manager@company.com |
| Employee | amit@company.com |
| Employee | priya@company.com |

> Change these before any real deployment.

---

## Scripts

**Root**
| Script | Description |
|--------|-------------|
| `npm run dev:backend` | Start the backend in watch mode |
| `npm run dev:frontend` | Start the frontend dev server |
| `npm run build` | Build backend and frontend for production |
| `npm test` | Run backend tests |

**Backend** (`cd backend`)
| Script | Description |
|--------|-------------|
| `npm run dev` | Watch-mode dev server |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run migrate` | Create/upgrade database schema |
| `npm run seed` | Seed demo data |
| `npm test` | Run Jest tests |

**Frontend** (`cd frontend`)
| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build |

---

## Notes

- This is a personal/portfolio project intended to run locally or on a single deployment. Uploaded profile pictures are stored on the local filesystem.
- Email delivery depends on a reachable SMTP server; institutional networks sometimes block outbound SMTP ports.
