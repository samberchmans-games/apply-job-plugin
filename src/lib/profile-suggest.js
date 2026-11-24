/*
 * profile-suggest.js — suggest profile updates from learned answers.
 *
 * When you keep typing the same answer into application forms (notice period, desired salary, LinkedIn…),
 * Admin offers to save it to your profile, so Autofill fills it everywhere from then on.
 *
 *   AJP.profileSuggest.list(profile, answers, dismissed)  -> [{ id, key, path, field, label, current, proposed, count, hosts, empty }]
 *   AJP.profileSuggest.apply(profile, suggestion)         -> profile (mutated copy-safe: call inside store.update)
 *
 * Rules:
 *  - A learned answer is matched to a profile field with the same rules Autofill uses (field-rules.js).
 *  - Empty profile field + answered at least once → suggested. A DIFFERENT value already in the profile →
 *    suggested only when you typed the other value at least twice (one odd form shouldn't nag you).
 *  - Several answers for one field → the most used wins (then the most recent).
 *  - Never suggested: EEO answers (race, gender, veteran, disability, Hispanic, pronouns), names split from a full
 *    name, education/experience lists, cover letters. Those stay where you put them.
 *  - Dismissed suggestions stay dismissed for that value (a new value can be suggested again).
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.profileSuggest) return;

  const yesNo = (v) => {
    const t = String(v || '').trim();
    return /^(y|yes|true)\b/i.test(t) ? 'Yes' : /^(n|no|false)\b/i.test(t) ? 'No' : '';
  };
  const number = (v) => {
    const m = String(v || '').replace(/,/g, '').match(/\d+(\.\d+)?/);
    return m ? String(Math.round(parseFloat(m[0]))) : '';
  };
  const money = (v) => {
    const t = String(v || '').replace(/[,\s$€£]/g, '');
    const m = t.match(/(\d+(?:\.\d+)?)(k)?/i);
    if (!m) return '';
    const n = parseFloat(m[1]) * (m[2] ? 1000 : 1);
    return n >= 1000 ? String(Math.round(n)) : ''; // "150" alone is ambiguous (hourly? thousands?) → not suggested
  };
  const text = (v) => String(v || '').trim().slice(0, 200);

  const TARGETS = {
    email: { path: 'personal.email', field: 'Email' },
    phone: { path: 'personal.phone', field: 'Phone' },
    linkedin: { path: 'personal.linkedin', field: 'LinkedIn' },
    github: { path: 'personal.github', field: 'GitHub' },
    website: { path: 'personal.website', field: 'Website / portfolio' },
    address: { path: 'personal.address', field: 'Address' },
    city: { path: 'personal.city', field: 'City' },
    state: { path: 'personal.state', field: 'State / province' },
    zip: { path: 'personal.zip', field: 'ZIP / postal code' },
    country: { path: 'personal.country', field: 'Country' },
    currentCompany: { path: 'personal.currentCompany', field: 'Current company' },
    currentTitle: { path: 'personal.currentTitle', field: 'Current title' },
    years: { path: 'personal.yearsExperience', field: 'Total years of experience', norm: number },
    salary: { path: 'salary.min', field: 'Minimum salary', norm: money },
    notice: { path: 'autoApply.noticePeriod', field: 'Notice period' },
    startDate: { path: 'autoApply.earliestStart', field: 'Earliest start date' },
    relocate: { path: 'willingToRelocate', field: 'Willing to relocate', norm: yesNo },
    sponsorship: { path: 'autoApply.requireSponsorship', field: 'Requires visa sponsorship', norm: yesNo },
    workAuth: { path: 'autoApply.workAuthorized', field: 'Authorized to work', norm: yesNo },
    over18: { path: 'autoApply.over18', field: 'At least 18 years old', norm: yesNo },
    govOfficial: { path: 'autoApply.govOfficial', field: 'Government official', norm: yesNo },
    govRelative: { path: 'autoApply.govRelative', field: 'Relative of a government official', norm: yesNo },
    conflict: { path: 'autoApply.conflict', field: 'Conflict of interest', norm: yesNo },
    heardFrom: { path: 'autoApply.heardFrom', field: 'How you heard about the job' },
  };

  const get = (o, path) => path.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  function set(o, path, v) {
    const ks = path.split('.');
    let x = o;
    for (const k of ks.slice(0, -1)) x = x[k] = x[k] || {};
    x[ks[ks.length - 1]] = v;
  }
  const same = (a, b) => AJP.norm(a) === AJP.norm(b);
  const idOf = (key, value) => `${key}:${AJP.normKey(value)}`;

  function list(profile, answers, dismissed = {}) {
    const best = new Map();
    for (const a of Object.values(answers || {})) {
      if (!a || !a.label || a.value == null) continue;
      const rule = AJP.fieldRules.ruleFor(a.label);
      const t = rule && TARGETS[rule.key];
      if (!t) continue;
      const proposed = (t.norm || text)(a.value);
      if (!proposed) continue;
      const current = get(profile, t.path);
      const curNorm = t.norm ? t.norm(current) : text(current);
      if (curNorm && same(curNorm, proposed)) continue;
      const empty = !String(current == null ? '' : current).trim();
      if (!empty && (a.count || 0) < 2) continue;
      const s = { id: idOf(rule.key, proposed), key: rule.key, path: t.path, field: t.field, label: a.label, current: current == null ? '' : String(current), proposed, count: a.count || 1, hosts: a.hosts || [], lastUsed: a.lastUsed || '', empty };
      if (dismissed[s.id]) continue;
      const cur = best.get(rule.key);
      if (!cur || s.count > cur.count || (s.count === cur.count && s.lastUsed > cur.lastUsed)) best.set(rule.key, s);
    }
    return [...best.values()].sort((a, b) => b.empty - a.empty || b.count - a.count || a.field.localeCompare(b.field));
  }

  function apply(profile, s) {
    if (!TARGETS[s.key] || TARGETS[s.key].path !== s.path) throw AJP.err('INTERNAL', { reason: 'unknown profile suggestion', key: s.key });
    set(profile, s.path, s.proposed);
    return profile;
  }

  AJP.profileSuggest = { TARGETS, list, apply };
})();
