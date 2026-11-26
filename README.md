# Powerlifting Competition Live Scoring & OBS Overlay

Real-time broadcast bridge connecting **[OpenLifter](https://gitlab.com/openpowerlifting/openlifter)** (running on the scorekeeper's Mac) to **[OBS Studio](https://github.com/obsproject/obs-studio)** (running locally for testing or on a dedicated Windows streaming PC).

---

## How It Works

OpenLifter is a client-side React/Redux application that saves competition state to browser `localStorage` (`persist:root`). Because it has no built-in network server, `server.js` acts as a lightweight, zero-dependency bridge:

```
┌──────────────────────────────┐
│  Mac Browser (Scorekeeper)   │
│  OpenLifter 1.3              │
│  http://localhost:8080       │
└──────────────┬───────────────┘
               │ Auto-pushes localStorage ('persist:root')
               ▼
┌──────────────────────────────┐
│  Node.js Bridge (server.js)  │
│  Port 8080 (0.0.0.0)         │
└──────────────┬───────────────┘
               │ Live Server-Sent Events (/api/stream)
               ▼
┌──────────────────────────────┐
│  OBS Studio Browser Source   │
│  (Local Mac or Windows PC)   │
│  http://<mac-ip>:8080/overlay│
└──────────────────────────────┘
```

Whenever the scorekeeper marks **Good Lift**, **No Lift**, edits rack heights, enters next attempts, or switches flights/lifts, the OBS overlay updates immediately—even if the scorekeeper opens the **Edit Weigh-ins** view or switches tabs.

---

## Prerequisites

- **Mac (Scorekeeper machine):**
  - [Node.js](https://nodejs.org/) (v16+ recommended; no `npm install` or external packages required)
  - Modern web browser (Chrome, Brave, Edge, or Safari)
- **Windows PC (Streaming machine, or Mac for local testing):**
  - [OBS Studio](https://obsproject.com/) (v28+ includes Browser Source out of the box)

---

## Part 1: Local Testing on Your Mac

You can test the entire workflow on a single Mac using either two browser tabs or OBS Studio for macOS.

### 1. Start the Server

Open a terminal in this project folder and run:

```bash
node server.js
```

You will see output similar to:

```text
==============================================================
🏋️  OpenLifter + OBS Live Overlay Server Running!
==============================================================
1. OpenLifter (Scorekeeper Mac):  http://localhost:8080/releases/1.3/
2. OBS Overlay (Local Test):      http://localhost:8080/overlay
3. OBS Overlay (Windows PC LAN):  http://192.168.1.41:8080/overlay
==============================================================
```

### 2. Open OpenLifter & Load a Meet

1. Open **`http://localhost:8080/releases/1.3/`** in your browser.
2. In the top-right navigation bar, verify the green **OBS Synced** indicator is visible.
3. Click **Load from File** on the **Home** page to import an `.openlifter` meet file (or set up your own meet under **Meet Setup** → **Registration** → **Weigh-ins**), then switch to the **Lifting** tab.

### 3. Preview the Overlay in a Browser or Local OBS

- **Browser Preview:** Click **Open OBS Overlay ↗** in the top navbar (or visit **`http://localhost:8080/overlay`**).
  - Use the top preview bar to toggle between **Lower-Third Only**, **Full Flight Board**, **Both**, or **Toggle Test Backdrop**.
  - Click **Good Lift** or **No Lift** in OpenLifter and watch the overlay update in real time.
- **Local OBS Studio Test:**
  1. Open OBS Studio on your Mac.
  2. Under **Sources**, click **`+`** → **Browser**.
  3. Set the following properties:
     - **URL:** `http://localhost:8080/overlay`
     - **Width:** `1920`
     - **Height:** `1080`
  4. Click **OK**. (Inside OBS, the preview toolbar and test background automatically hide so the overlay is 100% transparent over your camera/video source.)

---

## Part 2: Live Competition Setup (Mac + Windows PC)

On competition day, the **Mac** runs OpenLifter and `server.js`, while the **Windows PC** runs OBS Studio and pulls the overlay over the local network.

### 1. Connect Both Computers to the Same Local Network

- **Recommended (Most Reliable):** Plug both the Mac and the Windows PC into a small Gigabit Ethernet switch or dedicated local Wi-Fi router at the score table (internet access is not required for the overlay to work—only a shared local network).
- **Venue Wi-Fi:** Connect both the Mac and the Windows PC to the same Wi-Fi network. *(Ensure the Wi-Fi network is not a "Guest" network with client isolation enabled.)*

### 2. Start the Server on the Mac

1. On the Mac, open Terminal in this directory and run:
   ```bash
   node server.js
   ```
2. Note the **Windows PC LAN URL** printed in the terminal (for example, `http://192.168.1.41:8080/overlay`).
3. Open **`http://localhost:8080/releases/1.3/`** in Chrome on the Mac.
   > **Important:** Always use OpenLifter via `http://localhost:8080/releases/1.3/` on the Mac (not `openlifter.com`), because the bridge script is served from `localhost:8080`.
4. If the Mac is also feeding a venue projector/TV, drag the OpenLifter browser window to the projector display (or mirror displays) and press **Toggle Fullscreen** on the Lifting page.

### 3. Configure OBS Studio on the Windows PC

Recommend setting up two scenes in OBS on the Windows PC so the stream operator can switch between live attempts and between-flight standings:

#### Scene A: Live Platform Camera + Lower-Third
1. Add your **Video Capture Device** (platform camera) and audio inputs.
2. Click **`+`** under **Sources** → **Browser** and name it `Scoreboard Lower-Third`.
3. Configure the Browser Source:
   - **URL:** `http://<MAC-IP>:8080/overlay?mode=lower-third&clean=1` *(replace `<MAC-IP>` with the IP printed by `node server.js`)*
   - **Width:** `1920`
   - **Height:** `1080`
   - Check **Refresh browser when scene becomes active** (optional safety fallback).

#### Scene B: Full-Screen Flight Standings / Attempt Board
1. Duplicate or add your camera source (optional background).
2. Click **`+`** under **Sources** → **Browser** and name it `Flight Standings Board`.
3. Configure the Browser Source:
   - **URL:** `http://<MAC-IP>:8080/overlay?mode=board&clean=1`
   - **Width:** `1920`
   - **Height:** `1080`

---

## Overlay URL Parameters Reference

You can customize how `/overlay` renders using URL query parameters:

| URL | Description |
| :--- | :--- |
| `http://<ip>:8080/overlay` | Default Lower-Third view (auto-hides toolbar inside OBS) |
| `http://<ip>:8080/overlay?mode=lower-third&clean=1` | Broadcast Lower-Third banner only (toolbar & backdrop hidden) |
| `http://<ip>:8080/overlay?mode=board&clean=1` | Full Flight Lifting Order & Standings table only |
| `http://<ip>:8080/overlay?mode=both&clean=1` | Both the Flight Board and Lower-Third simultaneously |

---

## Troubleshooting & Competition Day Tips

- **Windows PC cannot reach `http://<MAC-IP>:8080/overlay`:**
  1. Test opening `http://<MAC-IP>:8080/overlay` in Chrome/Edge on the Windows PC first.
  2. Check **System Settings → Network → Firewall** on the Mac: either turn the firewall off on the local network or allow incoming connections for `node`.
  3. Verify both machines are on the same subnet (e.g., `192.168.1.x`) and not on an isolated Guest Wi-Fi network.
- **OBS Overlay is stuck on "Waiting for Lifter...":**
  - Ensure OpenLifter is open at `http://localhost:8080/releases/1.3/` on the Mac and that the green **OBS Synced** pill appears in the top navbar.
  - Ensure the active **Day**, **Platform**, and **Flight** selected at the bottom of OpenLifter's **Lifting** page match the flight that has lifters assigned to it.
- **Backing up competition data:**
  - OpenLifter allows you to export/import `.opl` JSON backups and `.csv` results at any time from the **Home** and **Results** tabs. Export a backup after Weigh-ins and after each flight.
