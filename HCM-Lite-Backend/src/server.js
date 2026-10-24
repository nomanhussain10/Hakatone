require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("Missing JWT_SECRET. Copy .env.example to .env and set a strong secret.");
  process.exit(1);
}

const employeeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  department: { type: String, required: true, trim: true },
  role: { type: String, required: true, trim: true },
  status: { type: String, enum: ["Active", "Inactive"], default: "Active" }
}, { timestamps: true });

const attendanceSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  date: { type: String, required: true },
  checkIn: Date,
  checkOut: Date,
  status: { type: String, enum: ["Present", "Late", "Absent"], default: "Present" }
}, { timestamps: true });
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

const leaveSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  type: { type: String, required: true },
  startDate: { type: String, required: true },
  endDate: { type: String, required: true },
  reason: { type: String, default: "" },
  status: { type: String, enum: ["Pending", "Approved", "Rejected"], default: "Pending" },
  reviewedBy: String
}, { timestamps: true });

const payrollSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  month: { type: String, required: true }, // YYYY-MM
  baseSalary: { type: Number, required: true, min: 0 },
  deductions: { type: Number, default: 0, min: 0 },
  netPay: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ["Draft", "Processed", "Paid"], default: "Draft" }
}, { timestamps: true });
payrollSchema.index({ employee: 1, month: 1 }, { unique: true });

const announcementSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true },
  author: { type: String, default: "HR Admin" }
}, { timestamps: true });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["admin", "hr"], default: "admin" }
}, { timestamps: true });

const Employee = mongoose.model("Employee", employeeSchema);
const Attendance = mongoose.model("Attendance", attendanceSchema);
const Leave = mongoose.model("Leave", leaveSchema);
const Payroll = mongoose.model("Payroll", payrollSchema);
const Announcement = mongoose.model("Announcement", announcementSchema);
const User = mongoose.model("User", userSchema);

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ message: "Missing bearer token." });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ message: "Invalid or expired token." }); }
}
function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
function requireFields(body, fields) {
  return fields.filter(field => body[field] === undefined || body[field] === null || String(body[field]).trim() === "");
}
app.get("/", (_req, res) => res.json({ name: "HCM Lite API", status: "running", version: "1.0.0" }));
app.get("/api/health", (_req, res) => res.json({ ok: true, database: mongoose.connection.readyState === 1 ? "connected" : "disconnected" }));

// Create the first admin from .env on server startup. Change the sample password before use.
async function ensureAdmin() {
  const email = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || "";
  if (!email || !password) {
    console.warn("ADMIN_EMAIL / ADMIN_PASSWORD not set; admin bootstrap skipped.");
    return;
  }
  const existing = await User.findOne({ email });
  if (!existing) {
    await User.create({
      name: process.env.ADMIN_NAME || "HCM Admin",
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: "admin"
    });
    console.log(`Initial admin created: ${email}`);
  }
}

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const missing = requireFields(req.body, ["email", "password"]);
  if (missing.length) return res.status(400).json({ message: `Required: ${missing.join(", ")}` });
  const user = await User.findOne({ email: String(req.body.email).toLowerCase().trim() });
  if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
    return res.status(401).json({ message: "Email or password is incorrect." });
  }
  const token = jwt.sign({ id: user._id.toString(), name: user.name, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "8h" });
  res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
}));
app.get("/api/auth/me", auth, (req, res) => res.json({ user: req.user }));

// Employees
app.get("/api/employees", auth, asyncRoute(async (req, res) => {
  const filter = {};
  if (req.query.department) filter.department = req.query.department;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.search) filter.$or = ["name", "email", "department", "role"].map(k => ({ [k]: { $regex: String(req.query.search), $options: "i" } }));
  res.json(await Employee.find(filter).sort({ createdAt: -1 }));
}));
app.get("/api/employees/:id", auth, asyncRoute(async (req, res) => {
  const item = await Employee.findById(req.params.id);
  if (!item) return res.status(404).json({ message: "Employee not found." });
  res.json(item);
}));
app.post("/api/employees", auth, asyncRoute(async (req, res) => {
  const missing = requireFields(req.body, ["name", "email", "department", "role"]);
  if (missing.length) return res.status(400).json({ message: `Required: ${missing.join(", ")}` });
  res.status(201).json(await Employee.create(req.body));
}));
app.patch("/api/employees/:id", auth, asyncRoute(async (req, res) => {
  const item = await Employee.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!item) return res.status(404).json({ message: "Employee not found." });
  res.json(item);
}));
app.delete("/api/employees/:id", auth, asyncRoute(async (req, res) => {
  const item = await Employee.findByIdAndDelete(req.params.id);
  if (!item) return res.status(404).json({ message: "Employee not found." });
  res.json({ message: "Employee deleted." });
}));

// Attendance
app.get("/api/attendance", auth, asyncRoute(async (req, res) => {
  const filter = {};
  if (req.query.date) filter.date = req.query.date;
  if (req.query.employee) filter.employee = req.query.employee;
  res.json(await Attendance.find(filter).populate("employee", "name email department").sort({ date: -1, createdAt: -1 }));
}));
app.post("/api/attendance/check-in", auth, asyncRoute(async (req, res) => {
  const missing = requireFields(req.body, ["employeeId"]);
  if (missing.length) return res.status(400).json({ message: "employeeId is required." });
  if (!(await Employee.exists({ _id: req.body.employeeId }))) return res.status(404).json({ message: "Employee not found." });
  const date = new Date().toISOString().slice(0, 10);
  let record = await Attendance.findOne({ employee: req.body.employeeId, date });
  if (record?.checkIn) return res.status(409).json({ message: "Employee already checked in today." });
  if (!record) record = new Attendance({ employee: req.body.employeeId, date });
  record.checkIn = new Date();
  record.status = "Present";
  await record.save();
  res.status(201).json(await record.populate("employee", "name email department"));
}));
app.post("/api/attendance/check-out", auth, asyncRoute(async (req, res) => {
  const missing = requireFields(req.body, ["employeeId"]);
  if (missing.length) return res.status(400).json({ message: "employeeId is required." });
  const date = new Date().toISOString().slice(0, 10);
  const record = await Attendance.findOne({ employee: req.body.employeeId, date });
  if (!record || !record.checkIn) return res.status(404).json({ message: "No check-in found for today." });
  if (record.checkOut) return res.status(409).json({ message: "Employee already checked out today." });
  record.checkOut = new Date();
  await record.save();
  res.json(await record.populate("employee", "name email department"));
}));

