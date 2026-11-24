/*
 * storage.js — the "database". Everything lives in the browser's local
 * extension storage (storage.local) on this machine only. No server, no sync.
 *
 * Keys:
 *   profile       who the user is + preferences + auto-apply details
 *   settings      AI provider, log level, behaviour toggles
 *   resumes       { activeId, items: [{id,name,text,file?,createdAt,job?}] }
 *   answers       learned answers: { [normKey]: {label,value,count,lastUsed,hosts[]} }
 *   applications  [{id,url,title,company,score,status,date,resumeId}]
 *   enhancements  resume enhancement drafts: requirements, evidence, validated edits (max 20)
 *   logs          ring buffer of log entries (owned by background)
 *   tabJobs       internal: which job each browser tab is on (for apply detection)
 *
 * Reads go through an in-memory cache that is invalidated by storage.onChanged,
 * so repeated reads are effectively free.
 *
 * Two places, one API (AJP.store):
 *   storage.local      what job-site pages also read: profile, settings (without API keys), resumes, answers, ...
 *   extension database IndexedDB that only the extension's own pages and background can open (DB_KEYS + API keys).
 *                      Data that changes often lives here: every storage.local write is copied to every open
 *                      Admin page and job-site tab, these writes aren't. Pages (content scripts) never see it.
 * Changes in either place reach AJP.store.onChange(fn) in every extension context.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.store) return;

  const DEFAULTS = {
    profile: {
      personal: {
        firstName: '', lastName: '', email: '', phone: '',
        address: '', city: '', state: '', zip: '', country: '',
        linkedin: '', github: '', website: '',
        currentTitle: '', currentCompany: '', yearsExperience: '',
      },
      skills: [], // CORE skills shared by every track: [{name, level, years}]
      tracks: [], // career tracks (max 3): [{id, name, targetTitles[], skills[], resumeId, salary?, workTypes?}] — see tracks.js
      targetRoles: [], // ["Senior Software Engineer", ...]
      salary: { min: '', max: '', currency: 'USD', period: 'year' },
      areas: [], // ["Austin, TX", "Remote - US"]
      workTypes: { remote: true, hybrid: true, onsite: false },
      willingToRelocate: '',
      autoApply: {
        education: [], // [{school, degree, field, startYear, endYear, gpa}]
        experience: [], // [{company, title, location, start, end, current, description}]
        workAuthorized: '', // 'Yes' | 'No'
        requireSponsorship: '',
        citizen: '', // 'Yes' | 'No' — U.S. citizen (Job Radar: citizenship-only / clearance jobs)
        noticePeriod: '',
        earliestStart: '',
        coverLetterTemplate: '',
        eeo: { gender: '', race: '', hispanic: '', veteran: '', disability: '', pronouns: '' },
      },
    },
    settings: {
      ai: {
        provider: 'none', // none | gemini | groq | openrouter | ollama
        model: '',
        keys: { gemini: '', groq: '', openrouter: '', nvidia: '', mistral: '', anthropic: '' },
        tailorProvider: '', // '' = same as provider; e.g. 'gemini' for tailoring while 'chrome' does the rest
        tailorModel: '', // '' = the tailoring provider's default (e.g. claude-haiku-5-5 to spend less with Claude)
        resolvedModels: {}, // legacy (read once if modelHealth has no record): the working model now lives in modelHealth
        ollamaUrl: 'http://localhost:11434',
      },
      logLevel: 'info',
      autoAnalyze: true, // show match badge automatically on known job sites
      learnAnswers: true,
      tracker: { autoDetect: true, followUpDays: 7 },
      retentionDays: 30, // applications, job history, drafts and logs older than this are removed (0 = keep)
      support: { crashPrompt: true }, // ask to report unnoticed failures (never sends without a click)
      // Resume tailoring is for CLOSE matches: small honest lift, never a rewrite (see resume-engine.js, "Limits").
      tailoring: { minMatch: 70, maxLift: 15, maxEdits: 6, maxSkills: 4 },
    },
    resumes: { activeId: null, items: [] },
    answers: {},
    applications: [],
    enhancements: [], // resume enhancement drafts awaiting review (max 20)
    evaluations: [], // last 300 analyzed jobs with a score per track (track insights)
    reports: [], // problem reports opened on GitHub: [{reportId, createdAt, codes, title, status, number, url, version, checkedAt, seen}]
    suggestions: { dismissed: {} }, // profile suggestions from learned answers: { dismissed: { [id]: isoDate } }
    // Job Radar (docs/JOB-FINDER.md §10). radarScanState is internal (not exported).
    radarSettings: { enabled: true, intervalHours: 3, threshold: 60, locations: [], remote: 'any', minSalary: '', notify: 'digest', lastDigestAt: null, directory: true, excluded: [] },
    radarWatchlist: [], // [{ key, board, company, companyName, site?, region?, wd?, domain?, paused, addedAt, lastScanAt, lastError, failuresInRow, openJobs }]
    radarJobs: [], // [job] (radar-core.normalize + score, bestTrackId, foundAt, status new|saved|dismissed)
    radarSeen: {}, // { [jobKey]: firstSeenDate }
    radarSites: [], // internal: company career sections you allowed from Job Radar (URL patterns)
    radarFiltered: [], // internal: jobs left out, with { reason, detail, filteredAt } (radar-core.mergeFiltered)
    radarScanState: {}, // internal: { lockedAt, queue[], position, lastSummary, stats }
    modelHealth: {}, // internal: per provider {ranked:[ids], at, last, ok:{model: lastSuccess}, bad:{model: until}, why:{model: gone|slow|busy|quota}} (ai.js model manager)
    aiChecks: {}, // internal: last "Check my AI setup" per provider (models, steps, timing, error text; no keys, no prompts)
    aiCalls: [], // internal: last 30 AI calls {at, task, provider, model, label, ms, ok, code} — no prompts, no answers
    promptState: {}, // internal: crash-prompt bookkeeping {recent, last, never, pending}
    logs: [],
    tabJobs: {}, // internal: { [tabId]: job being looked at / applied to in that tab }
  };
  const INTERNAL = new Set(['logs', 'tabJobs', 'promptState', 'aiCalls', 'aiChecks', 'modelHealth', 'radarScanState', 'radarFiltered', 'radarSites']); // never exported or imported

  const area = () => AJP.api.storage.local;
  const cache = new Map();

  // ---- Extension database (IndexedDB) --------------------------------------------------------------------
  const DB_KEYS = new Set(['logs', 'radarJobs', 'radarSeen', 'radarFiltered', 'radarScanState', 'radarWatchlist', 'modelHealth', 'aiCalls', 'aiChecks']);
  const KEYS_SLOT = 'aiKeys'; // settings.ai.keys, kept out of storage.local so job-site pages can't read them
  // Only the extension's own pages and background (a job-site page has a different origin and its own, empty database).
  function extensionContext() {
    try {
      return typeof indexedDB !== 'undefined' && typeof location !== 'undefined' && String(location.href).startsWith(AJP.api.runtime.getURL(''));
    } catch (_) {
      return false;
    }
  }
  let useDb = extensionContext();
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const r = indexedDB.open('ajp-store', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => {
          r.result.onversionchange = () => (r.result.close(), (dbp = null));
          resolve(r.result);
        };
        r.onerror = () => reject(r.error);
        r.onblocked = () => reject(new Error('extension database is blocked by another window'));
      }).catch((e) => {
        dbp = null;
        throw e;
      });
    }
    return dbp;
  }
  async function dbDo(mode, op) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('kv', mode);
      const req = op(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('extension database transaction failed'));
    });
  }
  const dbGet = (k) => dbDo('readonly', (s) => s.get(k));
  const dbPut = (k, v) => dbDo('readwrite', (s) => s.put(v, k));
  const dbClear = () => dbDo('readwrite', (s) => s.clear());
  const storeError = (key, e) => (AJP.err ? AJP.err('STORAGE', { key, original: e && e.message }, e) : e);
  // Data saved before the move: copied from storage.local once, then removed there.
  const moved = new Set();
  async function moveFromLocal(key) {
    if (moved.has(key)) return undefined;
    moved.add(key);
    const r = await area().get(key);
    if (r[key] === undefined) return undefined;
    await dbPut(key, r[key]);
    await area().remove(key);
    return r[key];
  }
  const blankKeys = (keys) => Object.fromEntries(Object.keys(keys || {}).map((k) => [k, '']));
  async function readKeys() {
    let keys = await dbGet(KEYS_SLOT);
    if (keys === undefined && !moved.has(KEYS_SLOT)) {
      moved.add(KEYS_SLOT);
      const s = (await area().get('settings')).settings;
      const old = s && s.ai && s.ai.keys;
      if (old && Object.values(old).some(Boolean)) {
        keys = old;
        await dbPut(KEYS_SLOT, keys);
        await area().set({ settings: { ...s, ai: { ...s.ai, keys: blankKeys(old) } } });
      }
    }
    return keys || {};
  }

  // ---- Change notices (both places, every extension context) ----------------------------------------------
  const watchers = [];
  const tell = (changes) => watchers.forEach((fn) => {
    try {
      fn(changes);
    } catch (_) {
      /* one listener failing must not stop the others */
    }
  });
  let chan = null;
  try {
    chan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ajp-store') : null;
    if (chan) chan.onmessage = (e) => e.data && Array.isArray(e.data.keys) && tell(Object.fromEntries(e.data.keys.map((k) => [k, {}])));
  } catch (_) {
    chan = null;
  }
  const announce = (keys) => {
    tell(Object.fromEntries(keys.map((k) => [k, {}])));
    if (chan) chan.postMessage({ keys });
  };
  // Bumped on every change, so a read that started before a write never caches the stale value.
  const versions = new Map();
  const bump = (k) => versions.set(k, (versions.get(k) || 0) + 1);

  function withDefaults(key, value) {
    const def = DEFAULTS[key];
    if (value === undefined) return AJP.clone(def);
    if (AJP.isPlainObject(def) && AJP.isPlainObject(value)) return AJP.deepMerge(def, value);
    return value;
  }

  try {
    AJP.api.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      for (const k of Object.keys(changes)) {
        cache.delete(k);
        bump(k);
      }
      tell(changes);
    });
  } catch (_) {
    /* no extension storage API (e.g. the command-line test runner): the cache simply isn't invalidated */
  }

  AJP.store = {
    DEFAULTS,
    KEYS: Object.keys(DEFAULTS),

    // Called with { key: change } for changes in storage.local and in the extension database.
    onChange(fn) {
      watchers.push(fn);
    },
    // Tests: empty the extension database.
    async _clearDb() {
      if (useDb) await dbClear();
      moved.clear();
    },
    // Tests: run as an extension page (database on) or as a job-site page (off).
    _useDb(on) {
      useDb = !!on && typeof indexedDB !== 'undefined';
      moved.clear();
      return useDb;
    },

    async get(key) {
      if (useDb && DB_KEYS.has(key)) {
        try {
          let v = await dbGet(key);
          if (v === undefined) v = await moveFromLocal(key);
          return withDefaults(key, v);
        } catch (e) {
          throw storeError(key, e);
        }
      }
      if (useDb && key === 'settings') {
        const s = await this.getLocal(key);
        try {
          s.ai.keys = { ...s.ai.keys, ...(await readKeys()) };
        } catch (e) {
          throw storeError(KEYS_SLOT, e);
        }
        return s;
      }
      return this.getLocal(key);
    },

    async getLocal(key) {
      if (cache.has(key)) return AJP.clone(cache.get(key));
      const ver = versions.get(key) || 0;
      const r = await area().get(key);
      const v = withDefaults(key, r[key]);
      if (!INTERNAL.has(key) && (versions.get(key) || 0) === ver) cache.set(key, v);
      return AJP.clone(v);
    },

    async getMany(keys) {
      const out = {};
      await Promise.all(keys.map(async (k) => (out[k] = await this.get(k))));
      return out;
    },

    async set(key, value) {
      if (useDb && DB_KEYS.has(key)) {
        try {
          await (AJP.retry ? AJP.retry(() => dbPut(key, value), { tries: 2, baseMs: 150, retryOn: () => true, label: 'database write' }) : dbPut(key, value));
          if (!moved.has(key)) await moveFromLocal(key).catch(() => {}); // an old copy in storage.local goes away
        } catch (e) {
          if (key !== 'logs' && AJP.logger) AJP.logger('storage').error('Write failed', { key, error: e.message }, { code: 'AJP-STORE' });
          throw storeError(key, e);
        }
        announce([key]);
        return;
      }
      if (useDb && key === 'settings' && value && value.ai && value.ai.keys) {
        try {
          await readKeys(); // finish moving old keys first, so this write isn't undone
          await dbPut(KEYS_SLOT, value.ai.keys);
        } catch (e) {
          throw storeError(KEYS_SLOT, e);
        }
        value = { ...value, ai: { ...value.ai, keys: blankKeys(value.ai.keys) } };
        announce([KEYS_SLOT]);
      }
      cache.delete(key);
      bump(key);
      try {
        // A write can fail briefly (e.g. the browser is busy); retry once before reporting AJP-STORE.
        await (AJP.retry ? AJP.retry(() => area().set({ [key]: value }), { tries: 2, baseMs: 150, retryOn: () => true, label: 'storage write' }) : area().set({ [key]: value }));
      } catch (e) {
        // Usually quota exceeded or storage blocked. Log (except for logs themselves) and surface a coded error.
        if (key !== 'logs' && AJP.logger) AJP.logger('storage').error('Write failed', { key, error: e.message }, { code: 'AJP-STORE' });
        throw AJP.err ? AJP.err('STORAGE', { key, original: e.message }, e) : e;
      }
    },

    // Read-modify-write. fn may mutate and/or return the new value.
    async update(key, fn) {
      const cur = await this.get(key);
      const ret = await fn(cur);
      const next = ret === undefined ? cur : ret;
      await this.set(key, next);
      return next;
    },

    async activeResume() {
      const r = await this.get('resumes');
      return r.items.find((x) => x.id === r.activeId) || r.items[0] || null;
    },

    async exportAll({ includeKeys = false, includeLogs = false } = {}) {
      const data = await this.getMany(this.KEYS.filter((k) => (includeLogs && k === 'logs') || !INTERNAL.has(k)));
      if (!includeKeys && data.settings) data.settings.ai.keys = Object.fromEntries(Object.keys(data.settings.ai.keys || {}).map((k) => [k, '']));
      return { app: 'apply-job-plugin', version: AJP.VERSION, exportedAt: new Date().toISOString(), data };
    },

    async importAll(backup) {
      if (!backup || backup.app !== 'apply-job-plugin' || !backup.data) throw AJP.err('BACKUP_INVALID');
      const toSet = {};
      for (const k of this.KEYS) if (k in backup.data && !INTERNAL.has(k)) toSet[k] = backup.data[k];
      cache.clear();
      for (const k of Object.keys(toSet)) bump(k);
      for (const [k, v] of Object.entries(toSet)) if (useDb && (DB_KEYS.has(k) || k === 'settings')) await this.set(k, v);
      const rest = Object.fromEntries(Object.entries(toSet).filter(([k]) => !(useDb && (DB_KEYS.has(k) || k === 'settings'))));
      if (Object.keys(rest).length) await area().set(rest);
      return Object.keys(toSet);
    },

    async wipe() {
      cache.clear();
      for (const k of this.KEYS) bump(k);
      await area().clear();
      if (useDb) {
        await dbClear();
        announce([...DB_KEYS, KEYS_SLOT]);
      }
    },
  };
})();
