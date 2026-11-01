// Couche IA : (1) comprendre les noms d'exercices du tableur, (2) jouer le coach.
// Sans clé API, l'appli tourne quand même avec un classement par mots-clés et sans coach.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5-5";

export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let client;
const getClient = () => (client ??= new Anthropic());

// "fallbacks: default" relance la requête sur un autre modèle si Claude la refuse.
async function ask({ system, prompt, effort, schema, maxTokens }) {
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    output_config: { effort, ...(schema && { format: { type: "json_schema", schema } }) },
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") throw new Error("Le modèle a refusé la requête.");
  if (response.stop_reason === "max_tokens") throw new Error("Réponse tronquée (max_tokens atteint).");
  return response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

// ---------- 1. Classement des exercices

const LIFTS = ["squat", "bench", "deadlift", "other"];

const EXERCISE_SCHEMA = {
  type: "object",
  properties: {
    exercises: {
      type: "array",
      items: {
        type: "object",
        properties: {
          raw: { type: "string", description: "Nom exact tel qu'il apparaît dans le tableur" },
          canonical: { type: "string", description: "Nom canonique en français ; deux variantes identiques doivent avoir le même" },
          lift: { type: "string", enum: LIFTS },
          competition: { type: "boolean", description: "Vrai uniquement pour le mouvement de compétition lui-même" },
          muscles: { type: "array", items: { type: "string" } },
          emoji: { type: "string" },
        },
        required: ["raw", "canonical", "lift", "competition", "muscles", "emoji"],
        additionalProperties: false,
      },
    },
  },
  required: ["exercises"],
  additionalProperties: false,
};

export function classifyByKeywords(name) {
  const n = name.toLowerCase();
  const lift = /deadlift|\bdl\b|soulevé/.test(n) ? "deadlift"
    : /bench|couché/.test(n) ? "bench"
    : /squat/.test(n) ? "squat"
    : "other";
  return {
    canonical: name.trim().replace(/\s+/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()),
    lift,
    competition: lift !== "other" && /competition|compétition/.test(n),
    muscles: [],
    emoji: { squat: "🦵", bench: "💪", deadlift: "🏗️", other: "🏋️" }[lift],
    source: "mots-clés",
  };
}

export async function classifyExercises(names) {
  if (!names.length) return {};
  if (!aiEnabled()) return Object.fromEntries(names.map((n) => [n, classifyByKeywords(n)]));

  const text = await ask({
    system:
      "Tu analyses le programme de powerlifting d'un athlète, saisi dans un tableur avec des noms d'exercices libres " +
      "(anglais, français, abréviations, variantes comme tempo 3-0-0, pause 2ct, myo-reps). " +
      "Pour chaque nom, donne un nom canonique en français : les écritures différentes d'un même exercice " +
      "(ex. « Competition bench » et « Competition Bench ») partagent le même nom canonique, " +
      "mais une variante (pause, tempo, high-bar) reste un exercice distinct de la version de compétition. " +
      "`lift` = le mouvement de compétition auquel l'exercice se rattache (squat, bench, deadlift) ou other. " +
      "`competition` = vrai seulement pour la version de compétition exacte.",
    prompt: `Exercices à classer :\n${names.map((n) => `- ${n}`).join("\n")}`,
    effort: "low",
    schema: EXERCISE_SCHEMA,
    maxTokens: 8000,
  });

  const result = {};
  for (const ex of JSON.parse(text).exercises) {
    if (names.includes(ex.raw)) result[ex.raw] = { ...ex, source: "ia" };
  }
  // Tout nom oublié par le modèle retombe sur le classement par mots-clés.
  for (const n of names) result[n] ??= classifyByKeywords(n);
  return result;
}

// ---------- 2. Coach

export async function coachReport(game) {
  const summary = {
    niveau: `${game.level} (${game.title})`,
    xp: game.xp,
    seances: `${game.sessionsDone}/${game.sessionsTotal}`,
    seancesParfaites: game.perfectSessions,
    enchainement: game.streak,
    tonnageTotalKg: Math.round(game.tonnage),
    recordsRecents: game.records.slice(-5).map((r) => ({ seance: r.session, exercice: r.canonical, charge: r.load, reps: r.reps, avant: r.previous, chargeMax: r.weight, recordReps: r.rep, plusFort: r.strength })),
    e1rmCompetition: game.bosses.map((b) => ({ mouvement: b.lift, meilleur: b.best, historique: b.history })),
    dernieresSeances: game.journal.slice(0, 4).map((s) => ({
      seance: s.key,
      bloc: s.block,
      statut: s.status,
      exercices: s.exercises.map((x) => ({
        nom: x.canonical,
        prevu: `${x.sets}x${x.repsText} @ ${x.intensityText}`,
        charges: x.loadText || "non fait",
        e1rm: x.e1rm,
      })),
    })),
    prochaineSeance: game.next && {
      seance: game.next.key,
      bloc: game.next.block,
      exercices: game.next.exercises.map((x) => ({
        nom: x.canonical,
        prevu: `${x.sets}x${x.repsText} @ ${x.intensityText}`,
        chargesSuggerees: x.suggested,
      })),
    },
    badgesProches: game.badges.filter((b) => !b.unlocked).sort((a, b) => b.progress / b.goal - a.progress / a.goal).slice(0, 3),
  };

  return ask({
    system:
      "Tu es le coach d'une appli de suivi de musculation façon jeu de rôle. L'athlète suit un programme de " +
      "powerlifting en RPE (bloc « off season squat emphasis »). Réponds en français, en tutoyant, avec un ton " +
      "motivant et un peu épique mais concret. Structure : un titre court, 2-3 observations tirées des chiffres " +
      "(progression, régularité, cohérence charges/RPE), puis la quête du jour pour la prochaine séance avec un " +
      "défi précis. 180 mots maximum, Markdown simple. Les 1RM sont des estimations issues des RPE prévus, " +
      "pas des RPE réellement ressentis : dis-le si tu t'appuies dessus. N'invente aucune donnée absente.",
    prompt: `Données de l'athlète :\n${JSON.stringify(summary, null, 2)}`,
    effort: "medium",
    maxTokens: 16000,
  });
}
