(function () {
  'use strict';
  const AJP = globalThis.AJP;
  AJP.logContext = 'popup';
  const log = AJP.logger('popup');
  const $ = (id) => document.getElementById(id);
  $('ver').textContent = 'v' + AJP.VERSION;

  async function activeTabId() {
    const [tab] = await AJP.api.tabs.query({ active: true, currentWindow: true });
    return tab && tab.id;
  }

  function showErr(e) {
    $('err').hidden = false;
    $('err').textContent = e;
  }

  async function run(type) {
    const tabId = await activeTabId();
    const r = await AJP.send(type, { tabId });
    if (!r.ok) return showErr(r.error);
    window.close();
  }

  $('analyze').onclick = () => run('analyzeTab');
  $('autofill').onclick = () => run('autofillTab');
  $('admin').onclick = () => AJP.send('openAdmin', {}).then(() => window.close());

  (async () => {
    const { profile, settings, resumes, applications } = await AJP.store.getMany(['profile', 'settings', 'resumes', 'applications']);
    const due = AJP.tracker.dueFollowUps(applications, Date.now(), Number(settings.tracker.followUpDays) || 7);
    const warn = [];
    if (!profile.personal.firstName || !profile.personal.email) warn.push('Profile incomplete');
    if (!profile.skills.length) warn.push('No skills added');
    if (!resumes.items.length) warn.push('No resume saved');
    const ai = settings.ai.provider === 'none' ? 'AI off (offline matching)' : 'AI: ' + settings.ai.provider;
    $('status').innerHTML =
      `${profile.skills.length} skills · ${resumes.items.length} resume(s) · ${ai}` +
      (warn.length ? `<br><span class="warn">⚠ ${warn.join(' · ')}</span>` : '') +
      (due.length ? `<br><a href="#" id="due" class="warn">🔔 ${due.length} follow-up${due.length > 1 ? 's' : ''} due</a>` : '');
    const dueLink = $('due');
    if (dueLink) dueLink.onclick = (e) => {
      e.preventDefault();
      AJP.send('openAdmin', { hash: 'applications?due=1' }).then(() => window.close());
    };
    log.debug('Popup opened');
  })();
})();
