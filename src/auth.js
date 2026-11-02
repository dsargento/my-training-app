// Mot de passe unique (SYNC_PASSWORD) pour la synchro et le coach : cookie signé, sans base de données.
// Sans mot de passe configuré, tout est ouvert (usage en local).
import crypto from "node:crypto";

const COOKIE = "sq_session";
const MAX_AGE_MS = 90 * 24 * 3600 * 1000; // reste connecté trois mois sur le téléphone
const LOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

const password = process.env.SYNC_PASSWORD || "";
// Clé dérivée du mot de passe : en changer déconnecte toutes les sessions.
const key = crypto.createHash("sha256").update(`sport-quest:${password}`).digest();
const sign = (value) => crypto.createHmac("sha256", key).update(value).digest("base64url");
const sameSecret = (a, b) => {
  const [x, y] = [a, b].map((s) => crypto.createHash("sha256").update(s).digest());
  return crypto.timingSafeEqual(x, y);
};

export const authRequired = Boolean(password);

function sessionCookie(req) {
  const match = (req.headers.cookie ?? "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return match?.[1] ?? "";
}

export function isAuthed(req) {
  if (!authRequired) return true;
  const [expires, signature] = sessionCookie(req).split(".");
  return Boolean(expires && signature) && Number(expires) > Date.now() && sameSecret(signature, sign(expires));
}

export function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: "Connexion requise." });
}

// Anti force brute : 5 essais ratés par adresse et par quart d'heure.
const failures = new Map();

export function login(req, res) {
  if (!authRequired) return res.json({ authed: true });
  const now = Date.now();
  const recent = (failures.get(req.ip) ?? []).filter((t) => now - t < LOCK_MS);
  if (recent.length >= MAX_FAILURES) return res.status(429).json({ error: "Trop d'essais, réessaie dans un quart d'heure." });

  if (!sameSecret(String(req.body?.password ?? ""), password)) {
    failures.set(req.ip, [...recent, now]);
    return res.status(401).json({ error: "Mot de passe incorrect." });
  }
  failures.delete(req.ip);
  const expires = String(now + MAX_AGE_MS);
  res.cookie(COOKIE, `${expires}.${sign(expires)}`, { httpOnly: true, sameSite: "strict", secure: req.secure, maxAge: MAX_AGE_MS });
  res.json({ authed: true });
}
