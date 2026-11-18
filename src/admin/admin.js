/*
 * admin.js — local Admin page. Plain DOM, no framework, autosaves to storage.local.
 */
(function () {
  'use strict';
  const AJP = globalThis.AJP;
  AJP.logContext = 'admin';
  const log = AJP.logger('admin');
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let profile;
  let settings;
  let selectedResumeId = null;

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 1600);
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
    const id = (location.hash || '#profile').slice(1);
    $$('section').forEach((s) => s.classList.toggle('on', s.id === id));
    $$('nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + id));
    if (id === 'logs') renderLogs();
    if (id === 'answers') renderAnswers();
    if (id === 'applications') renderApps();
    if (id === 'resumes') renderResumes();
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
        <td><select data-i="${i}" data-k="level">${['', 'expert', 'advanced', 'intermediate', 'beginner'].map((l) => `<option ${s.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td><input type="number" min="0" step="0.5" data-i="${i}" data-k="years" value="${esc(s.years || '')}"></td>
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

  function initSkills() {
    $('#skillSuggest').innerHTML = AJP.SKILLS.map((l) => `<option value="${esc(l.split('|')[0])}">`).join('');
    $('#skillForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!addSkill($('#skillName').value, $('#skillLevel').value, $('#skillYears').value)) return toast('Already in your list');
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
      saveProfile();
    });
    $('#skillRows').addEventListener('click', (e) => {
      const i = e.target.dataset.del;
      if (i == null) return;
      profile.skills.splice(+i, 1);
      renderSkills();
      saveProfile();
    });
    $('#detectSkills').addEventListener('click', async () => {
      const r = await AJP.store.activeResume();
      if (!r || !r.text) return ($('#detectOut').textContent = 'No resume text yet — add one in Resumes.');
      const found = [...AJP.matcher.findSkills(r.text).keys()];
      const added = found.filter((n) => addSkill(n));
      renderSkills();
      saveProfile();
      $('#detectOut').textContent = added.length ? `Added ${added.length}: ${added.join(', ')}` : `Found ${found.length} skills; all already in your list.`;
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

  async function renderResumes() {
    const r = await AJP.store.get('resumes');
    if (!selectedResumeId || !r.items.some((x) => x.id === selectedResumeId)) selectedResumeId = r.activeId || (r.items[0] && r.items[0].id);
    $('#resumeList').innerHTML =
      r.items
        .map(
          (x) => `<div class="res ${x.id === selectedResumeId ? 'sel' : ''}" data-id="${x.id}">
          📄 <b>${esc(x.name)}</b> ${x.id === r.activeId ? '<span class="tag">active</span>' : ''}
          ${x.file ? `<span class="hint">· ${esc(x.file.name)}</span>` : ''}
          <small>${new Date(x.createdAt).toLocaleString()}</small></div>`
        )
        .join('') || '<p class="hint">No resumes yet.</p>';
    const sel = r.items.find((x) => x.id === selectedResumeId);
    $('#resumeEditor').hidden = !sel;
    if (sel) {
      if (document.activeElement !== $('#resumeText')) $('#resumeText').value = sel.text || '';
      if (document.activeElement !== $('#resumeName')) $('#resumeName').value = sel.name || '';
      $('#resumeGaps').hidden = !sel.gaps;
      $('#resumeGaps').textContent = sel.gaps ? 'Gap notes from AI tailoring:\n' + sel.gaps : '';
      $('#resumeSetActive').disabled = sel.id === r.activeId;
    }
  }

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
      if (file.size > 5 * 1024 * 1024) return toast('File too large (max 5 MB)');
      let text = '';
      try {
        if (/\.docx$/i.test(file.name)) text = await AJP.docx.toText(await readFile(file, 'readAsArrayBuffer'));
        else if (/\.(txt|md)$/i.test(file.name)) text = await readFile(file, 'readAsText');
      } catch (err) {
        log.warn('Resume text extraction failed', { name: file.name, error: err.message });
      }
      const dataUrl = await readFile(file, 'readAsDataURL');
      const item = { id: AJP.uid('res'), name: file.name.replace(/\.[^.]+$/, ''), text, file: { name: file.name, type: file.type, size: file.size, dataUrl }, createdAt: new Date().toISOString() };
      await updateResumes((r) => {
        r.items.unshift(item);
        if (!r.activeId) r.activeId = item.id;
      });
      selectedResumeId = item.id;
      e.target.value = '';
      log.info('Resume uploaded', { type: file.type, size: file.size, textChars: text.length });
      toast(text ? 'Resume saved' : 'Resume saved — paste its text below so it can be matched');
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

    const saveField = AJP.debounce(async (k, v) => {
      const id = selectedResumeId;
      await updateResumes((r) => {
        const x = r.items.find((i) => i.id === id);
        if (x) x[k] = v;
      });
      toast('Saved');
    }, 500);
    $('#resumeText').addEventListener('input', (e) => saveField('text', e.target.value));
    $('#resumeName').addEventListener('input', (e) => saveField('name', e.target.value));

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
    $('#resumeDownload').addEventListener('click', () => download(($('#resumeName').value || 'resume') + '.md', $('#resumeText').value, 'text/markdown'));
    $('#resumePrint').addEventListener('click', () => window.open('resume-view.html?id=' + encodeURIComponent(selectedResumeId), '_blank'));
  }

  // ---- AI ----------------------------------------------------------------------------------------
  function updateModelPlaceholder() {
    const p = AJP.ai.PROVIDERS[settings.ai.provider];
    $('#aiModel').placeholder = (p && p.defaultModel) || '';
  }
  function initAI() {
    $('#aiProvider').innerHTML = Object.entries(AJP.ai.PROVIDERS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('');
    $('#aiProvider').value = settings.ai.provider;
    updateModelPlaceholder();
    $('#aiTest').addEventListener('click', async () => {
      await AJP.store.set('settings', settings); // flush pending edits first
      $('#aiTestOut').textContent = 'Testing…';
      const r = await AJP.send('ai.test');
      $('#aiTestOut').textContent = r.ok ? `✅ Works. Reply: "${r.text.slice(0, 40)}"` : '❌ ' + r.error;
    });
  }

  // ---- Learned answers ------------------------------------------------------------------------------
  async function renderAnswers() {
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

  // ---- Applications ------------------------------------------------------------------------------
  const STATUSES = ['in progress', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn'];
  async function renderApps() {
    const apps = await AJP.store.get('applications');
    $('#appRows').innerHTML =
      apps
        .map((a) => `<tr><td>${new Date(a.date).toLocaleDateString()}</td><td>${esc(a.company || '—')}</td>
          <td><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title || a.url)}</a></td>
          <td>${a.score == null ? '—' : a.score + '%'}</td>
          <td><select data-app="${a.id}">${STATUSES.map((s) => `<option ${s === a.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
          <td><button class="small danger" data-delapp="${a.id}">✕</button></td></tr>`)
        .join('') || '<tr><td colspan="6" class="hint">No applications tracked yet.</td></tr>';
  }
  function initApps() {
    $('#appRows').addEventListener('change', async (e) => {
      const id = e.target.dataset.app;
      if (!id) return;
      await AJP.store.update('applications', (l) => void (l.find((a) => a.id === id).status = e.target.value));
      toast('Saved');
    });
    $('#appRows').addEventListener('click', async (e) => {
      const id = e.target.dataset.delapp;
      if (!id) return;
      await AJP.store.update('applications', (l) => l.filter((a) => a.id !== id));
      renderApps();
    });
  }

  // ---- Logs ---------------------------------------------------------------------------------------
  async function renderLogs() {
    await AJP.flushLogs();
    const logs = await AJP.store.get('logs');
    const lvl = $('#logFilter').value;
    const q = AJP.norm($('#logSearch').value);
    const shown = logs.filter((l) => (!lvl || l.lvl === lvl) && (!q || AJP.norm(JSON.stringify(l)).includes(q))).slice(-800).reverse();
    $('#logCount').textContent = `${logs.length} entries stored (showing ${shown.length}, newest first)`;
    $('#logView').innerHTML = shown
      .map((l) => `<span class="${l.lvl}">${esc(l.t)} ${l.lvl.toUpperCase().padEnd(5)} [${esc(l.ctx)}/${esc(l.mod)}] ${esc(l.msg)}${l.data ? ' ' + esc(JSON.stringify(l.data)) : ''}</span>`)
      .join('\n');
  }
  function initLogs() {
    $('#logRefresh').addEventListener('click', renderLogs);
    $('#logFilter').addEventListener('change', renderLogs);
    $('#logSearch').addEventListener('input', AJP.debounce(renderLogs, 200));
    $('#logClear').addEventListener('click', async () => {
      if (!confirm('Clear all logs?')) return;
      await AJP.store.set('logs', []);
      renderLogs();
    });
    $('#logDownload').addEventListener('click', async () => {
      await AJP.flushLogs();
      const logs = await AJP.store.get('logs');
      const report = {
        app: 'apply-job-plugin',
        version: AJP.VERSION,
        exportedAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        environment: {
          aiProvider: settings.ai.provider,
          aiModel: settings.ai.model || 'default',
          logLevel: settings.logLevel,
          skills: profile.skills.length,
          hasResume: !!(await AJP.store.activeResume()),
        },
        logs,
      };
      download(`apply-job-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify(report, null, 2), 'application/json');
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
        alert('Import failed: ' + err.message);
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
    const on = (location.hash || '#profile').slice(1);
    if (changes.answers && on === 'answers' && !document.activeElement.matches('#answerRows textarea')) renderAnswers();
    if (changes.applications && on === 'applications') renderApps();
    if (changes.resumes && on === 'resumes') renderResumes();
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
    initApps();
    initLogs();
    initBackup();
    route();
    log.info('Admin opened');
  })().catch((e) => {
    log.error('Admin failed to load', { error: e.message, stack: e.stack });
    alert('Admin failed to load: ' + e.message);
  });
})();
