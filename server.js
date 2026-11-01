const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT) || 8080;
const OPENLIFTER_RELEASE_DIR = path.join(__dirname, "openlifter", "releases", "1.3");
const OVERLAY_DIR = path.join(__dirname, "overlay");

// In-memory store of the latest OpenLifter state pushed from the browser
let currentState = null;
let lastUpdated = null;

// Connected SSE clients (OBS Browser Sources / preview tabs)
const sseClients = new Set();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".map": "application/json; charset=utf-8",
};

function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

function broadcastState() {
  const payload = JSON.stringify({
    state: currentState,
    lastUpdated,
  });
  for (const res of sseClients) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch {
      sseClients.delete(res);
    }
  }
}

// Script injected into OpenLifter's index.html to stream localStorage ('persist:root') to our server
const INJECTED_BRIDGE_SCRIPT = `
<script>
(function() {
  let lastRaw = null;
  let statusDot = null;
  let statusText = null;

  function parsePersistRoot(raw) {
    if (!raw) return null;
    try {
      const outer = JSON.parse(raw);
      const result = {};
      for (const key of Object.keys(outer)) {
        if (key === "_persist") continue;
        try {
          result[key] = JSON.parse(outer[key]);
        } catch {
          result[key] = outer[key];
        }
      }
      return result;
    } catch (e) {
      return null;
    }
  }

  function pushState(force) {
    const raw = window.localStorage.getItem("persist:root");
    if (!force && raw === lastRaw) return;
    lastRaw = raw;
    const parsed = parsePersistRoot(raw);
    if (!parsed) return;

    fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed)
    }).then(() => {
      if (statusDot) statusDot.style.background = "#22c55e";
      if (statusText) statusText.textContent = "OBS Overlay Synced";
    }).catch(() => {
      if (statusDot) statusDot.style.background = "#ef4444";
      if (statusText) statusText.textContent = "Sync Disconnected";
    });
  }

  // Intercept localStorage.setItem for zero-latency updates when OpenLifter writes state
  const origSetItem = window.localStorage.setItem.bind(window.localStorage);
  window.localStorage.setItem = function(key, val) {
    origSetItem(key, val);
    if (key === "persist:root") {
      pushState(false);
    }
  };

  window.addEventListener("storage", function(e) {
    if (e.key === "persist:root") pushState(true);
  });

  setInterval(function() { pushState(false); }, 300);

  // Demo Meet generator so user can test with 1 click
  function loadDemoMeet() {
    const demoState = {
      versions: JSON.stringify({ stateVersion: "2", releaseVersion: "1.3" }),
      language: JSON.stringify("en"),
      meet: JSON.stringify({
        name: "Maverick Autumn Classic 2026",
        country: "Australia",
        state: "VIC",
        city: "Melbourne",
        federation: "Open",
        date: "2026-11-01",
        lengthDays: 1,
        platformsOnDays: [1],
        ageCoefficients: "None",
        divisions: ["Open", "Junior"],
        weightClassesKgMen: [59, 66, 74, 83, 93, 105, 120, -120],
        weightClassesKgWomen: [47, 52, 57, 63, 69, 76, 84, -84],
        weightClassesKgMx: [],
        formula: "Dots",
        combineSleevesAndWraps: false,
        combineSingleAndMulti: false,
        allow4thAttempts: false,
        roundTotalsDown: false,
        inKg: true,
        squatBarAndCollarsWeightKg: 25,
        benchBarAndCollarsWeightKg: 25,
        deadliftBarAndCollarsWeightKg: 25,
        plates: [
          { weightKg: 25, pairCount: 10, color: "#d0203b" },
          { weightKg: 20, pairCount: 2, color: "#1d57c2" },
          { weightKg: 15, pairCount: 2, color: "#f2d230" },
          { weightKg: 10, pairCount: 2, color: "#279948" },
          { weightKg: 5, pairCount: 2, color: "#f5f5f5" },
          { weightKg: 2.5, pairCount: 2, color: "#212121" },
          { weightKg: 1.25, pairCount: 2, color: "#9e9e9e" }
        ],
        showAlternateUnits: true
      }),
      lifting: JSON.stringify({
        day: 1,
        platform: 1,
        flight: "A",
        lift: "S",
        overrideAttempt: null,
        overrideEntryId: null,
        columnDivisionWidthPx: 120
      }),
      registration: JSON.stringify({
        nextEntryId: 5006,
        lookup: { "5000": 0, "5001": 1, "5002": 2, "5003": 3, "5004": 4, "5005": 5 },
        entries: [
          {
            id: 5000, day: 1, platform: 1, flight: "A",
            name: "Sarah Jenkins", sex: "F", birthDate: "1996-04-12", age: 30,
            country: "Australia", state: "VIC", intendedWeightClassKg: "63",
            equipment: "Sleeves", divisions: ["Open"], events: ["SBD"],
            lot: 1, memberId: "M-101", paid: true, team: "Ironclad Barbell", guest: false, notes: "",
            bodyweightKg: 62.4, squatRackInfo: "11 / In", benchRackInfo: "6 / 3",
            squatKg: [125, 132.5, 0, 0, 0], squatStatus: [1, 0, 0, 0, 0],
            benchKg: [72.5, 0, 0, 0, 0], benchStatus: [0, 0, 0, 0, 0],
            deadliftKg: [155, 0, 0, 0, 0], deadliftStatus: [0, 0, 0, 0, 0]
          },
          {
            id: 5001, day: 1, platform: 1, flight: "A",
            name: "Elena Rostova", sex: "F", birthDate: "1999-08-22", age: 27,
            country: "Australia", state: "NSW", intendedWeightClassKg: "69",
            equipment: "Sleeves", divisions: ["Open"], events: ["SBD"],
            lot: 2, memberId: "M-102", paid: true, team: "Southern Cross PL", guest: false, notes: "",
            bodyweightKg: 68.1, squatRackInfo: "13 / Out", benchRackInfo: "7 / 4",
            squatKg: [140, 147.5, 0, 0, 0], squatStatus: [1, 0, 0, 0, 0],
            benchKg: [85, 0, 0, 0, 0], benchStatus: [0, 0, 0, 0, 0],
            deadliftKg: [175, 0, 0, 0, 0], deadliftStatus: [0, 0, 0, 0, 0]
          },
          {
            id: 5002, day: 1, platform: 1, flight: "A",
            name: "Liam O'Connor", sex: "M", birthDate: "2003-01-19", age: 23,
            country: "Australia", state: "VIC", intendedWeightClassKg: "74",
            equipment: "Sleeves", divisions: ["Junior"], events: ["SBD"],
            lot: 3, memberId: "M-103", paid: true, team: "Maverick Strength", guest: false, notes: "",
            bodyweightKg: 73.2, squatRackInfo: "14 / In", benchRackInfo: "8 / 4",
            squatKg: [185, 195, 0, 0, 0], squatStatus: [1, 0, 0, 0, 0],
            benchKg: [125, 0, 0, 0, 0], benchStatus: [0, 0, 0, 0, 0],
            deadliftKg: [225, 0, 0, 0, 0], deadliftStatus: [0, 0, 0, 0, 0]
          },
          {
            id: 5003, day: 1, platform: 1, flight: "A",
            name: "Marcus Vance", sex: "M", birthDate: "1994-11-05", age: 31,
            country: "Australia", state: "VIC", intendedWeightClassKg: "83",
            equipment: "Sleeves", divisions: ["Open"], events: ["SBD"],
            lot: 4, memberId: "M-104", paid: true, team: "Maverick Strength", guest: false, notes: "",
            bodyweightKg: 82.5, squatRackInfo: "15 / Out", benchRackInfo: "9 / 5",
            squatKg: [210, 210, 0, 0, 0], squatStatus: [-1, 0, 0, 0, 0],
            benchKg: [142.5, 0, 0, 0, 0], benchStatus: [0, 0, 0, 0, 0],
            deadliftKg: [250, 0, 0, 0, 0], deadliftStatus: [0, 0, 0, 0, 0]
          },
          {
            id: 5004, day: 1, platform: 1, flight: "A",
            name: "David Chen", sex: "M", birthDate: "1997-06-30", age: 29,
            country: "Australia", state: "QLD", intendedWeightClassKg: "83",
            equipment: "Sleeves", divisions: ["Open"], events: ["SBD"],
            lot: 5, memberId: "M-105", paid: true, team: "Brisbane Barbell", guest: false, notes: "",
            bodyweightKg: 81.9, squatRackInfo: "14 / Out", benchRackInfo: "8 / 4",
            squatKg: [215, 225, 0, 0, 0], squatStatus: [1, 0, 0, 0, 0],
            benchKg: [150, 0, 0, 0, 0], benchStatus: [0, 0, 0, 0, 0],
            deadliftKg: [260, 0, 0, 0, 0], deadliftStatus: [0, 0, 0, 0, 0]
          },
          {
            id: 5005, day: 1, platform: 1, flight: "A",
            name: "Tomoko Sato", sex: "M", birthDate: "1992-03-14", age: 34,
            country: "Australia", state: "VIC", intendedWeightClassKg: "93",
            equipment: "Sleeves", divisions: ["Open"], events: ["SBD"],
            lot: 6, memberId: "M-106", paid: true, team: "Ironclad Barbell", guest: false, notes: "",
            bodyweightKg: 91.8, squatRackInfo: "16 / Out", benchRackInfo: "10 / 5",
            squatKg: [240, 252.5, 0, 0, 0], squatStatus: [1, 0, 0, 0, 0],
            benchKg: [165, 0, 0, 0, 0], benchStatus: [0, 0, 0, 0, 0],
            deadliftKg: [285, 0, 0, 0, 0], deadliftStatus: [0, 0, 0, 0, 0]
          }
        ]
      }),
      _persist: JSON.stringify({ version: -1, rehydrated: true })
    };
    origSetItem("persist:root", JSON.stringify(demoState));
    pushState(true);
    window.location.href = "/releases/1.3/lifting";
  }

  function mountToolbar() {
    if (document.getElementById("obs-sync-toolbar")) return;
    const navbar = document.querySelector(".navbar .navbar-collapse") || document.querySelector(".navbar");
    if (!navbar) return;

    const bar = document.createElement("div");
    bar.id = "obs-sync-toolbar";
    bar.style.cssText = "margin-left:auto;background:#1f2937;color:#f9fafb;padding:4px 10px;border-radius:6px;font-family:system-ui,-apple-system,sans-serif;font-size:12px;display:flex;align-items:center;gap:10px;border:1px solid #374151;";
    
    statusDot = document.createElement("span");
    statusDot.style.cssText = "width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block;";
    
    statusText = document.createElement("span");
    statusText.textContent = "OBS Synced";
    statusText.style.fontWeight = "600";

    const demoBtn = document.createElement("button");
    demoBtn.textContent = "Load Demo Flight";
    demoBtn.style.cssText = "background:#2563eb;color:#fff;border:none;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px;font-weight:600;";
    demoBtn.onclick = loadDemoMeet;

    const overlayLink = document.createElement("a");
    overlayLink.href = "/overlay";
    overlayLink.target = "_blank";
    overlayLink.textContent = "Open OBS Overlay ↗";
    overlayLink.style.cssText = "color:#60a5fa;text-decoration:none;font-weight:600;font-size:11px;";

    bar.appendChild(statusDot);
    bar.appendChild(statusText);
    bar.appendChild(demoBtn);
    bar.appendChild(overlayLink);
    navbar.appendChild(bar);
  }

  window.addEventListener("DOMContentLoaded", function() {
    mountToolbar();
    setInterval(mountToolbar, 500);
    pushState(true);
  });
})();
</script>
`;

