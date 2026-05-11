// middleware/roleGuard.js
// Factory that returns a middleware restricting access to specified roles.
// Must be used AFTER verifyToken.

/**
 * @param {...string} allowedRoles  e.g. requireRole("admin") or requireRole("admin","bookkeeper")
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized", message: "Not authenticated." });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: "Forbidden",
        message: `This action requires one of the following roles: ${allowedRoles.join(", ")}. Your role: ${req.user.role}.`,
      });
    }

    next();
  };
}

module.exports = { requireRole };
