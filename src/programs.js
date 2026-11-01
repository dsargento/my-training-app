// Historique des programmes : quand SHEET_SOURCE change, le programme précédent est archivé
// (ses séances commencées seulement), pour que l'XP, le journal et les records continuent.
import crypto from "node:crypto";

const programId = (source) => crypto.createHash("sha1").update(source).digest("hex").slice(0, 8);

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
  const started = new Set(entries.filter((e) => e.done).map((e) => e.session));
  program.entries = entries.filter((e) => started.has(e.session));

  // Tous les programmes à la suite, avec des clés de séance qui ne se mélangent pas ("S1-J1" existe partout).
  const programs = [...state.archive, program];
  return {
    entries: programs.flatMap((p, i) =>
      (p === program ? entries : p.entries).map((e) => ({ ...e, program: p.name, programIndex: i, session: `${p.id}:${e.session}` })),
    ),
    firstSeen: Object.fromEntries(programs.flatMap((p) => Object.entries(p.firstSeen).map(([key, date]) => [`${p.id}:${key}`, date]))),
    currentIndex: programs.length - 1,
  };
}
