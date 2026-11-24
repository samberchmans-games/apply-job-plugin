(function () {
  'use strict';
  const AJP = globalThis.AJP;
  AJP.logContext = 'popup';
  const log = AJP.logger('popup');
  AJP.captureErrors('popup', { notify: (d) => showErr({ error: d.message, hint: d.hint, code: d.code }) });
  const $ = (id) => document.getElementById(id);
  $('ver').textContent = 'v' + AJP.VERSION;

  async function activeTabId() {
    const [tab] = await AJP.api.tabs.query({ active: true, currentWindow: true });
    return tab && tab.id;
  }

  function showErr(r) {
    $('err').hidden = false;
    $('err').textContent = `${r.error}${r.hint ? ' ' + r.hint : ''} (${r.code || 'AJP-INTERNAL'})`;
  }

  async function run(type) {
    const tabId = await activeTabId();
    const r = await AJP.send(type, { tabId });
    if (!r.ok) return showErr(r);
    window.close();
  }

  $('analyze').onclick = () => run('analyzeTab');
  $('autofill').onclick = () => run('autofillTab');
  $('admin').onclick = () => AJP.send('openAdmin', {}).then(() => window.close());
  $('report').onclick = (e) => {
    e.preventDefault();
    AJP.send('openAdmin', { hash: 'logs?report=1' }).then(() => window.close());
  };

  (async () => {
    const { profile, settings, resumes, applications, answers, suggestions } = await AJP.store.getMany(['profile', 'settings', 'resumes', 'applications', 'answers', 'suggestions']);
    const sug = AJP.profileSuggest.list(profile, answers, suggestions.dismissed).length;
    const due = AJP.tracker.dueFollowUps(applications, Date.now(), Number(settings.tracker.followUpDays) || 7);
    const warn = [];
    if (!profile.personal.firstName || !profile.personal.email) warn.push('Profile incomplete');
    if (!profile.skills.length) warn.push('No skills added');
    if (!resumes.items.length) warn.push('No resume saved');
    const ai = settings.ai.provider === 'none' ? 'AI off (offline matching)' : settings.ai.provider === 'chrome' ? 'AI: Chrome built-in (on this computer)' : 'AI: ' + settings.ai.provider;
    $('status').innerHTML =
      `${profile.skills.length} skills · ${resumes.items.length} resume(s) · ${ai}` +
      (warn.length ? `<br><span class="warn">⚠ ${warn.join(' · ')}</span>` : '') +
      (due.length ? `<br><a href="#" id="due" class="warn">🔔 ${due.length} follow-up${due.length > 1 ? 's' : ''} due</a>` : '') +
      (sug ? `<br><a href="#" id="sug">💡 ${sug} profile suggestion${sug > 1 ? 's' : ''} from your answers</a>` : '');
    const sugLink = $('sug');
    if (sugLink) sugLink.onclick = (e) => {
      e.preventDefault();
      AJP.send('openAdmin', { hash: 'answers' }).then(() => window.close());
    };
    const dueLink = $('due');
    if (dueLink) dueLink.onclick = (e) => {
      e.preventDefault();
      AJP.send('openAdmin', { hash: 'applications?due=1' }).then(() => window.close());
    };
    log.debug('Popup opened');
  })();

  // Job Radar: new matches (same count as the blue badge), the top 5, and "See all".
  (async () => {
    const box = $('radar');
    const st = await AJP.send('radar.status');
    if (!st || st.ok === false) return;
    const openRadar = (e) => {
      e.preventDefault();
      AJP.send('openAdmin', { hash: 'radar' }).then(() => window.close());
    };
    if (!st.companies) {
      box.innerHTML = '<a href="#" id="radarAll">🛰 Job Radar: watch companies for new jobs that fit you →</a>';
    } else {
      const r = await AJP.send('radar.jobs', { status: 'new', limit: 5, eligible: true });
      const jobs = r && r.ok !== false ? r.jobs : [];
      const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      box.innerHTML =
        `<b>🛰 ${st.newCount ? `${st.newCount} new job match${st.newCount === 1 ? '' : 'es'}` : 'Job Radar: no new matches'}</b>` +
        (jobs.length ? `<ul>${jobs.map((j) => `<li><a href="${esc(AJP.safeUrl(j.url))}" target="_blank" rel="noopener" data-url="${esc(j.url)}">${esc(j.title)}</a> <span class="muted">${esc(j.companyName)} · ${j.score == null ? 'title only' : j.score + '%'}${j.postedAt && Date.now() - Date.parse(j.postedAt) < 86400000 ? ' · <b>today</b>' : ''}</span></li>`).join('')}</ul>` : '') +
        '<a href="#" id="radarAll">See all in Job Radar →</a>';
      box.querySelectorAll('a[data-url]').forEach((a) => (a.onclick = (e) => {
        e.preventDefault();
        AJP.api.tabs.create({ url: a.dataset.url }).then(() => window.close());
      }));
    }
    box.hidden = false;
    $('radarAll').onclick = openRadar;
  })();
})();
