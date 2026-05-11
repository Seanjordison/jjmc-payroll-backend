// server.js — JJMC Payroll Backend
// Express REST API that connects to the JJMC Firebase project.
// Runs standalone; does NOT modify any existing firebase_functions files.

"use strict";

require("dotenv").config();

const express  = require("express");
const cors     = require("cors");
const helmet   = require("helmet");
const morgan   = require("morgan");

// ── Routes ────────────────────────────────────────────────
const usersRouter         = require("./routes/users");
const clientsRouter       = require("./routes/clients");
const payrollRouter       = require("./routes/payroll");
const inquiriesRouter     = require("./routes/inquiries");
const notificationsRouter = require("./routes/notifications");
const tutorialsRouter     = require("./routes/tutorials");

const app  = express();
const PORT = process.env.PORT || 5000;

// ── Security & Logging ────────────────────────────────────
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// ── CORS ──────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (e.g. mobile apps, Postman, curl)
      if (!origin) return cb(null, true);
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);

// ── Body Parser ───────────────────────────────────────────
app.use(express.json({ limit: "5mb" }));

// ── Health Check ──────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    service: "JJMC Payroll Backend",
    status:  "running",
    version: "1.0.0",
    time:    new Date().toISOString(),
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ── API Routes ────────────────────────────────────────────
app.use("/api/users",         usersRouter);
app.use("/api/clients",       clientsRouter);
app.use("/api/payroll",       payrollRouter);
app.use("/api/inquiries",     inquiriesRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/tutorials",     tutorialsRouter);

// ── 404 Catch-all ─────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Not found", path: req.originalUrl });
});

// ── Global Error Handler ──────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[Unhandled Error]", err);
  res.status(500).json({ error: "Internal server error." });
});

// ── Start ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  JJMC Payroll Backend listening on port ${PORT}`);
  console.log(`    Mode:    ${process.env.NODE_ENV || "development"}`);
  console.log(`    Health:  http://localhost:${PORT}/api/health\n`);
});

module.exports = app; // export for testing
