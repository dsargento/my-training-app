// Historique des programmes : quand SHEET_SOURCE change, le programme précédent est archivé
// (ses séances commencées seulement), pour que l'XP, le journal et les records continuent.
import crypto from "node:crypto";

const programId = (source) => crypto.createHash("sha1").update(source).digest("hex").slice(0, 8);
const DAY_MS = 24 * 3600 * 1000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const startOf = (p) => Object.values(p.firstSeen).sort()[0] ?? p.startedAt;

const startedOnly = (entries) => {
  const started = new Set(entries.filter((e) => e.done).map((e) => e.session));
  return entries.filter((e) => started.has(e.session));
};

// Un vieux tableur n'a pas de dates : on les estime à partir du début (ou de la fin, ex. jour de compète)
// en étalant les jours d'entraînement sur chaque semaine.
function estimateDates(entries, { start, end }) {
  const weeks = Math.max(...entries.map((e) => e.week));
  const first = start ? Date.parse(start) : Date.parse(end) - (weeks * 7 - 1) * DAY_MS;
  const daysPerWeek = {};
  for (const e of entries) daysPerWeek[e.week] = Math.max(daysPerWeek[e.week] ?? 0, e.day);
  const firstSeen = {};
  for (const e of entries) {
    if (!e.done) continue;
    const offset = (e.week - 1) * 7 + Math.round(((e.day - 1) * 7) / daysPerWeek[e.week]);
    firstSeen[e.session] = isoDay(first + offset * DAY_MS);
  }
  return firstSeen;
}

// Programmes passés listés dans data/programs.json : importés une fois, réimportés seulement si leur ligne change.
export async function importPrograms(state, configs, loadEntries) {
  const wanted = new Set();
  for (const config of configs) {
    const id = programId(config.source);
    wanted.add(id);
    const key = JSON.stringify(config);
    if (state.program?.id === id || state.archive.find((p) => p.id === id)?.config === key) continue;
    try {
      const entries = await loadEntries(config.source);
      const firstSeen = estimateDates(entries, config);
      state.archive = state.archive.filter((p) => p.id !== id);
      state.archive.push({ id, source: config.source, name: config.name, config: key, imported: true, firstSeen, startedAt: startOf({ firstSeen }), entries: startedOnly(entries) });
    } catch (err) {
      console.warn(`Import de « ${config.name} » impossible : ${err.message}`);
    }
  }
  // Une ligne retirée du fichier retire le programme importé.
  state.archive = state.archive.filter((p) => !p.imported || wanted.has(p.id));
}

export function syncProgram(state, { source, name, entries, today }) {
  const id = programId(source);

  // Ancien format : un seul programme, ses dates de séances à la racine de l'état.
  if (state.firstSeen && !state.program) state.program = { id, source, firstSeen: state.firstSeen, startedAt: today, entries: [] };
  delete state.firstSeen;

  if (state.program?.id !== id) {
    if (state.program?.entries.length) state.archive.push({ ...state.program, archivedAt: today });
    // Revenir à une source déjà archivée la reprend là où elle en était.
    const restored = state.archive.find((p) => p.id === id);
    state.archive = state.archive.filter((p) => p.id !== id);
    state.program = { id, source, firstSeen: restored?.firstSeen ?? {}, startedAt: restored?.startedAt ?? today, entries: [] };
  }

  // Le tableur n'a pas de dates : une séance est datée du jour où l'appli la voit faite pour la première fois.
  const program = state.program;
  program.name = name;
  for (const e of entries) if (e.done) program.firstSeen[e.session] ??= today;
  program.entries = startedOnly(entries);

  // Tous les programmes dans l'ordre chronologique, avec des clés de séance qui ne se mélangent pas ("S1-J1" existe partout).
  state.archive.sort((a, b) => startOf(a).localeCompare(startOf(b)));
  const programs = [...state.archive, program];
  return {
    entries: programs.flatMap((p, i) =>
      (p === program ? entries : p.entries).map((e) => ({ ...e, program: p.name, programIndex: i, session: `${p.id}:${e.session}` })),
    ),
    firstSeen: Object.fromEntries(programs.flatMap((p) => Object.entries(p.firstSeen).map(([key, date]) => [`${p.id}:${key}`, date]))),
    currentIndex: programs.length - 1,
  };
}
