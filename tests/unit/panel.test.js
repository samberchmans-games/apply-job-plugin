(function () {
  const { describe, it, eq, ok, notOk, includes, afterEach } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const host = () => document.querySelector('ajp-panel');
  const shadow = () => host() && host().shadowRoot;
  const text = () => shadow().textContent;

  const analysis = (score = 72) => ({
    score,
    matched: [{ skill: 'Python', weight: 3, source: 'profile' }],
    missing: [{ skill: 'Kafka', weight: 1, importance: 'preferred' }, { skill: 'Kubernetes', weight: 3, importance: 'required' }],
    jdSkillCount: 3,
    ms: 4,
    fit: {
      workType: { job: ['remote'], wanted: ['remote'], ok: true },
      salary: { job: { min: 150000, max: 190000, hourly: false }, ok: true },
      location: { matched: null, ok: null },
    },
  });

  describe('panel › rendering', () => {
    afterEach(() => AJP.panel.remove());

    it('shows score, job, matching and gap skills, fit', () => {
      AJP.panel.render({ job: { title: 'Dev', company: 'Acme' }, analysis: analysis() }, {});
      includes(text(), '72%');
      includes(text(), 'Dev');
      includes(text(), 'Acme');
      includes(text(), 'Python');
      includes(text(), 'Kafka');
      includes(text(), '$150k–$190k');
      eq(shadow().querySelectorAll('.chip.ok').length, 1);
      eq(shadow().querySelectorAll('.chip.no').length, 2);
      eq(shadow().querySelectorAll('.chip.no.pref').length, 1);
    });
    it('only one panel exists even after many renders', () => {
      for (let i = 0; i < 5; i++) AJP.panel.render({ analysis: analysis(i * 10) }, {});
      eq(document.querySelectorAll('ajp-panel').length, 1);
    });
    it('page text is escaped (no HTML/script injection from job pages)', () => {
      AJP.panel.render({ job: { title: '<img src=x onerror="window.__pwned=1">', company: '<b>x</b>' }, analysis: { ...analysis(), matched: [{ skill: '<script>bad()</script>', source: 'p' }] } }, {});
      notOk(shadow().querySelector('img'));
      notOk(shadow().querySelector('script'));
      notOk(shadow().querySelector('.job b b'));
      includes(text(), '<img src=x');
      notOk(window.__pwned);
    });
    it('shows "?" when no score could be computed', () => {
      AJP.panel.render({ analysis: { ...analysis(), score: null } }, {});
      includes(shadow().querySelector('.badge').textContent, '–');
    });
    it('shows a helpful error when no JD was found', () => {
      AJP.panel.render({ error: 'Could not find a job description on this page.' }, {});
      includes(text(), 'Could not find a job description');
      includes(text(), 'analyze selection');
    });
    it('minimized state hides the body', () => {
      AJP.panel.render({ analysis: analysis(), minimized: true }, {});
      ok(shadow().querySelector('.wrap.min'));
    });
    it('buttons call their handlers', () => {
      const calls = [];
      const cb = { ai: () => calls.push('ai'), tailor: () => calls.push('tailor'), autofill: () => calls.push('autofill'), applied: () => calls.push('applied'), close: () => calls.push('close') };
      AJP.panel.render({ analysis: analysis() }, cb);
      for (const act of ['ai', 'tailor', 'autofill', 'applied', 'close']) shadow().querySelector(`[data-act="${act}"]`).click();
      eq(calls, ['ai', 'tailor', 'autofill', 'applied', 'close']);
    });
    it('buttons are disabled while busy', () => {
      AJP.panel.render({ analysis: analysis(), busy: 'ai' }, {});
      ok(shadow().querySelector('[data-act="ai"]').disabled);
      ok(shadow().querySelector('[data-act="autofill"]').disabled);
    });
    it('shows the autofill report and a draft button per question', () => {
      AJP.panel.render({ analysis: analysis(), autofill: { filled: ['a', 'b'], learned: ['c'], unknown: ['Snack'], questions: [{ ajpId: 'f1', label: 'Why us?' }], skipped: [] } }, {});
      includes(text(), 'Filled 2 from profile, 1 from learned answers');
      includes(text(), 'Snack');
      includes(text(), 'Review everything, then submit yourself');
      eq(shadow().querySelector('[data-act="draft"]').dataset.arg, 'f1');
    });
    it('page CSS cannot leak into the panel (Shadow DOM)', () => {
      const st = document.createElement('style');
      st.textContent = '.chip { display: none !important; }';
      document.head.appendChild(st);
      AJP.panel.render({ analysis: analysis() }, {});
      ok(getComputedStyle(shadow().querySelector('.chip')).display !== 'none');
      st.remove();
    });
    it('remove() takes it off the page', () => {
      AJP.panel.render({ analysis: analysis() }, {});
      AJP.panel.remove();
      eq(host(), null);
    });
  }, { env: 'browser' });
})();
