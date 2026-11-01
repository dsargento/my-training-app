process.chdir(import.meta.dirname); // chemins relatifs (data/, public/) depuis le dossier de l'appli

import express from "express";
import crypto from "node:crypto";
import { loadWorkbook } from "./src/source.js";
import { parseWorkbook } from "./src/parser.js";
import { computeGame, computeTrophies } from "./src/game.js";
import { aiEnabled, classifyExercises, coachReport } from "./src/ai.js";
import { readState, writeState } from "./src/store.js";
import { loadMeets } from "./src/openpowerlifting.js";
import { syncProgram } from "./src/programs.js";

const SOURCE = process.env.SHEET_SOURCE || "./data/programme.xlsx";
const PORT = Number(process.env.PORT) || 3000;
const PROGRAM_NAME = process.env.PROGRAM_NAME || "Programme";
const NEXT_MEET = { name: process.env.NEXT_MEET_NAME, date: process.env.NEXT_MEET_DATE };

async function buildGame() {
  const state = readState();
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

const app = express();
app.use(express.static("public"));

app.get("/api/game", async (req, res) => {
  try {
    const { game, state } = await buildGame();
    res.json({ ...game, aiEnabled: aiEnabled(), coach: state.coach });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/coach", async (req, res) => {
  if (!aiEnabled()) return res.status(400).json({ error: "Ajoute ANTHROPIC_API_KEY dans .env pour activer le coach." });
  try {
    const { game, state } = await buildGame();
    // Même données = même bilan : on ne rappelle l'IA que si les séances ont changé.
    const hash = crypto.createHash("sha1").update(JSON.stringify(game.journal.map((s) => [s.key, s.exercises.map((x) => x.loadText)]))).digest("hex");
    if (state.coach?.hash !== hash) {
      state.coach = { hash, text: await coachReport(game), at: new Date().toISOString() };
      writeState(state);
    }
    res.json(state.coach);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, (err) => {
  if (err) {
    console.error(err.code === "EADDRINUSE" ? `Le port ${PORT} est déjà utilisé (un autre Sport Quest tourne peut-être encore).` : err);
    process.exit(1);
  }
  console.log(`Sport Quest → http://localhost:${PORT}  (source : ${SOURCE}, IA : ${aiEnabled() ? "oui" : "non"})`);
});
