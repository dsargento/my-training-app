// Petit état persistant en JSON : programme en cours et archivés, classement des exercices, caches.
import fs from "node:fs";
import path from "node:path";

const file = () => path.resolve("data/state.json");
const EMPTY = { program: null, archive: [], exercises: {}, coach: null };

export function readState() {
  try {
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(file(), "utf8")) };
  } catch {
    return structuredClone(EMPTY);
  }
}

export function writeState(state) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(state, null, 2));
}
