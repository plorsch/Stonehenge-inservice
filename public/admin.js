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
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
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
    renderToday(); renderSchedule(); renderRequired(); renderAnnouncements(); renderTopics(); renderStaff(); renderFilters();
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
          ${q.reason ? `<div class="muted small">${escapeHtml(q.reason)}</div>` : ''}
          ${q.endDate ? `<div class="small ${q.endDate < todayStr() ? 'muted' : ''}">${q.endDate < todayStr() ? 'Ended' : 'Shows until'} ${escapeHtml(q.endDate)}</div>` : ''}</td>
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
      await post('/api/admin/required', { topicId: $('rq-topic').value, departments: d, reason: $('rq-reason').value, endDate: $('rq-end').value || null });
      $('rq-reason').value = ''; $('rq-end').value = '';
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
    $('f-image').value = t ? t.image || '' : '';
    $('f-image-file').value = ''; $('f-image-status').textContent = '';
    updateImagePreview();
    $('f-rotation').checked = t ? !!t.inRotation : true;
    renderChecks($('f-depts'), t ? t.departments : []);
    $('f-questions').innerHTML = '';
    (t && t.questions.length ? t.questions : [{}]).forEach(q => addQuestionCard(q));
    $('f-error').textContent = t && t.problems ? 'Still needed: ' + t.problems.join(' ') : '';
    updateLessonPreview();
    $('editor').showModal();
    $('f-title').focus();
  }
  function updateImagePreview() {
    const v = $('f-image').value.trim();
    $('f-image-preview').style.display = v ? 'block' : 'none';
    if (v) $('f-image-preview').src = v;
  }
  $('f-image').addEventListener('input', updateImagePreview);
  $('f-image-clear').addEventListener('click', () => { $('f-image').value = ''; $('f-image-file').value = ''; updateImagePreview(); });
  $('f-image-file').addEventListener('change', async () => {
    const f = $('f-image-file').files[0];
    if (!f) return;
    if (f.size > 10e6) { $('f-image-status').textContent = 'That picture is over 10 MB. Please use a smaller one.'; return; }
    $('f-image-status').textContent = 'Uploading...';
    try {
      const dataUrl = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(f); });
      const r = await post('/api/admin/media', { dataUrl });
      $('f-image').value = r.url; updateImagePreview();
      $('f-image-status').textContent = 'Uploaded. Click Save to keep it.';
    } catch (err) { $('f-image-status').textContent = err.message; }
  });
  function updateLessonPreview() { $('f-preview').innerHTML = formatLesson($('f-lesson').value); }
  $('f-lesson').addEventListener('input', updateLessonPreview);
  $('f-add-q').addEventListener('click', () => addQuestionCard());
  $('f-cancel').addEventListener('click', () => $('editor').close());
  $('new-topic').addEventListener('click', () => openEditor(null));

  const splitLines = v => v.split('\n').map(x => x.trim()).filter(Boolean);
  async function saveTopic(draft) {
    const body = {
      draft, title: $('f-title').value, category: $('f-category').value, lesson: $('f-lesson').value, image: $('f-image').value.trim(),
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
        status: findCol(header, [/^status$/i]),
        image: findCol(header, [/^(image|picture|gif)/i])
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
        if (col.image >= 0 && !t.image && get(r, 'image')) t.image = get(r, 'image');
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
    $('st-birthday').value = e && e.birthday ? e.birthday.split('-').map(Number).join('/') : '';
    $('st-hire').value = e && e.hireDate ? e.hireDate : '';
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
    const body = { name: $('st-name').value, last4: $('st-last4').value, department: $('st-dept').value, active: $('st-active').checked,
      birthday: $('st-birthday').value, hireDate: $('st-hire').value };
    if (body.birthday.trim() && !/^\d{1,2}\s*\/\s*\d{1,2}(\s*\/\s*\d{2,4})?$/.test(body.birthday.trim())) { $('st-error').textContent = 'Write the birthday as month/day, like 3/7.'; return; }
    body.birthday = body.birthday.replace(/\s/g, '');
    try {
      await api(editingStaffId ? `/api/admin/employees/${editingStaffId}` : '/api/admin/employees', { method: editingStaffId ? 'PUT' : 'POST', body: JSON.stringify(body) });
      $('staff-editor').close();
      toast('Saved');
      await refresh();
    } catch (err) { $('st-error').textContent = err.message; }
  });

  // staff import
  let staffRows = null;
  // Excel drops leading zeros, so 147 in a "last 4" column means 0147.
  const padId = v => { const d = String(v == null ? '' : v).replace(/\D/g, ''); return d && d.length < 4 ? d.padStart(4, '0') : d; };
  // "Breinholt, John Philip" -> "John Philip Breinholt", so the kiosk shows "John B."
  const firstLast = n => { const m = n.match(/^([^,]+),\s*(.+)$/); return m ? `${m[2]} ${m[1]}`.replace(/\s+/g, ' ').trim() : n; };
  // The leader most people in each department report to.
  function staffLeaders(rows) {
    const count = {};
    rows.filter(r => r.department && r.leader).forEach(r => { const c = count[r.department] = count[r.department] || {}; c[r.leader] = (c[r.leader] || 0) + 1; });
    return Object.fromEntries(Object.entries(count).map(([d, c]) => [d, Object.keys(c).sort((a, b) => c[b] - c[a])[0]]));
  }
  $('staff-import-btn').addEventListener('click', () => {
    staffRows = null;
    $('imp-file').value = ''; $('imp-text').value = ''; $('imp-preview').innerHTML = ''; $('imp-error').textContent = ''; $('imp-go').disabled = true;
    $('staff-import').showModal();
  });
  function previewStaff(rows) {
    $('imp-error').textContent = ''; $('imp-go').disabled = true; staffRows = null;
    if (!rows.length) { $('imp-preview').innerHTML = ''; return; }
    // Some sheets put a title above the column headings; use the first row that names a name or worker column.
    const hi = Math.max(0, rows.slice(0, 10).findIndex(r => r.some(c => /name|worker/i.test(String(c)))));
    let header = rows[hi].map(c => String(c).trim());
    let nameC = findCol(header, [/name/i, /^worker$/i, /^employee$/i]), idC = findCol(header, [/workday|employee.?id|ee.?id|\bid\b|last ?4/i]);
    let deptC = findCol(header, [/^dep/i]);
    if (deptC < 0) deptC = findCol(header, [/dep|role|position|job/i]);
    let leaderC = findCol(header, [/^(leader|supervisor|manager)$/i]);
    let bdayC = findCol(header, [/birth/i]), hireC = findCol(header, [/hire/i, /anniversary/i, /^start date$/i]);
    let body = rows.slice(hi + 1);
    if (nameC < 0 || idC < 0) { nameC = 0; idC = 1; deptC = header.length > 2 ? 2 : -1; leaderC = bdayC = hireC = -1; body = rows; } // no header row
    staffRows = body.map(r => ({ name: firstLast(String(r[nameC] || '').trim()), last4: padId(r[idC]),
      department: deptC >= 0 ? String(r[deptC] || '').trim() : '', leader: leaderC >= 0 ? String(r[leaderC] || '').trim() : '',
      ...(bdayC >= 0 ? { birthday: String(r[bdayC] || '').trim(), keepBlank: true } : {}), ...(hireC >= 0 ? { hireDate: String(r[hireC] || '').trim(), keepBlank: true } : {}) }))
      .filter(r => r.name || r.last4);
    const bad = staffRows.filter(r => !r.name || String(r.last4).replace(/\D/g, '').length < 4).length;
    const newDepts = [...new Set(staffRows.map(r => r.department).filter(d => d && !depts().some(x => x.toLowerCase() === d.toLowerCase())))];
    const leaders = Object.entries(staffLeaders(staffRows));
    $('imp-preview').innerHTML = `<strong>${staffRows.length} people found.</strong>${bad ? ` <span class="err">${bad} are missing a name or ID and will be skipped.</span>` : ''}
      ${newDepts.length ? `<div class="muted" style="margin-top:4px">New departments that will be added to Settings: ${newDepts.map(escapeHtml).join(', ')}</div>` : ''}
      ${leaders.length ? `<div class="muted" style="margin-top:4px">Leaders for the Clock-in check: ${leaders.map(([d, l]) => `${escapeHtml(d)}: ${escapeHtml(l)}`).join(', ')}</div>` : ''}
      <div class="table-wrap" style="max-height:200px;margin-top:8px"><table><thead><tr><th>Name</th><th>Last 4</th><th>Department</th></tr></thead><tbody>
      ${staffRows.slice(0, 30).map(r => `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(String(r.last4).replace(/\D/g, '').slice(-4))}</td><td>${escapeHtml(r.department)}</td></tr>`).join('')}
      </tbody></table></div>`;
    $('imp-go').disabled = !staffRows.length;
  }
  $('imp-file').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try { previewStaff(await readSheet(f, /id ref|staff|roster|employee/i)); } catch (err) { $('imp-error').textContent = err.message; }
  });
  $('imp-text').addEventListener('input', () => previewStaff(parseCsv($('imp-text').value)));
  $('imp-go').addEventListener('click', async () => {
    try {
      $('imp-go').disabled = true;
      const newDepts = [...new Set(staffRows.map(r => r.department).filter(d => d && !depts().some(x => x.toLowerCase() === d.toLowerCase())))];
      const leaders = staffLeaders(staffRows);
      if (newDepts.length || Object.keys(leaders).length) await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ departments: [...depts(), ...newDepts], leaders: Object.assign({}, state.settings.leaders, leaders) }) });
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

  // ---------- clock-in check ----------
  let ccRows = null, ccHeader = null, ccResult = null;
  const pad2 = n => String(n).padStart(2, '0');
  // Accepts Excel dates, "10/9/2026 6:45 AM", "2026-10-09 06:45", "10/9/26", and times like "6:45 PM" or Excel day fractions.
  // Excel dates can come through a few seconds early, so round to the nearest minute.
  const roundMin = d => new Date(Math.round(d.getTime() / 60000) * 60000);
  function parseWhen(v) {
    if (v instanceof Date && !isNaN(v)) v = roundMin(v);
    if (v instanceof Date && !isNaN(v)) return { date: isoDay(v), time: (v.getHours() || v.getMinutes()) ? `${pad2(v.getHours())}:${pad2(v.getMinutes())}` : '' };
    const s = String(v || '').trim();
    let date = '', m;
    if ((m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/))) date = `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
    else if ((m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) date = `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad2(m[1])}-${pad2(m[2])}`;
    return { date, time: parseTime(s.replace(m ? m[0] : '', '')) };
  }
  function parseTime(v) {
    if (v instanceof Date && !isNaN(v)) v = roundMin(v);
    if (v instanceof Date && !isNaN(v)) return `${pad2(v.getHours())}:${pad2(v.getMinutes())}`;
    if (typeof v === 'number' && v >= 0 && v < 1) { const mins = Math.round(v * 1440); return `${pad2(Math.floor(mins / 60) % 24)}:${pad2(mins % 60)}`; }
    const m = String(v || '').match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?/i);
    if (!m) return '';
    let h = Number(m[1]);
    if (m[3]) { const pm = /p/i.test(m[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
    return `${pad2(h)}:${m[2]}`;
  }
  function ccOptions(sel, guess, optional) {
    sel.innerHTML = (optional ? '<option value="-1">(none)</option>' : '') + ccHeader.map((h, i) => `<option value="${i}">${escapeHtml(h || 'Column ' + (i + 1))}</option>`).join('');
    sel.value = String(guess >= 0 ? guess : (optional ? -1 : 0));
  }
  $('cc-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    $('cc-error').textContent = ''; $('cc-map').hidden = true; $('cc-results').hidden = true;
    if (!file) return;
    try {
      let rows;
      if (/\.xlsx?$/i.test(file.name)) {
        await loadXlsx();
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
        const sheet = wb.SheetNames.find(n => /time ?clock|punch|clock/i.test(n)) || wb.SheetNames[0];
        rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true, defval: '' });
      } else rows = parseCsv((await file.text()).replace(/^﻿/, ''));
      rows = rows.filter(r => r.some(c => String(c).trim()));
      // Some exports put a title above the column headings; use the first row that names an ID column.
      const hi = Math.max(0, rows.findIndex(r => r.some(c => /id|employee|worker/i.test(String(c)))));
      ccHeader = rows[hi].map(c => String(c).trim());
      ccRows = rows.slice(hi + 1);
      ccOptions($('cc-col-id'), findCol(ccHeader, [/workday/i, /employee.?id/i, /worker.?id/i, /\bid\b/i, /last ?4/i]));
      ccOptions($('cc-col-name'), findCol(ccHeader, [/^name$/i, /worker$/i, /employee( name)?$/i, /name/i]), true);
      ccOptions($('cc-col-date'), findCol(ccHeader, [/start shift date/i, /shift date/i, /clock.?in/i, /time.?in/i, /in.?punch/i, /^date$/i, /date/i, /start/i]));
      ccOptions($('cc-col-time'), (() => { const d = Number($('cc-col-date').value); const t = findCol(ccHeader, [/^(time )?in$/i, /in time/i, /clock.?in time/i, /start time/i]); return t === d ? -1 : t; })(), true);
      ccOptions($('cc-col-pay'), findCol(ccHeader, [/pay ?code/i, /^pay ?type$/i, /time ?type/i]), true);
      ccOptions($('cc-col-job'), findCol(ccHeader, [/job/i, /position/i]), true);
      $('cc-map').hidden = false;
      runClockCheck();
    } catch (err) { $('cc-error').textContent = err.message; }
  });
  async function runClockCheck() {
    $('cc-error').textContent = ''; $('cc-notes').textContent = '';
    const col = id => Number($(id).value);
    const ci = col('cc-col-id'), cn = col('cc-col-name'), cd = col('cc-col-date'), ct = col('cc-col-time'), cp = col('cc-col-pay'), cj = col('cc-col-job');
    const punches = [];
    let skipped = 0, noTime = 0;
    for (const r of ccRows) {
      const id = padId(r[ci]);
      if (!id && !String(r[cd] || '').trim()) continue; // blank row
      const when = parseWhen(r[cd]);
      const time = ct >= 0 ? parseTime(r[ct]) : when.time;
      if (!when.date || id.length < 4) { skipped++; continue; }
      if (ct >= 0 && !time) { noTime++; continue; } // no clock-in time: usually sick or vacation hours
      punches.push({ last4: id.slice(-4), name: cn >= 0 ? String(r[cn] || '') : '', date: when.date, time,
        paycode: cp >= 0 ? String(r[cp] || '') : '', department: cj >= 0 ? String(r[cj] || '').replace(/\s+-\s+(Hourly|Salaried)$/i, '').trim() : '' });
    }
    if (!punches.length) { $('cc-error').textContent = 'No clock-ins found. Check the columns above.'; $('cc-results').hidden = true; return; }
    try {
      ccResult = await post('/api/admin/clock-check', { punches });
      $('cc-shifts').textContent = ccResult.shifts;
      $('cc-done').textContent = ccResult.done;
      $('cc-missed').textContent = ccResult.missed;
      $('cc-unfinished').textContent = ccResult.unfinished;
      $('cc-never').textContent = ccPeople().filter(x => !x.done).length;
      const notes = [];
      if (!ccResult.firstDay) notes.push('Nobody has done an in-service on the iPad yet, so there is nothing to compare.');
      else if (ccResult.before) notes.push(`${ccResult.before} clock-in${ccResult.before === 1 ? '' : 's'} before the iPad's first in-service (${fmtDate(ccResult.firstDay)}) ${ccResult.before === 1 ? 'was' : 'were'} not counted.`);
      if (ccResult.leave + noTime) notes.push(`${ccResult.leave + noTime} time-off row${ccResult.leave + noTime === 1 ? '' : 's'} (sick, vacation, or no clock-in time) skipped.`);
      if (skipped) notes.push(`${skipped} row${skipped === 1 ? '' : 's'} skipped because the ID or date couldn't be read.`);
      $('cc-notes').textContent = notes.join(' ');
      $('cc-results').hidden = false;
      renderClockCheck();
    } catch (err) { $('cc-error').textContent = err.message; }
  }
  const ccLabel = { done: '<span class="pill good">Done</span>', missed: '<span class="pill warn">Missed</span>', unfinished: '<span class="pill warn">Started, didn\'t finish</span>' };
  function ccFiltered() {
    const f = $('cc-filter').value;
    return ccResult.results.filter(r => f === 'all' || (f === 'done' ? r.status === 'done' : r.status !== 'done'));
  }
  const shortDay = d => { const [, m, day] = d.split('-'); return `${Number(m)}/${Number(day)}`; };
  // One row per person who missed at least one shift, grouped by leader.
  function ccPeople() {
    const by = new Map();
    for (const r of ccResult.results) {
      const k = `${r.last4}|${r.name.toLowerCase()}`;
      const p = by.get(k) || { name: r.name, last4: r.last4, department: r.department, leader: r.leader || (r.onRoster ? '' : 'Not on roster'), onRoster: r.onRoster, shifts: 0, done: 0, missedDates: [] };
      p.shifts++;
      if (r.status === 'done') p.done++; else p.missedDates.push(r.date);
      by.set(k, p);
    }
    return [...by.values()].filter(p => p.missedDates.length)
      .sort((a, b) => (!a.leader - !b.leader) || a.leader.localeCompare(b.leader) || b.missedDates.length - a.missedDates.length || a.name.localeCompare(b.name));
  }
  function renderClockCheck() {
    const people = $('cc-filter').value === 'people';
    $('cc-shift-table').hidden = people; $('cc-people-table').hidden = !people;
    if (people) {
      const list = ccPeople();
      let lastLeader = null;
      $('cc-people-rows').innerHTML = list.map(p => {
        const head = p.leader !== lastLeader ? `<tr class="group"><th colspan="4">${escapeHtml(p.leader || 'No leader set')} <span class="muted small">(${list.filter(x => x.leader === p.leader).length} to follow up)</span></th></tr>` : '';
        lastLeader = p.leader;
        return head + `<tr><td>${escapeHtml(p.name)}${p.onRoster ? '' : ' <span class="pill" title="This Workday ID is not on the Staff tab">Not on roster</span>'}<div class="muted small">${escapeHtml(p.last4)}</div></td>
          <td>${escapeHtml(p.department || '')}</td>
          <td><strong>${p.missedDates.length}</strong> of ${p.shifts}${p.done ? '' : ' <span class="pill warn">Never did it</span>'}</td>
          <td>${p.missedDates.map(shortDay).join(', ')}</td></tr>`;
      }).join('') || '<tr><td colspan="4" class="muted">Nobody to follow up with. Everyone did their in-service.</td></tr>';
      return;
    }
    $('cc-rows').innerHTML = ccFiltered().map(r => `<tr>
      <td style="white-space:nowrap">${fmtDate(r.date)}</td><td>${escapeHtml(r.time || '')}</td>
      <td>${escapeHtml(r.name)}${r.onRoster ? '' : ' <span class="pill" title="This Workday ID is not on the Staff tab">Not on roster</span>'}${r.ambiguous ? ' <span class="pill warn" title="Several staff share these last 4 digits">Shared ID</span>' : ''}</td>
      <td>${escapeHtml(r.last4)}</td><td>${escapeHtml(r.department || '')}</td>
      <td>${ccLabel[r.status]}${r.status === 'done' ? `<div class="muted small">${fmtWhen(r.completedAt)}</div>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="6" class="muted">Nothing to show. Everyone did their in-service.</td></tr>';
  }
  ['cc-col-id', 'cc-col-name', 'cc-col-date', 'cc-col-time', 'cc-col-pay', 'cc-col-job'].forEach(id => $(id).addEventListener('change', runClockCheck));
  $('cc-run').addEventListener('click', runClockCheck);
  $('cc-filter').addEventListener('change', renderClockCheck);
  $('cc-csv').addEventListener('click', () => {
    const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = $('cc-filter').value === 'people'
      ? [['Leader', 'Name', 'Workday last 4', 'Department', 'Shifts missed', 'Shifts worked', 'Never did it', 'Dates missed'].join(',')]
        .concat(ccPeople().map(p => [p.leader, p.name, p.last4, p.department, p.missedDates.length, p.shifts, p.done ? '' : 'yes', p.missedDates.map(shortDay).join(' ')].map(cell).join(',')))
      : [['Date', 'Clock-in', 'Name', 'Workday last 4', 'Department', 'Leader', 'Result', 'On roster', 'Finished at'].join(',')]
        .concat(ccFiltered().map(r => [r.date, r.time, r.name, r.last4, r.department, r.leader, r.status, r.onRoster ? 'yes' : 'no', r.completedAt || ''].map(cell).join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }));
    a.download = `clock-in-check-${isoDay(new Date())}.csv`;
    a.click();
  });

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
    $('set-leaders').value = Object.entries(s.leaders || {}).map(([d, l]) => `${d}: ${l}`).join('\n');
    $('set-unlisted').checked = !!s.allowUnlisted;
    $('set-closing').value = (s.closingMessages || []).join('\n');
    $('set-news-seconds').value = s.newsSeconds || 3;
    $('pw-env').hidden = !state.passwordFromEnv;
    renderDecor();
    $('pw-form').hidden = !!state.passwordFromEnv;
  }
  $('save-settings').addEventListener('click', async () => {
    try {
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({
        facilityName: $('set-facility').value,
        departments: splitLines($('set-depts').value),
        leaders: Object.fromEntries(splitLines($('set-leaders').value).map(l => l.split(/\s*[:=]\s*/)).filter(x => x.length > 1 && x[0] && x[1])),
        allowUnlisted: $('set-unlisted').checked,
        closingMessages: splitLines($('set-closing').value),
        newsSeconds: Number($('set-news-seconds').value)
      }) });
      $('sc-depts').dataset.init = ''; $('rq-depts').dataset.init = ''; $('an-depts').dataset.init = '';
      toast('Settings saved');
      await refresh();
    } catch (err) { fail(err); }
  });
  // ---------- announcements ----------
  function renderAnnouncements() {
    if (!$('an-depts').dataset.init) { renderChecks($('an-depts'), []); $('an-depts').dataset.init = 1; }
    if (!$('an-start').value) $('an-start').value = state.todayDate;
    const showPast = $('an-show-past').checked;
    const rows = (state.announcements || [])
      .filter(a => showPast || !a.endDate || a.endDate >= state.todayDate)
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
    $('an-rows').innerHTML = rows.map(a => {
      const live = a.startDate <= state.todayDate && (!a.endDate || a.endDate >= state.todayDate);
      const status = live ? ' <span class="pill good">Showing now</span>' : a.startDate > state.todayDate ? ' <span class="pill">Upcoming</span>' : ' <span class="pill">Ended</span>';
      return `<tr class="${!live && a.startDate < state.todayDate ? 'dim' : ''}"><td>${escapeHtml(a.text)}${status}</td><td>${whoLabel(a.departments)}</td>
        <td style="white-space:nowrap">${fmtDate(a.startDate)} – ${a.endDate ? fmtDate(a.endDate) : 'until removed'}</td>
        <td><button class="btn subtle danger" data-del-ann="${a.id}">Remove</button></td></tr>`;
    }).join('') || '<tr><td colspan="4" class="muted">No announcements yet.</td></tr>';
    $('an-celebrate').checked = state.settings.celebrations !== false;
    const up = state.upcomingCelebrations || [];
    $('an-upcoming').innerHTML = up.length
      ? up.map(c => `<div>${fmtDate(c.date)}: ${c.type === 'birthday' ? '🎂' : '🎉'} ${escapeHtml(c.name)}${c.department ? ` <span class="muted">(${escapeHtml(c.department)})</span>` : ''} ${c.type === 'birthday' ? 'birthday' : `${c.years} year${c.years === 1 ? '' : 's'} at work`}</div>`).join('')
      : '<span class="muted">None. Add birthdays and hire dates on the Staff tab.</span>';
  }
  $('an-show-past').addEventListener('change', renderAnnouncements);
  $('an-add').addEventListener('click', async () => {
    $('an-error').textContent = '';
    try {
      await post('/api/admin/announcements', { text: $('an-text').value, departments: checked($('an-depts')), startDate: $('an-start').value, endDate: $('an-end').value });
      $('an-text').value = ''; $('an-end').value = ''; $('an-depts').dataset.init = '';
      toast('Announcement added. The iPad shows it within a minute.');
      await refresh();
    } catch (err) { $('an-error').textContent = err.message; }
  });
  $('an-rows').addEventListener('click', async e => {
    const b = e.target.closest('[data-del-ann]');
    if (!b || !confirm('Remove this announcement?')) return;
    try { await api('/api/admin/announcements/' + b.dataset.delAnn, { method: 'DELETE' }); toast('Removed'); await refresh(); }
    catch (err) { fail(err); }
  });
  $('an-celebrate').addEventListener('change', async () => {
    try { await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ celebrations: $('an-celebrate').checked }) }); toast('Saved'); await refresh(); }
    catch (err) { fail(err); }
  });

  // ---------- home screen decor ----------
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DECOR_COLORS = ['none', 'blue', 'pink', 'green', 'purple', 'yellow', 'red', 'orange'];
  function renderDecor() {
    const d = state.settings.decor || { on: false, months: [] };
    $('decor-on').checked = !!d.on;
    const now = new Date().getMonth();
    $('decor-rows').innerHTML = MONTHS.map((name, i) => {
      const x = d.months[i] || {};
      return `<tr${i === now ? ' style="background:var(--brand-soft,#e4f0f5)"' : ''}><td><strong>${name}</strong>${i === now ? '<div class="muted small">now</div>' : ''}</td>
        <td><input type="text" data-decor="emoji" value="${escapeHtml(x.emoji || '')}" style="width:150px;font-size:20px"></td>
        <td><input type="text" data-decor="message" value="${escapeHtml(x.message || '')}" style="width:100%;min-width:220px"></td>
        <td><select data-decor="color">${DECOR_COLORS.map(c => `<option${c === (x.color || 'none') ? ' selected' : ''}>${c}</option>`).join('')}</select></td>
        <td><a href="/?month=${i + 1}" target="_blank" rel="noopener">Preview</a></td></tr>`;
    }).join('');
  }
  $('save-decor').addEventListener('click', async () => {
    const months = [...$('decor-rows').querySelectorAll('tr')].map(tr => ({
      emoji: tr.querySelector('[data-decor=emoji]').value, message: tr.querySelector('[data-decor=message]').value, color: tr.querySelector('[data-decor=color]').value }));
    try {
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ decor: { on: $('decor-on').checked, months } }) });
      toast('Decor saved. The iPad picks it up within a few minutes.');
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
