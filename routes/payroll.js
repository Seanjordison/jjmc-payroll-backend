// routes/payroll.js
// Handles payroll calculations and the clientPayrollDrafts approval workflow.
const express = require("express");
const router  = express.Router();
const { db, admin } = require("../utils/firebaseAdmin");
const { verifyToken }  = require("../middleware/auth");
const { requireRole }  = require("../middleware/roleGuard");
const {
  calculateDeductions,
  processEmployees,
  getMonthlyGrossPay,
} = require("../utils/payrollCalculations");

// ─────────────────────────────────────────────────────────
// POST /api/payroll/calculate
// Stateless calculation endpoint.
// Body: { employees: [{ name, ratePerHour, hoursWorked, ...rest }] }
//   OR: { grossPay: number }  (single-employee quick calc)
// ─────────────────────────────────────────────────────────
router.post("/calculate", verifyToken, (req, res) => {
  const { employees, grossPay } = req.body;

  // Single-employee convenience call
  if (typeof grossPay !== "undefined") {
    const g = parseFloat(grossPay);
    if (isNaN(g) || g < 0) {
      return res.status(400).json({ error: "grossPay must be a non-negative number." });
    }
    return res.json({ result: { grossPay: g, ...calculateDeductions(g) } });
  }

  // Batch
  if (!Array.isArray(employees) || employees.length === 0) {
    return res.status(400).json({ error: "Provide an 'employees' array or a 'grossPay' value." });
  }

  try {
    const results = processEmployees(employees);
    return res.json({ results });
  } catch (err) {
    console.error("[POST /payroll/calculate]", err);
    return res.status(400).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/payroll/drafts
// - Admin: all drafts (optionally filtered by ?status=)
// - Bookkeeper: only their own drafts
// ─────────────────────────────────────────────────────────
router.get(
  "/drafts",
  verifyToken,
  requireRole("admin", "bookkeeper"),
  async (req, res) => {
    try {
      let query = db.collection("clientPayrollDrafts");

      if (req.user.role === "bookkeeper") {
        query = query.where("bookkeeperId", "==", req.user.uid);
      }

      if (req.query.status) {
        query = query.where("status", "==", req.query.status);
      }

      // Default: newest first
      query = query.orderBy("createdAt", "desc");

      const snapshot = await query.get();
      const drafts = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      return res.json({ drafts });
    } catch (err) {
      console.error("[GET /payroll/drafts]", err);
      return res.status(500).json({ error: "Internal server error." });
    }
  }
);

// ─────────────────────────────────────────────────────────
// POST /api/payroll/drafts
// Create a new payroll draft (bookkeeper only).
// Body: {
//   clientId, clientName, payrollPeriod,
//   employees: [{ name, ratePerHour, hoursWorked, ... }]
// }
// ─────────────────────────────────────────────────────────
router.post(
  "/drafts",
  verifyToken,
  requireRole("bookkeeper", "admin"),
  async (req, res) => {
    const { clientId, clientName, payrollPeriod, employees } = req.body;

    if (!clientId || !clientName) {
      return res.status(400).json({ error: "clientId and clientName are required." });
    }
    if (!Array.isArray(employees) || employees.length === 0) {
      return res.status(400).json({ error: "employees array is required." });
    }

    try {
      // Verify the client exists
      const clientSnap = await db.collection("clientCompanies").doc(clientId).get();
      if (!clientSnap.exists) {
        return res.status(404).json({ error: "Client company not found." });
      }

      // Bookkeepers can only create drafts for their assigned clients
      if (
        req.user.role === "bookkeeper" &&
        clientSnap.data().bookkeeperId !== req.user.uid
      ) {
        return res.status(403).json({ error: "Forbidden: not your client." });
      }

      // Run payroll calculations
      const processedEmployees = processEmployees(employees);

      // Summarise totals
      const totals = processedEmployees.reduce(
        (acc, emp) => {
          acc.totalGross  += emp.grossPay  || 0;
          acc.totalSSS    += emp.sss       || 0;
          acc.totalPhic   += emp.phic      || 0;
          acc.totalHdmf   += emp.hdmf      || 0;
          acc.totalBir    += emp.bir       || 0;
          acc.totalNet    += emp.netPay    || 0;
          return acc;
        },
        { totalGross: 0, totalSSS: 0, totalPhic: 0, totalHdmf: 0, totalBir: 0, totalNet: 0 }
      );

      Object.keys(totals).forEach((k) => {
        totals[k] = Math.round(totals[k] * 100) / 100;
      });

      const docRef = await db.collection("clientPayrollDrafts").add({
        clientId,
        clientName,
        payrollPeriod:   payrollPeriod || null,
        bookkeeperId:    req.user.uid,
        bookkeeperEmail: req.user.email,
        employees:       processedEmployees,
        employeeCount:   processedEmployees.length,
        ...totals,
        status:         "draft",   // draft → pending_approval → approved / needs_revision
        submittedToAdmin: false,
        createdAt:   admin.firestore.FieldValue.serverTimestamp(),
        updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.status(201).json({ id: docRef.id, message: "Draft created.", totals });
    } catch (err) {
      console.error("[POST /payroll/drafts]", err);
      return res.status(500).json({ error: "Internal server error." });
    }
  }
);

// ─────────────────────────────────────────────────────────
// GET /api/payroll/drafts/:id
// ─────────────────────────────────────────────────────────
router.get(
  "/drafts/:id",
  verifyToken,
  requireRole("admin", "bookkeeper"),
  async (req, res) => {
    try {
      const snap = await db.collection("clientPayrollDrafts").doc(req.params.id).get();
      if (!snap.exists) return res.status(404).json({ error: "Draft not found." });

      const data = snap.data();
      if (req.user.role === "bookkeeper" && data.bookkeeperId !== req.user.uid) {
        return res.status(403).json({ error: "Forbidden." });
      }

      return res.json({ draft: { id: snap.id, ...data } });
    } catch (err) {
      console.error("[GET /payroll/drafts/:id]", err);
      return res.status(500).json({ error: "Internal server error." });
    }
  }
);

// ─────────────────────────────────────────────────────────
// POST /api/payroll/drafts/:id/submit
// Bookkeeper submits draft for admin approval.
// ─────────────────────────────────────────────────────────
router.post(
  "/drafts/:id/submit",
  verifyToken,
  requireRole("bookkeeper", "admin"),
  async (req, res) => {
    try {
      const ref  = db.collection("clientPayrollDrafts").doc(req.params.id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "Draft not found." });

      const data = snap.data();
      if (req.user.role === "bookkeeper" && data.bookkeeperId !== req.user.uid) {
        return res.status(403).json({ error: "Forbidden." });
      }

      if (data.status === "approved") {
        return res.status(400).json({ error: "This draft has already been approved." });
      }

      await ref.update({
        status:           "pending_approval",
        submittedToAdmin: true,
        submittedAt:      admin.firestore.FieldValue.serverTimestamp(),
        updatedAt:        admin.firestore.FieldValue.serverTimestamp(),
      });

      // Notify all admins
      const adminSnap = await db.collection("users").where("role", "==", "admin").get();
      const notifBatch = db.batch();
      adminSnap.docs.forEach((adminDoc) => {
        const notifRef = db.collection("notifications").doc();
        notifBatch.set(notifRef, {
          userId:    adminDoc.id,
          message:   `New payroll draft submitted by bookkeeper for ${data.clientName}.`,
          draftId:   req.params.id,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          read:      false,
        });
      });
      await notifBatch.commit();

      return res.json({ message: "Draft submitted for admin approval." });
    } catch (err) {
      console.error("[POST /payroll/drafts/:id/submit]", err);
      return res.status(500).json({ error: "Internal server error." });
    }
  }
);

// ─────────────────────────────────────────────────────────
// POST /api/payroll/drafts/:id/approve  (admin only)
// ─────────────────────────────────────────────────────────
router.post(
  "/drafts/:id/approve",
  verifyToken,
  requireRole("admin"),
  async (req, res) => {
    try {
      const ref  = db.collection("clientPayrollDrafts").doc(req.params.id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "Draft not found." });

      const data = snap.data();

      await ref.update({
        status:        "approved",
        approvedAt:    admin.firestore.FieldValue.serverTimestamp(),
        approvedBy:    req.user.email || "Admin",
        approvedById:  req.user.uid,
        updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
      });

      // Notify the bookkeeper
      if (data.bookkeeperId) {
        await db.collection("notifications").add({
          userId:    data.bookkeeperId,
          message:   `Your payroll draft for ${data.clientName} has been approved.`,
          draftId:   req.params.id,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          read:      false,
        });
      }

      return res.json({ message: "Draft approved." });
    } catch (err) {
      console.error("[POST /payroll/drafts/:id/approve]", err);
      return res.status(500).json({ error: "Internal server error." });
    }
  }
);

// ─────────────────────────────────────────────────────────
// POST /api/payroll/drafts/:id/revise  (admin only)
// Body: { notes: string }
// ─────────────────────────────────────────────────────────
router.post(
  "/drafts/:id/revise",
  verifyToken,
  requireRole("admin"),
  async (req, res) => {
    const { notes } = req.body;

    try {
      const ref  = db.collection("clientPayrollDrafts").doc(req.params.id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "Draft not found." });

      const data = snap.data();

      await ref.update({
        status:        "needs_revision",
        revisionNotes: notes || "Please revise.",
        revisedAt:     admin.firestore.FieldValue.serverTimestamp(),
        revisedBy:     req.user.email || "Admin",
        updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
      });

      // Notify the bookkeeper
      if (data.bookkeeperId) {
        await db.collection("notifications").add({
          userId:    data.bookkeeperId,
          message:   `Your payroll draft for ${data.clientName} needs revision. Notes: ${notes || "See admin."}`,
          draftId:   req.params.id,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          read:      false,
        });
      }

      return res.json({ message: "Revision requested." });
    } catch (err) {
      console.error("[POST /payroll/drafts/:id/revise]", err);
      return res.status(500).json({ error: "Internal server error." });
    }
  }
);

// ─────────────────────────────────────────────────────────
// DELETE /api/payroll/drafts/:id  (bookkeeper: own drafts only; admin: any)
// ─────────────────────────────────────────────────────────
router.delete(
  "/drafts/:id",
  verifyToken,
  requireRole("admin", "bookkeeper"),
  async (req, res) => {
    try {
      const ref  = db.collection("clientPayrollDrafts").doc(req.params.id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "Draft not found." });

      const data = snap.data();
      if (req.user.role === "bookkeeper" && data.bookkeeperId !== req.user.uid) {
        return res.status(403).json({ error: "Forbidden." });
      }
      if (data.status === "approved") {
        return res.status(400).json({ error: "Cannot delete an approved draft." });
      }

      await ref.delete();
      return res.json({ message: "Draft deleted." });
    } catch (err) {
      console.error("[DELETE /payroll/drafts/:id]", err);
      return res.status(500).json({ error: "Internal server error." });
    }
  }
);

// ─────────────────────────────────────────────────────────
// GET /api/payroll/history/:clientId
// Fetch approved drafts for a specific client.
// Accessible by admin, bookkeeper assigned to that client, and client-staff.
// ─────────────────────────────────────────────────────────
router.get("/history/:clientId", verifyToken, async (req, res) => {
  try {
    const clientId = req.params.clientId;

    // Validate access
    if (req.user.role === "bookkeeper") {
      const cSnap = await db.collection("clientCompanies").doc(clientId).get();
      if (!cSnap.exists || cSnap.data().bookkeeperId !== req.user.uid) {
        return res.status(403).json({ error: "Forbidden." });
      }
    }
    if (req.user.role === "client-staff") {
      const cSnap = await db.collection("clientCompanies").doc(clientId).get();
      if (!cSnap.exists || !cSnap.data().userIds?.includes(req.user.uid)) {
        return res.status(403).json({ error: "Forbidden." });
      }
    }

    const snapshot = await db
      .collection("clientPayrollDrafts")
      .where("clientId", "==", clientId)
      .where("status", "==", "approved")
      .orderBy("approvedAt", "desc")
      .get();

    const history = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    return res.json({ history });
  } catch (err) {
    console.error("[GET /payroll/history/:clientId]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;
