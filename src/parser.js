// Lit la grille du programme : un onglet = un bloc, une ligne "Exercise" = un jour,
// et chaque groupe de colonnes Sets/Reps/Intensity/Load(/Rest) = une semaine.
import * as XLSX from "xlsx";

const COLUMN_NAMES = ["sets", "reps", "intensity", "load", "rest"];

const clean = (v) => String(v ?? "").trim();

// "RPE 6.5/.7.5/8.5" -> [6.5, 7.5, 8.5]
export function numberList(text) {
  return clean(text)
    .replace(/,/g, ".")
    .split("/")
    .map((part) => parseFloat(part.replace(/[^\d.]/g, "").replace(/^\.+/, "")))
    .filter((n) => Number.isFinite(n));
}

// Charges réellement soulevées : une barre ratée ("147 fail") ou une durée ("8s") n'en est pas une.
const loadList = (text) => numberList(clean(text).split("/").filter((part) => !/fail|miss|raté|échec|\d\s*s$/i.test(part.trim())).join("/"));

// Étale une liste de valeurs sur le nombre de séries (une seule valeur = toutes les séries).
function perSet(values, sets) {
  if (!values.length || !sets) return [];
  return Array.from({ length: sets }, (_, i) => values[Math.min(i, values.length - 1)]);
}

function parseEntry(raw) {
  const sets = parseInt(raw.sets, 10) || 0;
  const firstReps = parseFloat(clean(raw.reps)); // "5(8)" -> 5, "15/4" (myo-reps) -> 15
  const reps = Number.isFinite(firstReps) ? firstReps : 0;
  const loads = perSet(loadList(raw.load), sets || loadList(raw.load).length);
  // Les pourcentages ("67%") ne sont pas des RPE ; un RPE est entre 1 et 10.
  const rpes = /%/.test(raw.intensity) ? [] : perSet(numberList(raw.intensity).filter((n) => n <= 10), sets);
  return {
    sets,
    reps,
    repsText: clean(raw.reps),
    intensityText: clean(raw.intensity),
    loadText: clean(raw.load),
    rest: parseInt(raw.rest, 10) || null,
    loads,
    rpes,
    done: clean(raw.load) !== "",
    tonnage: loads.reduce((sum, load) => sum + load * reps, 0),
  };
}

export function parseWorkbook(workbook) {
  const entries = [];
  let lastWeek = 0;

  workbook.SheetNames.forEach((block, blockIndex) => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[block], {
      header: 1,
      raw: false, // texte affiché : "12/3" plutôt que la date que Sheets a cru y voir
      defval: "",
      blankrows: false,
    });

    const weekRow = rows.find((row) => row.some((c) => /week\s*\d+/i.test(c))) ?? [];
    const weekNumbers = weekRow
      .map((c) => clean(c).match(/week\s*(\d+)/i))
      .filter(Boolean)
      .map((m) => Number(m[1]));

    let groups = null;
    let day = 0;
    let order = 0;

    for (const row of rows) {
      const first = clean(row[0]);

      if (first.toLowerCase() === "exercise") {
        const starts = row.flatMap((c, i) => (clean(c).toLowerCase() === "sets" ? [i] : []));
        groups = starts.map((start, g) => {
          const end = starts[g + 1] ?? row.length;
          const columns = {};
          for (let i = start; i < end; i++) {
            const name = clean(row[i]).toLowerCase();
            if (COLUMN_NAMES.includes(name)) columns[name] = i;
          }
          // Certains modèles décalent l'en-tête : "Load" contient l'intensité, la charge est dans la colonne sans titre d'après.
          if (columns.intensity == null && columns.load != null && clean(row[columns.load + 1]) === "") {
            columns.intensity = columns.load;
            columns.load += 1;
          }
          return columns;
        });
        day += 1;
        order = 0;
        continue;
      }

      if (!groups || !first || /^day\s*\d+/i.test(first) || /week\s*\d+/i.test(first)) continue;

      const raws = groups.map((columns) => Object.fromEntries(COLUMN_NAMES.map((n) => [n, columns[n] != null ? row[columns[n]] : ""])));
      // Ligne sans aucune valeur : un intitulé ("5 Days from Competition"), pas un exercice.
      if (raws.every((raw) => Object.values(raw).every((v) => clean(v) === ""))) continue;

      order += 1;
      raws.forEach((raw, g) => {
        // Onglet sans "Week N" (ex. semaine d'affûtage) : il prend la suite des semaines précédentes.
        const week = weekNumbers[g] ?? lastWeek + g + 1;
        entries.push({
          block,
          blockIndex,
          week,
          day,
          order,
          session: `S${week}-J${day}`,
          name: first,
          ...parseEntry(raw),
        });
      });
    }
    lastWeek = Math.max(lastWeek, ...entries.map((e) => e.week));
  });

  return entries;
}