// Leave requests
app.get("/api/leaves", auth, asyncRoute(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.employee) filter.employee = req.query.employee;
  res.json(await Leave.find(filter).populate("employee", "name email department").sort({ createdAt: -1 }));
}));
app.post("/api/leaves", auth, asyncRoute(async (req, res) => {
  const missing = requireFields(req.body, ["employee", "type", "startDate", "endDate"]);
  if (missing.length) return res.status(400).json({ message: `Required: ${missing.join(", ")}` });
  if (req.body.endDate < req.body.startDate) return res.status(400).json({ message: "endDate must be on or after startDate." });
  res.status(201).json(await Leave.create(req.body));
}));
app.patch("/api/leaves/:id/review", auth, asyncRoute(async (req, res) => {
  if (!["Approved", "Rejected"].includes(req.body.status)) return res.status(400).json({ message: "status must be Approved or Rejected." });
  const item = await Leave.findByIdAndUpdate(req.params.id, { status: req.body.status, reviewedBy: req.user.email }, { new: true, runValidators: true }).populate("employee", "name email department");
  if (!item) return res.status(404).json({ message: "Leave request not found." });
  res.json(item);
}));

// Payroll
app.get("/api/payroll", auth, asyncRoute(async (req, res) => {
  const filter = {};
  if (req.query.month) filter.month = req.query.month;
  if (req.query.employee) filter.employee = req.query.employee;
  res.json(await Payroll.find(filter).populate("employee", "name email department").sort({ month: -1 }));
}));
app.post("/api/payroll", auth, asyncRoute(async (req, res) => {
  const missing = requireFields(req.body, ["employee", "month", "baseSalary"]);
  if (missing.length) return res.status(400).json({ message: `Required: ${missing.join(", ")}` });
  const baseSalary = Number(req.body.baseSalary);
  const deductions = Number(req.body.deductions || 0);
  if (!Number.isFinite(baseSalary) || !Number.isFinite(deductions) || baseSalary < 0 || deductions < 0 || deductions > baseSalary) {
    return res.status(400).json({ message: "Salary and deductions must be valid; deductions cannot exceed salary." });
  }
  const netPay = baseSalary - deductions;
  res.status(201).json(await Payroll.create({ ...req.body, baseSalary, deductions, netPay }));
}));
app.patch("/api/payroll/:id/status", auth, asyncRoute(async (req, res) => {
  if (!["Draft", "Processed", "Paid"].includes(req.body.status)) return res.status(400).json({ message: "Invalid payroll status." });
  const item = await Payroll.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true, runValidators: true });
  if (!item) return res.status(404).json({ message: "Payroll record not found." });
  res.json(item);
}));

// Announcements
app.get("/api/announcements", auth, asyncRoute(async (_req, res) => res.json(await Announcement.find().sort({ createdAt: -1 }))));
app.post("/api/announcements", auth, asyncRoute(async (req, res) => {
  const missing = requireFields(req.body, ["title", "message"]);
  if (missing.length) return res.status(400).json({ message: `Required: ${missing.join(", ")}` });
  res.status(201).json(await Announcement.create({ title: req.body.title, message: req.body.message, author: req.user.name }));
}));
app.delete("/api/announcements/:id", auth, asyncRoute(async (req, res) => {
  const item = await Announcement.findByIdAndDelete(req.params.id);
  if (!item) return res.status(404).json({ message: "Announcement not found." });
  res.json({ message: "Announcement deleted." });
}));

app.get("/api/dashboard", auth, asyncRoute(async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const [totalEmployees, activeEmployees, presentToday, pendingLeaves, payroll] = await Promise.all([
    Employee.countDocuments(),
    Employee.countDocuments({ status: "Active" }),
    Attendance.countDocuments({ date: today, checkIn: { $exists: true } }),
    Leave.countDocuments({ status: "Pending" }),
    Payroll.aggregate([{ $match: { month: today.slice(0, 7) } }, { $group: { _id: null, total: { $sum: "$netPay" } } }])
  ]);
  res.json({ totalEmployees, activeEmployees, presentToday, pendingLeaves, payrollTotal: payroll[0]?.total || 0, date: today });
}));

app.use((req, res) => res.status(404).json({ message: `Route not found: ${req.method} ${req.path}` }));
app.use((err, _req, res, _next) => {
  if (err?.code === 11000) return res.status(409).json({ message: "A record with this unique value already exists." });
  if (err?.name === "ValidationError" || err?.name === "CastError") return res.status(400).json({ message: err.message });
  console.error(err);
  res.status(500).json({ message: "Internal server error." });
});

mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/hcm_lite")
  .then(async () => {
    console.log("MongoDB connected");
    await ensureAdmin();
    app.listen(PORT, () => console.log(`HCM Lite API listening at http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error("Could not connect to MongoDB:", err.message);
    process.exit(1);
  });