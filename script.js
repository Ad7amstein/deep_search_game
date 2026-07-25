/* ==========================================================================
   DEEP SEARCH CHALLENGE
   A frontend-only workshop game simulating a sequential AI agent pipeline.

   Module map (in order of appearance):
     1.  Utils          — small pure helpers
     2.  FX             — toasts, confetti, loading copy
     3.  DataLoader     — loads and validates game-data.json
     3b. Net            — optional Firebase Realtime Database sync
     4.  Store          — session state, persistence, cross-tab sync
     5.  Identity       — who *this* browser is (player / admin)
     6.  Engine         — pipeline rules: whose turn is it, what may they see
     7.  Scoring        — per-stage scoring, time bonus, stars
     8.  Timer          — one shared clock, driven off the session start time
     9.  Views          — pure render functions returning HTML strings
     10. App            — routing, event wiring, bootstrap

   No framework, no build step. State lives in localStorage; when a Firebase
   config is present (see index.html) sessions also sync across devices
   through Realtime Database, keyed by a short session code.
   ========================================================================== */
(function () {
  'use strict';

  /* ======================================================================
     1. UTILS
     ====================================================================== */
  const Utils = {
    $: (sel, root) => (root || document).querySelector(sel),
    $$: (sel, root) => Array.from((root || document).querySelectorAll(sel)),

    /** Escape untrusted strings before interpolating into HTML. */
    esc(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));
    },

    uid(prefix) {
      return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 9);
    },

    /** Short human-typeable session code (no ambiguous 0/O/1/I/L). */
    sessionCode() {
      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      let out = '';
      for (let i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)];
      return out;
    },

    clamp(n, min, max) {
      return Math.min(max, Math.max(min, n));
    },

    /** Deterministic 32-bit string hash — used to seed reproducible shuffles. */
    hash(str) {
      let h = 2166136261;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    },

    /** Mulberry32 PRNG. Same seed => same sequence => same card layout. */
    rng(seed) {
      let a = seed >>> 0;
      return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },

    /** Fisher-Yates using a supplied PRNG so results are reproducible. */
    shuffle(list, rand) {
      const out = list.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },

    pick(list, rand) {
      return list[Math.floor((rand || Math.random)() * list.length)];
    },

    formatClock(ms) {
      const total = Math.max(0, Math.ceil(ms / 1000));
      const m = Math.floor(total / 60);
      const s = total % 60;
      return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    },

    formatDuration(ms) {
      const total = Math.max(0, Math.round(ms / 1000));
      const m = Math.floor(total / 60);
      const s = total % 60;
      return m > 0 ? `${m}m ${s}s` : `${s}s`;
    },

    /** Length of the longest common subsequence — used to score ordering. */
    lcsLength(a, b) {
      const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
      for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
          table[i][j] = a[i - 1] === b[j - 1]
            ? table[i - 1][j - 1] + 1
            : Math.max(table[i - 1][j], table[i][j - 1]);
        }
      }
      return table[a.length][b.length];
    }
  };

  const { $, $$, esc } = Utils;

  /* ======================================================================
     2. FX — toasts, confetti, flavour text
     ====================================================================== */
  const FX = {
    toast(message, kind) {
      const stack = $('#toastStack');
      if (!stack) return;
      const node = document.createElement('div');
      node.className = 'toast' + (kind ? ' toast--' + kind : '');
      node.innerHTML = esc(message);
      stack.appendChild(node);
      setTimeout(() => {
        node.classList.add('is-out');
        node.addEventListener('animationend', () => node.remove(), { once: true });
      }, 3200);
    },

    confetti(durationMs) {
      const canvas = $('#confetti');
      if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const resize = () => {
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      resize();

      const colors = ['#c00000', '#e85c5c', '#1aa583', '#f5b8b8', '#2a2a2d', '#d98b1f'];
      const parts = Array.from({ length: 140 }, () => ({
        x: Math.random() * window.innerWidth,
        y: -20 - Math.random() * window.innerHeight * 0.5,
        w: 6 + Math.random() * 7,
        h: 8 + Math.random() * 10,
        vy: 2 + Math.random() * 3.4,
        vx: -1.4 + Math.random() * 2.8,
        rot: Math.random() * Math.PI,
        vr: -0.14 + Math.random() * 0.28,
        color: colors[Math.floor(Math.random() * colors.length)]
      }));

      const stopAt = Date.now() + (durationMs || 3000);
      (function frame() {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        parts.forEach((p) => {
          p.x += p.vx;
          p.y += p.vy;
          p.rot += p.vr;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        });
        if (Date.now() < stopAt) {
          requestAnimationFrame(frame);
        } else {
          ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        }
      })();
    },

    randomLoadingMessage() {
      const list = (DataLoader.data && DataLoader.data.loadingMessages) || ['Working...'];
      return Utils.pick(list, Math.random);
    }
  };

  /* ======================================================================
     3. DATA LOADER
     ====================================================================== */
  const DataLoader = {
    data: null,

    /** Indexes built once so lookups elsewhere are O(1). */
    index: { roles: {}, plannerSteps: {}, sources: {}, validationCriteria: {}, reportSections: {}, requests: {} },

    async load() {
      const response = await fetch('game-data.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return this.ingest(await response.json());
    },

    ingest(json) {
      const required = ['settings', 'roles', 'researchRequests', 'plannerSteps', 'sources', 'validationCriteria', 'reportSections'];
      const missing = required.filter((key) => !json || !json[key]);
      if (missing.length) throw new Error('game-data.json is missing: ' + missing.join(', '));

      this.data = json;
      this.data.roles.sort((a, b) => a.order - b.order);

      const build = (list) => list.reduce((map, item) => (map[item.id] = item, map), {});
      this.index.roles = build(json.roles);
      this.index.plannerSteps = build(json.plannerSteps);
      this.index.sources = build(json.sources);
      this.index.validationCriteria = build(json.validationCriteria);
      this.index.reportSections = build(json.reportSections);
      this.index.requests = build(json.researchRequests);
      return this.data;
    },

    /** The option pool a given role selects from. */
    poolFor(roleId) {
      return {
        planner: this.data.plannerSteps,
        searcher: this.data.sources,
        validator: this.data.validationCriteria,
        reporter: this.data.reportSections
      }[roleId] || [];
    },

    /** The `correct*` key on a research request for a given role. */
    answerKeyFor(roleId) {
      return { planner: 'correctPlan', reporter: 'correctReport' }[roleId];
    },

    optionById(roleId, id) {
      return this.poolFor(roleId).find((item) => item.id === id) || { id, label: id, icon: '•' };
    },

    role(id) { return this.index.roles[id]; },
    request(id) { return this.index.requests[id]; },
    roleIds() { return this.data.roles.map((r) => r.id); }
  };

  /* ======================================================================
     3b. NET — optional Firebase Realtime Database sync.
     Enabled only when index.html defines window.FIREBASE_CONFIG and the SDK
     loaded. Without it the game keeps its original same-browser behaviour.
     ====================================================================== */
  const Net = {
    enabled: false,
    db: null,
    ref: null,   // the ref of the session this browser is attached to

    init() {
      const cfg = window.FIREBASE_CONFIG;
      if (!window.firebase || !cfg || !cfg.databaseURL) return false;
      try {
        firebase.initializeApp(cfg);
        this.db = firebase.database();
        this.enabled = true;
      } catch (err) {
        console.warn('Firebase init failed — staying offline:', err);
      }
      return this.enabled;
    },

    cleanCode(code) {
      return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    },

    /** Follow a session: every remote change flows into Store.receive. */
    attach(code) {
      if (!this.enabled) return;
      code = this.cleanCode(code);
      if (!code) return;
      this.detach();
      this.ref = this.db.ref('sessions/' + code);
      try { localStorage.setItem(Store.CODE_KEY, code); } catch (err) { /* ignore */ }
      this.ref.on('value', (snap) => Store.receive(snap.val()));
    },

    detach() {
      if (this.ref) this.ref.off();
      this.ref = null;
    },

    /** One-shot lookup used before attaching to a code a player typed. */
    peek(code) {
      return this.db.ref('sessions/' + this.cleanCode(code)).once('value')
        .then((snap) => snap.val());
    }
  };

  /* ======================================================================
     4. STORE — session state + persistence + cross-tab sync
     ====================================================================== */
  const Store = {
    KEY: 'dsc:session:v1',
    CODE_KEY: 'dsc:code:v1',
    session: null,
    listeners: [],

    subscribe(fn) { this.listeners.push(fn); },
    emit() { this.listeners.forEach((fn) => fn(this.session)); },

    read() {
      try {
        const raw = localStorage.getItem(this.KEY);
        this.session = raw ? JSON.parse(raw) : null;
      } catch (err) {
        console.warn('Could not read session:', err);
        this.session = null;
      }
      return this.session;
    },

    /** Persist and notify this tab. Other tabs react via the `storage` event. */
    write(session) {
      this.session = session;
      try {
        localStorage.setItem(this.KEY, JSON.stringify(session));
      } catch (err) {
        FX.toast('Storage is full or blocked — progress may not persist.', 'err');
      }
      if (Net.ref) {
        Net.ref.set(session).catch(() => FX.toast('Sync failed — check your connection.', 'err'));
      }
      this.emit();
    },

    /** A remote snapshot arrived (or the session was deleted remotely). */
    receive(remote) {
      if (remote) {
        this.session = this.normalize(remote);
        try { localStorage.setItem(this.KEY, JSON.stringify(this.session)); } catch (err) { /* ignore */ }
      } else {
        this.session = null;
        try {
          localStorage.removeItem(this.KEY);
          localStorage.removeItem(this.CODE_KEY);
        } catch (err) { /* ignore */ }
      }
      this.emit();
    },

    /** Firebase strips nulls and empty arrays — reinstate the expected shape. */
    normalize(session) {
      if (!session) return session;
      (session.teams = session.teams || []).forEach((team) => {
        team.players = team.players || [];
        team.players.forEach((p) => { if (p.role === undefined) p.role = null; });
        team.stages = team.stages || {};
        DataLoader.roleIds().forEach((roleId) => {
          const stage = team.stages[roleId] = team.stages[roleId] || {};
          if (!stage.selection) stage.selection = [];
          if (stage.submittedAt === undefined) stage.submittedAt = null;
          if (stage.score === undefined) stage.score = 0;
          if (stage.detail === undefined) stage.detail = null;
        });
      });
      return session;
    },

    /** Read-modify-write helper. Always re-reads first to reduce tab races. */
    update(mutator) {
      const session = this.read();
      if (!session) return null;
      mutator(session);
      session.updatedAt = Date.now();
      if (Net.ref) {
        // Optimistic local apply; the transaction echo below is canonical.
        this.session = session;
        try { localStorage.setItem(this.KEY, JSON.stringify(session)); } catch (err) { /* ignore */ }
        this.emit();
        Net.ref.transaction((current) => {
          if (!current) return;               // session was deleted remotely
          const full = this.normalize(current);
          mutator(full);
          full.updatedAt = Date.now();
          return full;
        }).catch(() => FX.toast('Sync failed — check your connection.', 'err'));
      } else {
        this.write(session);
      }
      return session;
    },

    clear() {
      if (Net.ref) Net.ref.remove();
      Net.detach();
      try {
        localStorage.removeItem(this.KEY);
        localStorage.removeItem(this.CODE_KEY);
      } catch (err) { /* ignore */ }
      this.session = null;
      this.emit();
    },

    createSession(config) {
      const roleIds = DataLoader.roleIds();
      const session = {
        id: Utils.uid('sess'),
        code: Utils.sessionCode(),
        status: 'lobby',
        resultsReleasedAt: null,
        createdAt: Date.now(),
        startedAt: null,
        endedAt: null,
        maxPlayers: config.maxPlayers,
        durationMs: config.durationMinutes * 60 * 1000,
        teams: config.teams.map((team, i) => ({
          id: 'team_' + i,
          name: team.name,
          requestId: team.requestId,
          players: [],
          stages: roleIds.reduce((acc, roleId) => {
            acc[roleId] = { selection: [], submittedAt: null, score: 0, detail: null };
            return acc;
          }, {}),
          finishedAt: null,
          finalScore: null
        }))
      };
      if (Net.enabled) Net.attach(session.code);
      this.write(session);
      return session;
    },

    team(teamId) {
      return this.session ? this.session.teams.find((t) => t.id === teamId) : null;
    }
  };

  /* ======================================================================
     5. IDENTITY — this browser's player record / admin flag
     ====================================================================== */
  const Identity = {
    KEY: 'dsc:me:v1',
    ADMIN_KEY: 'dsc:admin:v1',
    me: null,

    load() {
      try {
        this.me = JSON.parse(localStorage.getItem(this.KEY) || 'null');
      } catch (err) {
        this.me = null;
      }
      return this.me;
    },

    save(me) {
      this.me = me;
      localStorage.setItem(this.KEY, JSON.stringify(me));
    },

    clear() {
      this.me = null;
      localStorage.removeItem(this.KEY);
    },

    isAdmin() { return localStorage.getItem(this.ADMIN_KEY) === '1'; },
    setAdmin(on) { on ? localStorage.setItem(this.ADMIN_KEY, '1') : localStorage.removeItem(this.ADMIN_KEY); },

    /** The live player record inside the session (identity alone can go stale). */
    record() {
      if (!this.me || !Store.session) return null;
      const team = Store.team(this.me.teamId);
      if (!team) return null;
      return team.players.find((p) => p.id === this.me.id) || null;
    },

    team() {
      return this.me && Store.session ? Store.team(this.me.teamId) : null;
    }
  };

  /* ======================================================================
     6. ENGINE — pipeline rules
     ====================================================================== */
  const Engine = {
    /** The role whose turn it currently is, or null when the team is done. */
    currentRole(team) {
      return DataLoader.roleIds().find((roleId) => !team.stages[roleId].submittedAt) || null;
    },

    stageStatus(team, roleId) {
      if (team.stages[roleId].submittedAt) return 'done';
      return this.currentRole(team) === roleId ? 'active' : 'locked';
    },

    isTeamComplete(team) {
      return this.currentRole(team) === null;
    },

    completionPercent(team) {
      const ids = DataLoader.roleIds();
      const done = ids.filter((id) => team.stages[id].submittedAt).length;
      return Math.round((done / ids.length) * 100);
    },

    roleTaken(team, roleId) {
      return team.players.some((p) => p.role === roleId);
    },

    playerInRole(team, roleId) {
      return team.players.find((p) => p.role === roleId) || null;
    },

    /**
     * VISIBILITY RULE: an agent may see only the output of the agent
     * immediately before it. The Planner sees the research question only.
     */
    inboxFor(team, roleId) {
      const request = DataLoader.request(team.requestId);
      const ids = DataLoader.roleIds();
      const previousRoleId = ids[ids.indexOf(roleId) - 1];

      if (!previousRoleId) {
        return { kind: 'question', question: request.question, context: request.context, items: [] };
      }
      const previous = team.stages[previousRoleId];
      return {
        kind: 'handoff',
        fromRole: DataLoader.role(previousRoleId),
        // selection is stored in pick order, which for an ordered stage is the answer.
        ordered: this.isOrdered(previousRoleId),
        items: previous.selection.map((id) => DataLoader.optionById(previousRoleId, id))
      };
    },

    /** Stages whose answer key is derived from the stage before, not authored. */
    DERIVED_FROM: { searcher: 'planner', validator: 'searcher' },

    /**
     * The answer key for a stage. A derived stage's key is the union of what
     * the upstream picks `implies`, so the handoff alone is always enough to
     * work out the answer — which matters because nobody downstream of the
     * Planner ever sees the research question.
     */
    correctIdsFor(team, roleId) {
      const from = this.DERIVED_FROM[roleId];
      if (!from) return DataLoader.request(team.requestId)[DataLoader.answerKeyFor(roleId)];

      const upstream = team.stages[from].selection;
      return DataLoader.poolFor(roleId)
        .filter((opt) => upstream.some((id) => (DataLoader.optionById(from, id).implies || []).includes(opt.id)))
        .map((opt) => opt.id);
    },

    /**
     * Build the selectable card set for a stage: every correct option plus
     * enough distractors to reach `cardsPerStage`. Seeded by team + role so
     * the layout is stable across re-renders and reloads.
     */
    cardsFor(team, roleId) {
      const pool = DataLoader.poolFor(roleId);
      const correctIds = this.correctIdsFor(team, roleId);
      const target = DataLoader.data.settings.cardsPerStage;

      const correct = pool.filter((opt) => correctIds.includes(opt.id));
      const others = pool.filter((opt) => !correctIds.includes(opt.id));

      const rand = Utils.rng(Utils.hash(team.requestId + ':' + roleId + ':' + team.id));
      const fillCount = Math.max(0, target - correct.length);
      const distractors = Utils.shuffle(others, rand).slice(0, fillCount);

      return Utils.shuffle(correct.concat(distractors), rand);
    },

    /** Stages whose answer key is a sequence, not just a set. */
    isOrdered(roleId) {
      return DataLoader.data.settings.scoring.orderedStages.includes(roleId);
    }
  };

  /* ======================================================================
     7. SCORING
     ====================================================================== */
  const Scoring = {
    get config() { return DataLoader.data.settings.scoring; },

    /**
     * Score one stage.
     *   hits    — correct options selected
     *   misses  — correct options not selected
     *   wrong   — distractors selected (penalised)
     * Ordered stages additionally earn/lose a quarter of the stage on sequence.
     */
    scoreStage(roleId, selection, correctIds) {
      const cfg = this.config;
      const hits = selection.filter((id) => correctIds.includes(id));
      const wrong = selection.filter((id) => !correctIds.includes(id));
      const missed = correctIds.filter((id) => !selection.includes(id));

      // A plan that calls for no sources at all leaves nothing to get right.
      if (correctIds.length === 0) {
        return { score: 0, max: cfg.pointsPerStage, hits: 0, wrong: selection.length, missed: 0,
                 total: 0, orderAccuracy: null, hitIds: [], wrongIds: selection, missedIds: [] };
      }
      const raw = (hits.length - wrong.length * cfg.wrongSelectionPenaltyWeight) / correctIds.length;
      let score = Utils.clamp(raw, 0, 1) * cfg.pointsPerStage;

      let orderAccuracy = null;
      if (Engine.isOrdered(roleId) && hits.length > 0) {
        const selectedInOrder = selection.filter((id) => correctIds.includes(id));
        orderAccuracy = Utils.lcsLength(selectedInOrder, correctIds) / correctIds.length;
        score = score * (0.75 + 0.25 * orderAccuracy);
      }

      return {
        score: Math.round(score * 10) / 10,
        max: cfg.pointsPerStage,
        hits: hits.length,
        wrong: wrong.length,
        missed: missed.length,
        total: correctIds.length,
        orderAccuracy,
        hitIds: hits,
        wrongIds: wrong,
        missedIds: missed
      };
    },

    /** Faster finishes earn up to `maxTimeBonus`, scaled by time remaining. */
    timeBonus(elapsedMs, durationMs) {
      const remaining = Utils.clamp(1 - elapsedMs / durationMs, 0, 1);
      return Math.round(this.config.maxTimeBonus * remaining * 10) / 10;
    },

    starsFor(score) {
      const tier = this.config.stars.find((t) => score >= t.min);
      return tier ? tier.stars : 0;
    },

    /** Roll up a team's stages into a final result object. */
    finalize(team, session) {
      const stageTotal = DataLoader.roleIds()
        .reduce((sum, roleId) => sum + (team.stages[roleId].score || 0), 0);

      const elapsedMs = (team.finishedAt || session.endedAt || Date.now()) - (session.startedAt || Date.now());
      const complete = Engine.isTeamComplete(team);
      const bonus = complete ? this.timeBonus(elapsedMs, session.durationMs) : 0;
      const total = Math.round(Utils.clamp(stageTotal + bonus, 0, this.config.maxScore) * 10) / 10;

      return {
        stageTotal: Math.round(stageTotal * 10) / 10,
        bonus,
        total,
        stars: this.starsFor(total),
        elapsedMs,
        complete
      };
    },

    /** Every team, best first. Used by both the admin and results screens. */
    leaderboard(session) {
      return session.teams
        .map((team) => Object.assign({ team }, this.finalize(team, session)))
        .sort((a, b) => b.total - a.total || a.elapsedMs - b.elapsedMs);
    }
  };

  /* ======================================================================
     8. TIMER — one shared clock derived from session.startedAt
     ====================================================================== */
  const Timer = {
    intervalId: null,
    onExpire: null,

    start(onExpire) {
      this.onExpire = onExpire;
      if (this.intervalId) return;
      this.intervalId = setInterval(() => this.tick(), 250);
      this.tick();
    },

    remainingMs() {
      const session = Store.session;
      if (!session || !session.startedAt) return session ? session.durationMs : 0;
      if (session.endedAt) return Math.max(0, session.startedAt + session.durationMs - session.endedAt);
      return Math.max(0, session.startedAt + session.durationMs - Date.now());
    },

    isExpired() {
      const session = Store.session;
      if (!session) return false;
      if (session.status === 'ended') return true;
      return session.status === 'running' && this.remainingMs() <= 0;
    },

    tick() {
      const session = Store.session;
      const wrap = $('#timer');
      const value = $('#timerValue');
      if (!wrap || !value) return;

      if (!session || session.status === 'lobby') {
        wrap.hidden = !session;
        if (session) value.textContent = Utils.formatClock(session.durationMs);
        wrap.className = 'timer';
        return;
      }

      wrap.hidden = false;
      const remaining = this.remainingMs();
      value.textContent = Utils.formatClock(remaining);

      const ratio = remaining / session.durationMs;
      wrap.className = 'timer'
        + (session.status === 'ended' || remaining <= 0 ? ' is-expired'
          : ratio <= 0.1 ? ' is-critical'
            : ratio <= 0.3 ? ' is-warning' : '');

      if (session.status === 'running' && remaining <= 0 && this.onExpire) {
        this.onExpire();
      }
    }
  };

  /* ======================================================================
     9. VIEWS — pure functions returning HTML strings
     ====================================================================== */
  const Views = {

    /* ---- shared fragments ---- */

    stars(count) {
      return '<div class="stars">' + [0, 1, 2]
        .map((i) => `<i class="${i < count ? '' : 'is-off'}">★</i>`)
        .join('') + '</div>';
    },

    starsInline(count) {
      return '★'.repeat(count) + '<span style="opacity:.22">' + '★'.repeat(3 - count) + '</span>';
    },

    /** The agent card used on the how-to, role-select and briefing screens. */
    agentCard(role, options) {
      const opts = options || {};
      const tag = opts.button ? 'button' : 'div';
      const attrs = opts.button
        ? ` type="button" data-action="pick-role" data-role="${esc(role.id)}"${opts.disabled ? ' disabled' : ''}`
        : '';
      const classes = 'agent-card' + (opts.featured ? ' agent-card--featured' : '');

      return `
        <${tag} class="${classes}"${attrs}>
          ${opts.takenBy ? `<span class="agent-card__taken">Taken · ${esc(opts.takenBy)}</span>` : ''}
          <div class="agent-card__top">
            <span class="agent-card__icon">${esc(role.icon)}</span>
            <span>
              <span class="agent-card__step">Stage ${role.order}</span>
              <div class="agent-card__name">${esc(role.name)}</div>
            </span>
          </div>
          <p class="agent-card__desc">${esc(role.description)}</p>
          ${opts.compact ? '' : `
            <div class="agent-card__specs">
              <div class="spec"><span class="spec__k">Goal</span><span>${esc(role.goal)}</span></div>
              <div class="spec"><span class="spec__k">Mission</span><span>${esc(role.mission)}</span></div>
              <div class="spec"><span class="spec__k">Input</span><span>${esc(role.input)}</span></div>
              <div class="spec"><span class="spec__k">Output</span><span>${esc(role.output)}</span></div>
            </div>`}
          <p class="agent-card__quote">“${esc(role.quote)}”</p>
        </${tag}>`;
    },

    waiting(title, message) {
      return `
        <div class="waiting">
          <div class="waiting__dots"><i></i><i></i><i></i></div>
          <div class="waiting__title">${esc(title)}</div>
          <p class="waiting__msg">${esc(message)}</p>
        </div>`;
    },

    /* ---- pipeline (topbar) ---- */

    pipeline(team) {
      return DataLoader.data.roles.map((role, i) => {
        const status = team ? Engine.stageStatus(team, role.id) : 'locked';
        const cls = team
          ? (status === 'done' ? 'is-done' : status === 'active' ? 'is-active' : 'is-locked')
          : '';
        return (i > 0 ? '<span class="pipe-arrow">→</span>' : '')
          + `<span class="pipe-node ${cls}">
               <span class="pipe-node__icon">${esc(role.icon)}</span>
               <span>${esc(role.name.replace(' Agent', ''))}</span>
               ${status === 'done' ? '<span>✓</span>' : ''}
             </span>`;
      }).join('');
    },

    heroPipeline() {
      return DataLoader.data.roles.map((role, i) => `
        <div class="hero-node" style="animation-delay:${i * 90}ms">
          <span class="hero-node__step">0${role.order}</span>
          <div class="hero-node__icon">${esc(role.icon)}</div>
          <div class="hero-node__name">${esc(role.name)}</div>
          <p class="hero-node__quote">“${esc(role.quote)}”</p>
        </div>`).join('');
    },

    /* ---- admin ---- */

    teamConfigRows(rows) {
      const requests = DataLoader.data.researchRequests;
      return rows.map((row, i) => `
        <div class="team-config__row">
          <span class="team-config__name">${esc(row.name)}</span>
          <select class="select" data-team-index="${i}">
            ${requests.map((req) => `
              <option value="${esc(req.id)}"${req.id === row.requestId ? ' selected' : ''}>
                ${esc(req.question)}
              </option>`).join('')}
          </select>
          <span class="team-config__diff" style="color:${
            { easy: 'var(--green-600)', medium: 'var(--amber-500)', hard: 'var(--red-600)' }[
              DataLoader.request(row.requestId).difficulty
            ]
          }">${esc(DataLoader.request(row.requestId).difficulty)}</span>
        </div>`).join('');
    },

    dashboardStats(session) {
      const totalPlayers = session.teams.reduce((n, t) => n + t.players.length, 0);
      const capacity = session.teams.length * session.maxPlayers;
      const avgCompletion = Math.round(
        session.teams.reduce((n, t) => n + Engine.completionPercent(t), 0) / session.teams.length
      );
      const finished = session.teams.filter((t) => Engine.isTeamComplete(t)).length;

      const stat = (label, value) =>
        `<div class="stat"><div class="stat__label">${esc(label)}</div><div class="stat__value">${value}</div></div>`;

      return stat('Teams', session.teams.length)
        + stat('Agents joined', `${totalPlayers}<small style="font-size:.5em;color:var(--gray-500)">/${capacity}</small>`)
        + stat('Avg completion', avgCompletion + '%')
        + stat('Teams finished', `${finished}/${session.teams.length}`)
        + stat('Status', `<span style="font-size:.62em;text-transform:uppercase;letter-spacing:.08em">${esc(session.status)}</span>`);
    },

    dashboardTeams(session) {
      return session.teams.map((team) => {
        const request = DataLoader.request(team.requestId);
        const percent = Engine.completionPercent(team);
        const complete = Engine.isTeamComplete(team);

        const roleRows = DataLoader.data.roles.map((role) => {
          const status = Engine.stageStatus(team, role.id);
          const player = Engine.playerInRole(team, role.id);
          const label = status === 'done' ? '✓ submitted'
            : status === 'active' ? 'working…'
              : 'waiting';
          return `
            <div class="role-row ${status === 'done' ? 'is-done' : status === 'active' ? 'is-active' : ''}">
              <span>${esc(role.icon)}</span>
              <span>${esc(role.name.replace(' Agent', ''))}</span>
              <span class="role-row__who">${player ? esc(player.name) + ' · ' : '<em style="color:var(--gray-400)">unassigned</em> · '}${label}</span>
            </div>`;
        }).join('');

        return `
          <div class="team-card ${complete ? 'is-complete' : ''}">
            <div class="team-card__head">
              <span class="team-card__name">${esc(team.name)}</span>
              <span class="team-card__count">${team.players.length}/${session.maxPlayers} joined</span>
            </div>
            <p class="team-card__q">${esc(request.question)}</p>
            <div class="team-card__roles">${roleRows}</div>
            <div class="progress">
              <div class="progress__bar ${complete ? 'is-complete' : ''}" style="width:${percent}%"></div>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:.78rem;color:var(--ink-soft)">
              <span>${percent}% complete</span>
              ${complete ? `<strong style="color:var(--green-600)">${Scoring.finalize(team, session).total} pts</strong>` : ''}
            </div>
          </div>`;
      }).join('');
    },

    leaderboard(session, highlightTeamId) {
      const rows = Scoring.leaderboard(session);
      const anyScored = rows.some((r) => r.total > 0 || r.complete);
      if (!anyScored) {
        return '<div class="empty">No results yet. The leaderboard fills in as teams submit their reports.</div>';
      }

      return `
        <div class="table-wrap">
          <table class="lb">
            <thead>
              <tr><th>Rank</th><th>Team</th><th>Research request</th><th>Score</th><th>Time</th><th>Stars</th></tr>
            </thead>
            <tbody>
              ${rows.map((row, i) => `
                <tr class="${i === 0 && row.complete ? 'is-winner' : ''} ${row.team.id === highlightTeamId ? 'is-me' : ''}">
                  <td class="lb__rank">${i === 0 && row.complete ? '🏆' : '#' + (i + 1)}</td>
                  <td>${esc(row.team.name)}</td>
                  <td style="color:var(--ink-soft);font-size:.86rem">${esc(DataLoader.request(row.team.requestId).question)}</td>
                  <td><strong>${row.total}</strong><small style="color:var(--gray-500)">/100</small>${
                    row.bonus > 0 ? `<br><small style="color:var(--green-600)">+${row.bonus} speed</small>` : ''
                  }</td>
                  <td>${row.complete ? esc(Utils.formatDuration(row.elapsedMs)) : '<span style="color:var(--gray-500)">incomplete</span>'}</td>
                  <td class="lb__stars">${this.starsInline(row.stars)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    },

    /* ---- player ---- */

    teamOptions(session, selectedId) {
      return session.teams.map((team) => {
        const full = team.players.length >= session.maxPlayers;
        return `
          <button type="button" class="team-opt ${selectedId === team.id ? 'is-selected' : ''}"
                  data-action="pick-team" data-team="${esc(team.id)}" ${full ? 'disabled' : ''}>
            <div class="team-opt__name">${esc(team.name)}</div>
            <div class="team-opt__meta">${team.players.length}/${session.maxPlayers} agents${full ? ' · full' : ''}</div>
          </button>`;
      }).join('');
    },

    /** The inbox panel: the ONLY upstream information a role is allowed to see. */
    inbox(inbox) {
      if (inbox.kind === 'question') {
        return `
          <div class="inbox">
            <div class="inbox__label">📥 Input · Research Question</div>
            <p class="inbox__question">${esc(inbox.question)}</p>
            <p class="inbox__context">${esc(inbox.context)}</p>
          </div>`;
      }
      return `
        <div class="inbox">
          <div class="inbox__label">📥 Input · ${esc(inbox.fromRole.output)} from the ${esc(inbox.fromRole.name)}</div>
          <p class="inbox__context">This is everything you are allowed to see. The original question is not yours to read.</p>
          <div class="inbox__chips">
            ${inbox.items.length
              ? inbox.items.map((item, i) =>
                  `<span class="chip">${inbox.ordered ? (i + 1) + '.' : esc(item.icon || '•')} ${esc(item.label)}${
                    item.hint ? `<small class="chip__hint">${esc(item.hint)}</small>` : ''}</span>`).join('')
              : '<span class="chip chip--muted">The previous agent sent nothing. Good luck.</span>'}
          </div>
        </div>`;
    },

    /** Selectable option cards for the active stage. */
    cardGrid(cards, selection, ordered, locked) {
      return `<div class="card-grid">${cards.map((card) => {
        const position = selection.indexOf(card.id);
        const selected = position !== -1;
        return `
          <button type="button" class="pick ${selected ? 'is-selected' : ''}"
                  data-action="toggle-card" data-id="${esc(card.id)}" ${locked ? 'disabled' : ''}>
            ${ordered && selected ? `<span class="pick__order">${position + 1}</span>` : ''}
            <span class="pick__box">✓</span>
            ${card.icon ? `<span class="pick__icon">${esc(card.icon)}</span>` : ''}
            <span class="pick__label">${esc(card.label)}
              ${card.hint ? `<span class="pick__hint">${esc(card.hint)}</span>` : ''}
            </span>
          </button>`;
      }).join('')}</div>`;
    },

    /* ---- results ---- */

    resultBreakdown(team) {
      return `<div class="breakdown">${DataLoader.data.roles.map((role) => {
        const stage = team.stages[role.id];
        const player = Engine.playerInRole(team, role.id);
        const detail = stage.detail;
        return `
          <div class="breakdown__item">
            <div class="breakdown__role">${esc(role.icon)} ${esc(role.name.replace(' Agent', ''))}</div>
            <div class="breakdown__who">${player ? esc(player.name) : 'unassigned'}</div>
            <div class="breakdown__score">${stage.score || 0}<small>/25</small></div>
            <div class="breakdown__detail">${
              detail
                ? `${detail.hits}/${detail.total} correct · ${detail.wrong} wrong${
                    detail.orderAccuracy != null ? ` · order ${Math.round(detail.orderAccuracy * 100)}%` : ''
                  }`
                : 'Never submitted'
            }</div>
          </div>`;
      }).join('')}</div>`;
    }
  };

  /* ======================================================================
     10. APP — routing, wiring, bootstrap
     ====================================================================== */
  const App = {
    route: 'landing',
    draftConfig: null,   // admin setup form state
    joinDraft: { teamId: null },
    selection: [],       // current stage picks (local until submitted)
    selectionStageKey: null,

    /* ---------- bootstrap ---------- */

    async init() {
      try {
        await DataLoader.load();
      } catch (err) {
        // file:// blocks fetch in most browsers — offer manual file selection.
        return this.showBootFallback(err);
      }
      this.start();
    },

    showBootFallback(err) {
      const boot = $('#boot');
      boot.classList.add('boot--error');
      $('#bootMsg').textContent = 'Could not load game-data.json (' + err.message + ')';
      $('#bootFallback').hidden = false;

      $('#bootFile').addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            DataLoader.ingest(JSON.parse(reader.result));
            boot.classList.remove('boot--error');
            this.start();
          } catch (parseErr) {
            $('#bootMsg').textContent = 'That file could not be parsed: ' + parseErr.message;
          }
        };
        reader.readAsText(file);
      });
    },

    start() {
      $('#boot').hidden = true;
      $('#app').hidden = false;
      $('#footerVersion').textContent = 'v' + DataLoader.data.meta.version;
      $('#heroPipeline').innerHTML = Views.heroPipeline();
      $('#howtoRoles').innerHTML = DataLoader.data.roles
        .map((role) => Views.agentCard(role, { compact: false })).join('');

      Store.read();
      Identity.load();
      Net.init();
      this.bindEvents();

      // A ?s=CODE link (or a previously joined code) attaches to the online session.
      const urlCode = new URLSearchParams(location.search).get('s');
      this.autoJoin = !!urlCode && !Identity.isAdmin();
      const code = urlCode || localStorage.getItem(Store.CODE_KEY);
      if (Net.enabled && code) Net.attach(code);

      Store.subscribe(() => {
        // Heal local identity if the server-side player record changed (role races, resets).
        const rec = Identity.record();
        if (rec && Identity.me && (Identity.me.role || null) !== (rec.role || null)) {
          Identity.save(Object.assign({}, Identity.me, { role: rec.role || null }));
        }
        if (this.autoJoin && Store.session && !Identity.me && !Identity.isAdmin()) {
          this.autoJoin = false;
          this.joinDraft = { teamId: null };
          this.route = 'join';
        }
        this.render();
      });
      Timer.start(() => this.handleExpiry());

      // Resume wherever this browser left off.
      if (Identity.isAdmin() && Store.session) this.route = 'admin-dashboard';
      else if (Identity.me && Store.session) this.route = 'player';

      this.render();
    },

    /* ---------- events ---------- */

    bindEvents() {
      // Delegated actions (data-action attributes).
      document.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-action]');
        if (!trigger || trigger.disabled) return;
        this.handleAction(trigger.dataset.action, trigger, event);
      });

      // Static controls with ids.
      $('#btnCreateSession').addEventListener('click', () => this.createSession());
      $('#btnShuffleRequests').addEventListener('click', () => this.shuffleRequests());
      $('#btnStartGame').addEventListener('click', () => this.startGame());
      $('#btnAddTime').addEventListener('click', () => this.addTime(5));
      $('#btnEndEarly').addEventListener('click', () => this.endEarly());
      $('#btnReleaseResults').addEventListener('click', () => this.releaseResults());
      $('#btnResetSession').addEventListener('click', () => this.resetSession());
      $('#btnCopyLink').addEventListener('click', () => this.copyPlayerLink());
      $('#btnJoinTeam').addEventListener('click', () => this.joinTeam());
      $('#btnLeaveTeam').addEventListener('click', () => this.leaveTeam());
      $('#btnExit').addEventListener('click', () => this.exit());
      $('#joinName').addEventListener('input', () => this.refreshJoinButton());

      // Setup form inputs feed the draft config.
      ['cfgTeams', 'cfgMaxPlayers', 'cfgDuration'].forEach((id) => {
        $('#' + id).addEventListener('change', () => this.syncSetupForm());
      });
      $('#teamConfig').addEventListener('change', (event) => {
        const select = event.target.closest('[data-team-index]');
        if (!select) return;
        this.draftConfig.teams[Number(select.dataset.teamIndex)].requestId = select.value;
        $('#teamConfig').innerHTML = Views.teamConfigRows(this.draftConfig.teams);
      });

      // Cross-tab synchronisation: another tab changed the session.
      window.addEventListener('storage', (event) => {
        if (event.key === Store.KEY) {
          Store.read();
          this.render();
        }
      });

      // Keyboard support for the brand "home" button.
      $('.topbar__brand').addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.go('landing');
        }
      });
    },

    handleAction(action, el) {
      switch (action) {
        case 'go-landing': this.go('landing'); break;
        case 'howto': this.go('howto'); break;
        case 'admin-setup': this.openSetup(); break;
        case 'join': this.openJoin(); break;
        case 'pick-team': this.joinDraft.teamId = el.dataset.team; this.render(); break;
        case 'pick-role': this.pickRole(el.dataset.role); break;
        case 'toggle-card': this.toggleCard(el.dataset.id); break;
        case 'submit-stage': this.submitStage(); break;
        default: break;
      }
    },

    go(route) {
      this.route = route;
      this.render();
    },

    /* ---------- admin flow ---------- */

    openSetup() {
      const settings = DataLoader.data.settings;
      $('#cfgTeams').value = settings.defaultTeams;
      $('#cfgMaxPlayers').value = settings.maxPlayersPerTeam;
      $('#cfgDuration').value = settings.defaultDurationMinutes;
      this.draftConfig = {
        maxPlayers: settings.maxPlayersPerTeam,
        durationMinutes: settings.defaultDurationMinutes,
        teams: []
      };
      this.syncSetupForm();
      this.go('admin-setup');
    },

    /** Rebuild the draft team list whenever the numeric inputs change. */
    syncSetupForm() {
      const requests = DataLoader.data.researchRequests;
      const count = Utils.clamp(Number($('#cfgTeams').value) || 1, 1, 12);
      const maxPlayers = Utils.clamp(Number($('#cfgMaxPlayers').value) || 4, 1, 4);
      const duration = Utils.clamp(Number($('#cfgDuration').value) || 5, 1, 60);

      $('#cfgTeams').value = count;
      $('#cfgMaxPlayers').value = maxPlayers;
      $('#cfgDuration').value = duration;

      const previous = this.draftConfig ? this.draftConfig.teams : [];
      const teams = [];
      for (let i = 0; i < count; i++) {
        teams.push({
          name: 'Team ' + String.fromCharCode(65 + i),
          requestId: (previous[i] && previous[i].requestId) || requests[i % requests.length].id
        });
      }
      this.draftConfig = { maxPlayers, durationMinutes: duration, teams };
      $('#teamConfig').innerHTML = Views.teamConfigRows(teams);
    },

    shuffleRequests() {
      const pool = Utils.shuffle(DataLoader.data.researchRequests, Math.random);
      this.draftConfig.teams.forEach((team, i) => {
        team.requestId = pool[i % pool.length].id;
      });
      $('#teamConfig').innerHTML = Views.teamConfigRows(this.draftConfig.teams);
      FX.toast('Research requests reshuffled 🎲');
    },

    createSession() {
      if (Store.session && !confirm('An existing session will be replaced. Continue?')) return;
      const session = Store.createSession(this.draftConfig);
      Identity.setAdmin(true);
      Identity.clear();
      if (Net.enabled) {
        FX.toast('Session created. Code: ' + session.code + ' — share the player link.', 'ok');
      } else {
        FX.toast('Session created — but online sync is not configured, so players must use this same browser.', 'err');
      }
      this.go('admin-dashboard');
    },

    startGame() {
      const session = Store.session;
      if (!session) return;

      const unstaffed = session.teams.filter((t) => t.players.length === 0);
      if (unstaffed.length === session.teams.length) {
        FX.toast('No agents have joined yet.', 'err');
        return;
      }
      if (session.status === 'running') {
        FX.toast('The game is already running.');
        return;
      }

      Store.update((s) => {
        s.status = 'running';
        s.startedAt = Date.now();
        s.endedAt = null;
      });
      FX.toast('Pipeline activated. Timer running ⏱️', 'ok');
      this.render();
    },

    releaseResults() {
      const session = Store.session;
      if (!session || session.status !== 'ended' || session.resultsReleasedAt) return;
      Store.update((s) => { s.resultsReleasedAt = Date.now(); });
      FX.toast('Results are live for every agent. 📣', 'ok');
      this.render();
    },

    resetSession() {
      if (!confirm('Reset and delete this session for every connected player?')) return;
      Store.clear();
      Identity.clear();
      Identity.setAdmin(false);
      this.go('landing');
      FX.toast('Session cleared.');
    },

    copyPlayerLink() {
      const base = location.origin + location.pathname;
      const url = Store.session && Store.session.code && Net.enabled
        ? base + '?s=' + Store.session.code
        : base;
      const done = () => FX.toast('Player link copied: ' + url, 'ok');
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(url).then(done, () => FX.toast(url));
      } else {
        FX.toast(url);
      }
    },

    /* ---------- player flow ---------- */

    openJoin() {
      if (!Store.read()) {
        if (Net.enabled) {
          // ponytail: prompt() over a code-entry screen — matches the confirm() idiom here.
          const code = prompt('Enter the session code from your host (e.g. ABC23):');
          if (code) this.connect(code);
        } else {
          FX.toast('No session exists yet. Ask the admin to create one.', 'err');
        }
        return;
      }
      this.joinDraft = { teamId: null };
      this.go('join');
    },

    /** Look up a typed session code, then follow that session. */
    connect(code) {
      code = Net.cleanCode(code);
      if (!code) return;
      FX.toast('Looking up session ' + code + '…');
      Net.peek(code).then((session) => {
        if (!session) {
          FX.toast('No session found with code ' + code + '.', 'err');
          return;
        }
        Net.attach(code);
        this.joinDraft = { teamId: null };
        this.go('join');
      }).catch(() => FX.toast('Could not reach the server. Check your connection.', 'err'));
    },

    refreshJoinButton() {
      const name = $('#joinName').value.trim();
      $('#btnJoinTeam').disabled = !(name && this.joinDraft.teamId);
    },

    joinTeam() {
      const name = $('#joinName').value.trim();
      const teamId = this.joinDraft.teamId;
      const error = $('#joinError');
      error.hidden = true;

      if (!name || !teamId) return;

      const session = Store.read();
      const team = session.teams.find((t) => t.id === teamId);

      if (team.players.length >= session.maxPlayers) {
        error.hidden = false;
        error.textContent = 'Sorry! This team already has four autonomous agents 🤖';
        this.render();
        return;
      }

      const player = { id: Utils.uid('p'), name, role: null, joinedAt: Date.now() };
      Store.update((s) => {
        const t = s.teams.find((x) => x.id === teamId);
        if (t.players.length >= s.maxPlayers) return;   // capacity race across devices
        t.players.push(player);
      });
      Identity.save({ id: player.id, name, teamId, role: null });
      FX.toast(`Welcome aboard, ${name}. Pick your agent.`, 'ok');
      this.go('player');
    },

    leaveTeam() {
      if (!Identity.me) return;
      if (!confirm('Leave this team? Your role will be freed up.')) return;
      const me = Identity.me;
      Store.update((s) => {
        const team = s.teams.find((t) => t.id === me.teamId);
        if (team) team.players = team.players.filter((p) => p.id !== me.id);
      });
      Identity.clear();
      this.go('landing');
    },

    exit() {
      if (Identity.isAdmin()) {
        Identity.setAdmin(false);
      } else if (Identity.me) {
        this.leaveTeam();
        return;
      }
      this.go('landing');
    },

    pickRole(roleId) {
      const me = Identity.me;
      if (!me) return;

      const team = Store.team(me.teamId);
      if (Engine.roleTaken(team, roleId)) {
        FX.toast('That agent is already deployed. Pick another.', 'err');
        this.render();
        return;
      }

      Store.update((s) => {
        const t = s.teams.find((x) => x.id === me.teamId);
        if (t.players.some((p) => p.role === roleId && p.id !== me.id)) return;   // role race
        const player = t.players.find((p) => p.id === me.id);
        if (player) player.role = roleId;
      });
      Identity.save(Object.assign({}, me, { role: roleId }));
      const role = DataLoader.role(roleId);
      FX.toast(`${role.icon} You are the ${role.name}.`, 'ok');
      this.render();
    },

    /* ---------- stage interaction ---------- */

    /** Reset local picks when the player moves to a different stage context. */
    ensureSelectionContext(key, role) {
      if (this.selectionStageKey !== key) {
        this.selectionStageKey = key;
        this.selection = [];
        // Pinned once per stage so it does not flicker on every re-render.
        this.stageFlavour = Utils.pick(role.funMessages, Math.random);
      }
    },

    toggleCard(id) {
      const index = this.selection.indexOf(id);
      if (index === -1) this.selection.push(id);
      else this.selection.splice(index, 1);
      this.render();
    },

    submitStage() {
      const me = Identity.me;
      const team = Identity.team();
      if (!me || !team || Timer.isExpired()) return;

      if (this.selection.length === 0) {
        FX.toast('Select at least one card before submitting.', 'err');
        return;
      }

      const roleId = me.role;
      const correctIds = Engine.correctIdsFor(team, roleId);
      const detail = Scoring.scoreStage(roleId, this.selection.slice(), correctIds);
      const selection = this.selection.slice();

      Store.update((s) => {
        const t = s.teams.find((x) => x.id === team.id);
        const stage = t.stages[roleId];
        if (stage.submittedAt) return;           // guard against double submit
        stage.selection = selection;
        stage.submittedAt = Date.now();
        stage.score = detail.score;
        stage.detail = detail;

        if (Engine.isTeamComplete(t)) {
          t.finishedAt = Date.now();
          t.finalScore = Scoring.finalize(t, s).total;
        }
        // End the session once every team has finished.
        if (s.teams.every((x) => Engine.isTeamComplete(x))) {
          s.status = 'ended';
          s.endedAt = Date.now();
        }
      });

      this.selection = [];
      const role = DataLoader.role(roleId);
      FX.toast(`${role.output} handed off ✔`, 'ok');

      const fresh = Store.team(team.id);
      if (Engine.isTeamComplete(fresh)) FX.confetti(3400);

      this.render();
    },

    /** Freeze the session and score whatever exists, however it ended. */
    endSession(endedAt) {
      const session = Store.session;
      if (!session || session.status !== 'running') return false;
      Store.update((s) => {
        s.status = 'ended';
        s.endedAt = endedAt;
        s.teams.forEach((t) => {
          if (!t.finishedAt && Engine.isTeamComplete(t)) t.finishedAt = s.endedAt;
          t.finalScore = Scoring.finalize(t, s).total;
        });
      });
      this.render();
      return true;
    },

    /** Timer ran out. */
    handleExpiry() {
      const session = Store.session;
      if (!session) return;
      if (this.endSession(session.startedAt + session.durationMs)) {
        FX.toast("Time's up! All inputs are locked. ⏰", 'err');
      }
    },

    /** Admin called it early: teams still mid-pipeline are scored as they stand. */
    endEarly() {
      const session = Store.session;
      if (!session || session.status !== 'running') return;
      const unfinished = session.teams.filter((t) => !Engine.isTeamComplete(t)).length;
      const warning = unfinished
        ? `${unfinished} of ${session.teams.length} teams have not finished. They will be scored on what they have submitted so far.\n\n`
        : '';
      if (!confirm(warning + 'End the session now for everyone?')) return;
      if (this.endSession(Date.now())) FX.toast('Session ended. Scores are final. 🛑', 'ok');
    },

    /** Admin buys the room more time. Only meaningful while the clock runs. */
    addTime(minutes) {
      const session = Store.session;
      if (!session || session.status !== 'running') return;
      Store.update((s) => { s.durationMs += minutes * 60 * 1000; });
      FX.toast(`+${minutes} minute${minutes > 1 ? 's' : ''} on the clock. ⏱️`, 'ok');
      this.render();
    },

    /* ---------- rendering ---------- */

    render() {
      const session = Store.session;

      // Fall back to the landing page if the session vanished (e.g. admin reset).
      if (!session && (this.route === 'admin-dashboard' || this.route === 'player')) {
        this.route = 'landing';
        Identity.clear();
      }

      const team = Identity.team();
      $('#pipeline').innerHTML = Views.pipeline(team);
      $('#btnExit').hidden = !(Identity.me || Identity.isAdmin());
      Timer.tick();

      // Player route resolves to a sub-screen based on pipeline state.
      const screen = this.route === 'player' ? this.resolvePlayerScreen() : this.route;

      $$('.screen').forEach((el) => el.classList.toggle('is-active', el.dataset.screen === screen));

      switch (screen) {
        case 'admin-dashboard': this.renderDashboard(); break;
        case 'join': this.renderJoin(); break;
        case 'role-select': this.renderRoleSelect(); break;
        case 'briefing': this.renderBriefing(); break;
        case 'stage': this.renderStage(); break;
        case 'results': this.renderResults(); break;
        default: break;
      }
    },

    resolvePlayerScreen() {
      const me = Identity.me;
      const team = Identity.team();
      if (!me || !team) return 'join';
      if (!Identity.record()) return 'join';        // removed from the session
      if (!me.role) return 'role-select';

      const session = Store.session;
      if (Engine.isTeamComplete(team) || session.status === 'ended') {
        // Scores stay hidden until the admin releases the results.
        return session.resultsReleasedAt ? 'results' : 'briefing';
      }
      if (session.status === 'running' && Engine.currentRole(team) === me.role) return 'stage';
      return 'briefing';
    },

    renderDashboard() {
      const session = Store.session;
      $('#dashStats').innerHTML = Views.dashboardStats(session);
      $('#dashTeams').innerHTML = Views.dashboardTeams(session);
      $('#dashLeaderboard').innerHTML = Views.leaderboard(session);

      const status = {
        lobby: 'Waiting for agents to join — press Start when everyone is in.',
        running: 'Pipeline running. Agents are working through their stages.',
        ended: 'Session complete. Final results below.'
      }[session.status];
      const codeLabel = Net.enabled && session.code ? 'Session code: ' + session.code + ' · ' : '';
      $('#dashStatus').textContent = codeLabel + status;

      $('#btnStartGame').disabled = session.status !== 'lobby';
      $('#btnStartGame').textContent = session.status === 'lobby' ? '▶ Start Game'
        : session.status === 'running' ? '⏱ Running…' : '✓ Finished';

      const running = session.status === 'running';
      $('#btnAddTime').hidden = !running;
      $('#btnEndEarly').hidden = !running;

      const released = !!session.resultsReleasedAt;
      const btnRelease = $('#btnReleaseResults');
      btnRelease.hidden = session.status !== 'ended';
      btnRelease.disabled = released;
      btnRelease.textContent = released ? '✓ Results released' : '📣 Release Results';
    },

    renderJoin() {
      const session = Store.session;
      if (!session) return;
      $('#joinTeams').innerHTML = Views.teamOptions(session, this.joinDraft.teamId);
      this.refreshJoinButton();
    },

    renderRoleSelect() {
      const team = Identity.team();
      const request = DataLoader.request(team.requestId);

      $('#roleSelectSub').innerHTML =
        `<strong>${esc(team.name)}</strong> · ${team.players.length}/${Store.session.maxPlayers} agents joined · `
        + `difficulty <strong>${esc(request.difficulty)}</strong>. Only one player can own each role.`;

      $('#roleGrid').innerHTML = DataLoader.data.roles.map((role) => {
        const holder = Engine.playerInRole(team, role.id);
        return Views.agentCard(role, {
          button: true,
          disabled: !!holder,
          takenBy: holder ? holder.name : null
        });
      }).join('');
    },

    renderBriefing() {
      const me = Identity.me;
      const team = Identity.team();
      const session = Store.session;
      const role = DataLoader.role(me.role);
      const stage = team.stages[me.role];

      $('#briefingCard').innerHTML = Views.agentCard(role, { featured: true })
        + `<p style="color:var(--ink-soft);margin-top:14px">
             Team <strong>${esc(team.name)}</strong> · ${team.players.length}/${session.maxPlayers} agents online
           </p>`;

      let body;
      if (session.status === 'lobby') {
        body = Views.waiting(
          'Standing by for launch',
          'The admin has not started the session yet. ' + role.loadingMessage
        );
      } else if (session.status === 'ended' || Engine.isTeamComplete(team)) {
        // Run is over but results are not released yet — reveal nothing.
        body = Views.waiting(
          Engine.isTeamComplete(team) ? 'Mission complete 🏁' : 'Time expired ⏰',
          'All submissions are in. Waiting for the host to reveal the results…'
        );
      } else if (stage.submittedAt) {
        body = `
          <div class="stage-head" style="margin-top:26px">
            <div class="stage-head__left">
              <span class="stage-head__icon">✅</span>
              <div>
                <div class="stage-head__name">${esc(role.output)} delivered</div>
                <p class="stage-head__mission">Downstream agents are working with your output now. Scores are revealed when the host publishes the results.</p>
              </div>
            </div>
            <span class="stage-head__counter">${stage.selection.length} picks submitted</span>
          </div>
          ${Views.waiting('Pipeline in progress', 'Waiting for the remaining agents to finish. ' + FX.randomLoadingMessage())}`;
      } else {
        const activeRole = DataLoader.role(Engine.currentRole(team));
        body = Views.waiting(
          `Waiting for the ${activeRole ? activeRole.name : 'previous agent'}`,
          `You cannot start until the ${activeRole ? activeRole.output : 'previous output'} reaches your inbox. ${FX.randomLoadingMessage()}`
        );
      }
      $('#briefingStatus').innerHTML = body;
    },

    renderStage() {
      const me = Identity.me;
      const team = Identity.team();
      const role = DataLoader.role(me.role);
      const locked = Timer.isExpired();

      this.ensureSelectionContext(team.id + ':' + me.role, role);

      const cards = Engine.cardsFor(team, me.role);
      const ordered = Engine.isOrdered(me.role);

      $('#stageHead').innerHTML = `
        <div class="stage-head__left">
          <span class="stage-head__icon">${esc(role.icon)}</span>
          <div>
            <div class="stage-head__name">${esc(role.name)} — your turn</div>
            <p class="stage-head__mission">${esc(role.mission)}</p>
          </div>
        </div>
        <span class="stage-head__counter">${this.selection.length} selected</span>`;

      $('#stageInput').innerHTML =
        (locked ? '<div class="locked-banner">⏰ Time expired — inputs are locked.</div>' : '')
        + Views.inbox(Engine.inboxFor(team, me.role));

      $('#stageBoard').innerHTML = Views.cardGrid(cards, this.selection, ordered, locked);

      $('#stageFoot').innerHTML = `
        <p class="stage-foot__note">
          ${ordered
            ? `Order matters here — the number on each card is its position in the ${esc(role.output)}.`
            : 'Pick every option that belongs. Wrong picks cost you points.'}
          <br><em style="color:var(--gray-500);font-style:italic">“${esc(this.stageFlavour)}”</em>
        </p>
        <button class="btn btn--primary" data-action="submit-stage" ${locked ? 'disabled' : ''}>
          Submit ${esc(role.output)} →
        </button>`;
    },

    renderResults() {
      const session = Store.session;
      const team = Identity.team();
      const body = $('#resultsBody');

      if (!team) {
        body.innerHTML = '<div class="empty">Session finished.</div>';
        $('#resultsLeaderboard').innerHTML = Views.leaderboard(session);
        return;
      }

      const result = Scoring.finalize(team, session);
      const message = Utils.pick(DataLoader.data.celebrationMessages, Math.random);

      body.innerHTML = `
        <div class="result-hero">
          <div class="result-hero__icon">${result.complete ? '🏁' : '⏰'}</div>
          <h2 class="result-hero__title">${result.complete ? 'Mission Complete' : 'Time Expired'}</h2>
          <p class="result-hero__msg">${esc(result.complete ? message : 'The pipeline stalled before the report shipped.')}</p>

          <div class="score-ring" style="--pct:${result.total}">
            <div class="score-ring__inner">
              <div class="score-ring__value">${result.total}</div>
              <div class="score-ring__label">of 100</div>
            </div>
          </div>
          ${Views.stars(result.stars)}

          <div class="inbox__chips" style="justify-content:center;margin-top:20px">
            <span class="chip">🏷️ ${esc(team.name)}</span>
            <span class="chip">⏱️ ${esc(Utils.formatDuration(result.elapsedMs))}</span>
            <span class="chip">🎯 ${result.stageTotal} stage pts</span>
            ${result.bonus > 0 ? `<span class="chip">⚡ +${result.bonus} speed bonus</span>` : ''}
          </div>
          <p class="team-card__q" style="max-width:640px;margin:22px auto 0;text-align:left">
            ${esc(DataLoader.request(team.requestId).question)}
          </p>
        </div>
        ${Views.resultBreakdown(team)}`;

      $('#resultsLeaderboard').innerHTML = Views.leaderboard(session, team.id);
    }
  };

  /* ---------- go ---------- */
  // Debug/console handle (also used by test_sync.js).
  window.__DSC = { Utils, Store, Net, Identity, DataLoader, Engine, Scoring, App };

  document.addEventListener('DOMContentLoaded', () => App.init());
})();
