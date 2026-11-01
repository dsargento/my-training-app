// Historique de compétitions : export CSV public d'un athlète sur OpenPowerlifting, mis en cache une journée.
const CACHE_MS = 24 * 3600 * 1000;
const CACHE_VERSION = 2; // à incrémenter quand toMeet() lit de nouvelles colonnes

// CSV simple avec champs entre guillemets possibles ("Meet, Paris").
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') field += text[++i];
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n") row.push(field), rows.push(row), (row = []), (field = "");
    else if (c !== "\r") field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const [header = [], ...data] = rows;
  return data.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const kg = (v) => (v === "" ? null : Number(v));

function toMeet(r) {
  // Essais réussis : les charges positives parmi les trois premiers essais de chaque mouvement.
  const attempts = ["Squat", "Bench", "Deadlift"].flatMap((lift) => [1, 2, 3].map((n) => kg(r[`${lift}${n}Kg`])));
  return {
    date: r.Date,
    name: r.MeetName,
    town: r.MeetTown,
    country: r.MeetCountry,
    federation: r.Federation,
    equipment: r.Equipment,
    division: r.Division,
    weightClass: r.WeightClassKg,
    bodyweight: kg(r.BodyweightKg),
    place: r.Place,
    squat: kg(r.Best3SquatKg),
    bench: kg(r.Best3BenchKg),
    deadlift: kg(r.Best3DeadliftKg),
    total: kg(r.TotalKg),
    dots: kg(r.Dots),
    attemptsMade: attempts.filter((a) => a > 0).length,
    attemptsTaken: attempts.filter((a) => a != null).length,
  };
}

// Renvoie le cache tant qu'il est frais ; en cas d'échec réseau, garde l'ancien plutôt que rien.
export async function loadMeets(user, cache) {
  if (!user) return null;
  const fresh = cache?.user === user && cache.version === CACHE_VERSION && Date.now() - Date.parse(cache.fetchedAt) < CACHE_MS;
  if (fresh) return cache;
  try {
    const res = await fetch(`https://www.openpowerlifting.org/api/liftercsv/${encodeURIComponent(user)}`);
    if (!res.ok) throw new Error(`OpenPowerlifting : HTTP ${res.status}`);
    return { user, version: CACHE_VERSION, fetchedAt: new Date().toISOString(), meets: parseCsv(await res.text()).map(toMeet) };
  } catch (err) {
    console.warn(err.message);
    return cache?.user === user ? cache : null;
  }
}
