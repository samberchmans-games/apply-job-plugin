/*
 * Findings from an outside code review (Nov 2026), each checked against the current code and fixed here.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, beforeEach, afterEach } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const E = () => AJP.resumeEngine;

  describe('review fixes › resume tailoring', () => {
    it('a new summary plus a skills edit: "Additional skills" is added once', () => {
      const text = '# Alex\n## Experience\n### Engineer, Acme (2020 - Present)\n- Built pipelines with Spark.\n## Skills\nLanguages: Python, SQL';
      const out = E().assemble(text, [{ target: 'skills', after: ['Python', 'SQL', 'Airflow'] }, { target: 'summary', after: 'Data engineer with 10 years.' }]);
      eq(out.split('Additional skills').length - 1, 1);
      includes(out, 'Data engineer with 10 years.');
    });
    it('a date line in a new section does not join text from the section before', () => {
      const doc = E().parse('## Experience\nSenior Engineer | Acme\n- Built X\n## Projects\n2021 - 2022\n- Built Y');
      const y = doc.bullets.find((b) => /Built Y/.test(b.text));
      notOk(/Acme/.test(y.role), y.role);
    });
    it('a date line after a job\'s bullets starts the next job; it does not join the job above (B65)', () => {
      const doc = E().parse('## Experience\nSenior Engineer | Acme\n- Built X\n2019 - 2021\n- Built Y');
      const y = doc.bullets.find((b) => /Built Y/.test(b.text));
      notOk(/Acme/.test(y.role), y.role);
      const x = doc.bullets.find((b) => /Built X/.test(b.text));
      ok(/Acme/.test(x.role), x.role);
    });
    it('a date line right under a title still joins it', () => {
      const doc = E().parse('## Experience\nData Engineer, Globex\n2015 - 2019\n- Built Z');
      ok(/Globex.*2015 - 2019/.test(doc.bullets[0].role), doc.bullets[0].role);
    });
    it('"## Technical Expertise" after Experience is a section, not a job line', () => {
      const doc = E().parse('## Experience\n### Engineer, Acme (2020 - Present)\n- Built pipelines.\n## Technical Expertise\nPython, SQL, Spark');
      eq(doc.skills.map((b) => b.text), ['Python, SQL, Spark']);
    });
  });

  describe('review fixes › links and prompts', () => {
    it('only http(s) links', () => {
      eq(AJP.safeUrl('https://boards.greenhouse.io/x/jobs/1'), 'https://boards.greenhouse.io/x/jobs/1');
      eq(AJP.safeUrl('javascript:alert(1)'), '');
      eq(AJP.safeUrl('data:text/html,hi'), '');
      eq(AJP.radar.core.normalize({ id: 1, title: 'Data Engineer', url: 'javascript:alert(1)' }, { board: 'lever', company: 'x' }).url, '');
    });
    it('a shortened resume block keeps its closing tag (Chrome built-in AI)', () => {
      const text = 'Intro line.\n\n<resume>\n' + 'Built data pipelines. '.repeat(200) + '\n</resume>';
      const out = AJP.ai.local.fitPrompt(text, 2000);
      ok(out.length < text.length);
      ok(/<\/resume>$/.test(out), out.slice(-40));
    });
    it('a remembered resume scan gives the same skills, and callers cannot change it', () => {
      const resume = 'Python and SQL pipelines on AWS with Airflow and Spark. '.repeat(20);
      const a = AJP.matcher.findSkills(resume);
      a.set('Fake skill', 1);
      const b = AJP.matcher.findSkills(resume);
      notOk(b.has('Fake skill'));
      ok(b.has('Python') && b.has('Airflow'));
    });
  });

  describe('review fixes › autofill, backup, Job Radar, job page', () => {
    const mock = globalThis.browser;
    const sandbox = () => document.getElementById('sandbox');
    beforeEach(() => mock.__reset());
    afterEach(() => (sandbox().innerHTML = ''));
    it('a learned checkbox answer is ticked again', async () => {
      sandbox().innerHTML = '<form><fieldset><legend>Which tools have you used?</legend><label><input type="checkbox" name="tools" value="a"> Airflow</label><label><input type="checkbox" name="tools" value="b"> Kafka</label></fieldset></form>';
      const label = 'Which tools have you used? — Airflow';
      const answers = { [AJP.normKey(label)]: { label, value: 'Yes', count: 1 } };
      await AJP.filler.fill({ profile: AJP.clone(AJP.store.DEFAULTS.profile), answers, resume: null, root: sandbox() });
      const [airflow, kafka] = sandbox().querySelectorAll('input[name="tools"]');
      eq([airflow.checked, kafka.checked], [true, false]);
    });
    it('restoring a backup made without API keys keeps the keys you have', async () => {
      await AJP.store.update('settings', (s) => void (s.ai.keys.groq = 'gsk-keep'));
      const backup = await AJP.store.exportAll();
      eq(backup.data.settings.ai.keys.groq, '');
      await AJP.store.importAll(backup);
      eq((await AJP.store.get('settings')).ai.keys.groq, 'gsk-keep');
    });
    it('removing one Workday career site keeps the jobs of the company\'s other site', async () => {
      const job = (id, site) => ({ key: `workday:acme:${id}`, board: 'workday', company: 'acme', site, status: 'new', title: 'Data Engineer', locations: [] });
      await AJP.store.set('radarWatchlist', [{ key: 'workday:acme:External', board: 'workday', company: 'acme', site: 'External' }, { key: 'workday:acme:Internal', board: 'workday', company: 'acme', site: 'Internal' }]);
      await AJP.store.set('radarJobs', [job(1, 'External'), job(2, 'Internal')]);
      await AJP.send('radar.watch.remove', { key: 'workday:acme:External' });
      eq((await AJP.store.get('radarJobs')).map((j) => j.site), ['Internal']);
    });
    it('a job page whose location is a list (JSON-LD address array)', () => {
      const posting = { '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Data Engineer', description: 'Build pipelines. '.repeat(30), jobLocation: { address: [{ addressLocality: 'Austin', addressRegion: 'TX' }] } };
      sandbox().innerHTML = `<script type="application/ld+json">${JSON.stringify(posting)}</script>`;
      eq(AJP.jd.extract({ root: sandbox(), host: 'jobs.example.com', url: 'https://jobs.example.com/1' }).location, 'Austin, TX');
    });
  }, { env: 'browser' });
})();
