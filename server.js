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
<style>
  #switch-version-modal {
    border: 1px solid #d1d5db;
    border-radius: 8px;
    padding: 20px 24px;
    max-width: 460px;
    width: calc(100% - 32px);
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.25);
    font-family: system-ui, -apple-system, sans-serif;
    color: #111827;
    background: #ffffff;
  }
  #switch-version-modal:modal {
    overscroll-behavior: contain;
  }
  #switch-version-modal::backdrop {
    overflow: hidden;
    overscroll-behavior: contain;
    background-color: rgba(0, 0, 0, 0.5);
  }
  #switch-version-modal h1 {
    font-size: 1.25rem;
    font-weight: 700;
    margin: 0 0 12px;
  }
  #switch-version-modal p {
    font-size: 0.95rem;
    line-height: 1.5;
    margin: 0 0 12px;
    color: #374151;
  }
  #switch-version-modal form {
    display: flex;
    justify-content: flex-end;
    margin-top: 16px;
  }
  a[href^="https://www.openlifter.com/releases/"] button {
    opacity: 0.65;
  }
</style>
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

    const overlayLink = document.createElement("a");
    overlayLink.href = "/overlay";
    overlayLink.target = "_blank";
    overlayLink.textContent = "Open OBS Overlay ↗";
    overlayLink.style.cssText = "color:#60a5fa;text-decoration:none;font-weight:600;font-size:11px;";

    bar.appendChild(statusDot);
    bar.appendChild(statusText);
    bar.appendChild(overlayLink);
    navbar.appendChild(bar);
  }

  function ensureSwitchWarningModal() {
    let dialog = document.getElementById("switch-version-modal");
    if (dialog) return dialog;

    dialog = document.createElement("dialog");
    dialog.id = "switch-version-modal";
    dialog.setAttribute("closedby", "any");
    dialog.setAttribute("aria-labelledby", "switch-version-modal-title");

    const title = document.createElement("h1");
    title.id = "switch-version-modal-title";
    title.textContent = "Stay on Local OpenLifter";

    const msg = document.createElement("p");
    msg.textContent = "You probably don't want to go to https://www.openlifter.com/.";

    const detail = document.createElement("p");
    detail.textContent = "This local OpenLifter instance is connected to the live OBS overlay bridge. Switching to openlifter.com will disconnect from your local server and overlay.";

    const form = document.createElement("form");
    form.method = "dialog";

    const closeBtn = document.createElement("button");
    closeBtn.type = "submit";
    closeBtn.className = "btn btn-primary";
    closeBtn.textContent = "Close";
    closeBtn.autofocus = true;

    form.appendChild(closeBtn);
    dialog.appendChild(title);
    dialog.appendChild(msg);
    dialog.appendChild(detail);
    dialog.appendChild(form);

    if (!("closedBy" in HTMLDialogElement.prototype)) {
      const outside = function(e) {
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      let pressedOutside = false;
      dialog.addEventListener("pointerdown", function(e) {
        pressedOutside = outside(e);
      });
      dialog.addEventListener("pointerup", function(e) {
        if (pressedOutside && outside(e)) dialog.close();
      });
    }

    document.body.appendChild(dialog);
    return dialog;
  }

  function showSwitchWarningModal() {
    const dialog = ensureSwitchWarningModal();
    if (!dialog.open) {
      dialog.showModal();
    }
  }

  function markSwitchButtons() {
    const buttons = document.querySelectorAll('a[href^="https://www.openlifter.com/releases/"] button');
    for (const btn of buttons) {
      if (btn.getAttribute("aria-disabled") !== "true") {
        btn.setAttribute("aria-disabled", "true");
      }
    }
  }

  function handleSwitchLinkActivation(e) {
    const link = e.target && e.target.closest
      ? e.target.closest('a[href^="https://www.openlifter.com/releases/"]')
      : null;
    if (!link) return;
    e.preventDefault();
    e.stopPropagation();
    showSwitchWarningModal();
  }

  document.addEventListener("click", handleSwitchLinkActivation, true);
  document.addEventListener("auxclick", handleSwitchLinkActivation, true);

  window.addEventListener("DOMContentLoaded", function() {
    mountToolbar();
    markSwitchButtons();
    setInterval(function() {
      mountToolbar();
      markSwitchButtons();
    }, 500);
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
