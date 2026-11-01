const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const kg = (n) => (n >= 1000 ? `${(n / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} t` : `${Math.round(n)} kg`);
const num = (n) => String(n).replace(".", ",");
const LIFT_NAMES = { squat: "Squat", bench: "Développé couché", deadlift: "Soulevé de terre" };

// "140 kg × 5", ou juste le constat quand seul le 1RM estimé a progressé.
const recordText = (r) => (r.weight || r.rep ? `${num(r.load)} kg × ${num(r.reps)}` : "plus fort que jamais 💪");
const recordDetail = (r) => `${r.name} ${recordText(r)}${r.previous ? ` (avant ${num(r.previous)} kg)` : ""}`;

function toast(message, isError = false) {
  const el = $("toast");
  el.textContent = message;
  el.className = isError ? "toast error" : "toast";
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 4000);
}

// Markdown minimal pour le texte du coach (échappé d'abord).
function markdown(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>");
  let html = "";
  let list = false;
  for (const line of text.split("\n")) {
    const item = line.match(/^\s*[-*]\s+(.*)/);
    if (item) {
      if (!list) html += "<ul>";
      list = true;
      html += `<li>${inline(item[1])}</li>`;
      continue;
    }
    if (list) html += "</ul>";
    list = false;
    const heading = line.match(/^#{1,4}\s+(.*)/);
    if (heading) html += `<h3>${inline(heading[1])}</h3>`;
    else if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  return html + (list ? "</ul>" : "");
}

function renderHero(g) {
  $("programName").textContent = g.programName;
  $("level").textContent = g.level;
  $("title").textContent = g.title;
  const pct = g.current / g.needed;
  $("xpfill").style.width = `${pct * 100}%`;
  $("xptext").textContent = `${g.xp} XP · encore ${g.needed - g.current} XP avant le niveau ${g.level + 1}`;
  const ring = $("ring");
  const c = 2 * Math.PI * 52;
  ring.style.strokeDasharray = c;
  ring.style.strokeDashoffset = c * (1 - pct);
}

function renderTiles(g) {
  const tiles = [
    [`${g.sessionsDone}/${g.sessionsTotal}`, "séances faites"],
    [kg(g.tonnage), "soulevés au total"],
    [`${g.streak} 🔥`, "séances enchaînées"],
    [`${g.perfectSessions} 💎`, "séances parfaites"],
  ];
  $("tiles").innerHTML = tiles.map(([v, l]) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`).join("");
}

function renderNext(next) {
  if (!next) {
    $("next").innerHTML = `<p class="empty">Programme terminé. Légendaire. 🏆</p>`;
    return;
  }
  const rows = next.exercises
    .filter((x) => x.sets > 0 || x.done)
    .map((x) => {
      const sugg = x.suggested?.some(Boolean)
        ? `<b>${x.suggested.map((v) => v ?? "?").join(" · ")} kg</b><span class="muted">suggéré</span>`
        : `<span class="muted">—</span>`;
      const reach = x.recordWithinReach ? `<span class="reach" title="La charge suggérée bat ta meilleure perf">🎯 record possible</span>` : "";
      return `<div class="ex">
        <div class="ex-emoji">${esc(x.emoji)}</div>
        <div><div class="ex-name">${esc(x.name)}</div>
          <div class="ex-presc">${x.sets} × ${esc(x.repsText)} · ${esc(x.intensityText)}${x.rest ? ` · repos ${x.rest}s` : ""}</div></div>
        <div class="ex-sugg">${sugg}${reach}</div>
      </div>`;
    })
    .join("");
  $("next").innerHTML = `<p class="quest-meta">Semaine ${next.week} · Jour ${next.day} · ${esc(next.block)}</p>${rows}
    <p class="muted small">Remplis la colonne <b>Load</b> dans ton tableur, puis synchronise pour encaisser l'XP.</p>`;
}

function renderBosses(bosses) {
  $("bosses").innerHTML = bosses
    .map((b) => {
      const last = b.records.at(-1);
      const status = last
        ? `Dernier : <b>${recordText(last)}</b> · S${last.week} J${last.day}`
        : b.history.length ? "Ta première séance sert de référence : bats-la !" : "Pas encore affronté";
      const max = Math.max(...b.history.map((h) => h.e1rm), 1);
      const min = Math.min(...b.history.map((h) => h.e1rm)) * 0.9;
      const bars = b.history.length
        ? `<div class="spark">${b.history
            .map((h) => `<i class="${h.e1rm === b.best ? "best" : ""}" style="height:${((h.e1rm - min) / (max - min || 1)) * 85 + 15}%" title="${esc(h.program)} · Semaine ${h.week} : ${h.e1rm} kg"></i>`)
            .join("")}</div>`
        : `<div class="spark-empty">Pas encore affronté</div>`;
      return `<div class="boss">
        <div class="boss-head"><span class="boss-name">${LIFT_NAMES[b.lift]}</span>
          <span class="boss-val">${b.records.length} <small>record${b.records.length > 1 ? "s" : ""}</small> 🏆</span></div>
        <p class="boss-status">${status}</p>
        <div class="one-rm">
          <p class="boss-1rm">1RM estimé <b>${b.best ? `${num(b.best)} kg` : "?"}</b></p>
          ${bars}
        </div>
      </div>`;
    })
    .join("");
}

// Table reps × RPE de l'exercice choisi, calculée sur sa séance la plus récente.
let tablesData = null;

function renderTableSelect(g) {
  tablesData = g;
  const select = $("tableSelect");
  const previousChoice = select.value;
  const today = [...new Set((g.next?.exercises ?? []).map((x) => x.canonical))].filter((n) => g.loadTables[n]);
  const others = Object.keys(g.loadTables).filter((n) => !today.includes(n)).sort((a, b) => a.localeCompare(b, "fr"));
  const option = (n) => `<option value="${esc(n)}">${esc(g.loadTables[n].emoji)} ${esc(n)}</option>`;
  select.innerHTML =
    (today.length ? `<optgroup label="Prochaine séance">${today.map(option).join("")}</optgroup>` : "") +
    (others.length ? `<optgroup label="Autres exercices">${others.map(option).join("")}</optgroup>` : "");
  select.hidden = !today.length && !others.length;
  if (g.loadTables[previousChoice]) select.value = previousChoice;
  renderLoadTable();
}

function renderLoadTable() {
  const t = tablesData?.loadTables[$("tableSelect").value];
  if (!t) {
    $("loadTable").innerHTML = `<p class="empty">Remplis la colonne Load d'un exercice pour obtenir sa table de charges.</p>`;
    return;
  }
  const fmt = (n) => (n == null ? "–" : String(n).replace(".", ","));
  const rpes = tablesData.tableRpes;
  // Cases de la prescription de la prochaine séance pour cet exercice.
  const planned = new Set(
    (tablesData.next?.exercises ?? []).filter((x) => x.canonical === t.name).flatMap((x) => x.rpes.map((r) => `${x.reps}|${r}`)),
  );
  const src = t.source;
  $("loadTable").innerHTML = `
    <p class="table-source">D'après <b>S${src.week} J${src.day}</b> : ${esc(src.label)} ${src.sets} × ${esc(src.repsText)} à
      <b>${esc(src.loadText)} kg</b> (${esc(src.intensityText)}) → 1RM estimé <b>${fmt(t.e1rm)} kg</b></p>
    <div class="table-wrap"><table class="load-table">
      <thead><tr><th>Reps</th>${rpes.map((r) => `<th>@${fmt(r)}</th>`).join("")}</tr></thead>
      <tbody>${t.rows
        .map((row) => `<tr><th>${row.reps}</th>${row.loads
          .map((load, i) => `<td class="${planned.has(`${row.reps}|${rpes[i]}`) ? "hit" : ""}">${fmt(load)}</td>`)
          .join("")}</tr>`)
        .join("")}</tbody>
    </table></div>
    <p class="muted small">Charges en kg, arrondies à 2,5 kg. Surligné : la prescription de ta prochaine séance.
      Le tableau se met à jour à chaque nouvelle séance remplie pour cet exercice.</p>`;
}

$("tableSelect").addEventListener("change", renderLoadTable);

// Les 1RM estimés restent cachés tant qu'on ne les demande pas (choix mémorisé dans le navigateur).
function show1RM(visible) {
  $("bossCard").classList.toggle("show-1rm", visible);
  $("toggle1rm").textContent = visible ? "Masquer les 1RM" : "Voir les 1RM";
  $("toggle1rm").setAttribute("aria-pressed", visible);
  try {
    localStorage.setItem("show1rm", visible ? "1" : "");
  } catch {}
}
let initial1RM = false;
try {
  initial1RM = localStorage.getItem("show1rm") === "1";
} catch {}
show1RM(initial1RM);
$("toggle1rm").addEventListener("click", () => show1RM(!$("bossCard").classList.contains("show-1rm")));

function renderMap(map) {
  const weeks = [...new Set(map.map((s) => s.week))];
  $("map").innerHTML = weeks
    .map((w) => {
      const nodes = map.filter((s) => s.week === w);
      const deload = /deload/i.test(nodes[0].block);
      return `<div class="map-week"><small>${deload ? "Deload" : `S${w}`}</small>${nodes
        .map((s) => `<div class="node ${s.status} ${s.isNext ? "next" : ""} ${deload ? "deload" : ""}" title="${esc(s.block)} · Semaine ${s.week} · Jour ${s.day}${s.xp ? ` · +${s.xp} XP` : ""}">J${s.day}</div>`)
        .join("")}</div>`;
    })
    .join("");
  $("map").insertAdjacentHTML(
    "afterend",
    $("map").nextElementSibling?.classList.contains("legend")
      ? ""
      : `<div class="legend"><span><i style="background:var(--gold)"></i>Parfaite</span><span><i style="background:var(--green)"></i>Faite</span><span><i style="border:2px solid var(--violet)"></i>Prochaine</span><span><i style="background:var(--panel-2);border:1px solid var(--line)"></i>À venir</span></div>`,
  );
}

function renderBadges(badges) {
  $("badges").innerHTML = badges
    .map((b) => `<div class="badge ${b.unlocked ? "unlocked" : "locked"}">
      <div class="badge-icon">${b.icon}</div>
      <div><div class="badge-name">${esc(b.name)}</div><div class="badge-desc">${esc(b.desc)}</div>
        ${b.unlocked ? "" : `<div class="badge-bar"><i style="width:${(b.progress / b.goal) * 100}%"></i></div>`}</div>
    </div>`)
    .join("");
}

const longDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const placeText = (p) => (Number(p) === 1 ? "1er" : Number(p) ? `${p}e` : esc(p));

function renderTrophies(t) {
  $("trophyCard").hidden = !t.meets.length && !t.next;
  const plural = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`;
  $("trophySummary").textContent = t.meets.length
    ? [plural(t.meets.length, "compète"), t.wins && plural(t.wins, "victoire"), t.podiums > t.wins && plural(t.podiums, "podium")].filter(Boolean).join(" · ")
    : "";
  const next = t.next
    ? `<div class="trophy upcoming">
        <div class="trophy-icon">🎯</div>
        <div><div class="trophy-name">${esc(t.next.name)}</div>
          <div class="trophy-meta">${longDate(t.next.date)}</div>
          <div class="trophy-countdown">dans ${plural(t.next.weeksLeft, "semaine")}</div></div>
      </div>`
    : "";
  const meets = t.meets
    .map((m) => `<div class="trophy ${m.best ? "best" : ""}">
      <div class="trophy-icon">${m.icon}</div>
      <div><div class="trophy-name">${esc(m.name)}</div>
        <div class="trophy-meta">${placeText(m.place)} · ${longDate(m.date)}${m.town ? ` · ${esc(m.town)}` : ""}</div>
        ${m.total ? `<div class="trophy-total">${num(m.total)} <small>kg de total</small></div>` : ""}
        ${m.tags.length ? `<div class="trophy-tags">${m.tags.map((tag) => `<span class="pill">${esc(tag)}</span>`).join("")}</div>` : ""}</div>
    </div>`)
    .join("");
  $("trophies").innerHTML = next + meets;
}

function renderJournal(journal, programName) {
  if (!journal.length) {
    $("journal").innerHTML = `<p class="empty">Aucune séance pour l'instant. La première quête t'attend.</p>`;
    return;
  }
  $("journal").innerHTML = journal
    .map((s) => {
      const date = s.date ? new Date(s.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : "";
      const done = s.exercises
        .filter((x) => x.done)
        .map((x) => `${esc(x.name)} ${esc(x.loadText)}${x.record ? ` <span class="rec" title="Record : ${esc(recordText(x.record))}">🏆</span>` : ""}`)
        .join(" · ");
      return `<div class="log">
        <div class="log-head"><div><b>Semaine ${s.week} · Jour ${s.day}</b>${s.status === "perfect" ? `<span class="pill">💎 parfaite</span>` : ""}${s.records ? `<span class="pill">🏆 ${s.records} record${s.records > 1 ? "s" : ""}</span>` : ""}
          <span class="muted small"> ${s.program !== programName ? `${esc(s.program)} · ` : ""}${date} · ${kg(s.tonnage)}</span></div>
          <span class="log-xp">+${s.xp} XP</span></div>
        <div class="log-ex">${done}</div>
      </div>`;
    })
    .join("");
}

let previous = null;

async function load() {
  $("sync").disabled = true;
  try {
    const res = await fetch("/api/game");
    const g = await res.json();
    if (!res.ok) throw new Error(g.error);
    renderHero(g);
    renderTiles(g);
    renderNext(g.next);
    renderBosses(g.bosses);
    renderTableSelect(g);
    renderMap(g.map);
    renderTrophies(g.trophies);
    renderBadges(g.badges);
    renderJournal(g.journal, g.programName);
    if (g.coach) $("coach").innerHTML = markdown(g.coach.text);
    $("coachBtn").hidden = !g.aiEnabled;
    if (!g.aiEnabled) $("coach").textContent = "Ajoute ta clé ANTHROPIC_API_KEY dans le fichier .env pour réveiller le coach.";

    if (previous) {
      const gained = g.xp - previous.xp;
      const newRecords = g.records.filter((r) => !previous.records.some((p) => p.id === r.id));
      const newBadges = g.badges.filter((b) => b.unlocked && !previous.badges.find((p) => p.id === b.id)?.unlocked);
      if (g.level > previous.level) toast(`🎉 Niveau ${g.level} ! Tu es désormais ${g.title}.`);
      else if (newRecords.length) toast(`🏆 Nouveau record : ${newRecords.map(recordDetail).join(" · ")}`);
      else if (newBadges.length) toast(`🏅 Succès débloqué : ${newBadges.map((b) => b.name).join(", ")}`);
      else if (gained > 0) toast(`+${gained} XP`);
      else toast("Synchronisé, rien de nouveau.");
    }
    previous = g;
  } catch (err) {
    toast(err.message, true);
  } finally {
    $("sync").disabled = false;
  }
}

$("sync").addEventListener("click", load);

$("coachBtn").addEventListener("click", async () => {
  const btn = $("coachBtn");
  btn.disabled = true;
  btn.textContent = "Le coach réfléchit…";
  try {
    const res = await fetch("/api/coach", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    $("coach").classList.remove("muted");
    $("coach").innerHTML = markdown(data.text);
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Demander un bilan";
  }
});

load();
