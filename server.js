process.chdir(import.meta.dirname); // chemins relatifs (data/, public/) depuis le dossier de l'appli

import express from "express";
import crypto from "node:crypto";
import { loadWorkbook } from "./src/source.js";
import { parseWorkbook } from "./src/parser.js";
import { computeGame, computeTrophies } from "./src/game.js";
import { aiEnabled, classifyExercises, coachReport } from "./src/ai.js";
import { readState, writeState } from "./src/store.js";
import { loadMeets } from "./src/openpowerlifting.js";
import { importPrograms, syncProgram } from "./src/programs.js";
import fs from "node:fs";
import { authRequired, isAuthed, login, requireAuth } from "./src/auth.js";

const SOURCE = process.env.SHEET_SOURCE || "./data/programme.xlsx";
const PORT = Number(process.env.PORT) || 3000;
const PROGRAM_NAME = process.env.PROGRAM_NAME || "Programme";
const NEXT_MEET = { name: process.env.NEXT_MEET_NAME, date: process.env.NEXT_MEET_DATE };

// Programmes passés à importer (facultatif) : [{ "name", "source", "start" | "end" }].
function pastPrograms() {
  try {
    return JSON.parse(fs.readFileSync("data/programs.json", "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") console.warn(`data/programs.json illisible : ${err.message}`);
    return [];
  }
}

async function buildGame() {
  const state = readState();
  await importPrograms(state, pastPrograms(), async (source) => parseWorkbook(await loadWorkbook(source)));
  const today = new Date().toISOString().slice(0, 10);
  const { entries, firstSeen, currentIndex } = syncProgram(state, {
    source: SOURCE,
    name: PROGRAM_NAME,
    entries: parseWorkbook(await loadWorkbook(SOURCE)),
    today,
  });

  const unknown = [...new Set(entries.map((e) => e.name))].filter((n) => !state.exercises[n]);
  Object.assign(state.exercises, await classifyExercises(unknown));
  state.openpowerlifting = await loadMeets(process.env.OPENPOWERLIFTING_USER, state.openpowerlifting);
  writeState(state);

  const game = computeGame(entries, state.exercises, firstSeen, currentIndex);
  game.programName = PROGRAM_NAME;
  game.trophies = computeTrophies(state.openpowerlifting?.meets ?? [], NEXT_MEET);
  return { game, state };
}

// Dernier état calculé : la page publique le lit sans rien déclencher ; seule la synchro (protégée) le recalcule.
const SNAPSHOT = "data/game.json";
let snapshot = null;
try {
  snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
} catch {}

function saveSnapshot(next) {
  snapshot = next;
  fs.writeFileSync(SNAPSHOT, JSON.stringify(snapshot));
}

// Une seule synchro à la fois : un deuxième appel attend la synchro en cours.
let running = null;
function sync() {
  running ??= (async () => {
    try {
      const { game, state } = await buildGame();
      saveSnapshot({ ...game, aiEnabled: aiEnabled(), coach: state.coach, syncedAt: new Date().toISOString() });
      return { game, state };
    } finally {
      running = null;
    }
  })();
  return running;
}

const app = express();
app.set("trust proxy", "loopback"); // derrière Cloudflare Tunnel : vraie IP et HTTPS d'origine
app.use(express.static("public"));
app.use(express.json());

const route = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
const view = (req) => ({ ...snapshot, authed: isAuthed(req), authRequired });

app.get("/api/game", route(async (req, res) => {
  if (!snapshot) await sync(); // tout premier lancement : rien à montrer encore
  res.json(view(req));
}));

app.post("/api/sync", requireAuth, route(async (req, res) => {
  await sync();
  res.json(view(req));
}));

app.post("/api/login", login);

app.post("/api/coach", requireAuth, route(async (req, res) => {
  if (!aiEnabled()) return res.status(400).json({ error: "Ajoute ANTHROPIC_API_KEY dans .env pour activer le coach." });
  const { game, state } = await sync();
  // Même données = même bilan : on ne rappelle l'IA que si les séances ont changé.
  const hash = crypto.createHash("sha1").update(JSON.stringify(game.journal.map((s) => [s.key, s.exercises.map((x) => x.loadText)]))).digest("hex");
  if (state.coach?.hash !== hash) {
    state.coach = { hash, text: await coachReport(game), at: new Date().toISOString() };
    writeState(state);
    saveSnapshot({ ...snapshot, coach: state.coach });
  }
  res.json(state.coach);
}));

app.listen(PORT, (err) => {
  if (err) {
    console.error(err.code === "EADDRINUSE" ? `Le port ${PORT} est déjà utilisé (un autre Sport Quest tourne peut-être encore).` : err);
    process.exit(1);
  }
  console.log(`Sport Quest → http://localhost:${PORT}  (source : ${SOURCE}, IA : ${aiEnabled() ? "oui" : "non"})`);
  if (!authRequired) console.warn("⚠️  SYNC_PASSWORD absent : synchro et coach ouverts à tous. À définir avant toute mise en ligne.");
});
