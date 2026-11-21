/*
 * Findings from a real tailored resume: false skill gaps, an edit that removed tools from a line, wrapped lines left
 * alone in the PDF, and a "was N%" that did not explain an unchanged score. Text here is anonymised.
 */
(function () {
  const { describe, it, eq, ok, notOk, includes, afterEach } = globalThis.AJPTest;
  const AJP = globalThis.AJP;
  const has = (text, skill) => AJP.matcher.findSkills(text).has(skill);

  describe('tailor accuracy › no false skill gaps', () => {
    it('"forecasting" in a company description is not a budgeting skill', () => {
      notOk(has('It powers analytics, forecasting, and decision-making across every team.', 'Budgeting'));
      ok(has('Own budget management for the department', 'Budgeting'));
      ok(has('Experience with financial forecasting', 'Budgeting'));
    });
    it('"data models" and dimensional models count as data modeling', () => {
      ['Defined KPIs and data models across the warehouse', 'Designed dimensional models for finance', 'data modeling', 'data modelling'].forEach((t) => ok(has(t, 'Data modeling'), t));
    });
  });

  describe('tailor accuracy › an edit never removes what the line proves', () => {
    const E = AJP.resumeEngine;
    const RESUME = '# Alex\n## Experience\n### Engineer, Acme (2020 - Present)\n- Tune long-running EMR Spark jobs and Snowflake queries for faster and cheaper runs.\n## Skills\nSpark, Snowflake, SQL';
    const doc = E.parse(RESUME);
    const ctx = { doc, resumeText: RESUME, jdText: 'SQL and Airflow', allowedSkills: E.allowedSkills(doc, RESUME, [{ name: 'Spark' }, { name: 'Snowflake' }, { name: 'SQL' }]) };
    const target = doc.bullets[0].id;
    const evidence = ['Tune long-running EMR Spark jobs'];
    it('dropping Spark is blocked and names the skill', () => {
      const v = E.validateEdit({ target, after: 'Optimized Snowflake queries, reducing runtime and cost.', evidence }, ctx);
      notOk(v.ok);
      const lost = v.violations.find((x) => x.code === 'LOST_SKILL');
      ok(lost && /Spark/.test(lost.detail), JSON.stringify(v.violations));
    });
    it('rewording that keeps every tool is allowed', () => {
      const v = E.validateEdit({ target, after: 'Tuned long-running EMR Spark jobs and Snowflake queries, making runs faster and cheaper.', evidence }, ctx);
      eq(v.violations.filter((x) => x.code === 'LOST_SKILL'), []);
    });
    it('your own edit may remove a tool: it is your resume', () => {
      const v = E.validateEdit({ target, after: 'Optimized Snowflake queries.', evidence, userEdited: true }, ctx);
      eq(v.violations.filter((x) => x.code === 'LOST_SKILL'), []);
    });
    it('the AI is told to keep them', () => {
      includes(E.editsPrompt({ doc, requirements: [], atsKeywords: [], skills: [], job: {}, maxEdits: 3 }).prompt + E.editsPrompt({ doc, requirements: [], atsKeywords: [], skills: [], job: {}, maxEdits: 3 }).system, 'never drop one');
    });
  });

  describe('tailor accuracy › wrapped lines', () => {
    it('a one-word tail joins its sentence', () => {
      ok(AJP.continuesLine('• Built automated data quality checks and alerts, tracking latency against', 'SLAs.'));
      ok(AJP.continuesLine('• Built a mobile game with a reinforcement learning model in PyTorch /', 'Gymnasium.'));
    });
    it('complete lines and short headings stay separate', () => {
      notOk(AJP.continuesLine('• Built automated data quality checks and alerts for pipelines.', 'SLAs.'));
      notOk(AJP.continuesLine('Lead Data Engineer at a large retail company in Texas today', 'Environment'));
      notOk(AJP.continuesLine('• Led the migration of the warehouse to the cloud platform', '• Built pipelines.'));
    });
  });

  describe('tailor accuracy › the panel explains the score', () => {
    afterEach(() => AJP.panel.remove());
    const analysis = (score) => ({ score, matched: [{ skill: 'Python', weight: 3, source: 'profile' }], missing: [], jdSkillCount: 1, ms: 1, fit: { workType: { job: ['remote'], wanted: ['remote'], ok: true }, salary: { job: { min: 150000, max: 190000, hourly: false }, ok: true }, location: { matched: null, ok: null } } });
    const text = () => document.querySelector('ajp-panel').shadowRoot.textContent;
    it('same score: says the edits reworded skills already counted', () => {
      AJP.panel.render({ job: { title: 'Dev' }, analysis: analysis(84), tailored: { id: 'r', before: 84 } }, {});
      includes(text(), 'Skills match unchanged at 84%');
      notOk(/was 84%/.test(text()));
    });
    it('higher score: shows what it was', () => {
      AJP.panel.render({ job: { title: 'Dev' }, analysis: analysis(92), tailored: { id: 'r', before: 84 } }, {});
      includes(text(), '(was 84%)');
    });
  }, { env: 'browser' });
})();
