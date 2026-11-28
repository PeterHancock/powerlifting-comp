// Shared OpenLifter OBS Live Overlay logic (used by /overlay/default and /overlay/maverick)
(function () {
  // Detect OBS Browser Source or URL query params (?mode=lower-third|board|both&clean=1)
  const params = new URLSearchParams(window.location.search);
  const initialMode = params.get("mode") || "lower-third";
  document.body.setAttribute("data-view", initialMode);

  if (window.obsstudio || params.get("clean") === "1") {
    document.body.classList.add("clean-mode");
    document.body.classList.remove("preview-backdrop");
  }

  const activeVariant = `${document.body.getAttribute("data-theme") || "default"}:${document.body.getAttribute("data-density") || "normal"}`;
  document.querySelectorAll("[data-variant]").forEach((link) => {
    if (link.getAttribute("data-variant") === activeVariant) {
      link.classList.add("active");
    }
    if (window.location.search) {
      link.setAttribute("href", link.getAttribute("href") + window.location.search);
    }
  });

  document.querySelectorAll("[data-set-view]").forEach((btn) => {
    if (btn.getAttribute("data-set-view") === initialMode) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-set-view");
      document.body.setAttribute("data-view", mode);
      document.querySelectorAll("[data-set-view]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  const toggleBackdropBtn = document.getElementById("toggleBackdropBtn");
  if (toggleBackdropBtn) {
    toggleBackdropBtn.addEventListener("click", () => {
      document.body.classList.toggle("preview-backdrop");
    });
  }

  // --- OpenLifter Exact Lifting Order & Scoring Logic ---
  const MAX_ATTEMPTS = 5;

  function liftToAttemptFieldName(lift) {
    if (lift === "B") return "benchKg";
    if (lift === "D") return "deadliftKg";
    return "squatKg";
  }

  function liftToStatusFieldName(lift) {
    if (lift === "B") return "benchStatus";
    if (lift === "D") return "deadliftStatus";
    return "squatStatus";
  }

  function liftToFullName(lift) {
    if (lift === "B") return "Bench Press";
    if (lift === "D") return "Deadlift";
    return "Squat";
  }

  function getNextAttemptNumberForEntry(entry, fieldKg, fieldStatus) {
    const weightsKg = entry[fieldKg] || [];
    const statuses = entry[fieldStatus] || [];
    for (let i = MAX_ATTEMPTS - 1; i >= 0; i--) {
      if (weightsKg[i] !== 0 && statuses[i] === 0) return i + 1;
    }
    return 0;
  }

  function getMaxAttemptNumberForEntry(entry, fieldKg, fieldStatus) {
    const weightsKg = entry[fieldKg] || [];
    const statuses = entry[fieldStatus] || [];
    for (let i = MAX_ATTEMPTS - 1; i >= 0; i--) {
      if (weightsKg[i] !== 0 && statuses[i] !== 0) return i + 1;
    }
    return 0;
  }

  function getActiveAttemptNumber(entriesInFlight, lifting) {
    const fieldKg = liftToAttemptFieldName(lifting.lift);
    const fieldStatus = liftToStatusFieldName(lifting.lift);
    if (lifting.overrideAttempt !== null && lifting.overrideAttempt !== undefined) {
      return Number(lifting.overrideAttempt);
    }
    let earliest = MAX_ATTEMPTS + 1;
    for (const entry of entriesInFlight) {
      const next = getNextAttemptNumberForEntry(entry, fieldKg, fieldStatus);
      if (next > 0 && next < earliest) earliest = next;
    }
    if (earliest < MAX_ATTEMPTS + 1) return earliest;

    let latest = 0;
    for (const entry of entriesInFlight) {
      const max = getMaxAttemptNumberForEntry(entry, fieldKg, fieldStatus);
      if (max > latest) latest = max;
    }
    if (latest > 0) {
      return latest + 1 >= 4 ? latest : latest + 1;
    }
    return 1;
  }

  function compareEntriesByAttempt(a, b, fieldKg, attemptOneIndexed) {
    const aKg = a[fieldKg][attemptOneIndexed - 1] || 0;
    const bKg = b[fieldKg][attemptOneIndexed - 1] || 0;
    if (aKg !== bKg) return aKg - bKg;
    if (a.lot !== 0 && b.lot !== 0) return a.lot - b.lot;
    if (attemptOneIndexed > 1) {
      return compareEntriesByAttempt(a, b, fieldKg, attemptOneIndexed - 1);
    }
    if (a.bodyweightKg !== b.bodyweightKg) return a.bodyweightKg - b.bodyweightKg;
    return a.name.localeCompare(b.name);
  }

  function orderEntriesForAttempt(entriesInFlight, lifting, attemptOneIndexed) {
    const fieldKg = liftToAttemptFieldName(lifting.lift);
    const attemptZero = attemptOneIndexed - 1;
    const existsNext = attemptOneIndexed + 1 <= MAX_ATTEMPTS;
    const existsPrev = attemptOneIndexed > 1;

    const byNext = [];
    const byThis = [];
    const byPrev = [];
    const notLifting = [];

    for (const entry of entriesInFlight) {
      if (existsNext && entry[fieldKg][attemptZero + 1] !== 0) {
        byNext.push(entry);
      } else if (entry[fieldKg][attemptZero] !== 0) {
        byThis.push(entry);
      } else if (existsPrev && entry[fieldKg][attemptZero - 1] !== 0) {
        byPrev.push(entry);
      } else {
        notLifting.push(entry);
      }
    }

    if (existsNext) byNext.sort((a, b) => compareEntriesByAttempt(a, b, fieldKg, attemptOneIndexed + 1));
    byThis.sort((a, b) => compareEntriesByAttempt(a, b, fieldKg, attemptOneIndexed));
    if (existsPrev) byPrev.sort((a, b) => compareEntriesByAttempt(a, b, fieldKg, attemptOneIndexed - 1));
    notLifting.sort((a, b) => compareEntriesByAttempt(a, b, fieldKg, attemptOneIndexed));

    return [].concat(byNext, byThis, byPrev, notLifting);
  }

  function getLiftingOrder(entriesInFlight, lifting) {
    const attemptOneIndexed = getActiveAttemptNumber(entriesInFlight, lifting);
    const orderedEntries = orderEntriesForAttempt(entriesInFlight, lifting, attemptOneIndexed);
    const fieldKg = liftToAttemptFieldName(lifting.lift);
    const fieldStatus = liftToStatusFieldName(lifting.lift);

    let currentEntryId = null;
    if (lifting.overrideEntryId !== null && lifting.overrideEntryId !== undefined) {
      if (orderedEntries.some((e) => e.id === Number(lifting.overrideEntryId))) {
        currentEntryId = Number(lifting.overrideEntryId);
      }
    }
    if (currentEntryId === null) {
      for (const entry of orderedEntries) {
        const idx = attemptOneIndexed - 1;
        if (entry[fieldKg][idx] !== 0 && entry[fieldStatus][idx] === 0) {
          currentEntryId = entry.id;
          break;
        }
      }
    }

    let nextInfo = null;
    if (currentEntryId !== null) {
      const currIdx = orderedEntries.findIndex((e) => e.id === currentEntryId);
      for (let i = currIdx + 1; i < orderedEntries.length; i++) {
        if (
          orderedEntries[i][fieldKg][attemptOneIndexed - 1] !== 0 &&
          orderedEntries[i][fieldStatus][attemptOneIndexed - 1] === 0
        ) {
          nextInfo = { entry: orderedEntries[i], attemptOneIndexed };
          break;
        }
      }
      if (!nextInfo && attemptOneIndexed + 1 <= MAX_ATTEMPTS) {
        const nextAtt = attemptOneIndexed + 1;
        for (let i = 0; i < currIdx; i++) {
          if (orderedEntries[i][fieldKg][nextAtt - 1] !== 0 && orderedEntries[i][fieldStatus][nextAtt - 1] === 0) {
            nextInfo = { entry: orderedEntries[i], attemptOneIndexed: nextAtt };
            break;
          }
        }
      }
    }

    return { orderedEntries, attemptOneIndexed, currentEntryId, nextInfo };
  }

  function getBest3(entry, fieldKg, fieldStatus) {
    let best = 0;
    for (let i = 0; i < 3; i++) {
      if (entry[fieldStatus][i] > 0) best = Math.max(best, entry[fieldKg][i]);
    }
    return best;
  }

  function getCurrentTotal(entry) {
    const s = getBest3(entry, "squatKg", "squatStatus");
    const b = getBest3(entry, "benchKg", "benchStatus");
    const d = getBest3(entry, "deadliftKg", "deadliftStatus");
    return s + b + d;
  }

  function kgToLbs(kg) {
    return Math.round(kg * 2.20462262 * 10) / 10;
  }

  function formatNum(n) {
    if (!n || n <= 0) return "—";
    return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function computePlates(weightKg, barAndCollarsKg, plates) {
    if (!weightKg || weightKg <= barAndCollarsKg) return [];
    const sorted = (plates || []).slice().sort((a, b) => b.weightKg - a.weightKg);
    let side = (weightKg - barAndCollarsKg) / 2;
    const loaded = [];
    for (const p of sorted) {
      let count = p.pairCount;
      while (count > 0 && p.weightKg <= side + 1e-6) {
        count--;
        side -= p.weightKg;
        loaded.push({ weightKg: p.weightKg, color: p.color });
      }
    }
    return loaded;
  }

  function renderPlateGraphic(plates) {
    const container = document.getElementById("ltPlateGraphic");
    container.innerHTML = "";
    if (!plates.length) return;

    const scale = parseFloat(document.body.getAttribute("data-plate-scale") || "1") || 1;

    const sleeve = document.createElement("div");
    sleeve.className = "bar-sleeve";
    container.appendChild(sleeve);

    for (const p of plates) {
      const disc = document.createElement("div");
      disc.className = "plate-disc";
      const baseHeightPx =
        p.weightKg >= 25 ? 54 : p.weightKg >= 20 ? 52 : p.weightKg >= 15 ? 44 : p.weightKg >= 10 ? 38 : p.weightKg >= 5 ? 30 : 24;
      disc.style.blockSize = `${Math.round(baseHeightPx * scale)}px`;
      disc.style.background = p.color || "var(--accent-primary, #e11d48)";
      container.appendChild(disc);
    }

    const collar = document.createElement("div");
    collar.className = "bar-collar";
    container.appendChild(collar);
  }

  function renderState(state) {
    if (!state || !state.registration || !state.lifting || !state.meet) return;

    const { meet, registration, lifting } = state;
    const entries = (registration.entries || []).filter(
      (e) => e.day === lifting.day && e.platform === lifting.platform && e.flight === lifting.flight
    );

    const order = getLiftingOrder(entries, lifting);
    const liftName = liftToFullName(lifting.lift);
    const fieldKg = liftToAttemptFieldName(lifting.lift);
    const fieldStatus = liftToStatusFieldName(lifting.lift);

    // Update Board Header
    document.getElementById("boardMeetName").textContent = meet.name || "Powerlifting Competition";
    document.getElementById("boardFlightInfo").textContent =
      `Day ${lifting.day} • Platform ${lifting.platform} • Flight ${lifting.flight} • ${liftName} (Attempt ${order.attemptOneIndexed})`;

    // Update Flight Table
    const tbody = document.getElementById("flightTableBody");
    tbody.innerHTML = "";
    order.orderedEntries.forEach((entry, idx) => {
      const tr = document.createElement("tr");
      if (entry.id === order.currentEntryId) tr.className = "current-row";

      const rack = lifting.lift === "S" ? entry.squatRackInfo : lifting.lift === "B" ? entry.benchRackInfo : "—";
      const bestS = getBest3(entry, "squatKg", "squatStatus");
      const bestB = getBest3(entry, "benchKg", "benchStatus");
      const bestD = getBest3(entry, "deadliftKg", "deadliftStatus");
      const total = bestS + bestB + bestD;

      let attemptsHtml = "";
      for (let i = 0; i < 3; i++) {
        const w = entry[fieldKg][i];
        const st = entry[fieldStatus][i];
        const isCurrent = entry.id === order.currentEntryId && order.attemptOneIndexed === i + 1 && st === 0;
        const cls = st === 1 ? "good" : st === -1 ? "no-lift" : isCurrent ? "active-attempt" : "";
        attemptsHtml += `<td class="cell-attempt ${cls}">${formatNum(w)}</td>`;
      }

      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td><strong>${escapeHtml(entry.name || "Unnamed")}</strong></td>
        <td class="cell-muted">${escapeHtml(entry.team || "—")}</td>
        <td>${entry.intendedWeightClassKg ? escapeHtml(entry.intendedWeightClassKg) + " kg" : "—"} <span class="cell-muted">(${formatNum(entry.bodyweightKg)})</span></td>
        <td class="cell-rack">${escapeHtml(rack || "—")}</td>
        ${attemptsHtml}
        <td class="cell-num">${formatNum(bestS)}</td>
        <td class="cell-num">${formatNum(bestB)}</td>
        <td class="cell-num">${formatNum(bestD)}</td>
        <td class="cell-num cell-total">${formatNum(total)}</td>
      `;
      tbody.appendChild(tr);
    });

    // Update Lower-Third
    document.getElementById("ltLiftBadge").textContent = `${liftName.toUpperCase()} • ATTEMPT ${order.attemptOneIndexed}`;
    document.getElementById("ltFlightBadge").textContent = `FLIGHT ${lifting.flight}`;
    document.getElementById("ltAttemptsHeader").textContent = `${liftName} Attempts (kg)`;

    const currentEntry = order.orderedEntries.find((e) => e.id === order.currentEntryId) || order.orderedEntries[0];

    if (order.nextInfo && order.nextInfo.entry) {
      const nextW = order.nextInfo.entry[fieldKg][order.nextInfo.attemptOneIndexed - 1];
      document.getElementById("ltOnDeck").innerHTML =
        `ON DECK: <strong>${escapeHtml(order.nextInfo.entry.name)}</strong> (${formatNum(nextW)} kg)`;
    } else {
      document.getElementById("ltOnDeck").innerHTML = `ON DECK: <strong>—</strong>`;
    }

    if (!currentEntry) {
      document.getElementById("ltLifterName").textContent = "No Active Lifter in Flight";
      return;
    }

    const rack = lifting.lift === "S" ? currentEntry.squatRackInfo : lifting.lift === "B" ? currentEntry.benchRackInfo : "";
    document.getElementById("ltRackBadge").textContent = rack ? `RACK: ${rack}` : `PLATFORM ${lifting.platform}`;

    document.getElementById("ltLifterName").textContent = currentEntry.name || "Unnamed Lifter";

    const metaTags = [];
    if (currentEntry.team) metaTags.push(`<span class="meta-tag">${escapeHtml(currentEntry.team)}</span>`);
    if (currentEntry.intendedWeightClassKg) {
      metaTags.push(`<span class="meta-tag">${escapeHtml(currentEntry.intendedWeightClassKg)} kg Class</span>`);
    }
    if (currentEntry.bodyweightKg) metaTags.push(`<span>BW: ${formatNum(currentEntry.bodyweightKg)} kg</span>`);
    if (currentEntry.divisions && currentEntry.divisions.length) {
      metaTags.push(`<span>${escapeHtml(currentEntry.divisions.join(", "))}</span>`);
    }
    document.getElementById("ltLifterMeta").innerHTML = metaTags.join("");

    // Attempts row (1 / 2 / 3)
    const attemptsRow = document.getElementById("ltAttemptsRow");
    attemptsRow.innerHTML = "";
    for (let i = 0; i < 3; i++) {
      const w = currentEntry[fieldKg][i];
      const st = currentEntry[fieldStatus][i];
      const pill = document.createElement("div");
      const isCurrent = order.attemptOneIndexed === i + 1 && st === 0;
      pill.className = "attempt-pill " + (st === 1 ? "good" : st === -1 ? "no-lift" : isCurrent ? "current" : "");
      pill.textContent = formatNum(w);
      attemptsRow.appendChild(pill);
    }

    // Best S / B / D / Total
    const bestS = getBest3(currentEntry, "squatKg", "squatStatus");
    const bestB = getBest3(currentEntry, "benchKg", "benchStatus");
    const bestD = getBest3(currentEntry, "deadliftKg", "deadliftStatus");
    document.getElementById("ltBestS").textContent = formatNum(bestS);
    document.getElementById("ltBestB").textContent = formatNum(bestB);
    document.getElementById("ltBestD").textContent = formatNum(bestD);
    document.getElementById("ltTotal").textContent = formatNum(getCurrentTotal(currentEntry));

    // Bar Weight & Plate Loading
    const currentWeightKg = currentEntry[fieldKg][order.attemptOneIndexed - 1] || 0;
    document.getElementById("ltBarPrimary").textContent = `${formatNum(currentWeightKg)} kg`;
    document.getElementById("ltBarSecondary").textContent = `${formatNum(kgToLbs(currentWeightKg))} lbs`;

    const barWeight =
      lifting.lift === "B"
        ? meet.benchBarAndCollarsWeightKg
        : lifting.lift === "D"
        ? meet.deadliftBarAndCollarsWeightKg
        : meet.squatBarAndCollarsWeightKg;
    const loadedPlates = computePlates(currentWeightKg, barWeight || 25, meet.plates || []);
    renderPlateGraphic(loadedPlates);
  }

  // Connect to live SSE stream from server.js
  function connectStream() {
    const dot = document.getElementById("syncDot");
    const status = document.getElementById("syncStatus");
    const es = new EventSource("/api/stream");

    es.onopen = () => {
      dot.classList.remove("disconnected");
      dot.classList.add("connected");
      status.textContent = "Live SSE Connected";
    };

    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.state) renderState(payload.state);
      } catch (err) {
        console.error("Failed to parse SSE state", err);
      }
    };

    es.onerror = () => {
      dot.classList.remove("connected");
      dot.classList.add("disconnected");
      status.textContent = "Reconnecting...";
    };
  }

  connectStream();
})();
