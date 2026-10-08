// Récupère le classeur : fichier local, ou export .xlsx d'un Google Sheet partagé par lien.
import * as XLSX from "xlsx";
import fs from "node:fs";

XLSX.set_fs(fs);

export async function loadWorkbook(source) {
  const googleId = source.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/)?.[1];
  if (!googleId) return XLSX.readFile(source);

  const url = `https://docs.google.com/spreadsheets/d/${googleId}/export?format=xlsx`;
  const response = await fetch(url, { redirect: "follow" });
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || type.includes("text/html")) {
    throw new Error(
      "Impossible de télécharger le Google Sheet. Vérifie qu'il est partagé en « Toute personne disposant du lien » (lecteur).",
    );
  }
  return XLSX.read(Buffer.from(await response.arrayBuffer()));
}
