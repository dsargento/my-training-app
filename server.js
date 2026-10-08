process.chdir(import.meta.dirname); // chemins relatifs (data/, public/) depuis le dossier de l'appli

import express from "express";
import crypto from "node:crypto";
import { loadWorkbook } from "./src/source.js";
import { parseWorkbook } from "./src/parser.js";
import { computeGame } from "./src/game.js";
import { aiEnabled, classifyExercises, coachReport } from "./src/ai.js";
import { readState, writeState } from "./src/store.js";

const SOURCE = process.env.SHEET_SOURCE || "./data/programme.xlsx";
const PORT = Number(process.env.PORT) || 3000;

// Le tableur n'a pas de dates : une séance est datée du jour où l'appli la voit faite pour la première fois.
async function buildGame() {
  const entries = parseWorkbook(await loadWorkbook(SOURCE));
  const state = readState();

  const today = new Date().toISOString().slice(0, 10);
  for (const e of entries) if (e.done) state.firstSeen[e.session] ??= today;

  const unknown = [...new Set(entries.map((e) => e.name))].filter((n) => !state.exercises[n]);
  Object.assign(state.exercises, await classifyExercises(unknown));
  writeState(state);

  return { game: computeGame(entries, state.exercises, state.firstSeen), state };
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

app.listen(PORT, () => console.log(`Sport Quest → http://localhost:${PORT}  (source : ${SOURCE}, IA : ${aiEnabled() ? "oui" : "non"})`));
