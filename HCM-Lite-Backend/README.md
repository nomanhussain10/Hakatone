# HCM Lite Backend API

Node.js + Express + MongoDB backend for the HCM Lite frontend.

## Requirements
- Node.js 18+
- MongoDB running locally, or a MongoDB Atlas connection string

## Setup (Windows)
1. Extract `HCM-Lite-Backend.zip`.
2. Open the extracted folder in VS Code.
3. Open terminal in that folder and run:
   ```bash
   npm install
   ```
4. Copy `.env.example` to a new file named `.env`.
5. In `.env`, set a long random `JWT_SECRET`, your admin email/password, and `MONGODB_URI`.
6. Start MongoDB (or use your Atlas URI).
7. Run:
   ```bash
   npm run dev
   ```
8. Visit `http://localhost:5000/api/health`. You should see `{ "ok": true, "database": "connected" }`.

## Login
`POST http://localhost:5000/api/auth/login`
```json
{ "email": "admin@example.com", "password": "ChangeMe123!" }
```
Use your actual values from `.env`. Save the returned token and send it on protected routes:
`Authorization: Bearer YOUR_TOKEN`

## API routes
- `GET /api/health` — health check (public)
- `POST /api/auth/login` — login (public)
- `GET /api/auth/me` — current signed-in user
- `GET, POST /api/employees`
- `GET, PATCH, DELETE /api/employees/:id`
- `GET /api/attendance`
- `POST /api/attendance/check-in`
- `POST /api/attendance/check-out`
- `GET, POST /api/leaves`
- `PATCH /api/leaves/:id/review`
- `GET, POST /api/payroll`
- `PATCH /api/payroll/:id/status`
- `GET, POST /api/announcements`
- `DELETE /api/announcements/:id`
- `GET /api/dashboard`

All routes except `/`, `/api/health`, and `/api/auth/login` require a bearer token.

## Frontend integration
The earlier frontend is currently a standalone demo and uses in-memory sample data. It will not persist records until its `public/app.js` is updated to call these endpoints with `fetch()` and attach the login token. The backend is ready to integrate, but it is not automatically connected to that frontend yet.

## Security notes
- Change the example admin password before use.
- Keep `.env` private and never commit it.
- Use HTTPS and stricter CORS configuration before public deployment.
- This is a hackathon starter, not a production-certified HR/payroll system.
