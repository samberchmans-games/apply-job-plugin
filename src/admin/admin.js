/*
 * admin.js — local Admin page. Plain DOM, no framework, autosaves to storage.local.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  AJP.logContext = 'admin';
  const log = AJP.logger('admin');
  AJP.captureErrors('admin', { notify: (d) => toast(`⚠ ${d.message} (${d.code})`) });
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let profile;
  let settings;
  let selectedResumeId = null;

  function toast(msg, ms = 1600) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), Math.max(ms, Math.min(9000, msg.length * 45)));
  }

  const saveProfile = AJP.debounce(async () => {
    await AJP.store.set('profile', profile);
    toast('Saved');
  }, 350);
  const saveSettings = AJP.debounce(async () => {
    await AJP.store.set('settings', settings);
    AJP.setLogLevel(settings.logLevel);
    toast('Saved');
  }, 350);

  // ---- Routing --------------------------------------------------------------------
  function route() {
    const want = (location.hash || '#profile').slice(1).split('?')[0] || 'profile';
    // An unknown link (old bookmark, typo) shows Profile instead of an empty page.
    const id = $$('section').some((s) => s.id === want) ? want : 'profile';
    $$('section').forEach((s) => s.classList.toggle('on', s.id === id));
    $$('nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + id));
    if (id === 'logs') {
      renderLogs();
      renderReports();
      AJP.send('github.status', {}).then(renderReports); // throttled to every 10 min per report
    }
    if (id === 'answers') renderAnswers();
    if (id === 'ai') renderAiCalls();
    if (id === 'skills') refreshEstimates();
    if (id === 'applications') renderApps();
    if (id === 'resumes') renderResumes();
    if (id === 'tracks') AJP.tracksView.render();
  }
  window.addEventListener('hashchange', route);

  // ---- Simple field binding ---------------------------------------------------------
  function bindFields() {
    const bind = (attr, getObj, save) => {
      for (const el of $$(`[${attr}]`)) {
        const path = el.getAttribute(attr);
        const v = AJP.getPath(getObj(), path);
        if (el.type === 'checkbox') el.checked = !!v;
        else el.value = v == null ? '' : v;
        el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
          AJP.setPath(getObj(), path, el.type === 'checkbox' ? el.checked : el.value);
          save();
          if (path === 'ai.provider') updateModelPlaceholder();
        });
      }
    };
    bind('data-path', () => profile, saveProfile);
    bind('data-settings', () => settings, saveSettings);
  }

  // ---- Skills ----------------------------------------------------------------------------
  function renderSkills() {
    const rows = profile.skills
      .map(
        (s, i) => `<tr>
        <td><b>${esc(s.name)}</b></td>
        <td><select data-i="${i}" data-k="level">${['', 'expert', 'advanced', 'intermediate', 'beginner'].map((l) => `<option ${s.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select>${s.estLevel ? '<div class="hint est">≈ from your resume</div>' : ''}</td>
        <td><input type="number" min="0" step="0.5" data-i="${i}" data-k="years" value="${esc(s.years || '')}">${s.estYears ? '<div class="hint est">≈ from your job dates</div>' : ''}</td>
        <td><button class="small danger" data-del="${i}">Remove</button></td></tr>`
      )
      .join('');
    $('#skillRows').innerHTML = rows || '<tr><td colspan="4" class="hint">No skills yet. Add your key skills above.</td></tr>';
  }

  function addSkill(name, level = '', years = '') {
    const canon = AJP.matcher.canonical(name);
    if (!canon) return false;
    if (profile.skills.some((s) => AJP.norm(s.name) === AJP.norm(canon))) return false;
    profile.skills.push({ name: canon, level, years });
    return true;
  }

  // Years and level for skills, estimated from the resume's dated jobs (experience.js: the merged dates of the jobs
  // whose lines mention the skill, or a skill that implies it). Only EMPTY fields are filled; anything the user set
  // stays. Estimated values are marked until the user edits them.
  const levelFor = (y) => (y >= 6 ? 'expert' : y >= 3 ? 'advanced' : y >= 1 ? 'intermediate' : 'beginner');
  function estimateSkills(text) {
    if (!AJP.experience || !(text || '').trim()) return 0;
    const me = AJP.experience.candidate(profile, text);
    let n = 0;
    for (const sk of profile.skills) {
      const y = me.skillYears(sk.name);
      if (y == null || y <= 0) continue;
      const years = String(Math.max(0.5, Math.round(y * 2) / 2));
      let changed = false;
      if (!String(sk.years || '').trim()) {
        sk.years = years;
        sk.estYears = true;
        changed = true;
      }
      if (!sk.level) {
        sk.level = levelFor(parseFloat(sk.years));
        sk.estLevel = true;
        changed = true;
      }
      if (changed) n++;
    }
    return n;
  }

  // Fill empty years/levels from the active resume whenever Admin or the Skills tab opens, and say what was found
  // (so a resume whose dates aren't recognised is easy to spot).
  const refreshEstimates = AJP.guard('admin.estimateSkills', async () => {
    const note = $('#skillYearsNote');
    const r = await AJP.store.activeResume();
    if (!r || !(r.text || '').trim()) {
      if (note) note.textContent = '';
      return;
    }
    const jobs = AJP.experience ? AJP.experience.candidate(profile, r.text).roles.length : 0;
    const n = estimateSkills(r.text);
    if (n) {
      renderSkills();
      await AJP.store.set('profile', profile);
      log.info('Skill years estimated on open', { estimated: n, jobs });
    }
    if (note) {
      note.textContent = jobs
        ? `Years and level come from ${jobs} dated job${jobs > 1 ? 's' : ''} in “${r.name}”${n ? ` (just filled ${n})` : ''}. Skills not mentioned in a dated job stay empty.`
        : `No dated jobs found in “${r.name}”, so years can't be estimated. Put dates on each job line, e.g. “Senior Engineer — Acme (Jan 2019 – Present)” or “2015 – 2019”, under an Experience heading.`;
    }
  }, { mod: 'admin' });

  // Skills from a resume, added automatically (upload, paste, edit). Skills the user removed are remembered in
  // suggestions.ignoredSkills and never re-added automatically (the "Detect skills" button still adds them).
  async function autoSkillsFrom(text) {
    if (!(text || '').trim()) return [];
    const sug = await AJP.store.get('suggestions');
    const ignored = new Set((sug.ignoredSkills || []).map((n) => AJP.norm(n)));
    const found = [...AJP.matcher.findSkills(text).keys()].filter((n) => !ignored.has(AJP.norm(n)));
    const added = found.filter((n) => addSkill(n));
    const estimated = estimateSkills(text);
    if (!added.length && !estimated) return [];
    renderSkills();
    await AJP.store.set('profile', profile);
    log.info('Skills added from resume', { added: added.length, estimated, total: profile.skills.length });
    added.estimated = estimated;
    return added;
  }
  const skillsNote = (added) =>
    (added.length ? ` Added ${added.length} skill${added.length > 1 ? 's' : ''} from it: ${added.slice(0, 6).join(', ')}${added.length > 6 ? '…' : ''} (see Skills).` : '') +
    (added.estimated ? ` Years and level estimated for ${added.estimated} skill${added.estimated > 1 ? 's' : ''} from your job dates.` : '');
  async function ignoreSkill(name, on) {
    await AJP.store.update('suggestions', (x) => {
      const list = (x.ignoredSkills || []).filter((n) => AJP.norm(n) !== AJP.norm(name));
      x.ignoredSkills = on ? list.concat(name).slice(-300) : list;
    });
  }

  function initSkills() {
    $('#skillSuggest').innerHTML = AJP.SKILLS.map((l) => `<option value="${esc(l.split('|')[0])}">`).join('');
    $('#skillForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!addSkill($('#skillName').value, $('#skillLevel').value, $('#skillYears').value)) return toast('Already in your list');
      ignoreSkill(profile.skills[profile.skills.length - 1].name, false);
      $('#skillName').value = '';
      $('#skillYears').value = '';
      renderSkills();
      saveProfile();
      log.info('Skill added', { count: profile.skills.length });
    });
    $('#skillRows').addEventListener('input', (e) => {
      const { i, k } = e.target.dataset;
      if (i == null) return;
      profile.skills[i][k] = e.target.value;
      delete profile.skills[i][k === 'years' ? 'estYears' : 'estLevel']; // the user's own value now
      saveProfile();
    });
    $('#skillRows').addEventListener('change', (e) => {
      const { i, k } = e.target.dataset;
      if (i == null || !k || !profile.skills[i]) return;
      profile.skills[i][k] = e.target.value;
      delete profile.skills[i][k === 'years' ? 'estYears' : 'estLevel'];
      saveProfile();
      renderSkills();
    });
    $('#skillRows').addEventListener('click', (e) => {
      const i = e.target.dataset.del;
      if (i == null) return;
      const [gone] = profile.skills.splice(+i, 1);
      if (gone) ignoreSkill(gone.name, true); // don't add it back automatically from the resume
      renderSkills();
      saveProfile();
    });
    $('#detectSkills').addEventListener('click', async () => {
      const r = await AJP.store.activeResume();
      if (!r || !r.text) return ($('#detectOut').textContent = 'No resume text yet — add one in Resumes.');
      const found = [...AJP.matcher.findSkills(r.text).keys()];
      const added = found.filter((n) => addSkill(n));
      const estimated = estimateSkills(r.text);
      renderSkills();
      saveProfile();
      $('#detectOut').textContent = (added.length ? `Added ${added.length}: ${added.join(', ')}.` : `Found ${found.length} skills; all already in your list.`) +
        (estimated ? ` Years and level estimated for ${estimated} from your job dates (change any of them).` : '');
    });
    renderSkills();
  }

  // ---- Chip lists (target roles, areas) ------------------------------------------------------
  function initChips() {
    for (const box of $$('.chipbox')) {
      const key = box.dataset.list;
      const render = () => {
        box.innerHTML =
          profile[key].map((v, i) => `<span class="chip">${esc(v)}<button data-i="${i}" title="Remove">✕</button></span>`).join('') +
          `<input placeholder="${esc(box.dataset.placeholder)}">`;
      };
      box.addEventListener('keydown', (e) => {
        if (e.target.tagName !== 'INPUT' || e.key !== 'Enter') return;
        e.preventDefault();
        const v = e.target.value.trim();
        if (v && !profile[key].includes(v)) {
          profile[key].push(v);
          saveProfile();
        }
        render();
        $('input', box).focus();
      });
      box.addEventListener('click', (e) => {
        if (e.target.dataset.i == null) return;
        profile[key].splice(+e.target.dataset.i, 1);
        saveProfile();
        render();
      });
      render();
    }
  }

  // ---- Education / experience cards ----------------------------------------------------------
  const CARD_FIELDS = {
    education: [['school', 'School / university'], ['degree', 'Degree'], ['field', 'Field of study'], ['startYear', 'Start year'], ['endYear', 'End / graduation year'], ['gpa', 'GPA']],
    experience: [['company', 'Company'], ['title', 'Title'], ['location', 'Location'], ['start', 'Start (MM/YYYY)'], ['end', 'End (MM/YYYY or Present)'], ['description', 'Description', 'textarea']],
  };

  function renderCards(kind) {
    const list = profile.autoApply[kind];
    $(`#${kind}List`).innerHTML =
      list
        .map(
          (item, i) => `<div class="card"><div class="grid">${CARD_FIELDS[kind]
            .map(([k, label, t]) =>
              t === 'textarea'
                ? `<label class="wide">${label}<textarea rows="3" data-kind="${kind}" data-i="${i}" data-k="${k}">${esc(item[k])}</textarea></label>`
                : `<label>${label}<input data-kind="${kind}" data-i="${i}" data-k="${k}" value="${esc(item[k])}"></label>`
            )
            .join('')}</div><div class="row"><button class="small danger" data-rm="${kind}" data-i="${i}">Remove</button></div></div>`
        )
        .join('') || '<div class="hint">None added.</div>';
  }

  function initCards() {
    for (const kind of Object.keys(CARD_FIELDS)) renderCards(kind);
    $('#autoapply').addEventListener('click', (e) => {
      const add = e.target.dataset.add;
      const rm = e.target.dataset.rm;
      if (add) {
        profile.autoApply[add].push({});
        renderCards(add);
        saveProfile();
      } else if (rm) {
        profile.autoApply[rm].splice(+e.target.dataset.i, 1);
        renderCards(rm);
        saveProfile();
      }
    });
    $('#autoapply').addEventListener('input', (e) => {
      const { kind, i, k } = e.target.dataset;
      if (!kind) return;
      profile.autoApply[kind][i][k] = e.target.value;
      saveProfile();
    });
  }

  // ---- Resumes ---------------------------------------------------------------------------------
  const serialResumes = AJP.serial();
  const updateResumes = (fn) => serialResumes(() => AJP.store.update('resumes', fn));

  // Tailoring works line by line on achievements. A resume without bullet characters (often a Word file) gets a
  // notice and a one-click fix that puts "- " in front of the lines that read like achievements.
  function checkBullets(text) {
    const box = $('#resumeBullets');
    if (!box) return;
    const t = String(text || '');
    const doc = t.trim() ? AJP.resumeEngine.parse(t) : null;
    if (!doc || !doc.loose) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.innerHTML = doc.bullets.length
      ? `This resume has no bullet points (common with Word files), so tailoring reads ${doc.bullets.length} line${doc.bullets.length > 1 ? 's' : ''} that look like achievements. ` +
        `<button id="resumeAddBullets">Mark achievement lines as bullets</button> <span class="hint">Then check the text: each achievement should start with "- ".</span>`
      : 'No achievements found for tailoring: put each achievement on its own line starting with "-" (for example "- Led the migration of…").';
  }

  async function renderResumes() {
    AJP.enhanceView.renderList();
    const r = await AJP.store.get('resumes');
    if (!selectedResumeId || !r.items.some((x) => x.id === selectedResumeId)) selectedResumeId = r.activeId || (r.items[0] && r.items[0].id);
    const row = (x) => `<div class="res ${x.id === selectedResumeId ? 'sel' : ''}" data-id="${x.id}">
          ${x.enhancementId ? '📝' : '📄'} <b>${esc(x.name)}</b> ${x.id === r.activeId ? '<span class="tag">active</span>' : ''}
          ${x.file ? `<span class="hint">· 📎 ${esc(x.file.name)}${x.file.generated && !x.enhancementId ? ' (made from the text)' : ''}</span>` : ''}
          <small>${new Date(x.updatedAt || x.createdAt).toLocaleString()}</small></div>`;
    // Your own resumes first; resumes tailored for jobs in one collapsed group (one per job, replaced on re-tailoring).
    const mine = r.items.filter((x) => !x.enhancementId);
    const tailored = r.items.filter((x) => x.enhancementId);
    const openGroup = tailored.some((x) => x.id === selectedResumeId);
    $('#resumeList').innerHTML =
      (mine.map(row).join('') || (tailored.length ? '' : '<p class="hint">No resumes yet.</p>')) +
      (tailored.length ? `<details class="tailored-group" ${openGroup ? 'open' : ''}><summary>📝 Tailored for jobs (${tailored.length})</summary>${tailored.map(row).join('')}</details>` : '');
    const sel = r.items.find((x) => x.id === selectedResumeId);
    $('#resumeEditor').hidden = !sel;
    if (sel) {
      if (document.activeElement !== $('#resumeText')) $('#resumeText').value = sel.text || '';
      if (document.activeElement !== $('#resumeName')) $('#resumeName').value = sel.name || '';
      checkBullets(sel.text);
      $('#resumeGaps').hidden = !sel.gaps;
      $('#resumeGaps').textContent = sel.gaps ? 'Gaps for this job (not added to the resume):\n' + sel.gaps : '';
      $('#resumeSetActive').disabled = sel.id === r.activeId;
      $('#resumeExtract').hidden = !(sel.file && /\.pdf$/i.test(sel.file.name));
    }
  }

  // Text from an uploaded resume file (PDF via pdf.js, DOCX, TXT/MD). Throws AJP errors (THE STANDARD).
  async function extractText(name, buf) {
    if (/\.pdf$/i.test(name)) return (await AJP.pdf.toText(buf)).text;
    if (/\.docx$/i.test(name)) return AJP.docx.toText(buf);
    if (/\.(txt|md)$/i.test(name)) return new TextDecoder().decode(buf);
    return '';
  }
  AJP.extractResumeText = extractText;

  function readFile(file, as) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(fr.error);
      fr[as](file);
    });
  }

  function initResumes() {
    $('#resumeList').addEventListener('click', (e) => {
      const el = e.target.closest('.res');
      if (!el) return;
      selectedResumeId = el.dataset.id;
      renderResumes();
    });

    $('#resumeFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        const x = AJP.err('FILE_TOO_LARGE', { size: file.size });
        log.warn('Resume rejected', { code: x.code, size: file.size }, { code: x.code });
        return toast(`${x.message} (${x.code})`);
      }
      let text = '';
      let extractError = null;
      try {
        if (/\.(pdf|docx)$/i.test(file.name)) toast('Reading the text from your resume…');
        text = await extractText(file.name, await readFile(file, 'readAsArrayBuffer'));
      } catch (err) {
        const x = AJP.toAppError(err);
        extractError = AJP.describeError(x);
        log.warn('Resume text extraction failed', { code: x.code, type: file.type, details: x.details }, { code: x.code });
      }
      const dataUrl = await readFile(file, 'readAsDataURL');
      const original = { name: file.name, type: file.type, size: file.size, dataUrl };
      const item = { id: AJP.uid('res'), name: file.name.replace(/\.[^.]+$/, ''), text, file: original, createdAt: new Date().toISOString() };
      // One format for applications: Word/text uploads get a PDF made from their text (the original is kept).
      if (!/\.pdf$/i.test(file.name) && text) {
        try {
          item.original = original;
          item.file = AJP.pdfWriter.fileFor(item).file;
        } catch (err) {
          const x = AJP.toAppError(err);
          log.warn('PDF from upload not created', { code: x.code, details: x.details }, { code: x.code });
        }
      }
      await updateResumes((r) => {
        r.items.unshift(item);
        if (!r.activeId) r.activeId = item.id;
      });
      selectedResumeId = item.id;
      e.target.value = '';
      log.info('Resume uploaded', { type: file.type, size: file.size, textChars: text.length });
      const added = await AJP.guard('admin.autoSkills', autoSkillsFrom, { mod: 'admin' })(text) || [];
      if (extractError) toast(`Resume saved, but its text couldn't be read: ${extractError.message} ${extractError.hint} (${extractError.code})`, 9000);
      else toast(text ? `Resume saved — ${text.split('\n').filter((l) => /^- /.test(l)).length} bullet points read. Check the text below.${skillsNote(added)}` : 'Resume saved — paste its text below so it can be matched', added.length ? 6000 : 1600);
      renderResumes();
    });

    $('#newResume').addEventListener('click', async () => {
      const item = { id: AJP.uid('res'), name: 'My resume', text: '', createdAt: new Date().toISOString() };
      await updateResumes((r) => {
        r.items.unshift(item);
        if (!r.activeId) r.activeId = item.id;
      });
      selectedResumeId = item.id;
      renderResumes();
    });

    // One save timer PER FIELD: renaming then editing the text quickly must save both (bug B16).
    const savers = {};
    const saveField = (k, v) => {
      const id = selectedResumeId;
      savers[k] = savers[k] || AJP.debounce(async (rid, val) => {
        await updateResumes((r) => {
          const x = r.items.find((i) => i.id === rid);
          if (x) x[k] = val;
        });
        toast('Saved');
      }, 500);
      savers[k](id, v);
    };
    // A PDF made from the text is kept in sync with it (a PDF the user uploaded is never replaced).
    const regenPdf = AJP.debounce(AJP.guard('admin.regeneratePdf', async () => {
      const id = selectedResumeId;
      const all = await AJP.store.get('resumes');
      const r = all.items.find((x) => x.id === id);
      if (!r || !(r.text || '').trim() || (r.file && !r.file.generated)) return;
      const { file, replaced } = AJP.pdfWriter.fileFor(r, { company: r.job && r.job.company });
      await updateResumes((x) => void x.items.forEach((it) => it.id === id && (it.file = file)));
      if (replaced) toast(`PDF updated — ${replaced} character(s) can't be shown in the PDF and appear as "?"`);
      renderResumes();
    }, { mod: 'admin', onError: (d) => toast(`${d.message} (${d.code})`) }), 1200);
    $('#resumeText').addEventListener('input', (e) => {
      saveField('text', e.target.value);
      regenPdf();
    });
    // Skills from the text: after a paste, and when the user leaves the box (not on every keystroke).
    const skillsFromEditor = AJP.guard('admin.autoSkills', async () => {
      const added = await autoSkillsFrom($('#resumeText').value);
      if (added.length || added.estimated) toast(skillsNote(added).trim(), 6000);
    }, { mod: 'admin' });
    $('#resumeText').addEventListener('change', skillsFromEditor);
    $('#resumeText').addEventListener('paste', () => setTimeout(skillsFromEditor, 50));
    $('#resumeName').addEventListener('input', (e) => saveField('name', e.target.value));
    $('#resumeText').addEventListener('change', (e) => checkBullets(e.target.value));
    $('#resumeEditor').addEventListener('click', AJP.guard('admin.addBullets', async (e) => {
      if (e.target.id !== 'resumeAddBullets') return;
      const ta = $('#resumeText');
      const r = AJP.resumeEngine.addBulletMarkers(ta.value);
      if (!r.count) return;
      ta.value = r.text;
      ta.dispatchEvent(new Event('input', { bubbles: true })); // saves the text and remakes the PDF
      checkBullets(r.text);
      toast(`Marked ${r.count} achievement line${r.count > 1 ? 's' : ''} with "- ". Check them in the text.`, 5000);
      log.info('Bullet markers added', { count: r.count });
    }, { mod: 'admin', onError: (d) => toast(`${d.message} (${d.code})`) }));

    $('#resumeSetActive').addEventListener('click', async () => {
      await updateResumes((r) => void (r.activeId = selectedResumeId));
      renderResumes();
      toast('Active resume set');
    });
    $('#resumeDelete').addEventListener('click', async () => {
      if (!confirm('Delete this resume?')) return;
      await updateResumes((r) => {
        r.items = r.items.filter((x) => x.id !== selectedResumeId);
        if (r.activeId === selectedResumeId) r.activeId = r.items[0] ? r.items[0].id : null;
      });
      selectedResumeId = null;
      renderResumes();
    });
    $('#resumeExtract').addEventListener('click', AJP.guard('admin.readPdfText', async () => {
      const r = await AJP.store.get('resumes');
      const sel = r.items.find((x) => x.id === selectedResumeId);
      if (!sel || !sel.file) return;
      if ((sel.text || '').trim() && !confirm('Replace the current text with the text read from the PDF?')) return;
      toast('Reading the PDF…');
      const buf = await (await fetch(sel.file.dataUrl)).arrayBuffer(); // local data: URL decode, not a network call
      const text = await extractText(sel.file.name, buf);
      await updateResumes((all) => void all.items.forEach((x) => x.id === sel.id && (x.text = text)));
      $('#resumeText').value = text;
      const added = await autoSkillsFrom(text);
      toast(`Text read from the PDF — check it below.${skillsNote(added)}`, added.length ? 6000 : 1600);
    }, { mod: 'admin', onError: (d) => toast(`${d.message} ${d.hint} (${d.code})`, 9000) }));
    // The PDF that applications get (uploaded PDF, or one made from the text).
    async function currentPdf() {
      const all = await AJP.store.get('resumes');
      const r = all.items.find((x) => x.id === selectedResumeId);
      if (!r) throw AJP.err('NO_RESUME');
      if (r.file && /pdf/i.test(r.file.type || r.file.name)) return r.file;
      if (!(r.text || '').trim()) throw AJP.err('NO_RESUME');
      const { file } = AJP.pdfWriter.fileFor(r, { company: r.job && r.job.company });
      await updateResumes((x) => void x.items.forEach((it) => it.id === r.id && (it.file = file)));
      return file;
    }
    const pdfBlob = async (f) => (await fetch(f.dataUrl)).blob(); // local data: URL decode, not a network call
    $('#resumeDownload').addEventListener('click', AJP.guard('admin.downloadPdf', async () => {
      const f = await currentPdf();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await pdfBlob(f));
      a.download = f.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, { mod: 'admin', onError: (d) => toast(`${d.message} ${d.hint} (${d.code})`) }));
    $('#resumeView').addEventListener('click', AJP.guard('admin.viewPdf', async () => {
      const f = await currentPdf();
      window.open(URL.createObjectURL(await pdfBlob(f)), '_blank', 'noopener');
    }, { mod: 'admin', onError: (d) => toast(`${d.message} ${d.hint} (${d.code})`) }));
  }

  // ---- AI ----------------------------------------------------------------------------------------
  function updateModelPlaceholder() {
    const p = AJP.ai.PROVIDERS[settings.ai.provider];
    $('#aiModel').placeholder = (p && p.defaultModel) || '';
  }
  function initAI() {
    $('#aiProvider').innerHTML = Object.entries(AJP.ai.PROVIDERS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('');
    $('#aiProvider').value = settings.ai.provider;
    $('#aiTailor').innerHTML = '<option value="">Same as above</option>' + Object.entries(AJP.ai.PROVIDERS).filter(([k]) => k !== 'none').map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('');
    $('#aiTailor').value = settings.ai.tailorProvider || '';
    $('#aiTailorTest').addEventListener('click', async () => {
      await AJP.store.set('settings', settings);
      $('#aiTailorOut').textContent = 'Testing…';
      const r = await AJP.send('ai.test', { group: 'tailor' });
      $('#aiTailorOut').textContent = r.ok ? `✅ Works (${r.ai || ''})` : `❌ ${r.error} ${r.hint || ''} (${r.code})`;
      renderAiCalls();
    });
    updateModelPlaceholder();
    $('#aiProvider').addEventListener('change', () => setTimeout(renderLocalAI, 0));
    $('#aiLocalUse').addEventListener('click', AJP.guard('admin.useLocalAI', async () => {
      $('#aiProvider').value = 'chrome';
      $('#aiProvider').dispatchEvent(new Event('change', { bubbles: true }));
      await AJP.store.update('settings', (s) => void (s.ai.provider = 'chrome'));
      settings.ai.provider = 'chrome';
      updateModelPlaceholder();
      renderLocalAI();
    }, { mod: 'admin', onError: (d) => toast(`${d.message} (${d.code})`) }));
    $('#aiLocalDownload').addEventListener('click', AJP.guard('admin.downloadLocalAI', async () => {
      const bar = $('#aiLocalProgress');
      bar.hidden = false;
      $('#aiLocalDownload').disabled = true;
      $('#aiLocalOut').textContent = 'Downloading… (this can take a while; you can keep using the page)';
      try {
        await AJP.ai.local.download((p) => {
          bar.value = p;
          $('#aiLocalOut').textContent = `Downloading… ${Math.round(p * 100)}%`;
        });
        $('#aiLocalOut').textContent = '✅ Downloaded. Click Test connection.';
      } finally {
        $('#aiLocalDownload').disabled = false;
        renderLocalAI();
      }
    }, { mod: 'admin', onError: (d) => ($('#aiLocalOut').textContent = `❌ ${d.message} ${d.hint} (${d.code})`) }));
    renderLocalAI();
    $('#aiTest').addEventListener('click', async () => {
      await AJP.store.set('settings', settings); // flush pending edits first
      $('#aiTestOut').textContent = 'Testing…';
      const r = await AJP.send('ai.test');
      $('#aiTestOut').textContent = r.ok ? `✅ Works (${r.ai || ''}). Reply: "${r.text.slice(0, 40)}"` : `❌ ${r.error} ${r.hint || ''} (${r.code})`;
      renderAiCalls();
    });
  }

  // Built-in AI: what the background (where AI runs) sees, plus the page for the one-time download.
  const LOCAL_TEXT = {
    available: '✅ Ready on this computer.',
    downloadable: 'Needs a one-time model download (a few GB; Chrome manages it).',
    downloading: 'Downloading in Chrome… you can keep working.',
    unavailable: "❌ Can't run on this computer (needs a desktop with about 22 GB free disk space and enough memory; see chrome://on-device-internals).",
    unsupported: "❌ This browser has no built-in AI. Use a recent desktop Chrome (138+), or pick another free provider.",
  };
  const renderLocalAI = AJP.guard('admin.localAIStatus', async () => {
    const bg = await AJP.send('ai.localStatus');
    const page = AJP.ai.local.api() ? await AJP.ai.local.status() : { state: 'unsupported' };
    // The background decides (AI runs there); the page can still download when only it sees the API.
    const st = bg && bg.state && bg.state !== 'unsupported' ? bg.state : page.state;
    const isLocal = settings.ai.provider === 'chrome';
    $('#aiLocal').hidden = !isLocal;
    $('#aiLocalState').textContent = LOCAL_TEXT[st] || st;
    $('#aiLocalDownload').hidden = !(st === 'downloadable' || st === 'downloading') || page.state === 'unsupported';
    $('#aiLocalOffer').hidden = isLocal || st !== 'available';
    if (isLocal && bg && bg.state === 'unsupported' && page.state !== 'unsupported') $('#aiLocalOut').textContent = 'Note: the extension background cannot see the built-in AI in this browser version; AI actions may fail with AJP-AI-LOCAL-NONE.';
    log.info('Local AI status', { background: bg && bg.state, page: page.state });
  }, { mod: 'admin', onError: (d) => ($('#aiLocalState').textContent = `${d.message} (${d.code})`) });

  // Recent AI calls: who did what (provider · model), how long, ok or the error code.
  const TASK_NAMES = { 'resume.analyze': 'Tailoring: read the job', 'resume.analyze.retry': 'Tailoring: read the job (again)', 'resume.edits': 'Tailoring: suggest changes',
    'resume.weaveSkills': 'Tailoring: add your skills', extractSkills: 'AI deep analysis', draftAnswer: 'Draft an answer', test: 'Test connection' };
  async function renderAiCalls() {
    const box = $('#aiCalls');
    if (!box) return;
    const calls = await AJP.store.get('aiCalls');
    box.innerHTML = calls.length
      ? calls.slice(0, 15).map((c) => `<tr><td>${esc(new Date(c.at).toLocaleString())}</td><td>${esc(TASK_NAMES[c.task] || c.task)}</td><td><b>${esc(c.label || c.provider + ' · ' + c.model)}</b></td>
          <td>${(c.ms / 1000).toFixed(1)}s</td><td>${c.ok ? '✅' : '❌ ' + esc(c.code || '')}</td></tr>`).join('')
      : '<tr><td colspan="5" class="hint">No AI calls yet.</td></tr>';
  }

  // ---- Learned answers ------------------------------------------------------------------------------
  // ---- Profile suggestions from learned answers --------------------------------------------------------
  let suggestions = [];
  const renderSuggestions = AJP.guard('admin.renderSuggestions', async () => {
    const [answers, sug] = await Promise.all([AJP.store.get('answers'), AJP.store.get('suggestions')]);
    suggestions = AJP.profileSuggest.list(profile, answers, sug.dismissed);
    $('#sugCount').hidden = !suggestions.length;
    $('#sugCount').textContent = suggestions.length;
    $('#suggestBox').hidden = !suggestions.length;
    $('#suggestAll').hidden = suggestions.length < 2;
    $('#suggestRows').innerHTML = suggestions.map((s) => `<div class="sug" data-sug="${esc(s.id)}">
        <b>${esc(s.field)}</b>: <span class="hint">${s.empty ? 'empty in your profile' : `profile says “${esc(s.current)}”`}</span> → <b class="val">${esc(s.proposed)}</b>
        <span class="hint">(typed ${s.count}× for “${esc(s.label.slice(0, 60))}”${s.hosts.length ? ' on ' + esc(s.hosts.slice(0, 3).join(', ')) : ''})</span>
        <button class="small" data-sug-save="${esc(s.id)}">Save to profile</button> <button class="small" data-sug-dismiss="${esc(s.id)}">Dismiss</button></div>`).join('');
  }, { mod: 'admin' });

  async function saveSuggestion(s) {
    AJP.profileSuggest.apply(profile, s);
    await AJP.store.set('profile', profile);
    for (const el of document.querySelectorAll(`[data-path="${s.path}"]`)) el.value = s.proposed; // the Profile / Auto-apply fields on screen
    log.info('Profile suggestion saved', { key: s.key, path: s.path });
  }
  function initSuggestions() {
    $('#suggestRows').addEventListener('click', AJP.guard('admin.suggestion', async (e) => {
      const save = e.target.dataset.sugSave;
      const dismiss = e.target.dataset.sugDismiss;
      const s = suggestions.find((x) => x.id === (save || dismiss));
      if (!s) return;
      if (save) {
        await saveSuggestion(s);
        toast(`Saved to your profile: ${s.field}`);
      } else {
        await AJP.store.update('suggestions', (x) => void (x.dismissed[s.id] = new Date().toISOString()));
        log.info('Profile suggestion dismissed', { key: s.key });
      }
      renderSuggestions();
    }, { mod: 'admin', onError: (d) => toast(`${d.message} (${d.code})`) }));
    $('#suggestAll').addEventListener('click', AJP.guard('admin.suggestionsAll', async () => {
      const all = suggestions.slice();
      for (const s of all) await saveSuggestion(s);
      toast(`Saved ${all.length} profile updates`);
      renderSuggestions();
    }, { mod: 'admin', onError: (d) => toast(`${d.message} (${d.code})`) }));
    renderSuggestions();
  }

  async function renderAnswers() {
    renderSuggestions();
    const answers = await AJP.store.get('answers');
    const q = AJP.norm($('#answerSearch').value);
    const rows = Object.entries(answers)
      .filter(([k, v]) => !q || k.includes(q) || AJP.norm(v.value).includes(q))
      .sort((a, b) => (b[1].lastUsed || '').localeCompare(a[1].lastUsed || ''))
      .map(([k, v]) => `<tr><td>${esc(v.label)}</td><td><textarea rows="${v.kind === 'long' ? 3 : 1}" data-key="${esc(k)}">${esc(v.value)}</textarea></td>
        <td>${v.count}</td><td class="hint">${esc((v.hosts || []).join(', '))}</td><td><button class="small danger" data-delkey="${esc(k)}">Delete</button></td></tr>`)
      .join('');
    $('#answerRows').innerHTML = rows || '<tr><td colspan="5" class="hint">Nothing learned yet. Use “Autofill” on an application and fill in the rest — it will be remembered.</td></tr>';
  }
  function initAnswers() {
    $('#answerSearch').addEventListener('input', AJP.debounce(renderAnswers, 150));
    const save = AJP.debounce(async (key, value) => {
      await AJP.store.update('answers', (a) => void (a[key] && (a[key].value = value)));
      toast('Saved');
    }, 400);
    $('#answerRows').addEventListener('input', (e) => e.target.dataset.key && save(e.target.dataset.key, e.target.value));
    $('#answerRows').addEventListener('click', async (e) => {
      const k = e.target.dataset.delkey;
      if (!k) return;
      await AJP.store.update('answers', (a) => void delete a[k]);
      renderAnswers();
    });
  }

  // ---- Applications: see tracker-view.js ---------------------------------------------
  const renderApps = () => AJP.trackerView.render();

  // ---- Logs & support ------------------------------------------------------------------------
  async function renderLogs() {
    await AJP.flushLogs();
    const logs = await AJP.store.get('logs');
    const lvl = $('#logFilter').value;
    const q = AJP.norm($('#logSearch').value);
    const shown = logs.filter((l) => (!lvl || l.lvl === lvl) && (!q || AJP.norm(JSON.stringify(l)).includes(q))).slice(-800).reverse();
    $('#logCount').textContent = `${logs.length} entries stored (showing ${shown.length}, newest first)`;
    $('#logView').innerHTML = shown
      .map((l) =>
        `<span class="${l.lvl}${l.pre ? ' pre' : ''}">${esc(l.t)} ${l.lvl.toUpperCase().padEnd(5)} [${esc(l.ctx)}/${esc(l.mod)}]` +
        (l.code ? ` <span class="code">${esc(l.code)}</span>` : '') +
        (l.tid ? ` <span class="tid" data-tid="${esc(l.tid)}" title="Show this whole action">${esc(l.tid)}</span>` : '') +
        ` ${esc(l.msg)}${l.data ? ' ' + esc(JSON.stringify(l.data)) : ''}${l.pre ? ' (context before error)' : ''}</span>`
      )
      .join('\n');
    const sum = AJP.diagnostics.errorSummary(logs);
    $('#errSummary').innerHTML = sum.total
      ? `Errors in stored logs: ${Object.entries(sum.byCode).map(([c, n]) => `<span class="errchip" data-code="${esc(c)}">${esc(c)} ×${n}</span>`).join('')}`
      : 'No errors in the stored logs. 👍';
  }

  // ---- My reports (status from GitHub, by report id) ------------------------------------------
  async function renderReports() {
    const reports = await AJP.store.get('reports');
    const T = AJP.issues.STATUS_TEXT;
    $('#myReports').innerHTML = reports.length
      ? `<table class="tbl"><thead><tr><th>Report</th><th>Opened</th><th>Status</th></tr></thead><tbody>${reports
          .map((r) => `<tr><td>${esc(r.title || r.reportId)}</td><td>${new Date(r.createdAt).toLocaleDateString()}</td><td class="st-${esc(r.status || '')}">${
            T[r.status] || T['not-submitted']}${r.number ? ` <a href="${esc(r.url)}" target="_blank" rel="noopener">#${r.number}</a>` : ''}${r.version ? ' in ' + esc(r.version) : ''}${r.checkFailed ? ' · couldn\'t check' : ''}</td></tr>`)
          .join('')}</tbody></table>`
      : '<p class="hint">No reports yet. Use 🆘 Report an issue → 🐙 Report on GitHub.</p>';
    if (reports.some((r) => r.status === 'fixed' && r.seen === false)) AJP.send('reports.seen');
  }
  AJP.renderReports = renderReports;

  // ---- Crash banner (a problem happened in the background) -----------------------------------------
  async function renderCrashBanner() {
    const st = await AJP.store.get('promptState');
    const b = $('#crashBanner');
    if (!st.pending) {
      b.hidden = true;
      return;
    }
    b.hidden = false;
    b.innerHTML = `Something went wrong in the background <b>(${esc(st.pending.code)})</b>. Report it so we can fix it? Nothing is sent until you review it on GitHub.
      <div class="row"><button class="small primary" data-crash="report">Report</button><button class="small" data-crash="later">Not now</button><button class="small" data-crash="never">Don't ask again for this error</button></div>`;
    b.dataset.code = st.pending.code;
  }
  function initCrashBanner() {
    $('#crashBanner').addEventListener('click', async (e) => {
      const action = e.target.dataset.crash;
      if (!action) return;
      const code = $('#crashBanner').dataset.code;
      $('#crashBanner').hidden = true;
      if (action === 'report') {
        await AJP.send('crashPromptAction', { code, action: 'later' });
        location.hash = 'logs?report=1&code=' + encodeURIComponent(code);
      } else await AJP.send('crashPromptAction', { code, action });
    });
    renderCrashBanner();
  }

  async function buildReport(description, includeLogs) {
    const bundle = await AJP.diagnostics.collect({ description, includeLogs });
    log.info('Issue report created', { reportId: bundle.reportId, errors: bundle.errors.total, logs: bundle.logs.length });
    return bundle;
  }

  function initLogs() {
    $('#logRefresh').addEventListener('click', renderLogs);
    $('#logFilter').addEventListener('change', renderLogs);
    $('#logSearch').addEventListener('input', AJP.debounce(renderLogs, 200));
    // Click a trace id or error code to filter the view to it.
    const filterTo = (v) => {
      $('#logSearch').value = v;
      $('#logFilter').value = '';
      renderLogs();
    };
    $('#logView').addEventListener('click', (e) => e.target.dataset.tid && filterTo(e.target.dataset.tid));
    $('#errSummary').addEventListener('click', (e) => e.target.dataset.code && filterTo(e.target.dataset.code));
    $('#logClear').addEventListener('click', async () => {
      if (!confirm('Clear all logs?')) return;
      await AJP.store.set('logs', []);
      renderLogs();
    });
    $('#logDownload').addEventListener('click', async () => {
      const b = await buildReport('', true);
      download(`apply-job-logs-${b.reportId}.json`, JSON.stringify(b, null, 2), 'application/json');
    });

    const dlg = $('#reportDialog');
    let last = null;
    $('#reportOpen').addEventListener('click', () => {
      last = null;
      similarShown = false;
      $('#ghSimilar').hidden = true;
      $('#reportOut').textContent = '';
      $('#reportSummary').hidden = true;
      dlg.showModal();
      $('#reportText').focus();
    });
    $('#reportClose').addEventListener('click', () => dlg.close());
    const ensureReport = async () => (last = last && last.description === $('#reportText').value.trim() ? last : await buildReport($('#reportText').value.trim(), $('#reportLogs').checked));
    let reportCode = null; // error code that triggered the report (crash prompt / banner)
    let similarShown = false;
    $('#reportGitHub').addEventListener('click', async () => {
      const b = await ensureReport();
      const { url, fields } = AJP.issues.buildIssueUrl(b, { code: reportCode });
      const codes = fields.codes ? fields.codes.split(', ') : [];
      // Same problem already reported? Offer that issue first (once).
      if (!similarShown && codes.length) {
        similarShown = true;
        const sim = await AJP.send('github.similar', { codes });
        if (sim.ok && sim.items && sim.items.length) {
          $('#ghSimilar').hidden = false;
          $('#ghSimilar').innerHTML = `<b>Similar open reports for ${esc(codes[0])}</b> — same problem? Add a 👍 or a comment there instead:<ul>${sim.items
            .map((i) => `<li><a href="${esc(i.url)}" target="_blank" rel="noopener">#${i.number} ${esc(i.title)}</a></li>`)
            .join('')}</ul>Different problem? Click <b>Report on GitHub</b> again to open a new report.`;
          return;
        }
      }
      window.open(url, '_blank', 'noopener');
      await AJP.send('report.saved', { report: { reportId: b.reportId, codes, title: fields.title } });
      $('#ghSimilar').hidden = true;
      $('#reportOut').innerHTML = `🐙 GitHub opened with your report <b>${esc(b.reportId)}</b>. Review it and click <b>Submit new issue</b> there. You'll get an automatic acknowledgement, and its status appears under My reports.`;
      renderReports();
    });
    $('#reportDownload').addEventListener('click', async () => {
      const b = await ensureReport();
      download(`apply-job-report-${b.reportId}.json`, JSON.stringify(b, null, 2), 'application/json');
      $('#reportOut').innerHTML = `✅ Saved <b>apply-job-report-${esc(b.reportId)}.json</b>. Send this file to support and mention report id <b>${esc(b.reportId)}</b>.`;
    });
    $('#reportCopy').addEventListener('click', async () => {
      const b = await ensureReport();
      const text = AJP.diagnostics.summaryText(b);
      const box = $('#reportSummary');
      box.value = text;
      box.hidden = false;
      try {
        await navigator.clipboard.writeText(text);
        $('#reportOut').textContent = 'Summary copied. Paste it into your message and attach the downloaded report.';
      } catch (_) {
        box.select();
        $('#reportOut').textContent = 'Select the text below and copy it (Ctrl/Cmd+C).';
      }
    });
    const openFromHash = () => {
      if (!/[?&]report=1/.test(location.hash)) return;
      const m = location.hash.match(/[?&]code=([A-Z0-9-]+)/);
      reportCode = m ? m[1] : null;
      $('#reportOpen').click();
      if (reportCode && !$('#reportText').value) $('#reportText').value = `The extension showed an error (${reportCode}). What I was doing: `;
    };
    window.addEventListener('hashchange', openFromHash);
    setTimeout(openFromHash, 0);
    $('#reportsCheck').addEventListener('click', async () => {
      $('#reportsCheck').disabled = true;
      await AJP.send('github.status', { force: true });
      $('#reportsCheck').disabled = false;
      renderReports();
    });
    initCrashBanner();
    // For testers (Tester Guide 8.6): a harmless coded error that goes through the normal crash-prompt path.
    $('#simulateError').addEventListener('click', async () => {
      AJP.logger('admin').error('Test error simulated by the user (safe to ignore)', { simulated: true }, { code: 'AJP-INTERNAL' });
      await AJP.flushLogs();
      toast('Test error created — the report prompt should appear');
    });
  }

  // ---- Backup -------------------------------------------------------------------------------------
  function download(name, content, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function initBackup() {
    $('#bkExport').addEventListener('click', async () => {
      const data = await AJP.store.exportAll({ includeKeys: $('#bkKeys').checked });
      download(`apply-job-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
      log.info('Backup exported');
    });
    $('#bkImport').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const keys = await AJP.store.importAll(JSON.parse(await readFile(file, 'readAsText')));
        log.info('Backup imported', { keys });
        alert('Imported: ' + keys.join(', '));
        location.reload();
      } catch (err) {
        const x = AJP.toAppError(err);
        log.warn('Backup import failed', { code: x.code, error: x.message }, { code: x.code });
        alert(`Import failed: ${x.message} (${x.code})`);
      }
    });
    $('#bkWipe').addEventListener('click', async () => {
      if (!confirm('Delete ALL data (profile, resumes, answers, applications, logs)? This cannot be undone.')) return;
      await AJP.store.wipe();
      location.reload();
    });
  }

  // ---- Live refresh when content pages write data ------------------------------------------------------------
  AJP.api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const on = (location.hash || '#profile').slice(1).split('?')[0];
    if (changes.promptState) renderCrashBanner();
    if (changes.reports && on === 'logs') renderReports();
    if (changes.aiCalls && on === 'ai') renderAiCalls();
    if (changes.answers && on === 'answers' && !document.activeElement.matches('#answerRows textarea')) renderAnswers();
    if (changes.applications && on === 'applications') renderApps();
    if ((changes.resumes || changes.enhancements) && on === 'resumes') renderResumes();
  });

  // ---- Boot ---------------------------------------------------------------------------------------
  (async () => {
    ({ profile, settings } = await AJP.store.getMany(['profile', 'settings']));
    AJP.setLogLevel(settings.logLevel);
    $('#ver').textContent = 'v' + AJP.VERSION;
    initAI();
    bindFields();
    initSkills();
    initChips();
    initCards();
    initResumes();
    initAnswers();
    initSuggestions();
    AJP.trackerView.init({ toast, download });
    AJP.tracksView.init({ toast });
    AJP.enhanceView.init({
      toast,
      onCreated: (resume) => {
        selectedResumeId = resume.id;
        renderResumes();
      },
    });
    initLogs();
    initBackup();
    route();
    refreshEstimates(); // fill empty skill years/levels from the active resume (no click needed)
    log.info('Admin opened');
  })().catch((e) => {
    log.error('Admin failed to load', { error: e.message, stack: e.stack });
    alert('Admin failed to load: ' + e.message);
  });
})();
