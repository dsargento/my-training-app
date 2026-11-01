// Moteur de jeu : tout est calculé ici de façon déterministe (l'IA ne touche pas aux points).

// Table RPE (Tuchscherer) : % du 1RM selon les "reps effectives" = reps + (10 - RPE).
const RPE_TABLE = [1, 0.955, 0.922, 0.892, 0.863, 0.837, 0.811, 0.786, 0.762, 0.739, 0.707, 0.68, 0.653, 0.626, 0.599];

export function percentOf1RM(reps, rpe) {
  const effective = reps + (10 - rpe);
  if (!(effective >= 1) || effective > RPE_TABLE.length) return null;
  const low = Math.floor(effective);
  const high = Math.min(low + 1, RPE_TABLE.length);
  const t = effective - low;
  return RPE_TABLE[low - 1] * (1 - t) + RPE_TABLE[high - 1] * t;
}

// Meilleur 1RM estimé d'un exercice fait, sur les séries où charge et RPE prévu sont connus
// (au-delà de 15 reps effectives, la table ne sait plus estimer).
export function estimate1RM(entry) {
  let best = null;
  entry.loads.forEach((load, i) => {
    const pct = entry.rpes[i] ? percentOf1RM(entry.reps, entry.rpes[i]) : null;
    if (pct) best = Math.max(best ?? 0, load / pct);
  });
  return best && Math.round(best * 10) / 10;
}

const roundTo = (value, step) => Math.round(value / step) * step;

const TABLE_REPS = Array.from({ length: 12 }, (_, i) => i + 1);
const TABLE_RPES = [5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];

function loadAt(e1rm, reps, rpe) {
  const pct = percentOf1RM(reps, rpe);
  return pct ? roundTo(e1rm * pct, 2.5) : null;
}

const LEVEL_TITLES = [
  "Recrue", "Apprenti de la barre", "Écuyer du rack", "Chevalier du squat",
  "Gardien de la plateforme", "Champion de fer", "Seigneur du powerlifting", "Titan", "Légende",
];

const xpForLevel = (level) => 50 * (level - 1) * level; // 0, 100, 300, 600, 1000...

function levelFromXp(xp) {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level += 1;
  return {
    level,
    title: LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)],
    current: xp - xpForLevel(level),
    needed: xpForLevel(level + 1) - xpForLevel(level),
  };
}

export const XP = { exercise: 10, perTonne: 10, perfectSession: 50, fullWeek: 150, record: 25 };

// Compare un exercice fait aux meilleures perfs passées et met ces perfs à jour.
// La première fois qu'un exercice apparaît, il sert de référence : pas de record.
function checkRecord(best, x) {
  const top = Math.max(0, ...x.loads);
  if (!top) return null;
  const b = best[x.canonical];
  if (!b) {
    best[x.canonical] = { load: top, byReps: x.reps ? { [x.reps]: top } : {}, e1rm: x.e1rm };
    return null;
  }
  const atReps = x.reps ? b.byReps[x.reps] : undefined;
  const kinds = {
    weight: top > b.load, // charge la plus lourde jamais faite
    rep: atReps != null && top > atReps, // plus lourd à ce nombre de reps
    strength: x.e1rm != null && b.e1rm != null && x.e1rm > b.e1rm, // 1RM estimé en hausse
  };
  const previous = kinds.rep ? atReps : kinds.weight ? b.load : null;
  b.load = Math.max(b.load, top);
  if (x.reps) b.byReps[x.reps] = Math.max(atReps ?? 0, top);
  if (x.e1rm != null) b.e1rm = Math.max(b.e1rm ?? 0, x.e1rm);
  if (!kinds.weight && !kinds.rep && !kinds.strength) return null;
  return { ...kinds, load: top, reps: x.reps, previous };
}

// La charge suggérée battrait-elle la meilleure perf (tous reps confondus, ou à ce nombre de reps) ?
function recordWithinReach(b, x) {
  const top = Math.max(0, ...(x.suggested ?? []).filter(Boolean));
  if (!b || !top) return false;
  const atReps = x.reps ? b.byReps[x.reps] : undefined;
  return top > b.load || (atReps != null && top > atReps);
}

