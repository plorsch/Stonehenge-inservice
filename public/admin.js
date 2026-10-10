(() => {
  const $ = id => document.getElementById(id);
  let state = null;
  let editingTopicId = null;
  let editingStaffId = null;

  // ---------- helpers ----------
  async function api(path, opts = {}) {
    const res = await fetch(path, Object.assign({ cache: 'no-store', headers: { 'Content-Type': 'application/json' } }, opts));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function fail(err) { alert(err.message || err); }
  function fmtDate(d) {
    if (!d) return '<span class="muted">Never</span>';
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const fmtWhen = iso => iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const topicById = id => state.topics.find(t => t.id === id);
  const whoLabel = depts => depts && depts.length ? depts.map(escapeHtml).join(', ') : 'All staff';
  const depts = () => state.settings.departments || [];

  function renderChecks(el, selected) {
    el.innerHTML = depts().map(d => `<label><input type="checkbox" value="${escapeHtml(d)}"${(selected || []).includes(d) ? ' checked' : ''}> ${escapeHtml(d)}</label>`).join('')
      || '<span class="muted small">Add departments on the Settings tab.</span>';
  }
  const checked = el => [...el.querySelectorAll('input:checked')].map(i => i.value);

  function topicOptions(sel, { includeBlank = true } = {}) {
    const live = state.topics.filter(t => t.status === 'active').sort((a, b) => a.title.localeCompare(b.title));
    const cur = sel.value;
    sel.innerHTML = (includeBlank ? '<option value="">Choose a topic…</option>' : '') +
      live.map(t => `<option value="${t.id}">${escapeHtml(t.title)} (${t.questions.length} question${t.questions.length === 1 ? '' : 's'})</option>`).join('');
    sel.value = cur;
  }

  // ---------- tabs ----------
  $('nav').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    document.querySelectorAll('#nav button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.id === 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'responses') loadResponses();
    if (b.dataset.tab === 'history') loadUsage();
    if (b.dataset.tab === 'settings') renderSettings();
  });

  async function refresh() {
    state = await api('/api/admin/state');
    renderToday(); renderSchedule(); renderRequired(); renderTopics(); renderStaff(); renderFilters();
  }

  // ---------- today ----------
  function renderToday() {
    $('stat-today').textContent = state.responseCountToday;
    $('stat-missed').textContent = state.missedToday;
    $('stat-required').textContent = state.required.filter(q => q.active).length;
    $('stat-staff').textContent = state.employees.filter(e => e.active).length;
    $('kiosk-urls').innerHTML = state.kioskUrls.length
      ? state.kioskUrls.map(u => `<div><code>${escapeHtml(u)}</code></div>`).join('')
      : '<span class="muted">Use this site\'s web address.</span>';
    const openReq = state.required.filter(q => q.active);
    $('today-rows').innerHTML = state.today.map(d => {
      const reqs = openReq.filter(q => !q.departments.length || q.departments.includes(d.department));
      const why = d.source === 'schedule' ? '<span class="pill brand">Scheduled</span>'
        : d.source === 'weekly' ? '<span class="pill">Topic of the week (rotation)</span>'
        : d.source === 'culture' ? '<span class="pill">Culture day</span>'
        : d.source === 'random' ? `<span class="pill">Random from ${d.poolSize} rotation topics</span>`
        : '<span class="pill">Topic of the day (rotation)</span>';
      const reqNote = reqs.length ? `<div class="small" style="margin-top:4px"><span class="pill req">+ ${reqs.length} required first</span></div>` : '';
      const swap = ['daily', 'weekly', 'culture'].includes(d.source) && d.topicId ? `<button class="btn subtle" data-swap="${escapeHtml(d.department)}">Pick another</button>` : '';
      const title = d.title ? `<a href="#" data-preview="${d.topicId}">${escapeHtml(d.title)}</a>` : (d.source === 'random' ? '<span class="muted">Varies per person</span>' : '<span class="muted">Nothing available</span>');
      return `<tr><td><strong>${escapeHtml(d.department || 'Everyone')}</strong></td><td>${title}${reqNote}</td><td>${why}</td><td>${swap}</td></tr>`;
    }).join('');
  }
  $('today-rows').addEventListener('click', async e => {
    const sw = e.target.closest('[data-swap]');
    if (sw) {
      try { await post('/api/admin/pick-new-daily', { department: sw.dataset.swap }); toast('Topic changed'); await refresh(); }
      catch (err) { fail(err); }
    }
  });
  document.addEventListener('click', e => {
    const pv = e.target.closest('[data-preview]');
    if (pv) { e.preventDefault(); showPreview(topicById(pv.dataset.preview)); }
  });

  // ---------- schedule ----------
  function renderSchedule() {
    topicOptions($('sc-topic'));
    if (!$('sc-depts').dataset.init) { renderChecks($('sc-depts'), []); $('sc-depts').dataset.init = 1; }
    if (!$('sc-start').value) setWeek(0);
    document.querySelectorAll('input[name=fallback]').forEach(r => { r.checked = r.value === state.settings.fallbackMode; });
    $('culture-day').value = Number.isInteger(state.settings.cultureDay) ? String(state.settings.cultureDay) : '';
    const showPast = $('sc-show-past').checked;
    const rows = state.schedules
      .filter(s => showPast || !s.endDate || s.endDate >= state.todayDate)
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
    $('sc-rows').innerHTML = rows.map(s => {
      const t = topicById(s.topicId);
      const live = s.startDate <= state.todayDate && (!s.endDate || s.endDate >= state.todayDate);
      const status = live ? ' <span class="pill good">Running now</span>' : s.startDate > state.todayDate ? ' <span class="pill">Upcoming</span>' : ' <span class="pill">Ended</span>';
      return `<tr class="${!live && s.startDate < state.todayDate ? 'dim' : ''}">
        <td>${t ? `<a href="#" data-preview="${t.id}">${escapeHtml(t.title)}</a>` : '<span class="muted">Deleted topic</span>'}${t && t.status !== 'active' ? ' <span class="pill warn">Not active</span>' : ''}${status}
          ${s.note ? `<div class="muted small">${escapeHtml(s.note)}</div>` : ''}</td>
        <td>${whoLabel(s.departments)}</td>
        <td style="white-space:nowrap">${fmtDate(s.startDate)} – ${s.endDate ? fmtDate(s.endDate) : 'until removed'}</td>
        <td>${t ? t.questions.length : ''}</td>
        <td><button class="btn subtle danger" data-del-sched="${s.id}">Remove</button></td></tr>`;
    }).join('') || '<tr><td colspan="5" class="muted">Nothing scheduled. Staff get topics from the rotation.</td></tr>';
  }
  function setWeek(offset) {
    const d = new Date();
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7) + 7 * offset);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    $('sc-start').value = isoDay(offset === 0 ? d : monday);
    $('sc-end').value = isoDay(sunday);
  }
  document.querySelectorAll('[data-week]').forEach(b => b.addEventListener('click', () => setWeek(Number(b.dataset.week))));
  $('sc-show-past').addEventListener('change', renderSchedule);
  $('sc-add').addEventListener('click', async () => {
    $('sc-error').textContent = '';
    try {
      await post('/api/admin/schedules', { topicId: $('sc-topic').value, departments: checked($('sc-depts')), startDate: $('sc-start').value, endDate: $('sc-end').value, note: $('sc-note').value });
      $('sc-note').value = '';
      toast('Scheduled');
      await refresh();
    } catch (err) { $('sc-error').textContent = err.message; }
  });
  $('sc-rows').addEventListener('click', async e => {
    const b = e.target.closest('[data-del-sched]');
    if (!b || !confirm('Remove this from the schedule? Responses already recorded are kept.')) return;
    try { await api('/api/admin/schedules/' + b.dataset.delSched, { method: 'DELETE' }); toast('Removed'); await refresh(); }
    catch (err) { fail(err); }
  });
  $('save-fallback').addEventListener('click', async () => {
    const v = document.querySelector('input[name=fallback]:checked');
    if (!v) return;
    const cd = $('culture-day').value;
    try { await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ fallbackMode: v.value, cultureDay: cd === '' ? null : Number(cd) }) }); toast('Saved'); await refresh(); }
    catch (err) { fail(err); }
  });

  // ---------- required ----------
  function renderRequired() {
    topicOptions($('rq-topic'));
    if (!$('rq-depts').dataset.init) { renderChecks($('rq-depts'), []); $('rq-depts').dataset.init = 1; }
    const rows = state.required.slice().sort((a, b) => (b.active - a.active) || b.createdAt.localeCompare(a.createdAt));
    $('rq-rows').innerHTML = rows.map(q => {
      const t = topicById(q.topicId);
      const total = q.doneCount + q.pendingCount;
      const pct = total ? Math.round(100 * q.doneCount / total) : 0;
      return `<tr class="${q.active ? '' : 'dim'}">
        <td>${t ? `<a href="#" data-preview="${t.id}">${escapeHtml(t.title)}</a>` : 'Deleted topic'} ${q.active ? '<span class="pill req">Open</span>' : '<span class="pill">Closed</span>'}
          ${q.reason ? `<div class="muted small">${escapeHtml(q.reason)}</div>` : ''}</td>
        <td>${whoLabel(q.departments)}</td>
        <td style="white-space:nowrap">${fmtWhen(q.createdAt)}</td>
        <td><div class="progress-bar"><span style="width:${pct}%"></span></div><div class="small">${q.doneCount} of ${total} done</div></td>
        <td style="white-space:nowrap">
          <button class="btn subtle" data-rq-view="${q.id}">Who's done</button>
          <button class="btn subtle${q.active ? ' danger' : ''}" data-rq-toggle="${q.id}" data-active="${q.active ? 1 : 0}">${q.active ? 'Close' : 'Reopen'}</button>
        </td></tr>`;
    }).join('') || '<tr><td colspan="5" class="muted">No required education yet.</td></tr>';
  }
  $('rq-add').addEventListener('click', async () => {
    $('rq-error').textContent = '';
    const d = checked($('rq-depts'));
    const t = topicById($('rq-topic').value);
    if (t && !confirm(`Require "${t.title}" for ${d.length ? d.join(', ') : 'all staff'}? Each person will get it the next time they clock in.`)) return;
    try {
      await post('/api/admin/required', { topicId: $('rq-topic').value, departments: d, reason: $('rq-reason').value });
      $('rq-reason').value = '';
      toast('Required education added');
      await refresh();
    } catch (err) { $('rq-error').textContent = err.message; }
  });
  $('rq-rows').addEventListener('click', async e => {
    const tg = e.target.closest('[data-rq-toggle]');
    const vw = e.target.closest('[data-rq-view]');
    try {
      if (tg) {
        const closing = tg.dataset.active === '1';
        if (closing && !confirm('Close this? Staff who have not done it yet will no longer get it.')) return;
        await post(`/api/admin/required/${tg.dataset.rqToggle}/${closing ? 'close' : 'reopen'}`);
        await refresh();
      }
      if (vw) {
        const q = state.required.find(x => x.id === vw.dataset.rqView);
        const pr = await api(`/api/admin/required/${q.id}/progress`);
        const t = topicById(q.topicId);
        $('vw-title').textContent = t ? t.title : 'Required education';
        $('vw-body').innerHTML = `
          <h3 style="margin-top:14px">Still to do (${pr.pending.length})</h3>
          ${pr.pending.length ? `<table><tbody>${pr.pending.map(p => `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.department)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Everyone is done.</p>'}
          <h3 style="margin-top:18px">Done (${pr.done.length})</h3>
          ${pr.done.length ? `<table><tbody>${pr.done.map(p => `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.department)}</td><td>${fmtWhen(p.completedAt)}</td><td>${p.firstTryCorrect ? '<span class="pill good">Right first try</span>' : '<span class="pill warn">Needed a retry</span>'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No one yet.</p>'}`;
        $('viewer').showModal();
      }
    } catch (err) { fail(err); }
  });

  // ---------- topics ----------
  function renderTopics() {
    const q = $('topic-search').value.trim().toLowerCase();
    const f = $('topic-filter').value;
    const rows = state.topics
      .filter(t => f === 'all' || (f === 'retired' ? t.status === 'retired' : f === 'draft' ? t.status === 'draft' : t.status !== 'retired' && (f !== 'rotation' || (t.inRotation && t.status === 'active'))))
      .filter(t => !q || [t.title, t.category, t.lesson, ...t.questions.map(x => x.text)].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (a.status === 'draft') - (b.status === 'draft') || (b.lastUsedDate || '').localeCompare(a.lastUsedDate || '') || a.title.localeCompare(b.title));
    $('topic-rows').innerHTML = rows.map(t => {
      const st = state.topicStats[t.id];
      const pct = st && st.responses ? Math.round(100 * st.firstTry / st.responses) + '%' : '<span class="muted">–</span>';
      const retired = t.status === 'retired', draft = t.status === 'draft';
      const tags = (retired ? ' <span class="pill">Retired</span>' : '') +
        (draft ? ` <span class="pill warn" title="${escapeHtml((t.problems || []).join(' '))}">Needs work</span>` : '');
      return `<tr class="${retired ? 'dim' : ''}">
        <td><strong>${escapeHtml(t.title)}</strong>${tags}<div class="muted small">${escapeHtml(t.category || '')}${draft && t.problems ? ' · ' + escapeHtml(t.problems[0]) : ''}</div></td>
        <td class="small">${whoLabel(t.departments)}</td>
        <td>${t.questions.length}</td>
        <td>${retired || draft ? '<span class="muted">–</span>' : `<input type="checkbox" data-rotation="${t.id}"${t.inRotation ? ' checked' : ''} aria-label="In rotation">`}</td>
        <td style="white-space:nowrap">${fmtDate(t.lastUsedDate)}</td>
        <td>${st ? st.responses : 0}</td>
        <td>${pct}</td>
        <td style="white-space:nowrap">
          <button class="btn subtle" data-act="preview" data-id="${t.id}">Preview</button>
          <button class="btn subtle" data-act="edit" data-id="${t.id}">Edit</button>
          <button class="btn subtle" data-act="duplicate" data-id="${t.id}">Copy</button>
          ${retired ? `<button class="btn subtle" data-act="restore" data-id="${t.id}">Restore</button>`
                    : `<button class="btn subtle danger" data-act="retire" data-id="${t.id}">Retire</button>`}
        </td></tr>`;
    }).join('') || '<tr><td colspan="8" class="muted">No topics match.</td></tr>';
    const cats = [...new Set(state.topics.map(t => t.category).filter(Boolean))].sort();
    $('category-list').innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">`).join('');
  }
  $('topic-search').addEventListener('input', renderTopics);
  $('topic-filter').addEventListener('change', renderTopics);

  $('topic-rows').addEventListener('change', async e => {
    const id = e.target.dataset.rotation;
    if (!id) return;
    try {
      await post(`/api/admin/topics/${id}/rotation`, { inRotation: e.target.checked });
      toast(e.target.checked ? 'Added to rotation' : 'Removed from rotation');
      await refresh();
    } catch (err) { fail(err); e.target.checked = !e.target.checked; }
  });
  $('topic-rows').addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = b.dataset.id, act = b.dataset.act, t = topicById(id);
    try {
      if (act === 'preview') return showPreview(t);
      if (act === 'edit') return openEditor(t);
      if (act === 'duplicate') {
        const { topic } = await post(`/api/admin/topics/${id}/duplicate`);
        await refresh();
        toast('Copy created. It is not in the rotation yet.');
        return openEditor(topicById(topic.id));
      }
      if (act === 'retire' && !confirm(`Retire "${t.title}"? It will stop showing on the iPad but its history is kept.`)) return;
      await post(`/api/admin/topics/${id}/${act}`);
      toast(act === 'retire' ? 'Topic retired' : 'Topic restored');
      await refresh();
    } catch (err) { fail(err); }
  });

  function showPreview(t) {
    if (!t) return;
    $('vw-title').textContent = t.title;
    $('vw-body').innerHTML = `<div class="muted small" style="margin-top:12px">For: ${whoLabel(t.departments)}</div>
      <div class="lesson-preview" style="margin-top:8px">${formatLesson(t.lesson) || '<span class="muted">No lesson yet.</span>'}</div>
      ${t.questions.map((q, n) => `
        <h3 style="margin-top:18px">Question ${n + 1}${q.type === 'multi' ? ' <span class="pill brand">Select all that apply</span>' : ''}: ${escapeHtml(q.text)}</h3>
        <ul>${q.correctAnswers.map(a => `<li>${escapeHtml(a)} <span class="pill good">Correct</span></li>`).join('')}${q.wrongAnswers.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul>
        ${q.hint ? `<div class="muted small"><strong>Hint after a wrong answer:</strong> ${escapeHtml(q.hint)}</div>` : ''}
        ${q.explanation ? `<div class="muted small"><strong>Explanation:</strong> ${escapeHtml(q.explanation)}</div>` : ''}`).join('')}
      <div class="muted small" style="margin-top:14px">Each person gets one question per visit, with the answers in a random order.</div>`;
    $('viewer').showModal();
  }

  // ---------- topic editor ----------
  function addQuestionCard(q = {}) {
    const card = document.createElement('div');
    card.className = 'qcard';
    const lines = arr => escapeHtml((arr || []).join('\n'));
    card.innerHTML = `
      <div class="qhead"><strong class="qnum"></strong>
        <span><label class="small"><input type="checkbox" class="q-multi"${q.type === 'multi' ? ' checked' : ''}> Select all that apply</label>
        <button type="button" class="btn subtle danger q-remove">Remove</button></span></div>
      <textarea class="q-text" rows="2" placeholder="Question">${escapeHtml(q.text || '')}</textarea>
      <div class="grid" style="gap:0 14px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">
        <div><label class="block small q-correct-label">Correct answer</label><textarea class="q-correct" rows="2">${lines(q.correctAnswers)}</textarea></div>
        <div><label class="block small">Wrong answers <span class="hint">one per line</span></label><textarea class="q-wrong" rows="3">${lines(q.wrongAnswers)}</textarea></div>
      </div>
      <label class="block small">Hint shown after a wrong answer <span class="hint">optional</span></label>
      <input type="text" class="q-hint" style="width:100%" value="${escapeHtml(q.hint || '')}">
      <label class="block small">Explanation shown after the right answer <span class="hint">optional</span></label>
      <input type="text" class="q-expl" style="width:100%" value="${escapeHtml(q.explanation || '')}">`;
    card.dataset.qid = q.id || '';
    const syncLabel = () => { card.querySelector('.q-correct-label').innerHTML = card.querySelector('.q-multi').checked ? 'Correct answers <span class="hint">one per line</span>' : 'Correct answer'; };
    card.querySelector('.q-multi').addEventListener('change', syncLabel);
    syncLabel();
    card.querySelector('.q-remove').onclick = () => { if ($('f-questions').children.length > 1) { card.remove(); numberQuestions(); } };
    $('f-questions').appendChild(card);
    numberQuestions();
  }
  function numberQuestions() { [...$('f-questions').children].forEach((c, i) => { c.querySelector('.qnum').textContent = `Question ${i + 1}`; }); }
  function openEditor(t) {
    editingTopicId = t ? t.id : null;
    $('editor-heading').textContent = t ? 'Edit topic' : 'New topic';
    $('f-title').value = t ? t.title : '';
    $('f-category').value = t ? t.category || '' : '';
    $('f-lesson').value = t ? t.lesson : '';
    $('f-rotation').checked = t ? !!t.inRotation : true;
    renderChecks($('f-depts'), t ? t.departments : []);
    $('f-questions').innerHTML = '';
    (t && t.questions.length ? t.questions : [{}]).forEach(q => addQuestionCard(q));
    $('f-error').textContent = t && t.problems ? 'Still needed: ' + t.problems.join(' ') : '';
    updateLessonPreview();
    $('editor').showModal();
    $('f-title').focus();
  }
  function updateLessonPreview() { $('f-preview').innerHTML = formatLesson($('f-lesson').value); }
  $('f-lesson').addEventListener('input', updateLessonPreview);
  $('f-add-q').addEventListener('click', () => addQuestionCard());
  $('f-cancel').addEventListener('click', () => $('editor').close());
  $('new-topic').addEventListener('click', () => openEditor(null));

  const splitLines = v => v.split('\n').map(x => x.trim()).filter(Boolean);
  async function saveTopic(draft) {
    const body = {
      draft, title: $('f-title').value, category: $('f-category').value, lesson: $('f-lesson').value,
      departments: checked($('f-depts')), inRotation: $('f-rotation').checked,
      questions: [...$('f-questions').children].map(c => ({
        id: c.dataset.qid || undefined,
        type: c.querySelector('.q-multi').checked ? 'multi' : 'single',
        text: c.querySelector('.q-text').value,
        correctAnswers: splitLines(c.querySelector('.q-correct').value),
        wrongAnswers: splitLines(c.querySelector('.q-wrong').value),
        hint: c.querySelector('.q-hint').value, explanation: c.querySelector('.q-expl').value
      }))
    };
    try {
      $('f-save').disabled = true;
      await api(editingTopicId ? `/api/admin/topics/${editingTopicId}` : '/api/admin/topics',
        { method: editingTopicId ? 'PUT' : 'POST', body: JSON.stringify(body) });
      $('editor').close();
      toast(draft ? 'Saved as draft. It will not show on the iPad until it is complete.' : 'Topic saved');
      await refresh();
    } catch (err) { $('f-error').textContent = err.message; }
    finally { $('f-save').disabled = false; }
  }
  $('editor-form').addEventListener('submit', e => { e.preventDefault(); saveTopic(false); });
  $('f-draft').addEventListener('click', () => saveTopic(true));

  // ---------- spreadsheet reading (Excel .xlsx or CSV) ----------
  let xlsxLoading = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve();
    xlsxLoading = xlsxLoading || new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/xlsx.full.min.js'; // SheetJS, bundled so the admin page works without internet
      s.onload = resolve;
      s.onerror = () => { xlsxLoading = null; reject(new Error('Could not load the Excel reader. Save the file as CSV and try again.')); };
      document.head.appendChild(s);
    });
    return xlsxLoading;
  }
  function parseCsv(text) {
    const rows = []; let row = [], cell = '', q = false;
    const delim = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
    return rows.filter(r => r.some(c => String(c).trim()));
  }
  // Returns rows (arrays) from the first sheet, or from the sheet whose name matches `prefer`.
  async function readSheet(file, prefer) {
    if (/\.xlsx?$/i.test(file.name)) {
      await loadXlsx();
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const name = wb.SheetNames.find(n => prefer && prefer.test(n)) || wb.SheetNames[0];
      return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' })
        .map(r => r.map(c => c instanceof Date ? isoDay(c) : String(c)))
        .filter(r => r.some(c => c.trim()));
    }
    return parseCsv((await file.text()).replace(/^﻿/, ''));
  }
  const findCol = (header, patterns) => header.findIndex(h => patterns.some(p => p.test(String(h).trim())));

  // ---------- topic import ----------
  let topicImport = null;
  $('topic-import-btn').addEventListener('click', () => {
    topicImport = null;
    $('ti-file').value = ''; $('ti-preview').innerHTML = ''; $('ti-error').textContent = ''; $('ti-go').disabled = true;
    $('topic-import').showModal();
  });
  $('ti-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    $('ti-error').textContent = ''; $('ti-preview').innerHTML = ''; $('ti-go').disabled = true;
    if (!file) return;
    try {
      const rows = await readSheet(file, /topic/i);
      const header = rows[0] || [];
      const col = {
        title: findCol(header, [/^topic( title)?$/i, /^title$/i]),
        category: findCol(header, [/^category$/i]),
        lesson: findCol(header, [/^lesson/i]),
        question: findCol(header, [/^question$/i, /^question text$/i]),
        correct: findCol(header, [/^correct answers?$/i]),
        wrong: findCol(header, [/^wrong answers?$/i, /^incorrect answers?$/i]),
        depts: findCol(header, [/^departments?$/i, /^for$/i, /^audience$/i]),
        hint: findCol(header, [/^hint$/i]),
        explanation: findCol(header, [/^explanation$/i]),
        lastUsed: findCol(header, [/^last.?used/i]),
        status: findCol(header, [/^status$/i])
      };
      if (col.title < 0 || col.question < 0) throw new Error('The first row needs column headings, including "Topic title" and "Question".');
      const get = (r, k) => col[k] >= 0 ? String(r[col[k]] || '').trim() : '';
      const split = v => v.split('|').map(x => x.trim()).filter(Boolean);
      const byTitle = new Map();
      for (const r of rows.slice(1)) {
        const title = get(r, 'title');
        if (!title || /template \(skip\)/i.test(get(r, 'status'))) continue;
        let t = byTitle.get(title.toLowerCase());
        if (!t) {
          t = { title, category: get(r, 'category'), lesson: '', departments: split(get(r, 'depts').replace(/,/g, '|')), lastUsedDate: '', questions: [] };
          byTitle.set(title.toLowerCase(), t);
        }
        if (!t.lesson && get(r, 'lesson')) t.lesson = get(r, 'lesson');
        const lu = get(r, 'lastUsed').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(lu) && lu > t.lastUsedDate) t.lastUsedDate = lu;
        const text = get(r, 'question');
        if (!text) continue;
        const multi = /select all/i.test(text);
        let correct = split(get(r, 'correct'));
        if (multi && correct.length === 1) correct = correct[0].split(/\s+\/\s+/).map(x => x.trim()).filter(Boolean);
        t.questions.push({ type: multi ? 'multi' : 'single', text, correctAnswers: correct, wrongAnswers: split(get(r, 'wrong')), hint: get(r, 'hint'), explanation: get(r, 'explanation') });
      }
      topicImport = [...byTitle.values()];
      const existing = topicImport.filter(t => state.topics.some(x => x.title.toLowerCase() === t.title.toLowerCase())).length;
      const qCount = topicImport.reduce((n, t) => n + t.questions.length, 0);
      $('ti-preview').innerHTML = `Found <strong>${topicImport.length} topics</strong> with ${qCount} questions${existing ? `, ${existing} of them already in your library (they will be updated)` : ''}.
        <div class="muted" style="margin-top:6px">Topics missing a lesson, question or wrong answers are imported as <strong>Needs work</strong> and stay off the iPad until you finish them.</div>
        <div class="table-wrap" style="max-height:220px;margin-top:8px"><table><tbody>${topicImport.slice(0, 40).map(t => `<tr><td>${escapeHtml(t.title)}</td><td>${t.questions.length} question${t.questions.length === 1 ? '' : 's'}</td></tr>`).join('')}</tbody></table></div>`;
      $('ti-go').disabled = !topicImport.length;
    } catch (err) { $('ti-error').textContent = err.message; }
  });
  $('ti-go').addEventListener('click', async () => {
    try {
      $('ti-go').disabled = true;
      const r = await post('/api/admin/topics/import', { topics: topicImport });
      $('topic-import').close();
      alert(`Imported: ${r.added} new, ${r.updated} updated. ${r.drafts} need work before they can be used (filter "Needs work").`);
      $('topic-filter').value = r.drafts ? 'draft' : 'active';
      await refresh();
    } catch (err) { $('ti-error').textContent = err.message; $('ti-go').disabled = false; }
  });

  // ---------- staff ----------
  function renderStaff() {
    const q = $('staff-search').value.trim().toLowerCase();
    const f = $('staff-filter').value;
    const rows = state.employees
      .filter(e => f === 'all' || (f === 'active' ? e.active : !e.active))
      .filter(e => !q || [e.name, e.last4, e.department].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    $('staff-rows').innerHTML = rows.map(e => `<tr class="${e.active ? '' : 'dim'}">
      <td><strong>${escapeHtml(e.name)}</strong>${e.active ? '' : ' <span class="pill">Inactive</span>'}</td>
      <td>${escapeHtml(e.last4)}</td><td>${escapeHtml(e.department)}</td>
      <td data-last="${e.id}" class="small muted">…</td>
      <td data-pending="${e.id}"></td>
      <td><button class="btn subtle" data-edit-staff="${e.id}">Edit</button></td></tr>`).join('')
      || '<tr><td colspan="6" class="muted">No staff yet. Add them one at a time or import your roster from a spreadsheet.</td></tr>';
    fillStaffActivity();
    const sel = $('st-dept');
    sel.innerHTML = '<option value="">No department</option>' + depts().map(d => `<option>${escapeHtml(d)}</option>`).join('');
  }
  async function fillStaffActivity() {
    try {
      const { responses } = await api('/api/admin/responses');
      const last = {}, doneReq = {};
      for (const r of responses) {
        if (!r.employeeId) continue;
        if (!last[r.employeeId]) last[r.employeeId] = r.submittedAt;
        if (r.requiredId && r.completed) (doneReq[r.employeeId] = doneReq[r.employeeId] || new Set()).add(r.requiredId);
      }
      for (const e of state.employees) {
        const c = document.querySelector(`[data-last="${e.id}"]`);
        if (c) c.textContent = last[e.id] ? fmtWhen(last[e.id]) : 'Never';
        const p = document.querySelector(`[data-pending="${e.id}"]`);
        if (p) {
          const n = state.required.filter(r => r.active && (!r.departments.length || r.departments.includes(e.department)) && !(doneReq[e.id] && doneReq[e.id].has(r.id))).length;
          p.innerHTML = n ? `<span class="pill req">${n}</span>` : '<span class="muted">–</span>';
        }
      }
    } catch { /* leave placeholders */ }
  }
  $('staff-search').addEventListener('input', renderStaff);
  $('staff-filter').addEventListener('change', renderStaff);
  function openStaff(e) {
    editingStaffId = e ? e.id : null;
    $('staff-heading').textContent = e ? 'Edit staff' : 'Add staff';
    $('st-name').value = e ? e.name : '';
    $('st-last4').value = e ? e.last4 : '';
    $('st-dept').value = e ? e.department : '';
    $('st-active').checked = e ? e.active : true;
    $('st-error').textContent = '';
    $('staff-editor').showModal();
    $('st-name').focus();
  }
  $('staff-add-btn').addEventListener('click', () => openStaff(null));
  $('staff-rows').addEventListener('click', e => {
    const b = e.target.closest('[data-edit-staff]');
    if (b) openStaff(state.employees.find(x => x.id === b.dataset.editStaff));
  });
  $('staff-form').addEventListener('submit', async e => {
    e.preventDefault();
    const body = { name: $('st-name').value, last4: $('st-last4').value, department: $('st-dept').value, active: $('st-active').checked };
    try {
      await api(editingStaffId ? `/api/admin/employees/${editingStaffId}` : '/api/admin/employees', { method: editingStaffId ? 'PUT' : 'POST', body: JSON.stringify(body) });
      $('staff-editor').close();
      toast('Saved');
      await refresh();
    } catch (err) { $('st-error').textContent = err.message; }
  });

  // staff import
  let staffRows = null;
  $('staff-import-btn').addEventListener('click', () => {
    staffRows = null;
    $('imp-file').value = ''; $('imp-text').value = ''; $('imp-preview').innerHTML = ''; $('imp-error').textContent = ''; $('imp-go').disabled = true;
    $('staff-import').showModal();
  });
  function previewStaff(rows) {
    $('imp-error').textContent = ''; $('imp-go').disabled = true; staffRows = null;
    if (!rows.length) { $('imp-preview').innerHTML = ''; return; }
    let header = rows[0];
    let nameC = findCol(header, [/name/i]), idC = findCol(header, [/workday|employee|id|last ?4/i]), deptC = findCol(header, [/dep|role|position|job/i]);
    let body = rows.slice(1);
    if (nameC < 0 || idC < 0) { nameC = 0; idC = 1; deptC = header.length > 2 ? 2 : -1; body = rows; } // no header row
    staffRows = body.map(r => ({ name: String(r[nameC] || '').trim(), last4: String(r[idC] || '').trim(), department: deptC >= 0 ? String(r[deptC] || '').trim() : '' }))
      .filter(r => r.name || r.last4);
    const bad = staffRows.filter(r => !r.name || String(r.last4).replace(/\D/g, '').length < 4).length;
    const newDepts = [...new Set(staffRows.map(r => r.department).filter(d => d && !depts().some(x => x.toLowerCase() === d.toLowerCase())))];
    $('imp-preview').innerHTML = `<strong>${staffRows.length} people found.</strong>${bad ? ` <span class="err">${bad} are missing a name or ID and will be skipped.</span>` : ''}
      ${newDepts.length ? `<div class="muted" style="margin-top:4px">New departments that will be added to Settings: ${newDepts.map(escapeHtml).join(', ')}</div>` : ''}
      <div class="table-wrap" style="max-height:200px;margin-top:8px"><table><thead><tr><th>Name</th><th>Last 4</th><th>Department</th></tr></thead><tbody>
      ${staffRows.slice(0, 30).map(r => `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(String(r.last4).replace(/\D/g, '').slice(-4))}</td><td>${escapeHtml(r.department)}</td></tr>`).join('')}
      </tbody></table></div>`;
    $('imp-go').disabled = !staffRows.length;
  }
  $('imp-file').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try { previewStaff(await readSheet(f, /staff|roster|employee/i)); } catch (err) { $('imp-error').textContent = err.message; }
  });
  $('imp-text').addEventListener('input', () => previewStaff(parseCsv($('imp-text').value)));
  $('imp-go').addEventListener('click', async () => {
    try {
      $('imp-go').disabled = true;
      const newDepts = [...new Set(staffRows.map(r => r.department).filter(d => d && !depts().some(x => x.toLowerCase() === d.toLowerCase())))];
      if (newDepts.length) await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ departments: [...depts(), ...newDepts] }) });
      const r = await post('/api/admin/employees/import', { rows: staffRows });
      $('staff-import').close();
      alert(`Added ${r.added}, updated ${r.updated}.${r.skipped.length ? `\n\nSkipped ${r.skipped.length}:\n` + r.skipped.slice(0, 10).join('\n') : ''}`);
      await refresh();
    } catch (err) { $('imp-error').textContent = err.message; $('imp-go').disabled = false; }
  });

  // ---------- responses ----------
  function renderFilters() {
    const cur = $('resp-dept').value;
    $('resp-dept').innerHTML = '<option value="">All departments</option>' + depts().map(d => `<option>${escapeHtml(d)}</option>`).join('');
    $('resp-dept').value = cur;
    const ct = $('resp-topic').value;
    $('resp-topic').innerHTML = '<option value="">All topics</option>' +
      state.topics.slice().sort((a, b) => a.title.localeCompare(b.title)).map(t => `<option value="${t.id}">${escapeHtml(t.title)}</option>`).join('');
    $('resp-topic').value = ct;
  }
  function respQuery() {
    const p = new URLSearchParams();
    if ($('resp-from').value) p.set('from', $('resp-from').value);
    if ($('resp-to').value) p.set('to', $('resp-to').value);
    if ($('resp-dept').value) p.set('department', $('resp-dept').value);
    if ($('resp-topic').value) p.set('topicId', $('resp-topic').value);
    if ($('resp-missed').checked) p.set('missed', '1');
    return p.toString();
  }
  const kindLabel = { required: '<span class="pill req">Required</span>', scheduled: '<span class="pill brand">Scheduled</span>', rotation: '<span class="pill">Rotation</span>' };
  async function loadResponses() {
    try {
      const { responses } = await api('/api/admin/responses?' + respQuery());
      const first = responses.filter(r => r.firstTryCorrect).length;
      $('resp-summary').textContent = responses.length
        ? `${responses.length} response${responses.length === 1 ? '' : 's'}. ${Math.round(100 * first / responses.length)}% right on the first try.`
        : 'No responses for this selection.';
      $('resp-rows').innerHTML = responses.slice(0, 1000).map(r => {
        const result = !r.completed ? '<span class="pill warn">Did not finish</span>'
          : r.firstTryCorrect ? '<span class="pill good">Right first try</span>'
          : `<span class="pill warn">Missed, right on try ${r.attempts.length}</span>`;
        return `<tr>
        <td style="white-space:nowrap">${fmtWhen(r.submittedAt)}</td>
        <td>${escapeHtml(r.name)}${r.verified ? '' : ' <span class="pill" title="Typed their name; not on the roster">Not on roster</span>'}<div class="muted small">${escapeHtml(r.last4 || '')}</div></td>
        <td>${escapeHtml(r.department || '')}</td><td>${kindLabel[r.kind] || ''}</td>
        <td>${escapeHtml(r.topicTitle)}<div class="muted small">${escapeHtml(r.question)}</div></td>
        <td>${escapeHtml(r.attempts[0] || '')}</td><td>${result}</td></tr>`;
      }).join('');
      $('resp-csv').href = '/api/admin/responses.csv?' + respQuery();
    } catch (err) { fail(err); }
  }
  ['resp-from', 'resp-to', 'resp-dept', 'resp-topic', 'resp-missed'].forEach(id => $(id).addEventListener('change', loadResponses));

  // ---------- usage history ----------
  async function loadUsage() {
    try {
      const { usage } = await api('/api/admin/usage');
      $('usage-rows').innerHTML = usage.map(u => {
        const t = topicById(u.topicId);
        return `<tr><td>${fmtDate(u.date)}</td><td>${escapeHtml(t ? t.title : u.title)}</td><td>${u.responses}</td></tr>`;
      }).join('') || '<tr><td colspan="3" class="muted">No in-services completed yet.</td></tr>';
    } catch (err) { fail(err); }
  }

  // ---------- settings ----------
  function renderSettings() {
    const s = state.settings;
    $('set-facility').value = s.facilityName || '';
    $('set-depts').value = depts().join('\n');
    $('set-unlisted').checked = !!s.allowUnlisted;
    $('pw-env').hidden = !state.passwordFromEnv;
    $('pw-form').hidden = !!state.passwordFromEnv;
  }
  $('save-settings').addEventListener('click', async () => {
    try {
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({
        facilityName: $('set-facility').value,
        departments: splitLines($('set-depts').value),
        allowUnlisted: $('set-unlisted').checked
      }) });
      $('sc-depts').dataset.init = ''; $('rq-depts').dataset.init = '';
      toast('Settings saved');
      await refresh();
    } catch (err) { fail(err); }
  });
  $('save-pw').addEventListener('click', async () => {
    try {
      await post('/api/admin/password', { password: $('set-pw').value });
      $('set-pw').value = '';
      alert('Password changed. Your browser will ask you to sign in again with the new password.');
      location.reload();
    } catch (err) { fail(err); }
  });
  $('restore-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      JSON.parse(text);
      if (!confirm(`Replace ALL current data with "${file.name}"?`)) return;
      const r = await api('/api/admin/restore', { method: 'POST', body: text });
      alert(`Restored ${r.topics} topics, ${r.employees} staff and ${r.responses} responses.`);
      await refresh();
    } catch (err) { fail(err instanceof SyntaxError ? new Error('That file is not a valid backup.') : err); }
    finally { e.target.value = ''; }
  });

  refresh().catch(fail);
})();
