// routes/clients.js
// Manages the `clientCompanies` Firestore collection.
const express = require("express");
const router  = express.Router();
const { db, admin } = require("../utils/firebaseAdmin");
const { verifyToken }  = require("../middleware/auth");
const { requireRole }  = require("../middleware/roleGuard");

// ─────────────────────────────────────────────────────────
// GET /api/clients
// - Admin: all clients
// - Bookkeeper: only clients assigned to them
// - Client-staff: clients that contain their UID in the users list
// ─────────────────────────────────────────────────────────
router.get("/", verifyToken, async (req, res) => {
  try {
    let query = db.collection("clientCompanies");

    if (req.user.role === "bookkeeper") {
      query = query.where("bookkeeperId", "==", req.user.uid);
    } else if (req.user.role === "client-staff") {
      query = query.where("userIds", "array-contains", req.user.uid);
    }
    // admin sees everything

    const snapshot = await query.get();
    const clients  = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    return res.json({ clients });
  } catch (err) {
    console.error("[GET /clients]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/clients
// Create a new client company (admin only).
// ─────────────────────────────────────────────────────────
router.post("/", verifyToken, requireRole("admin"), async (req, res) => {
  const {
    name, address, contactPerson, contactEmail, contactPhone,
    industry, notes,
  } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Company name is required." });
  }

  try {
    const docRef = await db.collection("clientCompanies").add({
      name:          name.trim(),
      address:       address       || null,
      contactPerson: contactPerson || null,
      contactEmail:  contactEmail  || null,
      contactPhone:  contactPhone  || null,
      industry:      industry      || null,
      notes:         notes         || null,
      bookkeeperId:  null,
      bookkeeperName:null,
      status:        "Awaiting Assignment",
      userIds:       [],
      parsedCSV:     [],
      createdAt:  admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(201).json({ id: docRef.id, message: "Client company created." });
  } catch (err) {
    console.error("[POST /clients]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// GET /api/clients/:id
// Get a single client company.
// ─────────────────────────────────────────────────────────
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const snap = await db.collection("clientCompanies").doc(req.params.id).get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Client company not found." });
    }

    const data = snap.data();

    // Bookkeepers can only view their own clients
    if (req.user.role === "bookkeeper" && data.bookkeeperId !== req.user.uid) {
      return res.status(403).json({ error: "Forbidden." });
    }
    // Client-staff can only view companies they belong to
    if (req.user.role === "client-staff" && !data.userIds?.includes(req.user.uid)) {
      return res.status(403).json({ error: "Forbidden." });
    }

    return res.json({ client: { id: snap.id, ...data } });
  } catch (err) {
    console.error("[GET /clients/:id]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// PUT /api/clients/:id
// Update client company details (admin only).
// ─────────────────────────────────────────────────────────
router.put("/:id", verifyToken, requireRole("admin"), async (req, res) => {
  const { bookkeeperId, bookkeeperName, status, userIds, parsedCSV, createdAt, ...safeFields } = req.body;

  try {
    const ref  = db.collection("clientCompanies").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Client company not found." });

    await ref.update({
      ...safeFields,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ message: "Client company updated." });
  } catch (err) {
    console.error("[PUT /clients/:id]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// DELETE /api/clients/:id  (admin only)
// ─────────────────────────────────────────────────────────
router.delete("/:id", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const ref  = db.collection("clientCompanies").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Client company not found." });

    await ref.delete();
    return res.json({ message: "Client company deleted." });
  } catch (err) {
    console.error("[DELETE /clients/:id]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/clients/:id/assign-bookkeeper
// Assign or unassign a bookkeeper (admin only).
// Body: { bookkeeperId: string | "NONE" }
// ─────────────────────────────────────────────────────────
router.post("/:id/assign-bookkeeper", verifyToken, requireRole("admin"), async (req, res) => {
  const clientId = req.params.id;
  const { bookkeeperId } = req.body;

  if (bookkeeperId === undefined) {
    return res.status(400).json({ error: "bookkeeperId is required. Use 'NONE' to unassign." });
  }

  const isUnassigning = !bookkeeperId || bookkeeperId === "NONE";

  try {
    const clientRef  = db.collection("clientCompanies").doc(clientId);
    const clientSnap = await clientRef.get();
    if (!clientSnap.exists) {
      return res.status(404).json({ error: "Client company not found." });
    }

    let resolvedName = null;
    if (!isUnassigning) {
      const bkSnap = await db.collection("users").doc(bookkeeperId).get();
      if (!bkSnap.exists || bkSnap.data()?.role?.toLowerCase() !== "bookkeeper") {
        return res.status(400).json({ error: "Target user is not a bookkeeper." });
      }
      const bk = bkSnap.data();
      resolvedName =
        [bk.firstName, bk.lastName].filter(Boolean).join(" ") ||
        bk.displayName ||
        bk.email ||
        "Bookkeeper";
    }

    await clientRef.update({
      bookkeeperId:   isUnassigning ? null : bookkeeperId,
      bookkeeperName: isUnassigning ? null : resolvedName,
      status:         isUnassigning ? "Awaiting Assignment" : "Assigned",
      assignedAt:     isUnassigning ? null : admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
    });

    // Notify bookkeeper on assignment
    if (!isUnassigning) {
      await db.collection("notifications").add({
        userId:    bookkeeperId,
        message:   `You have been assigned: ${clientSnap.data().name || "a client company"}`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        read:      false,
      });
    }

    return res.json({
      message: isUnassigning
        ? "Bookkeeper unassigned from client."
        : `${resolvedName} assigned to ${clientSnap.data().name}.`,
    });
  } catch (err) {
    console.error("[POST /clients/:id/assign-bookkeeper]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/clients/:id/add-user
// Add a client-staff user UID to this company's userIds array (admin only).
// Body: { uid: string }
// ─────────────────────────────────────────────────────────
router.post("/:id/add-user", verifyToken, requireRole("admin"), async (req, res) => {
  const { uid } = req.body;
  if (!uid) return res.status(400).json({ error: "uid is required." });

  try {
    const ref  = db.collection("clientCompanies").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Client company not found." });

    await ref.update({
      userIds:   admin.firestore.FieldValue.arrayUnion(uid),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ message: "User added to client company." });
  } catch (err) {
    console.error("[POST /clients/:id/add-user]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// DELETE /api/clients/:id/remove-user/:uid
// Remove a user from a client company (admin only).
// ─────────────────────────────────────────────────────────
router.delete("/:id/remove-user/:uid", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const ref  = db.collection("clientCompanies").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Client company not found." });

    await ref.update({
      userIds:   admin.firestore.FieldValue.arrayRemove(req.params.uid),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ message: "User removed from client company." });
  } catch (err) {
    console.error("[DELETE /clients/:id/remove-user/:uid]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────────────────
// PUT /api/clients/:id/csv
// Upload/replace the parsed CSV employee list for a client (bookkeeper only).
// Body: { parsedCSV: Array }
// ─────────────────────────────────────────────────────────
router.put("/:id/csv", verifyToken, requireRole("bookkeeper", "admin"), async (req, res) => {
  const { parsedCSV } = req.body;

  if (!Array.isArray(parsedCSV)) {
    return res.status(400).json({ error: "parsedCSV must be an array." });
  }

  try {
    const ref  = db.collection("clientCompanies").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Client company not found." });

    // Bookkeepers can only update their own clients
    if (req.user.role === "bookkeeper" && snap.data().bookkeeperId !== req.user.uid) {
      return res.status(403).json({ error: "Forbidden." });
    }

    await ref.update({
      parsedCSV,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ message: "Employee CSV data updated.", count: parsedCSV.length });
  } catch (err) {
    console.error("[PUT /clients/:id/csv]", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;
