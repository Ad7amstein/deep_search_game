# Deep Search Challenge

An interactive workshop game that teaches AI interns how a **Deep Search agent pipeline** works — by making them *be* the pipeline.

Each team is one sequential AI workflow. Each player is one agent:

```
Planner  →  Searcher  →  Validator  →  Reporter
```

Every agent sees **only** its own instructions and the output of the agent immediately before it. Nobody can skip ahead. The whole team shares one timer.

Pure HTML, CSS and vanilla JavaScript. No framework, no build step, no backend, no database.

---

## Running it

### Recommended: any static server

```bash
python -m http.server 8000
# then open http://localhost:8000
```

Or deploy the folder as-is to GitHub Pages, Netlify, S3 — anything that serves static files.

### Opening `index.html` directly

Browsers block `fetch()` on `file://` URLs, so `game-data.json` cannot be read automatically. The app detects this and shows a **"Select game-data.json"** file picker on the boot screen — choose the file and the game starts normally. Serving over HTTP avoids the extra click.

---

## How a session runs

1. **Admin** clicks *Create Session*, sets the number of teams, max players per team (default 4) and duration (default 5 minutes), then assigns a research request to each team.
2. **Players** click *Join Session*, enter a name, and pick a team. A team that already has four players is refused with *"Sorry! This team already has four autonomous agents 🤖"*.
3. Inside a team each player claims **one** role. Roles are exclusive — first come, first served.
4. Admin presses **Start Game**. One shared timer begins for everyone.
5. The Planner works first. On submit, their output becomes the Searcher's input, and so on down the chain. Agents who are not active see a waiting screen and their own agent briefing.
6. When the Reporter submits (or the timer expires, locking every input), players see a **"waiting for the host"** screen. Scores stay hidden — no per-stage feedback, no leaderboard — until the admin presses **📣 Release Results**, at which point every player's screen flips to their team's score, stars and breakdown.

### Playing across devices (online multiplayer)

Out of the box there is no server, so "multiplayer" means **one browser profile on one machine**: session state lives in `localStorage` and syncs across tabs via the `storage` event. That still suits the one-laptop-per-team workshop setup.

To let players join from **their own devices** (e.g. the GitHub Pages deployment), plug in a free Firebase Realtime Database:

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** (Analytics not needed).
2. In the project: **Build → Realtime Database → Create database** → start in **test mode** (or set rules to `{"rules": {"sessions": {".read": true, ".write": true}}}`).
3. **Project settings → General → Your apps → Web app (</>)** → register an app and copy the config object.
4. Paste it into the `window.FIREBASE_CONFIG = ...` block at the bottom of `index.html` (make sure it includes `databaseURL`), then redeploy.

With that in place, *Create Session* produces a short **session code**; the admin's *Player link* button shares a `?s=CODE` URL, and *Join Session* on another device asks for the code. All game state syncs live through Firebase. Without a config, the game silently falls back to the original same-browser behaviour.

Note: test-mode rules leave the database publicly writable — fine for a workshop game with throwaway data, not for anything sensitive.

---

## Scoring

| Stage | Points |
|---|---|
| Planner | 25 |
| Searcher | 25 |
| Validator | 25 |
| Reporter | 25 |
| **Base total** | **100** |

- **Hits** — each correct option selected earns its share of the 25.
- **Penalty** — each wrong (distractor) pick subtracts `0.75` of a correct pick's value. A stage never drops below 0.
- **Ordering** — stages listed in `scoring.orderedStages` (Planner and Reporter) are scored on sequence too. Order accuracy is the longest common subsequence against the ideal sequence, and scales the stage between 75% and 100% of what was earned.
- **Speed bonus** — up to `+10`, proportional to time remaining, awarded only to teams that finish. Final score is clamped to 100.
- **Stars** — 3 at ≥90, 2 at ≥70, 1 at ≥45.

All of these knobs live in `settings.scoring` in `game-data.json`.

---

## Files

