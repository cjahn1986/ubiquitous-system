# Ubiquitous System — Beta 1

A small workshop for seeing the structure under things and putting it to use.
Everything runs in your browser on open, keyless data. Nothing is sent anywhere
except the public APIs; your tracked concepts live only in your browser.

## Run it (pick one)

1. **Live URL (if GitHub Pages is on):** `https://cjahn1986.github.io/ubiquitous-system/`
   — full experience: installable + offline, all knowledge sources reachable.
2. **Local server (most reliable):**
   ```bash
   git clone https://github.com/cjahn1986/ubiquitous-system
   cd ubiquitous-system/tools && python3 -m http.server 8000
   ```
   then open `http://localhost:8000/`. (A served origin is required for install/offline.)
3. **Just a file:** download `tools/index.html` and open it. Works, but no install/offline,
   and some browsers block cross-site API calls from `file://`.

## Install as an app
On the live URL or local server, your browser offers **Install** (desktop) or
**Add to Home Screen** (mobile). After first load it works **offline** (the knowledge
lookups need a connection; the tools themselves don't).

## What to beta-test

**Pattern Tracker** (`pattern-tracker.html`)
- Click "Load example data" — trends, a ~weekly cycle, a sleep↔mood correlation, and an
  anomaly should appear under "Patterns found".
- Add your own metric; log a few entries; or import a CSV of real data.
- Check the honesty: cycles/correlations carry a p-value, and correlation is flagged
  "worth investigating", never "X causes Y".

**Node Explorer** (`node-explorer.html`) — the heart of it
- Enter a concept (or 🎲 Surprise). **Tell me which of the four source chips turn green.**
- Node graph: click a node to travel to it.
- Variable Uses → **Theoretic**: these are now **ranked by analogy strength (0–100)** with a
  "why" and a bar. Does the top-ranked analogy feel like the *best* one? (Try "Slime mold" —
  it should favor transport-network / routing, the real-world result.)
- Each theoretic use has a **📚 "who's working where these meet?"** link to the literature.

**Decision Matrix** (`decision-matrix.html`)
- "Load roadmap example", then edit weights/scores. Does the winner + the robust/fragile call
  make sense?

**Hub** (`index.html`)
- Tracked concepts shared across tools; **Export / Import JSON** round-trips cleanly?

## Known limitations (honest)
- The analogy ranker is a **transparent heuristic**, not an oracle — it scores "test this first,"
  never "this is true." Theoretic uses are prompts, not facts.
- Knowledge sources can rate-limit or momentarily fail; a red chip means that source was
  unreachable, and the app keeps working on the rest.
- Learning model is a simplified FSRS-style approximation; good for intuition, not clinical.

## Feedback that helps most
1. Which source chips were green/red, and on what concept?
2. A theoretic ranking that felt wrong (concept + what it put on top).
3. Anything that broke, on which browser/OS.
4. The one thing that would make this genuinely useful to you.
