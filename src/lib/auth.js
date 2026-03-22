const { verifyToken } = require("@clerk/backend");

function getBearerToken(req) {
  const auth = req.headers.authorization || "";
  const [type, token] = auth.split(" ");
  if (type !== "Bearer" || !token) return null;
  return token;
}

async function requireAuth(req, res, next) {
  if (process.env.DEV_AUTH_BYPASS === "1") {
    req.user = { sub: "dev-user-1" };
    return next();
  }

  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const verified = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
    if (!verified || !verified.sub) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.user = { sub: verified.sub };
    return next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

function applyClerkMiddleware() {
  // Intentionally no-op. We only verify Bearer tokens in requireAuth.
}

module.exports = { requireAuth, applyClerkMiddleware };