export function computeGame(entries, exerciseInfo, firstSeen) {
  const info = (name) => exerciseInfo[name] ?? { canonical: name, lift: "other", competition: false, emoji: "🏋️" };

  // --- Séances, dans l'ordre du programme
  const sessionMap = new Map();
  for (const e of entries) {
    if (!sessionMap.has(e.session)) {
      sessionMap.set(e.session, { key: e.session, block: e.block, blockIndex: e.blockIndex, week: e.week, day: e.day, exercises: [] });
    }
    const e1rm = e.done ? estimate1RM(e) : null;
    sessionMap.get(e.session).exercises.push({ ...e, ...info(e.name), e1rm });
  }
  const sessions = [...sessionMap.values()].sort((a, b) => a.week - b.week || a.day - b.day);

  let xp = 0;
  let tonnage = 0;
  let perfectSessions = 0;
  const journal = [];
  const best = {}; // par exercice : charge max, charge max par nombre de reps, 1RM estimé max
  const records = []; // records battus, dans l'ordre du programme

  for (const s of sessions) {
    const planned = s.exercises.filter((x) => x.sets > 0);
    const done = s.exercises.filter((x) => x.done);
    s.tonnage = done.reduce((sum, x) => sum + x.tonnage, 0);
    s.status = done.length === 0 ? "todo" : planned.every((x) => x.done) ? "perfect" : "done";
    s.xp = 0;
    s.records = 0;
    for (const x of done) {
      x.record = checkRecord(best, x);
      if (!x.record) continue;
      s.records += 1;
      records.push({
        id: `${s.key}|${x.canonical}`, session: s.key, week: s.week, day: s.day,
        name: x.name, canonical: x.canonical, emoji: x.emoji, lift: x.lift, competition: x.competition, ...x.record,
      });
    }
    if (done.length) {
      s.xp = done.length * XP.exercise + Math.round((s.tonnage / 1000) * XP.perTonne) + s.records * XP.record;
      if (s.status === "perfect") {
        s.xp += XP.perfectSession;
        perfectSessions += 1;
      }
      s.date = firstSeen[s.key] ?? null;
      journal.push(s);
    }
    xp += s.xp;
    tonnage += s.tonnage;
  }

  // --- Semaines complètes
  const weeks = new Map();
  for (const s of sessions) {
    if (!weeks.has(s.week)) weeks.set(s.week, { week: s.week, block: s.block, sessions: [] });
    weeks.get(s.week).sessions.push(s);
  }
  const fullWeeks = [...weeks.values()].filter((w) => w.sessions.every((s) => s.status !== "todo"));
  xp += fullWeeks.length * XP.fullWeek;

  // --- Enchaînement : séances faites d'affilée dans l'ordre du programme
  let streak = 0;
  let bestStreak = 0;
  for (const s of sessions) {
    streak = s.status === "todo" ? 0 : streak + 1;
    bestStreak = Math.max(bestStreak, streak);
  }
  const lastDoneIndex = sessions.findLastIndex((s) => s.status !== "todo");
  const currentStreak = lastDoneIndex < 0 ? 0 : sessions.slice(0, lastDoneIndex + 1).reverse().findIndex((s) => s.status === "todo");
  const next = sessions.find((s, i) => i > lastDoneIndex) ?? null;

  // --- Boss : 1RM estimé des trois mouvements de compétition, semaine par semaine
  const bosses = ["squat", "bench", "deadlift"].map((lift) => {
    const history = [];
    for (const s of sessions) {
      for (const x of s.exercises) {
        if (x.lift === lift && x.competition && x.e1rm) history.push({ week: s.week, session: s.key, e1rm: x.e1rm });
      }
    }
    const best = history.reduce((m, h) => Math.max(m, h.e1rm), 0) || null;
    return { lift, best, history, records: records.filter((r) => r.lift === lift && r.competition) };
  });

  // --- Tables de charges : 1RM estimé sur la séance la plus récente de chaque exercice, croisé reps × RPE
  const latest = {};
  for (const s of sessions) {
    for (const x of s.exercises) if (x.e1rm) latest[x.canonical] = { s, x }; // ordre du programme : la dernière gagne
  }
  const loadTables = Object.fromEntries(
    Object.entries(latest).map(([name, { s, x }]) => [name, {
      name,
      emoji: x.emoji,
      competition: x.competition,
      e1rm: x.e1rm,
      source: { week: s.week, day: s.day, label: x.name, sets: x.sets, repsText: x.repsText, intensityText: x.intensityText, loadText: x.loadText },
      rows: TABLE_REPS.map((reps) => ({ reps, loads: TABLE_RPES.map((rpe) => loadAt(x.e1rm, reps, rpe)) })),
    }]),
  );

  // Charges suggérées pour la prochaine séance : mêmes données que les tables.
  if (next) {
    for (const x of next.exercises) {
      const table = loadTables[x.canonical];
      x.suggested = table && x.rpes.length ? x.rpes.map((rpe) => loadAt(table.e1rm, x.reps, rpe)) : null;
      x.recordWithinReach = !x.done && recordWithinReach(best[x.canonical], x);
    }
  }

  // --- Badges
  const blockNames = [...new Set(sessions.map((s) => s.block))];
  const blockDone = (name) => sessions.filter((s) => s.block === name).every((s) => s.status !== "todo");
  const doneCount = sessions.filter((s) => s.status !== "todo").length;
  const liftTonnage = (lift) => sessions.flatMap((s) => s.exercises).filter((x) => x.done && x.lift === lift).reduce((a, x) => a + x.tonnage, 0);

  const badges = [
    { id: "first", icon: "🔥", name: "Premier sang", desc: "Terminer ta première séance", progress: Math.min(doneCount, 1), goal: 1 },
    { id: "perfect", icon: "💎", name: "Perfectionniste", desc: "5 séances parfaites (tous les exercices faits)", progress: perfectSessions, goal: 5 },
    { id: "week", icon: "📅", name: "Semaine bouclée", desc: "Toutes les séances d'une semaine", progress: Math.min(fullWeeks.length, 1), goal: 1 },
    { id: "streak", icon: "⛓️", name: "Inarrêtable", desc: "8 séances enchaînées sans en sauter", progress: Math.min(bestStreak, 8), goal: 8 },
    { id: "record1", icon: "🏆", name: "Premier record", desc: "Battre ta meilleure perf sur un exercice", progress: Math.min(records.length, 1), goal: 1 },
    { id: "record10", icon: "🎖️", name: "Collectionneur", desc: "10 records battus", progress: Math.min(records.length, 10), goal: 10 },
    { id: "t10", icon: "🏗️", name: "10 tonnes", desc: "10 000 kg soulevés au total", progress: Math.min(tonnage, 10000), goal: 10000 },
    { id: "t100", icon: "🌋", name: "100 tonnes", desc: "100 000 kg soulevés au total", progress: Math.min(tonnage, 100000), goal: 100000 },
    { id: "squat", icon: "👑", name: "Roi du squat", desc: "30 tonnes en squat (c'est un bloc squat !)", progress: Math.min(liftTonnage("squat"), 30000), goal: 30000 },
    ...blockNames.map((name) => {
      const list = sessions.filter((s) => s.block === name);
      const isDeload = /deload/i.test(name);
      return {
        id: `block-${name}`,
        icon: isDeload ? "🧘" : "🏰",
        name: isDeload ? "Deload honoré" : `${name} conquis`,
        desc: isDeload ? "Faire toutes les séances de deload (oui, ça compte)" : `Toutes les séances de ${name}`,
        progress: list.filter((s) => s.status !== "todo").length,
        goal: list.length,
      };
    }),
    { id: "all", icon: "🏆", name: "Programme terminé", desc: "Les " + sessions.length + " séances du programme", progress: doneCount, goal: sessions.length },
  ].map((b) => ({ ...b, unlocked: b.progress >= b.goal }));

  return {
    xp,
    ...levelFromXp(xp),
    tonnage,
    sessionsDone: doneCount,
    sessionsTotal: sessions.length,
    perfectSessions,
    fullWeeks: fullWeeks.length,
    streak: currentStreak < 0 ? lastDoneIndex + 1 : currentStreak,
    bestStreak,
    next,
    bosses,
    records,
    loadTables,
    tableRpes: TABLE_RPES,
    badges,
    journal: journal.reverse(),
    map: sessions.map(({ key, block, week, day, status, xp: sxp }) => ({ key, block, week, day, status, xp: sxp, isNext: key === next?.key })),
  };
}