```
index.html        Screen markup and the app shell
style.css         Design tokens + all styling
script.js         Game logic (see module map at the top of the file)
game-data.json    Every question, option, role and setting
README.md         This file
```

`script.js` is organised into commented modules, in dependency order:

| Module | Responsibility |
|---|---|
| `Utils` | Pure helpers — escaping, clamping, seeded RNG, LCS, clock formatting |
| `FX` | Toasts, confetti, random flavour text |
| `DataLoader` | Fetches, validates and indexes `game-data.json` |
| `Store` | Session state, `localStorage` persistence, cross-tab sync |
| `Identity` | Who this browser is (player record / admin flag) |
| `Engine` | Pipeline rules — whose turn it is, what each role may see |
| `Scoring` | Stage scoring, time bonus, stars, leaderboard |
| `Timer` | One shared clock derived from `session.startedAt` |
| `Views` | Pure render functions returning HTML strings |
| `App` | Routing, event wiring, bootstrap |

Nothing about the game — no question, plan step, source, criterion, section or role — is hardcoded in JavaScript. `script.js` only knows the *shape* of the data.

---

## Editing the game content

Everything is in `game-data.json`.

### Adding a research request

Add an object to `researchRequests`. It references option IDs from the shared pools:

```json
{
  "id": "req_example",
  "question": "Should offices ban internal email?",
  "context": "One line of framing shown to the Planner only.",
  "difficulty": "medium",
  "correctPlan":       ["p_topic", "p_questions", "p_quant", "p_viewpoints"],
  "correctSources":    ["s_paper", "s_stats", "s_expert", "s_ngo"],
  "correctValidation": ["v_relevant", "v_method", "v_data", "v_neutral"],
  "correctReport":     ["r_summary", "r_findings", "r_analysis", "r_conclusion", "r_sources"]
}
```

`correctPlan` and `correctReport` are **ordered** — the array order is the ideal search sequence / report structure.

Ships with **20 requests** covering sports refereeing, flat-earth claims, public figures, corporate research, EV policy, the Titanic, climate change, DeepSeek vs ChatGPT, the EU AI Act, the four-day workweek, remote work, vaccine safety, crypto regulation, the GERD dam, coffee and health, AI and jobs, language choice, Mars, teen social media, and green hydrogen.

### Adding an option

Append to `plannerSteps`, `sources`, `validationCriteria` or `reportSections`. Mark bad options with `"trap": true` so they read as distractors — any option not listed in a request's `correct*` array is scored as wrong if selected.

Each stage shows `settings.cardsPerStage` cards: every correct option, topped up with distractors. The mix is shuffled with a **seeded** PRNG keyed on team + role, so the layout is stable across re-renders and reloads but differs between teams.

### Tuning the run

```json
"settings": {
  "defaultTeams": 4,
  "maxPlayersPerTeam": 4,
  "defaultDurationMinutes": 5,
  "cardsPerStage": 12
}
```

Admins can override teams, players and duration per session in the setup screen.

---

## Design

Modern AI control center — cards, soft shadows, rounded corners, a glowing pipeline that turns green as stages complete, and a large shared timer that shifts amber then red as it runs down.

| Token | Value |
|---|---|
| Primary | `#C00000` |
| White | `#FFFFFF` |
| Black | `#000000` |
| Gray | `#6C6C6C` |

Lighter and darker variants of each are defined as CSS custom properties at the top of `style.css`. Desktop first, usable down to mobile, and it honours `prefers-reduced-motion`.

---

## Facilitator notes

- **Four laptops, four teams** works better than one big group — teams race the same clock.
- **5 minutes is tight on purpose.** It forces the Planner to commit rather than deliberate.
- The best teaching moment is the handoff: the Validator can see the Searcher picked a Reddit thread, but cannot go back and fix it. Bad upstream output propagates. That is the lesson.
- Run a second round with `Shuffle requests` and swapped roles so everyone plays more than one agent.
