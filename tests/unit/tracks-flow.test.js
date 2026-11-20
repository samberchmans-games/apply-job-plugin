/*
 * Career tracks end to end: panel tabs + switching, per-track tailoring/autofill/tracking, Admin tracks screen.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, excludes, beforeEach, afterEach, waitFor, sleep } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const mock = globalThis.browser;
  const sh = () => document.querySelector('ajp-panel') && document.querySelector('ajp-panel').shadowRoot;

  const CLOUD = { id: 'cloud', name: 'AWS Cloud Architect', targetTitles: ['Cloud Architect'], skills: [{ name: 'AWS' }, { name: 'Terraform' }, { name: 'Kubernetes' }, { name: 'Docker' }], resumeId: 'rc' };
  const JAVA = { id: 'java', name: 'Java Architect', targetTitles: ['Java Architect'], skills: [{ name: 'Spring' }, { name: 'Microservices' }, { name: 'Kafka' }], resumeId: null };
  const CLOUD_RESUME = '# Ana\n## Experience\n### Cloud Engineer — Acme (2020–Present)\n- Automated AWS infrastructure with Terraform\n- Ran Docker workloads on AWS ECS\n## Skills\nAWS, Terraform, Docker';
  const JAVA_RESUME = '# Ana\n## Experience\n### Java Lead — Globex (2016–2020)\n- Built Spring microservices in Java\n- Introduced Kafka event streaming\n## Skills\nJava, Spring, Kafka';
  const JD_CLOUD = 'Requirements\n- AWS\n- Terraform\n- Kubernetes\n- Docker\n- Python';

  async function setup({ tracks = [CLOUD, JAVA] } = {}) {
    await mock.__reset();
    await AJP.store.update('profile', (p) => {
      p.personal.firstName = 'Ana';
      p.personal.email = 'ana@example.com';
      p.skills = [{ name: 'Python' }, { name: 'SQL' }];
      p.tracks = tracks;
    });
    await AJP.store.set('resumes', {
      activeId: 'rj',
      items: [
        { id: 'rj', name: 'Java resume', text: JAVA_RESUME, file: { name: 'ana-java.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK' } },
        { id: 'rc', name: 'Cloud resume', text: CLOUD_RESUME, file: { name: 'ana-cloud.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK' } },
      ],
    });
  }
  const open = async (jdText = JD_CLOUD) => {
    await AJP.send('analyzeTab', { tabId: 1, jdText });
    return waitFor(() => sh() && sh().querySelector('.badge') && /\d+%/.test(sh().querySelector('.badge').textContent) && sh(), { msg: 'panel' });
  };

  describe('tracks flow › panel', () => {
    beforeEach(() => setup());
    afterEach(() => AJP.panel.remove());

    it('shows a tab per track with its score; the best one is starred and selected', async () => {
      const s = await open();
      const tabs = [...s.querySelectorAll('.tk')];
      eq(tabs.length, 2);
      includes(tabs[0].textContent, '★ AWS Cloud Architect');
      ok(tabs[0].classList.contains('on'));
      ok(/Java Architect \d+%/.test(tabs[1].textContent));
    });
    it('switching track changes the score and chips', async () => {
      const s = await open();
      const before = s.querySelector('.badge').textContent;
      s.querySelectorAll('.tk')[1].click();
      await waitFor(() => sh().querySelectorAll('.tk')[1].classList.contains('on'), { msg: 'switched' });
      ok(sh().querySelector('.badge').textContent !== before);
    });
    it('records the job with a score per track (for insights/compare)', async () => {
      await open();
      const ev = await waitFor(async () => (await AJP.store.get('evaluations'))[0], { msg: 'evaluation' });
      eq(Object.keys(ev.scores).sort(), ['cloud', 'java']);
      eq(ev.bestTrackId, 'cloud');
      includes(ev.gaps.java, 'Terraform');
    });
    it('a different job gets its own best track, not the last manual pick', async () => {
      const s = await open();
      s.querySelectorAll('.tk')[1].click(); // pick Java for this job
      await waitFor(() => sh().querySelectorAll('.tk')[1].classList.contains('on'));
      const s2 = await open(JD_CLOUD + '\n- Docker Swarm'); // next job (SPA navigation)
      await waitFor(() => s2.querySelectorAll('.tk')[0].classList.contains('on'), { msg: 'best track selected again' });
    });
    it('no tabs and no history when no tracks are set up', async () => {
      await setup({ tracks: [] });
      const s = await open();
      eq(s.querySelectorAll('.tk').length, 0);
      await sleep(50);
      eq((await AJP.store.get('evaluations')).length, 0);
    });
  }, { env: 'browser' });

  describe('tracks flow › the chosen track is used everywhere', () => {
    let realFetch;
    beforeEach(async () => {
      await setup();
      realFetch = globalThis.fetch;
      document.getElementById('sandbox').innerHTML = '';
      await open('Requirements\n- COBOL'); // a different job first, so no earlier manual track pick carries over
    });
    afterEach(() => {
      globalThis.fetch = realFetch;
      AJP.panel.remove();
      document.getElementById('sandbox').innerHTML = '';
    });

    it('Mark applied stores the track and that track\'s resume', async () => {
      const s = await open();
      s.querySelector('[data-act="applied"]').click();
      const a = await waitFor(async () => (await AJP.store.get('applications'))[0], { msg: 'app' });
      eq([a.trackId, a.trackName, a.resumeName], ['cloud', 'AWS Cloud Architect', 'Cloud resume']);
    });
    it('after switching to Java, Mark applied uses the Java track and resume', async () => {
      const s = await open();
      s.querySelectorAll('.tk')[1].click();
      await waitFor(() => sh().querySelectorAll('.tk')[1].classList.contains('on'));
      sh().querySelector('[data-act="applied"]').click();
      const a = await waitFor(async () => (await AJP.store.get('applications'))[0]);
      eq([a.trackName, a.resumeName], ['Java Architect', 'Java resume']);
    });
    it('Autofill attaches the chosen track\'s resume file', async () => {
      document.getElementById('sandbox').innerHTML = '<label for="cv">Resume/CV</label><input id="cv" type="file"><label for="fn">First name</label><input id="fn">';
      const s = await open();
      s.querySelector('[data-act="autofill"]').click();
      await waitFor(() => document.getElementById('cv').files.length, { msg: 'file attached' });
      eq(document.getElementById('cv').files[0].name, 'ana-cloud.pdf');
    });
    it('Autofill attaches the resume tailored for THIS job, and the panel names the file', async () => {
      await AJP.store.update('resumes', (r) => void r.items.push({ id: 'rt', name: 'Tailored', text: CLOUD_RESUME, enhancementId: 'enh1', job: { url: location.href, company: 'Initech' },
        file: { name: 'Ana - Resume - Initech.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK', generated: true } }));
      document.getElementById('sandbox').innerHTML = '<label for="cv">Resume/CV</label><input id="cv" type="file">';
      const s = await open();
      s.querySelector('[data-act="autofill"]').click();
      await waitFor(() => document.getElementById('cv').files.length, { msg: 'file attached' });
      eq(document.getElementById('cv').files[0].name, 'Ana - Resume - Initech.pdf');
      await waitFor(() => /Resume attached: Ana - Resume - Initech\.pdf/.test(sh().textContent), { msg: 'panel names the file' });
    });
    it('a resume tailored for a DIFFERENT job is not used', async () => {
      await AJP.store.update('resumes', (r) => void r.items.push({ id: 'rt', name: 'Tailored', text: CLOUD_RESUME, enhancementId: 'enh1', job: { url: 'https://jobs.example.com/other-job' },
        file: { name: 'other.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK' } }));
      document.getElementById('sandbox').innerHTML = '<label for="cv">Resume/CV</label><input id="cv" type="file">';
      const s = await open();
      s.querySelector('[data-act="autofill"]').click();
      await waitFor(() => document.getElementById('cv').files.length, { msg: 'file attached' });
      eq(document.getElementById('cv').files[0].name, 'ana-cloud.pdf');
    });
    it('Tailor resume uses the track\'s resume and skills, and the draft is labelled with the track', async () => {
      await AJP.store.update('settings', (x) => { x.ai.provider = 'groq'; x.ai.keys.groq = 'k'; });
      const bodies = [];
      const answers = [
        { requirements: [{ id: 'R1', text: 'AWS', priority: 'must', match: 'strong', evidence: [{ quote: 'Automated AWS infrastructure with Terraform' }] },
          { id: 'R2', text: 'Terraform', priority: 'must', match: 'strong', evidence: [{ quote: 'Automated AWS infrastructure with Terraform' }] },
          { id: 'R3', text: 'Kubernetes', priority: 'must', match: 'none', evidence: [] }], ats_keywords: ['AWS'] },
        { edits: [{ target: 'b1', after: 'Automated AWS infrastructure with Terraform, reducing manual provisioning', requirement_ids: ['R1'], evidence: ['Automated AWS infrastructure with Terraform'], reason: 'r' }] },
      ];
      let i = 0;
      globalThis.fetch = async (u, o) => {
        bodies.push(o.body);
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answers[i++]) } }] }));
      };
      const s = await open();
      s.querySelector('[data-act="tailor"]').click();
      await waitFor(() => /job requirements/.test(sh().textContent), { msg: 'summary', timeout: 4000 });
      includes(bodies[0], 'Automated AWS infrastructure with Terraform');
      excludes(bodies[0], 'Built Spring microservices');
      includes(JSON.parse(bodies[1]).messages[1].content, 'CANDIDATE SKILLS: ["Python","SQL","AWS","Terraform"'); // core + track skills
      const d = (await AJP.store.get('enhancements'))[0];
      eq([d.trackId, d.trackName, d.resumeId], ['cloud', 'AWS Cloud Architect', 'rc']);
      // "make active" on a track draft = becomes that track's resume; the global active resume stays
      const r = await AJP.send('resume.applyEnhancement', { id: d.id, makeActive: true });
      ok(r.ok, r.error);
      eq((await AJP.store.get('profile')).tracks.find((t) => t.id === 'cloud').resumeId, r.resume.id);
      eq((await AJP.store.get('resumes')).activeId, 'rj');
      eq(r.resume.trackId, 'cloud');
    });
  }, { env: 'browser' });

  describe('tracks flow › Admin tracks screen', () => {
    let frame;
    let w;
    const $ = (s) => w.document.querySelector(s);
    async function loadAdmin(seed) {
      let html = await (await fetch('../src/admin/admin.html', { cache: 'no-store' })).text();
      html = html.replace('<script src="tracker-view.js"></script>', '<script src="../background/background.js"></script>\n<script src="tracker-view.js"></script>');
      const page = html.replace('<head>', '<head><base href="' + new URL('../src/admin/', location.href).href + '"><script>window.__SEED__=' + JSON.stringify(seed) + '</script>')
        .replace('<script src="../lib/core.js"></script>', '<script src="../../tests/mocks/browser-mock.js"></script><script>browser.storage.local.set(window.__SEED__)</script><script src="../lib/core.js"></script>');
      frame = document.createElement('iframe');
      frame.style.cssText = 'width:1200px;height:800px;border:0;position:absolute;left:-5000px;top:0';
      document.body.appendChild(frame);
      await new Promise((res) => {
        frame.onload = res;
        frame.srcdoc = page;
      });
      w = frame.contentWindow;
      await waitFor(() => w.AJP && w.AJP.tracksView && $('#ver').textContent, { msg: 'admin' });
      w.location.hash = 'tracks';
      await waitFor(() => $('#tracks').classList.contains('on'), { msg: 'tracks tab' });
    }
    const evaluations = [
      { jobKey: 'k1', url: 'https://x.com/1', title: 'Cloud Architect', company: 'A', at: '2026-11-10T00:00:00Z', bestTrackId: 'cloud', scores: { cloud: 80, java: 40 }, gaps: { cloud: ['Kubernetes'], java: ['AWS'] } },
      { jobKey: 'k2', url: 'https://x.com/2', title: 'Java Architect', company: 'B', at: '2026-11-11T00:00:00Z', bestTrackId: 'java', scores: { cloud: 30, java: 90 }, gaps: { cloud: ['Kubernetes', 'Spring'], java: [] } },
    ];
    afterEach(() => frame && frame.remove());

    it('shows each track with insights and the compare table', async () => {
      await loadAdmin({ profile: { tracks: [CLOUD, JAVA] }, evaluations, applications: [{ id: 'a', trackId: 'cloud', appliedAt: 'x', status: 'applied' }] });
      await waitFor(() => w.document.querySelectorAll('.track').length === 2 && w.document.querySelector('[data-ins="cloud"] .tile'), { msg: 'cards' });
      const ins = $('[data-ins="cloud"]').textContent;
      includes(ins, '2Jobs evaluated');
      includes(ins, '55%Average match');
      includes(ins, '1Applied');
      includes(ins, 'Kubernetes · 100%');
      const rows = w.document.querySelectorAll('#trackCompare tbody tr');
      eq(rows.length, 2);
      includes(rows[0].querySelector('.best').textContent, '80% ★');
    });
    it('adding and editing a track saves it to the profile; max 3', async () => {
      await loadAdmin({ profile: { tracks: [] } });
      for (let i = 0; i < 3; i++) {
        $('#trackAdd').click();
        await waitFor(() => w.document.querySelectorAll('.track').length === i + 1, { msg: 'added ' + i });
      }
      ok($('#trackAdd').disabled);
      const name = w.document.querySelector('.track [data-k="name"]');
      name.value = 'Data Engineer';
      name.dispatchEvent(new w.Event('input', { bubbles: true }));
      const titles = w.document.querySelector('.track [data-k="targetTitles"]');
      titles.value = 'Data Engineer, Analytics Engineer';
      titles.dispatchEvent(new w.Event('input', { bubbles: true }));
      const t = await waitFor(async () => {
        const p = await w.AJP.store.get('profile');
        return p.tracks[0] && p.tracks[0].name === 'Data Engineer' && p.tracks[0].targetTitles.length === 2 && p.tracks[0];
      }, { msg: 'saved' });
      eq(t.targetTitles, ['Data Engineer', 'Analytics Engineer']);
    });
    it('deleting a track removes it', async () => {
      await loadAdmin({ profile: { tracks: [CLOUD, JAVA] } });
      await waitFor(() => w.document.querySelectorAll('.track').length === 2);
      w.confirm = () => true;
      w.document.querySelector('[data-del="1"]').click();
      await waitFor(async () => (await w.AJP.store.get('profile')).tracks.length === 1, { msg: 'deleted' });
    });
    it('Applications can be filtered by track', async () => {
      await loadAdmin({ applications: [{ id: 'a', company: 'A', title: 'x', status: 'applied', trackName: 'AWS Cloud Architect' }, { id: 'b', company: 'B', title: 'y', status: 'applied', trackName: 'Java Architect' }] });
      w.location.hash = 'applications';
      await waitFor(() => w.document.querySelectorAll('.board .app').length === 2, { msg: 'board' });
      const sel = $('#trkTrack');
      notOk(sel.hidden);
      sel.value = 'Java Architect';
      sel.dispatchEvent(new w.Event('change'));
      await waitFor(() => w.document.querySelectorAll('.board .app').length === 1, { msg: 'filtered' });
      includes(w.document.querySelector('.board .app').textContent, 'Java Architect');
    });
  }, { env: 'browser' });
})();
