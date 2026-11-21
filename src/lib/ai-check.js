/*
 * ai-check.js — "Check my AI setup" (Admin → AI settings). Real calls with the user's saved key, using a SAMPLE resume
 * and job (never the user's): a one-word reply, valid JSON, and a full tailoring-size request. A model that passes all
 * three is "verified", and tailoring then stays on verified models. Only provider, model, timing and error text are kept.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  if (AJP.aiCheck) return;

  const CONFIG = { maxModels: 4, wantVerified: 2, deadlineMs: 240000, secondModelMs: 120000, shortMs: 30000 };

  const SAMPLE_RESUME = `# Alex Example
Senior Data Engineer · alex@example.com

## Summary
Data engineer with 12 years building batch and streaming platforms for analytics teams.

## Experience
### Lead Data Engineer, Northwind Retail (2019 - Present)
- Built a Python and Airflow pipeline platform that loads 400 tables into Snowflake every night
- Moved reporting from on-premise SQL Server to AWS with S3, Glue and Redshift
- Designed dimensional data models used by finance, supply chain and marketing analysts
- Introduced dbt tests and CI/CD with GitHub Actions, cutting failed loads by 60%
- Mentored a team of five engineers and ran design reviews
### Data Engineer, Contoso Health (2014 - 2019)
- Developed Spark jobs on Databricks to process claims data for reporting
- Built Kafka consumers that feed near-real-time dashboards in Tableau
- Tuned SQL queries and partitioning, reducing warehouse cost by 25%
- Wrote data quality checks and on-call runbooks for production pipelines
### ETL Developer, Fabrikam Bank (2011 - 2014)
- Maintained ETL jobs and stored procedures for regulatory reports
- Automated monthly data reconciliation with Python scripts

## Skills
Python, SQL, Spark, Airflow, Kafka, Snowflake, Redshift, Databricks, dbt, AWS, Terraform, Tableau

## Education
B.S. Computer Science, State University`;

  const SAMPLE_JOB = `Senior Data Engineer, Example Corp

About the role
You will build and operate the data platform that powers analytics and machine learning across the company.

Requirements
- 8+ years of experience in data engineering
- 3+ years leading projects or mentoring engineers
- Expert SQL and strong Python
- Production experience with Airflow or a similar orchestrator
- Snowflake or another cloud data warehouse
- Spark or Databricks for large-scale processing
- Kafka or another streaming platform
- AWS services such as S3, Glue and IAM
- Data modeling for analytics
- CI/CD and infrastructure as code with Terraform

Nice to have
- dbt
- Experience with data governance and data quality tooling
- Machine learning feature pipelines`;

  const describeFail = (e) => {
    const x = AJP.toAppError(e);
    const said = x.reason || AJP.aiWire.reasonFrom(x.details && x.details.body);
    return { code: x.code, reason: said ? (AJP.scrub ? AJP.scrub(said) : said) : x.message };
  };
  async function step(name, fn) {
    const t0 = Date.now();
    try {
      await fn();
      return { name, ok: true, ms: Date.now() - t0 };
    } catch (e) {
      return { name, ok: false, ms: Date.now() - t0, ...describeFail(e) };
    }
  }
  const badReply = (reason) => AJP.err('AI_BAD_RESPONSE', { reason });

  async function checkModel(provider, model) {
    const base = { via: provider, exactModel: model, patient: true };
    const steps = [];
    const run = async (name, fn) => {
      const s = await step(name, fn);
      steps.push(s);
      return s.ok;
    };
    const ok =
      (await run('short', async () => {
        const out = await AJP.ai.complete({ ...base, task: 'check.short', timeoutMs: CONFIG.shortMs, system: 'Reply with one word.', prompt: 'Say OK.' });
        if (!String(out).trim()) throw badReply('empty answer');
      })) &&
      (await run('json', async () => {
        const out = await AJP.ai.complete({ ...base, task: 'check.json', json: true, timeoutMs: CONFIG.shortMs, system: 'Reply with strict JSON only.', prompt: 'Return exactly this JSON object: {"ok":true,"items":["a","b","c"]}' });
        if (!out || !Array.isArray(out.items) || out.items.length !== 3) throw badReply('JSON had the wrong shape');
      })) &&
      (await run('full', async () => {
        const p = AJP.resumeEngine.analyzePrompt({ jd: SAMPLE_JOB, resumeText: SAMPLE_RESUME });
        const out = await AJP.ai.complete({ ...base, task: 'check.full', json: true, timeoutMs: AJP.ai.CONFIG.tailorTimeoutMs, ...p });
        if (!out || !Array.isArray(out.requirements) || out.requirements.length < 3) throw badReply('tailoring answer had too few requirements');
      }));
    return { model, ok: !!ok, steps };
  }

  // A key or account problem: every model would fail the same way.
  const ACCOUNT = new Set(['AJP-AI-401', 'AJP-AI-KEY', 'AJP-AI-CREDIT']);

  async function modelsToTry(provider, cfg) {
    const P = AJP.ai.PROVIDERS[provider];
    const h = (await AJP.store.get('modelHealth'))[provider] || {};
    let ranked = [];
    let listError = null;
    try {
      ranked = await AJP.ai.models.rank({ ...cfg, timeoutMs: AJP.ai.CONFIG.listTimeoutMs }, provider);
    } catch (e) {
      listError = describeFail(e);
    }
    const typed = [cfg.tailorProvider === provider && cfg.tailorModel, cfg.provider === provider && cfg.model];
    const models = [...new Set([...typed, h.last, ...Object.keys(h.verified || {}), ...ranked, ...(ranked.length ? [] : [P.defaultModel])].filter(Boolean))];
    return { models: models.slice(0, CONFIG.maxModels), listError };
  }

  async function run(provider) {
    const P = AJP.ai.PROVIDERS[provider];
    const t0 = Date.now();
    const cfg = (await AJP.store.get('settings')).ai;
    const label = P ? P.label.replace(/\s*\(.*$/, '') : provider;
    const result = { provider, label, at: new Date().toISOString(), status: 'failed', model: null, verified: [], models: [], code: null, reason: '' };
    if (!P || !P.needsKey || !cfg.keys || !cfg.keys[provider]) return { ...result, status: 'nokey', reason: 'No API key saved' };
    const { models, listError } = await modelsToTry(provider, cfg);
    if (listError && ACCOUNT.has(listError.code)) Object.assign(result, listError);
    else {
      for (const model of models) {
        if (Date.now() - t0 > CONFIG.deadlineMs) break;
        if (result.verified.length && Date.now() - t0 > CONFIG.secondModelMs) break;
        const m = await checkModel(provider, model);
        result.models.push(m);
        if (m.ok) {
          result.verified.push(model);
          if (result.verified.length >= CONFIG.wantVerified) break;
        } else {
          const bad = m.steps.find((s) => !s.ok);
          if (!result.code) Object.assign(result, { code: bad.code, reason: bad.reason });
          if (ACCOUNT.has(bad.code)) break;
        }
      }
    }
    if (result.verified.length) Object.assign(result, { status: 'ready', model: result.verified[0], code: null, reason: '' });
    const now = Date.now();
    await AJP.store.update('modelHealth', (all) => {
      const h = (all[provider] = all[provider] || {});
      h.verified = Object.fromEntries(result.verified.map((m, i) => [m, now - i]));
      if (result.verified.length) {
        h.last = result.verified[0];
        h.bad = Object.fromEntries(Object.entries(h.bad || {}).filter(([m]) => !result.verified.includes(m)));
      }
    });
    await AJP.store.update('aiChecks', (c) => void (c[provider] = result));
    AJP.logger('ai').info('AI setup check', { provider, status: result.status, model: result.model, code: result.code, ms: Date.now() - t0 });
    return result;
  }

  // Plain text for support: no keys, no resume, no job text.
  function report(results) {
    const rows = results.map((r) => {
      const tried = r.models.map((m) => `  ${m.model}: ${m.steps.map((s) => `${s.name} ${s.ok ? 'ok' : `FAILED ${s.code}`} ${(s.ms / 1000).toFixed(1)}s${s.ok ? '' : ` (${s.reason})`}`).join(', ')}`);
      return [`${r.label}: ${r.status === 'ready' ? `READY (${r.verified.join(', ')})` : r.status === 'nokey' ? 'no key' : `FAILED ${r.code || ''} ${r.reason || ''}`}`, ...tried].join('\n');
    });
    const text = `Apply Job Assistant v${AJP.VERSION} · AI setup check · ${new Date().toISOString()}\n${rows.join('\n')}`;
    return AJP.scrub ? AJP.scrub(text) : text;
  }

  AJP.aiCheck = { CONFIG, SAMPLE_RESUME, SAMPLE_JOB, run, report };
})();