function serveOpenLifterIndex(res) {
  const indexPath = path.join(OPENLIFTER_RELEASE_DIR, "index.html");
  fs.readFile(indexPath, "utf8", (err, html) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Failed to read OpenLifter index.html");
      return;
    }
    const injectedHtml = html.replace("</body>", `${INJECTED_BRIDGE_SCRIPT}</body>`);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(injectedHtml);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  // Enable CORS so OBS on Windows or any LAN device can connect freely
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. API: Receive state from OpenLifter
  if (pathname === "/api/state" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        currentState = JSON.parse(body);
        lastUpdated = new Date().toISOString();
        broadcastState();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, lastUpdated }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  // 2. API: Get current state snapshot
  if (pathname === "/api/state" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ state: currentState, lastUpdated }));
    return;
  }

  // 3. API: Real-time Server-Sent Events (SSE) stream for OBS overlay
  if (pathname === "/api/stream" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ state: currentState, lastUpdated })}\n\n`);
    sseClients.add(res);
    req.on("close", () => {
      sseClients.delete(res);
    });
    return;
  }

  // 4. Root redirect -> OpenLifter
  if (pathname === "/") {
    res.writeHead(302, { Location: "/releases/1.3/" });
    res.end();
    return;
  }

  // 5. OBS Broadcast Overlay (/overlay)
  if (pathname === "/overlay" || pathname === "/overlay/") {
    const overlayHtmlPath = path.join(OVERLAY_DIR, "index.html");
    fs.readFile(overlayHtmlPath, "utf8", (err, html) => {
      if (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Overlay not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(html);
    });
    return;
  }

  // 6. Serve OpenLifter 1.3 static assets & SPA routes
  if (pathname.startsWith("/releases/1.3")) {
    const relPath = pathname.slice("/releases/1.3".length) || "/";
    const candidatePath = path.normalize(path.join(OPENLIFTER_RELEASE_DIR, relPath));

    // Security check: ensure candidatePath stays inside OPENLIFTER_RELEASE_DIR
    if (!candidatePath.startsWith(OPENLIFTER_RELEASE_DIR)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if (relPath === "/" || relPath === "/index.html") {
      serveOpenLifterIndex(res);
      return;
    }

    fs.stat(candidatePath, (err, stats) => {
      if (!err && stats.isFile()) {
        const ext = path.extname(candidatePath);
        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": contentType });
        fs.createReadStream(candidatePath).pipe(res);
      } else {
        // SPA client-side route (e.g. /releases/1.3/lifting, /releases/1.3/weigh-ins)
        serveOpenLifterIndex(res);
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(PORT, "0.0.0.0", () => {
  const lanIp = getLanIp();
  console.log("==============================================================");
  console.log("🏋️  OpenLifter + OBS Live Overlay Server Running!");
  console.log("==============================================================");
  console.log(`1. OpenLifter (Scorekeeper Mac):  http://localhost:${PORT}/releases/1.3/`);
  console.log(`2. OBS Overlay (Local Test):      http://localhost:${PORT}/overlay`);
  console.log(`3. OBS Overlay (Windows PC LAN):  http://${lanIp}:${PORT}/overlay`);
  console.log("==============================================================");
});
