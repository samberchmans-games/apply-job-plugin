/*
 * tracks.js — multiple career tracks (pure logic; no DOM, no storage).
 *
 * A track is one direction the user is looking for, e.g. "AWS Cloud Architect" and "Java Architect".
 *   profile.tracks = [{ id, name, targetTitles[], skills[], resumeId, salary?, workTypes?, areas? }]  (max 3)
 *   profile.skills  = CORE skills shared by every track.
 * With no tracks configured, one implicit "General" track (the profile as it is) is used, so nothing changes
 * for users who never set tracks up — that IS the migration: the existing profile is the first track.
 *
 * Every job is scored against every track; the best track is picked by match % plus how close the job
 * title is to the track's target titles. Tailoring, autofill and applications then use that track.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.tracks) return;

  const MAX_TRACKS = 3;
  const DEFAULT_ID = 'general';
  const TITLE_BONUS = 15; // max points a perfect title match adds when choosing the best track (not shown as the score)

  // All tracks to evaluate. Implicit "General" track when none are configured.
  function list(profile) {
    const t = (profile && Array.isArray(profile.tracks) ? profile.tracks : []).filter((x) => x && x.id && x.name).slice(0, MAX_TRACKS);
    if (t.length) return t;
    return [{ id: DEFAULT_ID, name: 'General', targetTitles: (profile && profile.targetRoles) || [], skills: [], resumeId: null, implicit: true }];
  }

  // The profile as seen by one track: core skills + track skills; track overrides for salary/work types/areas.
  function effectiveProfile(profile, track) {
    const p = AJP.clone(profile || {});
    const seen = new Set();
    p.skills = [...(profile.skills || []), ...((track && track.skills) || []).map((s) => (typeof s === 'string' ? { name: s } : s))].filter((s) => {
      const k = AJP.norm(s && (s.name || s));
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (track && track.salary && (track.salary.min || track.salary.max)) p.salary = { ...profile.salary, ...track.salary };
    if (track && track.workTypes && Object.values(track.workTypes).some(Boolean)) p.workTypes = track.workTypes;
    if (track && Array.isArray(track.areas) && track.areas.length) p.areas = track.areas;
    p.targetRoles = (track && track.targetTitles && track.targetTitles.length ? track.targetTitles : profile.targetRoles) || [];
    return p;
  }

  // Which resume a track uses: its own, else the active one.
  function resumeFor(track, resumes) {
    const items = (resumes && resumes.items) || [];
    return (track && track.resumeId && items.find((r) => r.id === track.resumeId)) || items.find((r) => r.id === (resumes && resumes.activeId)) || items[0] || null;
  }

  // 0..1 — how well a job title fits the track's target titles (token overlap; "Sr" ≈ "Senior").
  function titleFit(jobTitle, track) {
    const norm = (s) => AJP.normKey(String(s || '').replace(/\bsr\b\.?/gi, 'senior').replace(/\bjr\b\.?/gi, 'junior'));
    const toks = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 1 && !['and', 'the', 'of', 'for', 'remote', 'hybrid'].includes(w)));
    const J = toks(jobTitle);
    if (!J.size) return 0;
    let best = 0;
    for (const t of (track && track.targetTitles) || []) {
      const T = toks(t);
      if (!T.size) continue;
      const inter = [...T].filter((w) => J.has(w)).length;
      best = Math.max(best, inter / T.size); // share of the target title found in the job title
    }
    return best;
  }

  /*
   * analyzeAll({ jdText, jobTitle, jobLocation, profile, resumes, aiSkills })
   *   -> { results: [{ track, analysis, titleFit, rank, resumeId }], bestId }
   */
  function analyzeAll({ jdText, jobTitle = '', jobLocation = '', profile, resumes, aiSkills = null }) {
    const results = list(profile).map((track) => {
      const resume = resumeFor(track, resumes);
      const analysis = AJP.matcher.analyze({ jdText, profile: effectiveProfile(profile, track), resumeText: resume ? resume.text : '', aiSkills, jobLocation });
      const tf = titleFit(jobTitle, track);
      return { track: { id: track.id, name: track.name, implicit: !!track.implicit }, analysis, titleFit: Math.round(tf * 100) / 100, rank: (analysis.score || 0) + TITLE_BONUS * tf, resumeId: resume ? resume.id : null };
    });
    const best = results.reduce((a, b) => (b.rank > a.rank ? b : a), results[0]);
    return { results, bestId: best ? best.track.id : DEFAULT_ID };
  }

  // Validate & normalize a tracks list coming from the Admin page.
  function normalize(tracks) {
    return (Array.isArray(tracks) ? tracks : []).slice(0, MAX_TRACKS).map((t, i) => ({
      id: String(t.id || AJP.uid('trk')),
      name: String(t.name || `Track ${i + 1}`).trim().slice(0, 60),
      targetTitles: (t.targetTitles || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 10),
      skills: (t.skills || []).map((s) => (typeof s === 'string' ? { name: s } : s)).filter((s) => s && s.name).slice(0, 60),
      resumeId: t.resumeId || null,
      salary: t.salary && (t.salary.min || t.salary.max) ? { min: String(t.salary.min || ''), max: String(t.salary.max || '') } : null,
      workTypes: t.workTypes && Object.values(t.workTypes).some(Boolean) ? t.workTypes : null,
    }));
  }

  /*
   * insights(trackId, { evaluations, applications }) — what this direction looks like so far.
   *   evaluations: [{ jobKey, title, company, at, scores:{[trackId]:n}, gaps:{[trackId]:[skill]} }]
   */
  function insights(trackId, { evaluations = [], applications = [] } = {}) {
    const evs = evaluations.filter((e) => e.scores && e.scores[trackId] != null);
    const scores = evs.map((e) => e.scores[trackId]);
    const gapCount = {};
    for (const e of evs) for (const g of (e.gaps && e.gaps[trackId]) || []) gapCount[g] = (gapCount[g] || 0) + 1;
    const topGaps = Object.entries(gapCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([skill, count]) => ({ skill, count, pct: Math.round((100 * count) / evs.length) }));
    const apps = applications.filter((a) => a.trackId === trackId);
    const bestFor = evaluations.filter((e) => e.bestTrackId === trackId).length;
    return {
      evaluated: evs.length,
      bestFor,
      avgScore: scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : null,
      applied: apps.filter((a) => a.appliedAt).length,
      interviews: apps.filter((a) => ['interviewing', 'offer'].includes(a.status) || (a.statusHistory || []).some((h) => h.status === 'interviewing')).length,
      topGaps,
    };
  }

  // Keep the last 300 evaluations, one per job (latest wins).
  function addEvaluation(list, ev, max = 300) {
    const out = list.filter((x) => x.jobKey !== ev.jobKey);
    out.unshift(ev);
    return out.slice(0, max);
  }

  AJP.tracks = { MAX_TRACKS, DEFAULT_ID, list, effectiveProfile, resumeFor, titleFit, analyzeAll, normalize, insights, addEvaluation };
})();
