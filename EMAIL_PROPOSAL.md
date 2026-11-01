Subject: Proposal: Live Scoring & Stream Overlay Setup for the Powerlifting Competition (OpenLifter + OBS)

Hi everyone,

Ahead of the upcoming competition, I wanted to share a proposed setup for connecting our **scoring computer (Mac running OpenLifter)** to our **live-streaming computer (Windows PC running OBS Studio)**, and get your feedback on the layout and venue setup.

### 1. The Challenge
We are using **OpenLifter** on a Mac at the score table to run the meet, and **OBS Studio** on a separate Windows PC to produce the live stream. 

Out of the box, OpenLifter is designed as a standalone, single-computer program—it saves all scores inside the Mac’s web browser and doesn't have a built-in way to send live data to a second computer. Simply capturing the scorekeeper's screen also has a drawback: whenever the score table scrolls, switches tabs, or edits a lifter's rack heights/attempts, those behind-the-scenes edits would flash on the live stream.

### 2. Our Proposed Solution: A Lightweight "Live Score Bridge"
To give viewers a clean, TV-style broadcast graphic without disrupting the scorekeeper, we have built a small local helper server ([`server.js`](./server.js)) that runs on the scoring Mac alongside OpenLifter:

* **How OpenLifter is used:** We downloaded the official OpenLifter source repository and run its pre-built release (`v1.3`) directly from the Mac. We did **not** change how OpenLifter calculates scores, lifting order, or exports final meet results—the scorekeeper uses OpenLifter in their browser exactly as normal.
* **How the Server captures scores:** As our local server delivers the OpenLifter page to the Mac's browser, it attaches a small background listener. Every time the scorekeeper clicks *Good Lift*, *No Lift*, or enters a next attempt, OpenLifter saves that change to the browser's memory, and our listener immediately forwards a copy of the current competition state to the local server on the Mac.
* **How OBS on the Windows PC gets the results:** The local server hosts a custom, transparent webpage (`/overlay`) on the local network. On the Windows streaming PC, OBS Studio loads that webpage URL using a standard **OBS Browser Source**. Whenever a score changes on the Mac, the overlay inside OBS updates automatically in a fraction of a second.

### 3. Competition Day Hardware & Networking Setup
Here is what the physical setup looks like at the venue:

1. **The Scoring Mac:**
   * Runs OpenLifter for the table crew.
   * Can still plug into the **venue projector or TV via HDMI** as normal so the audience and loaders can see the full OpenLifter screen.
2. **The Streaming Windows PC:**
   * Runs OBS Studio, connected to the platform camera(s) and commentary/venue microphones.
3. **Connecting the Mac and Windows PC (Local Network):**
   * Both computers simply need to be on the **same local network**.
   * **Best Option (Recommended):** We bring a small $20 Ethernet switch (or a dedicated travel Wi-Fi router) and plug both the Mac and Windows PC into it at the score table. This guarantees instant, rock-solid updates between the two computers even if the venue's internet drops out.
   * **Alternative Option:** Both computers connect to the same venue Wi-Fi network.

### 4. What Viewers See on the Live Stream
We have set up two broadcast views that the OBS operator can switch between at any time:
* **During Lifts (Lower-Third Banner):** A clean bar along the bottom of the camera feed showing the **Current Lifter**, **Team/Weight Class/Bodyweight**, **Rack Height**, **1st/2nd/3rd Attempt status (Green/Red)**, **Best Squat/Bench/Deadlift & Running Total**, **Bar Weight (kg & lbs)** with a color-coded plate graphic, and who is **On Deck (Next Up)**.
* **Between Flights / Warmups (Full Flight Board):** A full-screen scoreboard showing the entire flight's lifting order, attempts, and current totals.

---

### Frequently Asked Questions (FAQ)

**Q: Does the scorekeeper have to learn new software or click extra buttons to update the stream?**
**A:** No. The scorekeeper uses standard OpenLifter. Every action they take in OpenLifter automatically updates the stream overlay in the background.

**Q: What happens on the stream when the scorekeeper switches tabs or edits weigh-ins/rack heights?**
**A:** Nothing disruptive! Because the OBS overlay reads the underlying competition data rather than recording the Mac's screen, the scorekeeper can freely switch to Registration, Weigh-ins, or the Edit screen while the live stream stays cleanly locked on the current lifter on the platform.

**Q: What if the venue's internet goes down during the meet?**
**A:** OpenLifter and the overlay sync run 100% over the local network between the Mac and the Windows PC. Even with zero internet, OpenLifter and the OBS overlay will continue working normally (which is also great if we are recording the stream locally to disk as a backup).

**Q: Can we still export the official OpenPowerlifting CSV and backup files at the end of the meet?**
**A:** Yes, 100%. Because this runs unmodified OpenLifter 1.3 under the hood, all standard `.opl` backups and final `.csv` result exports work identically.

**Q: What if the Windows PC is far away from the scoring Mac?**
**A:** As long as both computers are on the same Wi-Fi network (or connected via a long Ethernet cable/router), they don't need to sit right next to each other.

---

### Request for Comments & Next Steps
We currently have this running in a test environment with a simulated flight of lifters and would love your feedback before we lock it in for competition day:

1. **Venue Layout & Networking:** How far apart will the scoring table (Mac) and streaming station (Windows PC) be positioned? Do we have an Ethernet switch/router available, or will we rely on venue Wi-Fi?
2. **Overlay Information:** Are there any specific details you want added, removed, or emphasized on the stream graphic (e.g., club/sponsor logos, IPF/Dots points, federation branding, or specific colors)?
3. **OBS Scenes:** Aside from the *Live Platform + Lower-Third* view and the *Between-Flights Scoreboard* view, are there any other screens you would like for the broadcast?

Please reply with your thoughts, questions, or any adjustments you'd like to see—happy to do a quick live screen-share demo of the setup this week!

Best regards,
[Your Name]