// --- Salle des trophées : les compétitions passées (OpenPowerlifting) et la prochaine en ligne de mire.
const MEDALS = { 1: "🥇", 2: "🥈", 3: "🥉" };

export function computeTrophies(meets, nextMeet, today = new Date()) {
  let bestTotal = 0;
  let podium = false;
  const trophies = [...meets]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m, i) => {
      const place = Number(m.place) || null;
      const tags = [];
      if (i === 0) tags.push("Première compète");
      if (place === 1) tags.push("Victoire");
      else if (place && place <= 3 && !podium) tags.push("Premier podium");
      if (m.total && m.total > bestTotal) {
        if (i > 0) tags.push("Meilleur total");
        bestTotal = m.total;
      }
      if (m.attemptsTaken === 9 && m.attemptsMade === 9) tags.push("9/9 sans faute");
      if (place && place <= 3) podium = true;
      return { ...m, icon: MEDALS[place] ?? "🏟️", tags, best: false };
    });

  for (const t of trophies) t.best = Boolean(t.total) && t.total === bestTotal;

  const date = nextMeet?.date ? new Date(`${nextMeet.date}T12:00:00`) : null;
  const next = date && date > today
    ? { name: nextMeet.name || "Prochaine compète", date: nextMeet.date, weeksLeft: Math.ceil((date - today) / (7 * 24 * 3600 * 1000)) }
    : null;

  return {
    next,
    meets: trophies.reverse(),
    wins: trophies.filter((t) => Number(t.place) === 1).length,
    podiums: trophies.filter((t) => Number(t.place) <= 3).length,
  };
}
