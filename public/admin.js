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

  // 👍/👎 counts in the topic library open the Responses tab filtered to that topic's ratings.
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-ratings]');
    if (!a) return;
    e.preventDefault();
    $('resp-from').value = ''; $('resp-to').value = ''; $('resp-dept').value = ''; $('resp-missed').checked = false;
    $('resp-topic').value = a.dataset.ratings; $('resp-helpful').value = 'any'; respPerson = null;
    document.querySelector('#nav button[data-tab="responses"]').click();
  });
  // 👍/👎 counts on the Staff tab open the Responses tab showing that person's ratings.
  let respPerson = null;
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-person-ratings]');
    if (!a) return;
    e.preventDefault();
    $('resp-from').value = ''; $('resp-to').value = ''; $('resp-dept').value = ''; $('resp-topic').value = ''; $('resp-missed').checked = false;
    $('resp-helpful').value = 'any'; respPerson = state.employees.find(x => x.id === a.dataset.personRatings) || null;
    document.querySelector('#nav button[data-tab="responses"]').click();
  });

  // ---------- tabs ----------
  $('nav').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    document.querySelectorAll('#nav button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.id === 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'responses') loadResponses();
    if (b.dataset.tab === 'history') loadUsage();
    if (b.dataset.tab === 'settings') renderSettings();
    if (b.dataset.tab === 'reports') { loadFollowups(); loadMissed(); loadAnnual(); loadReviews(); }
  });

  // ---------- click a column heading to sort ----------
  // Works on every table. Dates, numbers and words each sort the natural way; blanks and "Never" go last.
  // The sort sticks when the table refreshes, until you click a different column.
  const MON_IDX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  function sortKey(cell) {
    if (!cell) return null;
    if (cell.dataset.sort !== undefined) return cell.dataset.sort === '' ? null : isNaN(cell.dataset.sort) ? cell.dataset.sort.toLowerCase() : Number(cell.dataset.sort);
    const t = cell.textContent.replace(/\s+/g, ' ').trim();
    if (!t || /^(never|–|-|none)$/i.test(t)) return null;
    let m = t.match(/^([A-Z][a-z]{2})[a-z]* (\d{1,2}), (\d{4})(?:,? (?:at )?(\d{1,2}):(\d{2}) ?([AP]M))?/);
    if (m && m[1].toLowerCase() in MON_IDX) {
      const h = m[4] ? (Number(m[4]) % 12) + (m[6] === 'PM' ? 12 : 0) : 0;
      return new Date(Number(m[3]), MON_IDX[m[1].toLowerCase()], Number(m[2]), h, Number(m[5] || 0)).getTime();
    }
    if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
    if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) return new Date(Number(m[3].length === 2 ? '20' + m[3] : m[3]), Number(m[1]) - 1, Number(m[2])).getTime();
    if (/^[-+]?[\d,]*\.?\d+\s*%?(\s|$)/.test(t) && !/^\d{4}$/.test(t.split(' ')[0])) return parseFloat(t.replace(/,/g, ''));
    if ((m = t.match(/^👍\s*(\d+)/))) return Number(m[1]);
    return t.toLowerCase();
  }
  function sortTable(table) {
    const col = Number(table.dataset.sortCol), dir = table.dataset.sortDir === 'desc' ? -1 : 1;
    const body = table.tBodies[0];
    if (!body || isNaN(col)) return;
    const rows = [...body.rows];
    if (rows.length < 2 || rows.some(r => r.cells.length === 1 && r.cells[0].colSpan > 1)) return;
    const keyed = rows.map((r, i) => ({ r, i, k: sortKey(r.cells[col]) }));
    keyed.sort((a, b) => {
      if (a.k === null || b.k === null) return a.k === b.k ? a.i - b.i : a.k === null ? 1 : -1;
      const c = typeof a.k === 'number' && typeof b.k === 'number' ? a.k - b.k : String(a.k).localeCompare(String(b.k), undefined, { numeric: true });
      return c * dir || a.i - b.i;
    });
    if (keyed.every((x, i) => x.r === rows[i])) return;   // already in order: touch nothing
    for (const x of keyed) body.appendChild(x.r);
  }
  function markSortable(root) {
    for (const th of root.querySelectorAll('table thead th:not(.sortable)')) {
      if (!th.textContent.trim() || th.querySelector('input, select, button')) continue;
      th.classList.add('sortable'); th.title = th.title || 'Click to sort';
    }
  }
  document.addEventListener('click', e => {
    const th = e.target.closest('th.sortable');
    if (!th) return;
    const table = th.closest('table'), col = th.cellIndex;
    const same = Number(table.dataset.sortCol) === col;
    table.dataset.sortCol = col;
    table.dataset.sortDir = same && table.dataset.sortDir === 'asc' ? 'desc' : 'asc';
    table.querySelectorAll('thead th').forEach(x => x.classList.remove('sort-asc', 'sort-desc'));
    th.classList.add(table.dataset.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    sortTable(table);
  });
  let sortPending = false;
  new MutationObserver(() => {
    if (sortPending) return;
    sortPending = true;
    requestAnimationFrame(() => {
      sortPending = false;
      markSortable(document);
      document.querySelectorAll('table[data-sort-col]').forEach(sortTable);
    });
  }).observe(document.body, { childList: true, subtree: true });
  markSortable(document);

  // ---------- search the whole admin site ----------
  // Finds topics, staff, announcements, and any heading, setting or button on any tab.
  const EXTRA_WORDS = {
    settings: 'password backup restore decor season month color emoji banner speed seconds test data go live clear facility name messages closing leaderboard streaks',
    staff: 'employees people roster birthday hire date anniversary department job title import excel workday code last 4 bulk',
    topics: 'lesson question quiz library import spreadsheet ai copilot chatgpt preview spanish retire copy',
    announcements: 'birthday anniversary messages news banner celebrations',
    responses: 'answers results thumbs ratings helpful csv download',
    clockcheck: 'time clock power bi missed follow up leaders',
    reports: 'missed yearly annual review trends',
    schedule: 'topic of the week rotation calendar',
    required: 'incident education mandatory'
  };
  const tabName = tab => (document.querySelector(`#nav button[data-tab="${tab}"]`) || {}).textContent || tab;
  function pageEntries() {
    const out = [];
    for (const b of document.querySelectorAll('#nav button[data-tab]')) out.push({ label: b.textContent, tab: b.dataset.tab, el: null, hay: b.textContent + ' ' + (EXTRA_WORDS[b.dataset.tab] || '') });
    for (const sec of document.querySelectorAll('section.tab')) {
      const tab = sec.id.replace(/^tab-/, ''), seen = new Set();
      for (const el of sec.querySelectorAll('h2, h3, summary, label, button.btn, a.btn')) {
        if (el.closest('tbody')) continue;
        const label = el.textContent.replace(/\s+/g, ' ').replace(/^[^\w🎂🎉✨🏆👍👎]+|[\s:]+$/g, '').trim();
        if (label.length < 3 || label.length > 70 || seen.has(label.toLowerCase())) continue;
        seen.add(label.toLowerCase());
        out.push({ label, tab, el, hay: label });
      }
    }
    return out;
  }
  function searchAll(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = text => words.every(w => text.toLowerCase().includes(w));
    const groups = [];
    const topics = state.topics.filter(t => hit([t.title, t.category, t.lesson].join(' '))).slice(0, 6)
      .map(t => ({ label: t.title, where: t.status === 'retired' ? 'Retired' : t.status === 'draft' ? 'Needs work' : '', go: () => { goTab('topics'); openEditor(t); } }));
    if (topics.length) groups.push(['Topics', topics]);
    const staff = state.employees.filter(e => hit([e.name, e.last4, e.department, e.jobTitle].join(' '))).slice(0, 6)
      .map(e => ({ label: e.name, where: [e.department, e.active ? '' : 'Inactive'].filter(Boolean).join(' · '),
        go: () => { goTab('staff'); $('staff-filter').value = 'all'; $('staff-dept').value = ''; $('staff-missing').value = ''; $('staff-search').value = e.name; renderStaff(); } }));
    if (staff.length) groups.push(['Staff', staff]);
    const anns = (state.announcements || []).filter(a => hit(a.text)).slice(0, 4).map(a => ({ label: a.text.slice(0, 60), where: '', go: () => goTab('announcements') }));
    if (anns.length) groups.push(['Announcements', anns]);
    const pages = pageEntries().filter(x => hit(x.hay + ' ' + tabName(x.tab))).sort((a, b) => (hit(a.label) ? 0 : 1) - (hit(b.label) ? 0 : 1) || (a.el ? 0 : 1) - (b.el ? 0 : 1)).slice(0, 8)
      .map(x => ({ label: x.label, where: x.el ? tabName(x.tab) : 'Tab', go: () => { goTab(x.tab); if (x.el) showFound(x.el); } }));
    if (pages.length) groups.push(['On the admin site', pages]);
    return groups;
  }
  function goTab(tab) { const b = document.querySelector(`#nav button[data-tab="${tab}"]`); if (b && !b.classList.contains('on')) b.click(); }
  function showFound(el) {
    for (let d = el.closest('details'); d; d = d.parentElement.closest('details')) d.open = true;
    setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('flash-find');
      setTimeout(() => el.classList.remove('flash-find'), 2500);
    }, 60);
  }
  let gsHits = [], gsSel = 0;
  function renderSearch() {
    const q = $('gsearch').value.trim();
    const box = $('gsearch-results');
    if (!q) { box.hidden = true; gsHits = []; return; }
    const groups = searchAll(q);
    gsHits = groups.flatMap(g => g[1]); gsSel = 0;
    let i = 0;
    box.innerHTML = groups.map(([name, list]) => `<div class="grp">${name}</div>` + list.map(h =>
      `<button type="button" data-gs="${i}"${i++ === 0 ? ' class="sel"' : ''}>${escapeHtml(h.label)}${h.where ? `<span class="where">${escapeHtml(h.where)}</span>` : ''}</button>`).join('')).join('')
      || '<div class="muted small" style="padding:8px 14px">Nothing found. Try a different word.</div>';
    box.hidden = false;
  }
  function pickSearch(i) {
    const h = gsHits[i];
    if (!h) return;
    $('gsearch-results').hidden = true; $('gsearch').blur();
    h.go();
  }
  $('gsearch').addEventListener('input', renderSearch);
  $('gsearch').addEventListener('focus', renderSearch);
  $('gsearch').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); pickSearch(gsSel); }
    else if (e.key === 'Escape') { $('gsearch-results').hidden = true; $('gsearch').blur(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      gsSel = Math.max(0, Math.min(gsHits.length - 1, gsSel + (e.key === 'ArrowDown' ? 1 : -1)));
      document.querySelectorAll('#gsearch-results [data-gs]').forEach(b => b.classList.toggle('sel', Number(b.dataset.gs) === gsSel));
    }
  });
  $('gsearch-results').addEventListener('mousedown', e => { const b = e.target.closest('[data-gs]'); if (b) { e.preventDefault(); pickSearch(Number(b.dataset.gs)); } });
  document.addEventListener('click', e => { if (!e.target.closest('.gsearch')) $('gsearch-results').hidden = true; });
  // Press / anywhere (outside a text box) to jump to the search bar.
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !e.target.closest('input, textarea, select, [contenteditable]') && !document.querySelector('dialog[open]')) { e.preventDefault(); $('gsearch').focus(); }
  });

  async function refresh() {
    state = await api('/api/admin/state');
    renderToday(); renderSchedule(); renderRequired(); renderStarter(); renderAnnouncements(); renderTopics(); renderStaff(); renderFilters(); renderReportFilters();
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

  // ---------- iPad check ----------
  // The iPad asks for its settings every minute while it shows the keypad. Warn when it goes quiet.
  const KIOSK_QUIET_MIN = 10;
  const ago = mins => mins < 1 ? 'just now' : mins < 60 ? `${Math.round(mins)} minute${Math.round(mins) === 1 ? '' : 's'} ago`
    : mins < 48 * 60 ? `${Math.round(mins / 60)} hour${Math.round(mins / 60) === 1 ? '' : 's'} ago` : `${Math.round(mins / 1440)} days ago`;
  async function checkKiosk() {
    let k;
    try { k = await api('/api/admin/kiosk-status'); } catch { return; }
    const now = new Date(k.now);
    const mins = k.kioskSeen ? (now - new Date(k.kioskSeen.at)) / 60000 : null;
    const upMins = (now - new Date(k.serverStartedAt)) / 60000;
    // Right after an update the site restarts and hasn't heard from the iPad yet; give it a few minutes.
    const quiet = mins === null ? upMins > 5 : mins > KIOSK_QUIET_MIN;
    const noneToday = !k.responseCountToday && new Date().getHours() >= 10;
    const alerts = [];
    if (quiet) alerts.push(`The iPad hasn't checked in for ${mins === null ? 'over ' + ago(upMins).replace(' ago', '') : ago(mins).replace(' ago', '')}. <span class="small">Check that it's charged, on Wi-Fi, and showing the in-service page.</span>`);
    else if (noneToday) alerts.push('No one has done an in-service on the iPad yet today. <span class="small">Check that the iPad is working and staff can reach it.</span>');
    $('kiosk-alert').innerHTML = alerts.map(a => `<div>⚠️ ${a}</div>`).join('');
    $('kiosk-alert').hidden = !alerts.length;
    $('kiosk-status').innerHTML = `<div><span class="dot${quiet ? ' off' : ''}"></span>${k.kioskSeen ? `Last checked in ${ago(mins)}${k.kioskSeen.device === 'iPad' ? ' from the iPad' : ''}.` : 'Waiting to hear from the iPad.'}</div>
      <div class="muted" style="margin-top:4px">Last in-service: ${k.lastResponseAt ? fmtWhen(k.lastResponseAt) : 'none yet'}. Completed today: ${k.responseCountToday}.</div>
      ${k.kioskSeen && k.kioskSeen.waiting ? `<div style="margin-top:4px">${k.kioskSeen.waiting} answer${k.kioskSeen.waiting === 1 ? '' : 's'} saved on the iPad while it was offline ${k.kioskSeen.waiting === 1 ? 'is' : 'are'} waiting to upload.</div>` : ''}
      <div class="muted" style="margin-top:4px">A warning shows at the top of this page if the iPad goes ${KIOSK_QUIET_MIN} minutes without checking in, or if no one has done an in-service by 10 am.</div>`;
  }
  checkKiosk();
  setInterval(checkKiosk, 60000);

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

  // ---------- new hire starter set ----------
  let nsIds = null, nsDirty = false;
  function renderStarter() {
    const st = state.settings.starter || { topicIds: [], days: 60 };
    if (!nsDirty) { nsIds = st.topicIds.slice(); $('ns-days').value = st.days; }
    $('ns-list').innerHTML = nsIds.map((id, i) => {
      const t = topicById(id);
      return `<li>${t ? escapeHtml(t.title) : '<span class="muted">Deleted topic</span>'}${t && t.status !== 'active' ? ' <span class="pill warn">Not active</span>' : ''}
        <span class="muted small">${t ? whoLabel(t.departments) : ''}</span>
        <button class="btn subtle" data-ns-up="${i}"${i ? '' : ' disabled'}>↑</button><button class="btn subtle" data-ns-down="${i}"${i < nsIds.length - 1 ? '' : ' disabled'}>↓</button>
        <button class="btn subtle danger" data-ns-del="${i}">Remove</button></li>`;
    }).join('') || '<li class="muted" style="list-style:none;margin-left:-20px">No topics yet. Add the ones every new person should see first.</li>';
    topicOptions($('ns-add-topic'));
    $('nh-rows').innerHTML = (state.newHires || []).map(n => `<tr><td>${escapeHtml(n.name)}</td><td>${escapeHtml(n.department || '')}</td>
      <td style="white-space:nowrap">${fmtDate(n.hireDate)}<div class="muted small">new hire until ${fmtDate(n.until)}</div></td>
      <td>${n.total ? `<div class="progress-bar"><span style="width:${Math.round(100 * n.done / n.total)}%"></span></div><div class="small">${n.done} of ${n.total} done</div>` : '<span class="muted">No topics for their department</span>'}</td>
      <td>${n.next ? escapeHtml(n.next) : n.total ? '<span class="pill good">Finished</span>' : ''}</td></tr>`).join('')
      || '<tr><td colspan="5" class="muted">No one with a recent hire date. Add hire dates on the Staff tab.</td></tr>';
  }
  $('ns-list').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const swap = (i, j) => { [nsIds[i], nsIds[j]] = [nsIds[j], nsIds[i]]; };
    if (b.dataset.nsUp) swap(Number(b.dataset.nsUp), Number(b.dataset.nsUp) - 1);
    else if (b.dataset.nsDown) swap(Number(b.dataset.nsDown), Number(b.dataset.nsDown) + 1);
    else if (b.dataset.nsDel) nsIds.splice(Number(b.dataset.nsDel), 1);
    nsDirty = true; renderStarter();
  });
  $('ns-add').addEventListener('click', () => {
    const id = $('ns-add-topic').value;
    if (!id) return;
    if (!nsIds.includes(id)) nsIds.push(id);
    $('ns-add-topic').value = ''; nsDirty = true; renderStarter();
  });
  $('ns-days').addEventListener('input', () => { nsDirty = true; });
  $('ns-save').addEventListener('click', async () => {
    try {
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ starter: { topicIds: nsIds, days: Number($('ns-days').value) } }) });
      nsDirty = false; toast('Starter set saved'); await refresh();
    } catch (err) { fail(err); }
  });

  // ---------- topics ----------
  // Fills a filter dropdown, keeping the current choice if it still exists.
  const sameDept = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  function fillSelect(sel, first, options) {
    const cur = sel.value;
    sel.innerHTML = first.map(([v, l]) => `<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`).join('') + options.map(o => `<option>${escapeHtml(o)}</option>`).join('');
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : first[0][0];
  }
  function renderTopics() {
    const q = $('topic-search').value.trim().toLowerCase();
    const f = $('topic-filter').value;
    const allDepts = [...new Set([...depts(), ...state.topics.flatMap(t => t.departments || [])])].sort((a, b) => a.localeCompare(b));
    fillSelect($('topic-for'), [['', 'For: anyone'], ['*', 'For: all staff only']], allDepts);
    fillSelect($('topic-cat'), [['', 'All categories'], ['-', 'No category']], [...new Set(state.topics.map(t => t.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)));
    const fd = $('topic-for').value, fc = $('topic-cat').value;
    const rows = state.topics
      .filter(t => !fd || (fd === '*' ? !(t.departments || []).length : !(t.departments || []).length || t.departments.some(d => sameDept(d, fd))))
      .filter(t => !fc || (fc === '-' ? !t.category : t.category === fc))
      .filter(t => f === 'all' || (f === 'retired' ? t.status === 'retired' : f === 'draft' ? t.status === 'draft' : t.status !== 'retired' && (f !== 'rotation' || (t.inRotation && t.status === 'active'))))
      .filter(t => !q || [t.title, t.category, t.lesson, ...t.questions.map(x => x.text)].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (a.status === 'draft') - (b.status === 'draft') || (b.lastUsedDate || '').localeCompare(a.lastUsedDate || '') || a.title.localeCompare(b.title));
    $('topic-rows').innerHTML = rows.map(t => {
      const st = state.topicStats[t.id];
      const pct = st && st.responses ? Math.round(100 * st.firstTry / st.responses) + '%' : '<span class="muted">–</span>';
      const retired = t.status === 'retired', draft = t.status === 'draft';
      const tags = (t.annual ? ' <span class="pill req">Yearly</span>' : '') + (t.es && t.es.lesson ? ' <span class="pill brand">Español</span>' : '') +
        (retired ? ' <span class="pill">Retired</span>' : '') +
        (draft ? ` <span class="pill warn" title="${escapeHtml((t.problems || []).join(' '))}">Needs work</span>` : '');
      return `<tr class="${retired ? 'dim' : ''}">
        <td><strong>${escapeHtml(t.title)}</strong>${tags}<div class="muted small">${escapeHtml(t.category || '')}${draft && t.problems ? ' · ' + escapeHtml(t.problems[0]) : ''}</div></td>
        <td class="small">${whoLabel(t.departments)}</td>
        <td>${t.questions.length}</td>
        <td>${retired || draft ? '<span class="muted">–</span>' : `<input type="checkbox" data-rotation="${t.id}"${t.inRotation ? ' checked' : ''} aria-label="In rotation">`}</td>
        <td style="white-space:nowrap">${fmtDate(t.lastUsedDate)}</td>
        <td style="white-space:nowrap">${t.createdAt ? fmtDate(t.createdAt.slice(0, 10)) : '<span class="muted">–</span>'}</td>
        <td>${st ? st.responses : 0}</td>
        <td>${pct}${st && st.helpful + st.notHelpful ? `<div class="small" title="See who rated this lesson"><a href="#" data-ratings="${t.id}">👍 ${st.helpful} · 👎 ${st.notHelpful}</a></div>` : ''}</td>
        <td style="white-space:nowrap">
          <button class="btn subtle" data-act="preview" data-id="${t.id}" title="Try it on the kiosk screens. Nothing is saved.">Preview</button><button class="btn subtle" data-act="details" data-id="${t.id}" title="All questions and answers on one page">Answer key</button>
          <button class="btn subtle" data-act="edit" data-id="${t.id}">Edit</button>
          <button class="btn subtle" data-act="duplicate" data-id="${t.id}">Copy</button>
          ${retired ? `<button class="btn subtle" data-act="restore" data-id="${t.id}">Restore</button>`
                    : `<button class="btn subtle danger" data-act="retire" data-id="${t.id}">Retire</button>`}
        </td></tr>`;
    }).join('') || '<tr><td colspan="9" class="muted">No topics match.</td></tr>';
    const cats = [...new Set(state.topics.map(t => t.category).filter(Boolean))].sort();
    $('category-list').innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">`).join('');
  }
  $('topic-search').addEventListener('input', renderTopics);
  $('topic-filter').addEventListener('change', renderTopics);
  $('topic-for').addEventListener('change', renderTopics);
  $('topic-cat').addEventListener('change', renderTopics);

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
      if (act === 'details') return showDetails(t);
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

  // "Preview" opens the real kiosk screens in a new window, in practice mode (nothing is saved).
  function showPreview(t) {
    if (!t) return;
    if (!t.questions.length) return showDetails(t);
    const w = window.open('/admin/preview?topic=' + encodeURIComponent(t.id), 'inservice-preview', 'width=820,height=1080');
    if (!w) return alert('Your browser blocked the preview window. Allow pop-ups for this site and try again.');
    w.focus();
  }
  function showDetails(t) {
    if (!t) return;
    $('vw-title').textContent = t.title;
    $('vw-body').innerHTML = `<div class="muted small" style="margin-top:12px">For: ${whoLabel(t.departments)}</div>
      <div class="lesson-preview" style="margin-top:8px">${formatLesson(t.lesson) || '<span class="muted">No lesson yet.</span>'}</div>
      ${t.questions.map((q, n) => `
        <h3 style="margin-top:18px">Question ${n + 1}${q.type === 'multi' ? ' <span class="pill brand">Select all that apply</span>' : ''}: ${escapeHtml(q.text)}</h3>
        <ul>${q.correctAnswers.map(a => `<li>${escapeHtml(a)} <span class="pill good">Correct</span></li>`).join('')}${q.wrongAnswers.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul>
        ${q.hint ? `<div class="muted small"><strong>Hint after a wrong answer:</strong> ${escapeHtml(q.hint)}</div>` : ''}
        ${q.explanation ? `<div class="muted small"><strong>Explanation:</strong> ${escapeHtml(q.explanation)}</div>` : ''}`).join('')}
      ${t.es && t.es.lesson ? `<details class="es" style="margin-top:16px"><summary>Spanish version</summary>
        <h3 style="margin-top:10px">${escapeHtml(t.es.title || t.title)}</h3><div class="lesson-preview">${formatLesson(t.es.lesson)}</div>
        ${t.questions.filter(q => q.es).map(q => `<h3 style="margin-top:14px">${escapeHtml(q.es.text)}</h3>
          <ul>${q.es.correctAnswers.map(a => `<li>${escapeHtml(a)} <span class="pill good">Correcta</span></li>`).join('')}${q.es.wrongAnswers.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul>`).join('')}
        ${t.questions.some(q => !q.es) ? `<div class="muted small">${t.questions.filter(q => !q.es).length} question(s) have no Spanish yet and show in English only.</div>` : ''}</details>` : ''}
      <div class="muted small" style="margin-top:14px">Each person gets one question per visit, with the answers in a random order.</div>`;
    $('viewer').showModal();
  }

  // ---------- topic editor ----------
  function addQuestionCard(q = {}) {
    const card = document.createElement('div');
    card.className = 'qcard';
    const lines = arr => escapeHtml((arr || []).join('\n'));
    const es = q.es || {};
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
      <input type="text" class="q-expl" style="width:100%" value="${escapeHtml(q.explanation || '')}">
      <details class="es q-es"${q.es ? ' open' : ''}><summary>Spanish</summary>
        <div class="muted small" style="margin-top:4px">Put the answers in the same order as the English ones.</div>
        <textarea class="q-es-text" rows="2" placeholder="Pregunta" style="margin-top:6px">${escapeHtml(es.text || '')}</textarea>
        <div class="grid" style="gap:0 14px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">
          <div><label class="block small">Correct answer(s) in Spanish</label><textarea class="q-es-correct" rows="2">${lines(es.correctAnswers)}</textarea></div>
          <div><label class="block small">Wrong answers in Spanish <span class="hint">one per line</span></label><textarea class="q-es-wrong" rows="3">${lines(es.wrongAnswers)}</textarea></div>
        </div>
        <label class="block small">Hint in Spanish</label><input type="text" class="q-es-hint" style="width:100%" value="${escapeHtml(es.hint || '')}">
        <label class="block small">Explanation in Spanish</label><input type="text" class="q-es-expl" style="width:100%" value="${escapeHtml(es.explanation || '')}">
      </details>`;
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
    $('f-annual').checked = !!(t && t.annual);
    $('f-es-title').value = t && t.es ? t.es.title || '' : '';
    $('f-es-lesson').value = t && t.es ? t.es.lesson || '' : '';
    $('f-es-box').open = !!(t && t.es);
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

  // ----- Get help from AI -----
  // No AI runs on this site: it writes instructions to paste into Copilot, ChatGPT or Claude, then reads the answer back into the topic editor.
  const aiMode = () => document.querySelector('input[name=ai-mode]:checked').value;
  let aiFromEditor = false;   // opened from inside the topic editor: answers go into the open topic
  function aiTopic() {
    if (aiFromEditor) return { title: $('f-title').value.trim(), lesson: $('f-lesson').value.trim(), questions: readQuestionTexts() };
    const t = topicById($('ai-topic').value);
    return t ? { title: t.title, lesson: t.lesson, questions: t.questions.map(q => q.text) } : null;
  }
  function readQuestionTexts() { return [...$('f-questions').querySelectorAll('.q-text')].map(x => x.value.trim()).filter(Boolean); }
  function openAiHelp(fromEditor) {
    aiFromEditor = !!fromEditor;
    document.querySelector(`input[name=ai-mode][value=${fromEditor ? 'more' : 'new'}]`).checked = true;
    document.querySelectorAll('input[name=ai-mode]').forEach(r => { r.disabled = aiFromEditor; });
    const live = state.topics.filter(t => t.status !== 'retired').sort((a, b) => a.title.localeCompare(b.title));
    $('ai-topic').innerHTML = live.map(t => `<option value="${t.id}">${escapeHtml(t.title)}</option>`).join('');
    $('ai-about').value = ''; $('ai-answer').value = ''; $('ai-error').textContent = ''; $('ai-copied').textContent = '';
    syncAi();
    $('ai-help').showModal();
  }
  function syncAi() {
    const more = aiMode() === 'more';
    $('ai-topic').hidden = !more || aiFromEditor;
    $('ai-about-label').textContent = more ? 'Anything the new questions should focus on? (optional)' : 'What should it be about?';
    $('ai-prompt').value = aiPrompt();
  }
  function aiPrompt() {
    const more = aiMode() === 'more';
    const n = $('ai-count').value, es = $('ai-es').checked, about = $('ai-about').value.trim();
    const t = more ? aiTopic() : null;
    const qFormat = `QUESTION: the question
TYPE: single   (or: select all)
CORRECT: a correct answer   (one line per correct answer)
WRONG: a wrong answer       (one line per wrong answer)
HINT: one short sentence that nudges without giving the answer away
EXPLANATION: one short sentence on why the answer is right` + (es ? `
SPANISH QUESTION: the question in Spanish
SPANISH CORRECT: (same order as CORRECT)
SPANISH WRONG: (same order as WRONG)
SPANISH HINT: ...
SPANISH EXPLANATION: ...` : '');
    return [
      `You're helping write a micro in-service for staff at a skilled nursing facility. Staff read it standing at an iPad and answer one quick multiple-choice question, so everything must be very short and plain.`,
      more ? `Write ${n} NEW questions for this existing topic.\n\nTopic: ${t ? t.title : ''}\nLesson:\n${t ? t.lesson : ''}` + (t && t.questions.length ? `\n\nQuestions it already has (don't repeat these):\n${t.questions.map(q => '- ' + q).join('\n')}` : '') + (about ? `\n\nFocus on: ${about}` : '')
           : `Write one topic with a lesson and ${n} questions.\n\nTopic: ${about || '(describe the topic here)'}`,
      `Rules:
${more ? '' : '- Lesson: one short lead sentence, then up to 3 short bullets that start with "- ". 20 to 35 words in all. Use **double asterisks** to bold one key phrase.\n'}- Questions only test what the lesson says.
- Each answer under 10 words. 1 correct answer and 2 or 3 believable wrong answers.
- At most one question may be "select all that apply", with 2 or 3 correct answers.
- Simple, everyday words. No trick questions.
- Never mention a real resident, staff member, or anyone's personal or health information.`,
      `Put your whole reply inside ONE code block (so it can be copied with line breaks), in exactly this format, and nothing else:\n\n` + (more ? '' : `TITLE: a short title\nLESSON:\nlead sentence\n- bullet\n- bullet\n` + (es ? `SPANISH TITLE: ...\nSPANISH LESSON:\n...\n` : '') + '\n') + qFormat + `\n\n(repeat the QUESTION block for each question)`
    ].join('\n\n');
  }
  // Reads the AI's answer. Forgiving about markdown, numbering and spacing.
  function parseAi(text) {
    const out = { title: '', lesson: [], es: { title: '', lesson: [] }, questions: [] };
    let q = null, into = null;
    // Copying from a chat window often loses the line breaks ("TITLE: x LESSON: y - z QUESTION: ..."), so put each label back on its own line.
    const LABEL = /(?<!SPANISH)\s+(?=(?:\*\*)?(?:SPANISH\s+)?(?:TITLE|LESSON|QUESTION|TYPE|CORRECT|WRONG|HINT|EXPLANATION)(?:\s+ANSWERS?)?\s*\d*\s*(?:\*\*)?\s*:)/g;
    let body = String(text).replace(/\r/g, '').replace(/```\w*/g, '').replace(LABEL, '\n');
    // Inside a squashed lesson, " - " or " • " starts a bullet.
    body = body.replace(/((?:^|\n)(?:SPANISH\s+)?LESSON\s*:[^\n]*)/gi, m => m.replace(/\s+[-•*]\s+(?=\S)/g, '\n- '));
    // "WRONG: a | b" or a list under the label both work; a bullet under CORRECT/WRONG becomes its own line of that kind.
    let lastKey = null;
    body = body.split('\n').map(line => {
      const k = line.match(/^[\s*_]*(?:SPANISH\s+)?(CORRECT|WRONG)\b/i);
      if (k) { lastKey = line.match(/^[\s*_]*((?:SPANISH\s+)?(?:CORRECT|WRONG))/i)[1].toUpperCase(); return line; }
      if (/^[\s*_]*(?:SPANISH\s+)?(TITLE|LESSON|QUESTION|TYPE|HINT|EXPLANATION)\b/i.test(line)) lastKey = null;
      const b = lastKey && line.match(/^\s*(?:[-•*]|[a-d][.)])\s+(.+)$/i);
      return b ? `${lastKey}: ${b[1]}` : line;
    }).join('\n');
    for (const raw of body.split('\n')) {
      const clean = raw.replace(/^[\s>#*_`]*(\d+[.)]\s*)?[*_`]*/, '').replace(/^[-•]\s+(?=[A-Za-z ]+:)/, '');
      const m = clean.match(/^(spanish\s+)?(title|lesson|question|type|correct(?:\s+answers?)?|wrong(?:\s+answers?)?|hint|explanation)\s*\d*\s*[*_]*\s*:\s*[*_]*\s*(.*)$/i);
      if (m) {
        const sp = !!m[1], key = m[2].toLowerCase().split(/\s/)[0], val = m[3].replace(/[*_]+$/, '').replace(/\s+\d+[.)]$/, '').trim();
        if (key === 'question' && !sp) { q = { text: val, type: 'single', correctAnswers: [], wrongAnswers: [], hint: '', explanation: '', es: { text: '', correctAnswers: [], wrongAnswers: [], hint: '', explanation: '' } }; out.questions.push(q); into = null; continue; }
        if (key === 'title') { (sp ? out.es : out).title = val; into = null; continue; }
        if (key === 'lesson') { into = sp ? out.es.lesson : out.lesson; if (val) into.push(val); continue; }
        into = null;
        if (!q) continue;
        const tgt = sp ? q.es : q;
        if (key === 'type') { if (/all/i.test(val)) q.type = 'multi'; }
        else if (key === 'question') tgt.text = val;
        else if (key === 'correct') tgt.correctAnswers.push(...val.split(/\s*[|;]\s*/).filter(Boolean));
        else if (key === 'wrong') tgt.wrongAnswers.push(...val.split(/\s*[|;]\s*/).filter(Boolean));
        else tgt[key] = val;
        continue;
      }
      if (into) {
        const line = raw.replace(/^\s*[•*]\s+/, '- ').replace(/^\s+/, '');
        if (line || into.length) into.push(line);
      } else if (q && raw.trim() && /^\s*[-•*]\s+/.test(raw) && !q.correctAnswers.length && !q.wrongAnswers.length) { /* stray bullet: ignore */ }
    }
    const tidy = a => a.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    out.lesson = tidy(out.lesson); out.es.lesson = tidy(out.es.lesson);
    out.questions = out.questions.filter(x => x.text && x.correctAnswers.length);
    for (const x of out.questions) {
      if (x.correctAnswers.length > 1) x.type = 'multi';
      if (!x.es.text) delete x.es;
    }
    return out;
  }
  function fillFromAi() {
    const r = parseAi($('ai-answer').value);
    const more = aiMode() === 'more';
    if (!r.questions.length && !(r.title || r.lesson)) { $('ai-error').textContent = "I couldn't find a topic or questions in that. Paste the AI's whole answer, starting at TITLE: or QUESTION:."; return; }
    $('ai-help').close();
    if (!aiFromEditor) {
      if (more) openEditor(topicById($('ai-topic').value));
      else openEditor(null);
    }
    if (!more || !aiFromEditor) {
      if (r.title && !more) $('f-title').value = r.title;
      if (r.lesson && !more) { $('f-lesson').value = r.lesson; updateLessonPreview(); }
      if (r.es.lesson && !more) { $('f-es-title').value = r.es.title || ''; $('f-es-lesson').value = r.es.lesson; $('f-es-box').open = true; }
    }
    // Replace the empty starter card, then add each question.
    [...$('f-questions').children].forEach(c => { if (!c.querySelector('.q-text').value.trim()) c.remove(); });
    r.questions.forEach(q => addQuestionCard(q));
    if (!$('f-questions').children.length) addQuestionCard();
    $('f-error').textContent = `Filled in by AI: ${r.questions.length} question${r.questions.length === 1 ? '' : 's'}. Check it over, then Save.`;
  }
  $('ai-help-btn').addEventListener('click', () => openAiHelp(false));
  $('f-ai').addEventListener('click', () => openAiHelp(true));
  ['ai-about', 'ai-count', 'ai-es', 'ai-topic'].forEach(id => $(id).addEventListener('input', syncAi));
  document.querySelectorAll('input[name=ai-mode]').forEach(r => r.addEventListener('change', syncAi));
  $('ai-copy').addEventListener('click', async () => {
    syncAi();
    if (aiMode() === 'new' && !$('ai-about').value.trim()) { $('ai-error').textContent = 'First say what the topic should be about.'; return; }
    $('ai-error').textContent = '';
    try { await navigator.clipboard.writeText($('ai-prompt').value); $('ai-copied').textContent = '✓ Copied. Paste it into the AI chat.'; }
    catch { $('ai-prompt').closest('details').open = true; $('ai-prompt').select(); $('ai-copied').textContent = 'Press Ctrl+C to copy the highlighted instructions.'; }
  });
  $('ai-fill').addEventListener('click', fillFromAi);

  const splitLines = v => v.split('\n').map(x => x.trim()).filter(Boolean);
  async function saveTopic(draft) {
    const body = {
      draft, title: $('f-title').value, category: $('f-category').value, lesson: $('f-lesson').value, image: $('f-image').value.trim(),
      departments: checked($('f-depts')), inRotation: $('f-rotation').checked, annual: $('f-annual').checked,
      es: { title: $('f-es-title').value, lesson: $('f-es-lesson').value },
      questions: [...$('f-questions').children].map(c => ({
        id: c.dataset.qid || undefined,
        type: c.querySelector('.q-multi').checked ? 'multi' : 'single',
        text: c.querySelector('.q-text').value,
        correctAnswers: splitLines(c.querySelector('.q-correct').value),
        wrongAnswers: splitLines(c.querySelector('.q-wrong').value),
        hint: c.querySelector('.q-hint').value, explanation: c.querySelector('.q-expl').value,
        es: { text: c.querySelector('.q-es-text').value, correctAnswers: splitLines(c.querySelector('.q-es-correct').value),
          wrongAnswers: splitLines(c.querySelector('.q-es-wrong').value), hint: c.querySelector('.q-es-hint').value, explanation: c.querySelector('.q-es-expl').value }
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
  // Some exports (Workday reports) record a too-small sheet size, so only the title row would be read. Use the real extent.
  function fullSheet(ws) {
    let maxR = 0, maxC = 0;
    for (const k of Object.keys(ws)) {
      if (k[0] === '!') continue;
      const c = XLSX.utils.decode_cell(k);
      if (c.r > maxR) maxR = c.r;
      if (c.c > maxC) maxC = c.c;
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
    return ws;
  }
  // Returns rows (arrays) from the first sheet, or from the sheet whose name matches `prefer`.
  async function readSheet(file, prefer) {
    if (/\.xlsx?$/i.test(file.name)) {
      await loadXlsx();
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const name = wb.SheetNames.find(n => prefer && prefer.test(n)) || wb.SheetNames[0];
      return XLSX.utils.sheet_to_json(fullSheet(wb.Sheets[name]), { header: 1, raw: true, defval: '' })
        .map(r => r.map(c => c instanceof Date ? isoDay(new Date(Math.round(c.getTime() / 60000) * 60000)) : String(c)))
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
        image: findCol(header, [/^(image|picture|gif)/i]),
        esTitle: findCol(header, [/^spanish (topic )?title$/i]),
        esLesson: findCol(header, [/^spanish lesson/i]),
        esQuestion: findCol(header, [/^spanish question$/i]),
        esCorrect: findCol(header, [/^spanish correct answers?$/i]),
        esWrong: findCol(header, [/^spanish (wrong|incorrect) answers?$/i]),
        esHint: findCol(header, [/^spanish hint$/i]),
        esExplanation: findCol(header, [/^spanish explanation$/i])
      };
      const hasEs = col.esLesson >= 0 || col.esQuestion >= 0;
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
        if (hasEs) {
          t.es = t.es || { title: '', lesson: '' };
          if (!t.es.title && get(r, 'esTitle')) t.es.title = get(r, 'esTitle');
          if (!t.es.lesson && get(r, 'esLesson')) t.es.lesson = get(r, 'esLesson');
        }
        if (col.image >= 0 && !t.image && get(r, 'image')) t.image = get(r, 'image');
        const lu = get(r, 'lastUsed').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(lu) && lu > t.lastUsedDate) t.lastUsedDate = lu;
        const text = get(r, 'question');
        if (!text) continue;
        const multi = /select all/i.test(text);
        let correct = split(get(r, 'correct'));
        if (multi && correct.length === 1) correct = correct[0].split(/\s+\/\s+/).map(x => x.trim()).filter(Boolean);
        const q = { type: multi ? 'multi' : 'single', text, correctAnswers: correct, wrongAnswers: split(get(r, 'wrong')), hint: get(r, 'hint'), explanation: get(r, 'explanation') };
        if (get(r, 'esQuestion')) {
          let esCorrect = split(get(r, 'esCorrect'));
          if (multi && esCorrect.length === 1) esCorrect = esCorrect[0].split(/\s+\/\s+/).map(x => x.trim()).filter(Boolean);
          q.es = { text: get(r, 'esQuestion'), correctAnswers: esCorrect, wrongAnswers: split(get(r, 'esWrong')), hint: get(r, 'esHint'), explanation: get(r, 'esExplanation') };
        }
        t.questions.push(q);
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
    fillSelect($('staff-dept'), [['', 'All departments'], ['-', 'No department']],
      [...new Set([...depts(), ...state.employees.map(e => e.department).filter(Boolean)])].sort((a, b) => a.localeCompare(b)));
    const fd = $('staff-dept').value;
    const inSet = state.employees.filter(e => f === 'all' || (f === 'active' ? e.active : !e.active))
      .filter(e => !fd || (fd === '-' ? !e.department : sameDept(e.department, fd)));
    const noBday = inSet.filter(e => !e.birthday).length, noHire = inSet.filter(e => !e.hireDate).length;
    const mo = $('staff-missing').options;
    mo[0].textContent = `Everyone (${inSet.length})`; mo[1].textContent = `Missing birthday (${noBday})`; mo[2].textContent = `Missing hire date (${noHire})`;
    const miss = $('staff-missing').value;
    const rows = inSet
      .filter(e => !miss || (miss === 'birthday' ? !e.birthday : !e.hireDate))
      .filter(e => !q || [e.name, e.last4, e.department].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    staffShown = rows.map(e => e.id);
    $('staff-rows').innerHTML = rows.map(e => `<tr class="${e.active ? '' : 'dim'}">
      <td><input type="checkbox" data-pick="${e.id}"${staffPicked.has(e.id) ? ' checked' : ''}></td>
      <td><strong>${escapeHtml(e.name)}</strong>${e.active ? '' : ' <span class="pill">Inactive</span>'}${e.birthday ? `<div class="muted small">🎂 ${e.birthday.split('-').map(Number).join('/')}</div>` : ''}</td>
      <td>${escapeHtml(e.last4)}</td><td>${escapeHtml(e.department)}${e.jobTitle && e.jobTitle !== e.department ? `<div class="muted small">${escapeHtml(e.jobTitle)}</div>` : ''}</td>
      <td data-last="${e.id}" class="small muted">…</td>
      <td data-rated="${e.id}" class="small" style="white-space:nowrap"></td>
      <td data-pending="${e.id}"></td>
      <td style="white-space:nowrap"><button class="btn subtle" data-edit-staff="${e.id}">Edit</button><button class="btn subtle" data-record="${e.id}">Training record</button></td></tr>`).join('')
      || '<tr><td colspan="8" class="muted">No staff yet. Add them one at a time or import your roster from a spreadsheet.</td></tr>';
    fillStaffActivity();
    renderBulk();
    const sel = $('st-dept');
    sel.innerHTML = '<option value="">No department</option>' + depts().map(d => `<option>${escapeHtml(d)}</option>`).join('');
  }
  async function fillStaffActivity() {
    try {
      const { responses } = await api('/api/admin/responses');
      const last = {}, doneReq = {}, rated = {};
      for (const r of responses) {
        if (!r.employeeId) continue;
        if (!last[r.employeeId]) last[r.employeeId] = r.submittedAt;
        if ('helpful' in r) { const x = rated[r.employeeId] || (rated[r.employeeId] = { up: 0, down: 0 }); x[r.helpful ? 'up' : 'down'] += 1; }
        if (r.requiredId && r.completed) (doneReq[r.employeeId] = doneReq[r.employeeId] || new Set()).add(r.requiredId);
      }
      for (const e of state.employees) {
        const c = document.querySelector(`[data-last="${e.id}"]`);
        if (c) c.textContent = last[e.id] ? fmtWhen(last[e.id]) : 'Never';
        const t = document.querySelector(`[data-rated="${e.id}"]`);
        if (t) t.innerHTML = rated[e.id] ? `<a href="#" data-person-ratings="${e.id}" title="See which lessons they rated">👍 ${rated[e.id].up} · 👎 ${rated[e.id].down}</a>` : '<span class="muted">–</span>';
        const p = document.querySelector(`[data-pending="${e.id}"]`);
        if (p) {
          const n = state.required.filter(r => r.active && (!r.departments.length || r.departments.includes(e.department)) && !(doneReq[e.id] && doneReq[e.id].has(r.id))).length;
          p.innerHTML = n ? `<span class="pill req">${n}</span>` : '<span class="muted">–</span>';
        }
      }
    } catch { /* leave placeholders */ }
  }
  // ----- bulk select and edit -----
  const staffPicked = new Set();
  let staffShown = [];
  function renderBulk() {
    for (const id of [...staffPicked]) if (!state.employees.some(e => e.id === id)) staffPicked.delete(id);
    $('staff-bulk').hidden = !staffPicked.size;
    $('staff-bulk-n').textContent = `${staffPicked.size} selected`;
    $('staff-all').checked = staffShown.length > 0 && staffShown.every(id => staffPicked.has(id));
    const cur = $('staff-bulk-dept').value;
    $('staff-bulk-dept').innerHTML = '<option value="">No department</option>' + depts().map(d => `<option>${escapeHtml(d)}</option>`).join('');
    if (cur) $('staff-bulk-dept').value = cur;
  }
  $('staff-rows').addEventListener('change', e => {
    const c = e.target.closest('[data-pick]');
    if (!c) return;
    if (c.checked) staffPicked.add(c.dataset.pick); else staffPicked.delete(c.dataset.pick);
    renderBulk();
  });
  $('staff-all').addEventListener('change', () => {
    staffShown.forEach(id => $('staff-all').checked ? staffPicked.add(id) : staffPicked.delete(id));
    renderStaff();
  });
  async function bulk(change, label) {
    try {
      const r = await post('/api/admin/employees/bulk', Object.assign({ ids: [...staffPicked] }, change));
      toast(`${label}: ${r.changed} staff`);
      staffPicked.clear();
      await refresh();
    } catch (err) { fail(err); }
  }
  $('staff-bulk-move').addEventListener('click', () => bulk({ department: $('staff-bulk-dept').value }, 'Moved to ' + ($('staff-bulk-dept').value || 'no department')));
  $('staff-bulk-off').addEventListener('click', () => { if (confirm(`Mark ${staffPicked.size} staff inactive? They won't be able to sign in on the iPad.`)) bulk({ active: false }, 'Marked inactive'); });
  $('staff-bulk-on').addEventListener('click', () => bulk({ active: true }, 'Marked active'));
  $('staff-bulk-clear').addEventListener('click', () => { staffPicked.clear(); renderStaff(); });

  // ----- job titles -> departments -----
  const MAIN_DEPTS = ['CNA', 'Nursing', 'Dietary', 'Housekeeping', 'Therapy', 'Activities', 'Social Services', 'Administration', 'Transport'];
  // Best guess for a job title, following the facility's Job Profile -> Dept lookup.
  function suggestDept(title) {
    const t = String(title || '').toLowerCase();
    const map = state.settings.jobDepartments || {};
    if (map[title]) return map[title];
    if (/staffing/.test(t)) return 'Administration';
    if (/\bcna\b|nursing assistant|nurse aide|\blna\b|caregiver/.test(t)) return 'CNA';
    if (/\brn\b|\blpn\b|\blvn\b|nurse|\badon\b|\bdon\b|\bmds\b|nursing/.test(t)) return 'Nursing';
    if (/diet|cook|food|kitchen|nutrition/.test(t)) return 'Dietary';
    if (/housekeep|laundry|environmental/.test(t)) return 'Housekeeping';
    if (/therap|rehab|\bpta?\b|\bota?\b|\bslp\b|speech|physical|occupational/.test(t)) return 'Therapy';
    if (/activit/.test(t)) return 'Activities';
    if (/social/.test(t)) return 'Social Services';
    if (/driver|transport/.test(t)) return 'Transport';
    return 'Administration';
  }
  const mainDepts = () => [...new Set(MAIN_DEPTS.concat(Object.keys(state.settings.leaders || {})))];
  $('staff-group-btn').addEventListener('click', () => {
    const main = mainDepts().map(d => d.toLowerCase());
    const counts = {};
    depts().forEach(d => { if (!main.includes(d.toLowerCase())) counts[d] = 0; }); // extra departments in Settings, even with no one in them
    state.employees.forEach(e => { if (e.department && !main.includes(e.department.toLowerCase())) counts[e.department] = (counts[e.department] || 0) + 1; });
    const titles = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    $('sg-error').textContent = '';
    $('sg-rows').innerHTML = titles.map(t => `<tr><td>${escapeHtml(t)}</td><td>${counts[t]}</td>
      <td><select data-title="${escapeHtml(t)}"><option value="">Leave as is</option>${mainDepts().map(d => `<option${d === suggestDept(t) ? ' selected' : ''}>${escapeHtml(d)}</option>`).join('')}</select></td></tr>`).join('')
      || '<tr><td colspan="3" class="muted">Every staff member is already in one of the main departments.</td></tr>';
    $('sg-go').disabled = !titles.length;
    $('staff-group').showModal();
  });
  $('sg-go').addEventListener('click', async () => {
    const map = {};
    $('sg-rows').querySelectorAll('select[data-title]').forEach(s => { if (s.value) map[s.dataset.title] = s.value; });
    try {
      const r = await post('/api/admin/departments/group', { map });
      $('staff-group').close();
      $('sc-depts').dataset.init = ''; $('rq-depts').dataset.init = ''; $('an-depts').dataset.init = '';
      toast(`Moved ${r.moved} staff into their departments`);
      await refresh();
    } catch (err) { $('sg-error').textContent = err.message; }
  });

  $('staff-search').addEventListener('input', renderStaff);
  $('staff-filter').addEventListener('change', renderStaff);
  $('staff-dept').addEventListener('change', renderStaff);
  $('staff-missing').addEventListener('change', renderStaff);
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
    const rec = e.target.closest('[data-record]');
    if (rec) printRecord(state.employees.find(x => x.id === rec.dataset.record));
  });
  // A printable training record for one person, for their HR file.
  async function printRecord(emp) {
    const win = window.open('', '_blank');
    if (!win) return alert('Your browser blocked the new window. Allow pop-ups for this site and try again.');
    win.document.write('<p style="font-family:sans-serif">Loading…</p>');
    try {
      const [{ responses }, { topics }] = await Promise.all([api('/api/admin/responses?employeeId=' + encodeURIComponent(emp.id)), api('/api/admin/annual')]);
      const done = responses.filter(r => r.completed);
      const year = state.todayDate.slice(0, 4);
      const thisYear = done.filter(r => r.date.startsWith(year));
      const first = thisYear.filter(r => r.firstTryCorrect).length;
      const yearly = topics.map(t => ({ title: t.title, p: t.people.find(x => x.id === emp.id) })).filter(x => x.p);
      const words = { current: 'Up to date', soon: 'Due soon', overdue: 'Overdue', never: 'Not done yet' };
      const kinds = { required: 'Required', scheduled: 'Scheduled', rotation: 'Rotation', starter: 'New hire', annual: 'Yearly', review: 'Review' };
      win.document.open();
      win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(emp.name)} training record</title><style>
        body { font: 13px/1.45 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 28px; }
        h1 { font-size: 20px; margin: 0 0 2px; } h2 { font-size: 15px; margin: 18px 0 6px; } .meta { color: #444; }
        table { width: 100%; border-collapse: collapse; margin-top: 6px; } th, td { border: 1px solid #bbb; padding: 5px 7px; text-align: left; vertical-align: top; }
        th { background: #eee; font-size: 12px; } .noprint { margin-bottom: 14px; }
        @media print { .noprint { display: none; } body { margin: 0.4in; } tr { break-inside: avoid; } }
      </style></head><body>
        <div class="noprint"><button onclick="print()" style="font-size:15px;padding:6px 14px">Print or save as PDF</button></div>
        <h1>${escapeHtml(state.settings.facilityName || '')} In-Service Training Record</h1>
        <div class="meta"><strong>${escapeHtml(emp.name)}</strong> · ${escapeHtml(emp.department || 'No department')} · Workday last 4: ${escapeHtml(emp.last4)}${emp.hireDate ? ` · Hired ${fmtDate(emp.hireDate)}` : ''}<br>
          ${year}: <strong>${thisYear.length}</strong> in-services completed${thisYear.length ? `, ${Math.round(100 * first / thisYear.length)}% correct on the first try` : ''}. All time: ${done.length}.</div>
        ${yearly.length ? `<h2>Yearly requirements</h2><table><thead><tr><th>Topic</th><th>Status</th><th>Last completed</th><th>Due</th></tr></thead><tbody>
          ${yearly.map(x => `<tr><td>${escapeHtml(x.title)}</td><td>${words[x.p.status]}</td><td>${x.p.last ? fmtDate(x.p.last) : ''}</td><td>${x.p.due ? fmtDate(x.p.due) : 'Now'}</td></tr>`).join('')}</tbody></table>` : ''}
        <h2>Completed in-services</h2>
        <table><thead><tr><th>Completed</th><th>Topic</th><th>Type</th><th>Knowledge check</th></tr></thead><tbody>
        ${done.map(r => `<tr><td>${fmtWhen(r.completedAt)}</td><td>${escapeHtml(r.topicTitle)}</td><td>${kinds[r.kind] || ''}</td>
          <td>${r.firstTryCorrect ? 'Correct first try' : `Correct on try ${r.attempts.length}`}</td></tr>`).join('') || '<tr><td colspan="4">None yet.</td></tr>'}
        </tbody></table>
        <p style="margin-top:14px;color:#666;font-size:11px">Printed ${escapeHtml(new Date().toLocaleString())} from the in-service admin page.</p>
      </body></html>`);
      win.document.close();
    } catch (err) { win.close(); fail(err); }
  }
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
  // Other tabs in the same workbook with names and birthdays (e.g. a "Birthdays" tab) become birthday-only rows.
  async function birthdayTabs(file, prefer) {
    if (!/\.xlsx?$/i.test(file.name)) return [];
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const main = wb.SheetNames.find(n => prefer.test(n)) || wb.SheetNames[0];
    const out = [];
    for (const n of wb.SheetNames.filter(x => x !== main)) {
      const rows = XLSX.utils.sheet_to_json(fullSheet(wb.Sheets[n]), { header: 1, raw: true, defval: '' }).map(r => r.map(c => c instanceof Date ? isoDay(new Date(Math.round(c.getTime() / 60000) * 60000)) : String(c)));
      const hi = rows.slice(0, 10).findIndex(r => r.some(c => /birth|\bdob\b/i.test(c)) && r.some(c => /name|worker|employee/i.test(c)));
      if (hi < 0) continue;
      const h = rows[hi].map(c => String(c).trim());
      const nc = findCol(h, [/name/i, /^worker$/i, /^employee$/i]), bc = findCol(h, [/birth/i, /\bdob\b/i]);
      rows.slice(hi + 1).forEach(r => { const name = firstLast(String(r[nc] || '').trim()), b = String(r[bc] || '').trim(); if (name && b) out.push({ name, last4: '', birthday: b, keepBlank: true, birthdayOnly: true }); });
    }
    return out;
  }
  $('staff-import-btn').addEventListener('click', () => {
    staffRows = null;
    $('imp-file').value = ''; $('imp-text').value = ''; $('imp-preview').innerHTML = ''; $('imp-error').textContent = ''; $('imp-go').disabled = true;
    $('staff-import').showModal();
  });
  function previewStaff(rows, extraBirthdays) {
    $('imp-error').textContent = ''; $('imp-go').disabled = true; staffRows = null;
    if (!rows.length) { $('imp-preview').innerHTML = ''; return; }
    // Some sheets put a title above the column headings; use the first row that names a name or worker column.
    const hi = Math.max(0, rows.slice(0, 10).findIndex(r => r.some(c => /name|worker/i.test(String(c)))));
    let header = rows[hi].map(c => String(c).trim());
    let nameC = findCol(header, [/name/i, /^worker$/i, /^employee$/i]), idC = findCol(header, [/workday|employee.?id|ee.?id|\bid\b|last ?4/i]);
    const deptC = findCol(header, [/^dep/i]);
    let jobC = findCol(header, [/job/i, /title/i, /position/i, /role/i]);
    if (jobC === nameC) jobC = -1;
    let leaderC = findCol(header, [/^(leader|supervisor|manager)$/i]);
    // Workday reports can split the birthday into "Birthday Month" and "Birthday Day" columns.
    const bMonC = findCol(header, [/birth.*month/i]), bDayC = findCol(header, [/birth.*day$/i, /birth.*\bday\b/i]);
    const splitBday = bMonC >= 0 && bDayC >= 0 && bMonC !== bDayC;
    let bdayC = splitBday ? bMonC : findCol(header, [/birth/i, /^dob$/i, /\bdob\b/i]), hireC = findCol(header, [/continuous/i, /service date/i]);
    if (hireC < 0) hireC = findCol(header, [/hire/i, /^anniversary date$/i, /^start date$/i]); // not "Next Anniversary". Continuous service date wins: hire date is 11/1 for everyone since the acquisition
    let body = rows.slice(hi + 1);
    const nameOnly = nameC >= 0 && idC < 0 && (bdayC >= 0 || hireC >= 0); // e.g. a birthday list: fills in people already on Staff
    if (!nameOnly && (nameC < 0 || idC < 0)) { nameC = 0; idC = 1; jobC = header.length > 2 ? 2 : -1; leaderC = bdayC = hireC = -1; body = rows; } // no header row
    const cell = (r, c) => c >= 0 ? String(r[c] == null ? '' : r[c]).trim() : '';
    staffRows = body.map(r => {
      const job = cell(r, jobC).replace(/\s+-\s+(Hourly|Salaried)$/i, '').replace(/\s+/g, ' ');
      return { name: firstLast(cell(r, nameC)), last4: nameOnly ? '' : padId(r[idC]),
        department: cell(r, deptC) || (job ? suggestDept(job) : ''), leader: cell(r, leaderC),
        ...(job ? { jobTitle: job, keepBlank: true } : {}),
        ...(bdayC >= 0 ? { birthday: splitBday ? (cell(r, bMonC) && cell(r, bDayC) ? `${cell(r, bMonC)}/${cell(r, bDayC)}` : '') : cell(r, bdayC), keepBlank: true } : {}), ...(hireC >= 0 ? { hireDate: cell(r, hireC), keepBlank: true } : {}) };
    }).filter(r => r.name || r.last4).concat(extraBirthdays || []);
    const bad = staffRows.filter(r => !r.name || (!nameOnly && !r.birthdayOnly && String(r.last4).replace(/\D/g, '').length < 4)).length;
    const bdays = staffRows.filter(r => r.birthday).length;
    const newDepts = [...new Set(staffRows.map(r => r.department).filter(d => d && !depts().some(x => x.toLowerCase() === d.toLowerCase())))];
    const leaders = Object.entries(staffLeaders(staffRows));
    $('imp-preview').innerHTML = `<strong>${nameOnly ? `${staffRows.length} names found. Birthdays and hire dates will be filled in for matching people already on Staff; no one new is added.` : `${staffRows.length} people found.`}</strong>${bad ? ` <span class="err">${bad} are missing a name or ID and will be skipped.</span>` : ''}
      ${bdays ? `<div class="muted" style="margin-top:4px">${bdays} birthdays found${extraBirthdays && extraBirthdays.length ? ' (including the birthday tab)' : ''}.</div>` : ''}
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
    try { previewStaff(await readSheet(f, /id ref|staff|roster|employee/i), await birthdayTabs(f, /id ref|staff|roster|employee/i)); } catch (err) { $('imp-error').textContent = err.message; }
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
    if ($('resp-helpful').value) p.set('helpful', $('resp-helpful').value);
    if (respPerson) p.set('employeeId', respPerson.id);
    return p.toString();
  }
  const kindLabel = { required: '<span class="pill req">Required</span>', scheduled: '<span class="pill brand">Scheduled</span>', rotation: '<span class="pill">Rotation</span>',
    starter: '<span class="pill good">New hire</span>', annual: '<span class="pill req">Yearly</span>', review: '<span class="pill brand">Review</span>' };
  async function loadResponses() {
    try {
      const pc = $('resp-person');
      pc.hidden = !respPerson;
      if (respPerson) pc.innerHTML = `${escapeHtml(respPerson.name)} <a href="#" id="resp-person-x" title="Show everyone" style="text-decoration:none">×</a>`;
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
        <td>${escapeHtml(r.department || '')}</td><td>${kindLabel[r.kind] || ''}${r.lang === 'es' ? ' <span class="pill">Español</span>' : ''}${r.offline ? ' <span class="pill" title="Answered while the iPad was offline, uploaded later">Saved offline</span>' : ''}</td>
        <td>${escapeHtml(r.topicTitle)}<div class="muted small">${escapeHtml(r.question)}</div></td>
        <td>${escapeHtml(r.attempts[0] || '')}</td><td>${result}${r.helpful === true ? ' <span title="Said the lesson was helpful">👍</span>' : r.helpful === false ? ' <span title="Said the lesson was not helpful">👎</span>' : ''}</td></tr>`;
      }).join('');
      $('resp-csv').href = '/api/admin/responses.csv?' + respQuery();
    } catch (err) { fail(err); }
  }
  ['resp-from', 'resp-to', 'resp-dept', 'resp-topic', 'resp-missed', 'resp-helpful'].forEach(id => $(id).addEventListener('change', loadResponses));
  $('resp-person').addEventListener('click', e => { if (e.target.id !== 'resp-person-x') return; e.preventDefault(); respPerson = null; loadResponses(); });

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
        rows = XLSX.utils.sheet_to_json(fullSheet(wb.Sheets[sheet]), { header: 1, raw: true, defval: '' });
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

  // ---------- reports ----------
  function renderReportFilters() {
    const t = $('rp-topic').value;
    $('rp-topic').innerHTML = '<option value="">Choose a topic…</option>' + state.topics.slice().sort((a, b) => a.title.localeCompare(b.title))
      .map(x => `<option value="${x.id}">${escapeHtml(x.title)}${x.status === 'retired' ? ' (retired)' : ''}</option>`).join('');
    $('rp-topic').value = t;
    for (const id of ['rp-dept', 'mm-dept']) {
      const cur = $(id).value;
      $(id).innerHTML = '<option value="">All departments</option>' + depts().map(d => `<option>${escapeHtml(d)}</option>`).join('');
      $(id).value = cur;
    }
  }
  const query = obj => new URLSearchParams(Object.entries(obj).filter(([, v]) => v)).toString();

  // Printable sign-in sheet for surveyors: lesson, questions, and each person's first completion in the date range.
  $('rp-print').addEventListener('click', async () => {
    $('rp-error').textContent = '';
    const t = topicById($('rp-topic').value);
    if (!t) { $('rp-error').textContent = 'Choose a topic.'; return; }
    const win = window.open('', '_blank'); // open now, while the click still counts, so it isn't blocked as a pop-up
    if (!win) { $('rp-error').textContent = 'Your browser blocked the new window. Allow pop-ups for this site and try again.'; return; }
    win.document.write('<p style="font-family:sans-serif">Loading…</p>');
    try {
      const from = $('rp-from').value, to = $('rp-to').value, dept = $('rp-dept').value;
      const { responses } = await api('/api/admin/responses?' + query({ topicId: t.id, from, to, department: dept }));
      const seen = new Map();
      for (const r of responses.filter(x => x.completed).sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))) {
        const k = r.employeeId || `${r.name.toLowerCase()}|${r.last4}`;
        if (!seen.has(k)) seen.set(k, r);
      }
      const people = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
      const first = people.filter(r => r.firstTryCorrect).length;
      const range = from || to ? `${from ? fmtDate(from) : 'the start'} to ${to ? fmtDate(to) : 'today'}` : 'All dates';
      win.document.open();
      win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(t.title)} sign-in sheet</title><style>
        body { font: 13px/1.45 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 28px; }
        h1 { font-size: 20px; margin: 0 0 2px; } h2 { font-size: 15px; margin: 18px 0 6px; }
        .meta { color: #444; margin-bottom: 10px; } .box { border: 1px solid #bbb; border-radius: 6px; padding: 8px 12px; }
        table { width: 100%; border-collapse: collapse; margin-top: 6px; } th, td { border: 1px solid #bbb; padding: 5px 7px; text-align: left; vertical-align: top; }
        th { background: #eee; font-size: 12px; } ul { margin: 4px 0 8px; padding-left: 20px; } p { margin: 0 0 8px; }
        .sign { margin-top: 28px; display: flex; gap: 28px; } .sign div { flex: 1; border-top: 1px solid #333; padding-top: 4px; font-size: 12px; }
        .noprint { margin-bottom: 14px; } @media print { .noprint { display: none; } body { margin: 0.4in; } tr { break-inside: avoid; } }
      </style></head><body>
        <div class="noprint"><button onclick="print()" style="font-size:15px;padding:6px 14px">Print or save as PDF</button></div>
        <h1>${escapeHtml(state.settings.facilityName || '')} In-Service Sign-In Sheet</h1>
        <div class="meta"><strong>Topic:</strong> ${escapeHtml(t.title)}${t.category ? ` (${escapeHtml(t.category)})` : ''}<br>
          <strong>Dates:</strong> ${range} &nbsp; <strong>Staff:</strong> ${dept ? escapeHtml(dept) : whoLabel(t.departments)}<br>
          <strong>Format:</strong> Self-paced micro in-service on the facility iPad, with a knowledge check. Staff who answer wrong get a hint and must answer correctly to finish.</div>
        <h2>Content presented</h2><div class="box">${formatLesson(t.lesson)}</div>
        <h2>Knowledge check questions</h2><div class="box">${t.questions.map(q => `<div><strong>${escapeHtml(q.text)}</strong>
          <ul>${q.correctAnswers.map(a => `<li>${escapeHtml(a)} (correct)</li>`).join('')}${q.wrongAnswers.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul></div>`).join('')}</div>
        <h2>Attendance: ${people.length} staff completed${people.length ? `, ${Math.round(100 * first / people.length)}% correct on the first try` : ''}</h2>
        <table><thead><tr><th>#</th><th>Name</th><th>Department</th><th>Workday last 4</th><th>Completed</th><th>Knowledge check</th></tr></thead><tbody>
        ${people.map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.department || '')}</td><td>${escapeHtml(r.last4 || '')}</td>
          <td>${fmtWhen(r.completedAt)}</td><td>${r.firstTryCorrect ? 'Correct first try' : `Correct on try ${r.attempts.length}`}</td></tr>`).join('')
          || '<tr><td colspan="6">No one has completed this topic in these dates.</td></tr>'}
        </tbody></table>
        <div class="sign"><div>In-service coordinator</div><div>Title</div><div>Date</div></div>
        <p style="margin-top:14px;color:#666;font-size:11px">Printed ${escapeHtml(new Date().toLocaleString())} from the in-service admin page.</p>
      </body></html>`);
      win.document.close();
    } catch (err) { win.close(); $('rp-error').textContent = err.message; }
  });

  // Most-missed questions, from every response in the date range.
  async function loadMissed() {
    try {
      const { responses } = await api('/api/admin/responses?' + query({ from: $('mm-from').value, to: $('mm-to').value, department: $('mm-dept').value }));
      const by = new Map();
      for (const r of responses) {
        const k = `${r.topicId}|${r.questionId}`;
        const g = by.get(k) || { topicId: r.topicId, questionId: r.questionId, topicTitle: r.topicTitle, question: r.question, asked: 0, missed: 0, wrong: {} };
        g.asked++;
        if (!r.firstTryCorrect) { g.missed++; if (r.attempts[0]) g.wrong[r.attempts[0]] = (g.wrong[r.attempts[0]] || 0) + 1; }
        by.set(k, g);
      }
      const rows = [...by.values()].filter(g => g.missed)
        .sort((a, b) => (b.asked >= 5) - (a.asked >= 5) || b.missed / b.asked - a.missed / a.asked || b.missed - a.missed);
      $('mm-rows').innerHTML = rows.slice(0, 50).map(g => {
        const t = topicById(g.topicId);
        const q = t && t.questions.find(x => x.id === g.questionId);
        const [wrong, n] = Object.entries(g.wrong).sort((a, b) => b[1] - a[1])[0] || [];
        const pct = Math.round(100 * g.missed / g.asked);
        return `<tr class="${g.asked < 5 ? 'dim' : ''}"><td>${escapeHtml(q ? q.text : g.question)}<div class="muted small">${escapeHtml(t ? t.title : g.topicTitle)}</div></td>
          <td>${g.asked}</td><td><strong>${pct}%</strong> <span class="muted small">(${g.missed})</span></td>
          <td>${wrong ? `${escapeHtml(wrong)} <span class="muted small">(${n})</span>` : ''}</td>
          <td>${t ? `<button class="btn subtle" data-mm-edit="${t.id}">Edit topic</button>` : ''}</td></tr>`;
      }).join('') || '<tr><td colspan="5" class="muted">No missed questions for this selection.</td></tr>';
    } catch (err) { fail(err); }
  }
  ['mm-from', 'mm-to', 'mm-dept'].forEach(id => $(id).addEventListener('change', loadMissed));
  $('mm-rows').addEventListener('click', e => {
    const b = e.target.closest('[data-mm-edit]');
    if (b) openEditor(topicById(b.dataset.mmEdit));
  });

  // Spaced review
  async function loadReviews() {
    try {
      const { reviews, thin, settings } = await api('/api/admin/reviews');
      $('rv-on').checked = !!settings.on; $('rv-first').value = settings.firstDays; $('rv-second').value = settings.secondDays;
      const today = state.todayDate;
      $('rv-rows').innerHTML = reviews.map(r => `<tr><td>${escapeHtml(r.name)}<div class="muted small">${escapeHtml(r.department || '')}</div></td>
        <td>${escapeHtml(r.title)}<div class="muted small">missed ${fmtDate(r.since)}</div></td>
        <td>${r.stage === 1 ? 'First' : 'Final'}</td>
        <td style="white-space:nowrap">${fmtDate(r.due)} ${r.due <= today ? '<span class="pill warn">Due now</span>' : ''}</td></tr>`).join('')
        || '<tr><td colspan="4" class="muted">No one has anything to review right now.</td></tr>';
      $('rv-thin').innerHTML = thin.length ? `<strong>Topics with fewer than 3 questions</strong> <span class="muted">(add more so a review can ask it a different way):</span> ` +
        thin.map(t => `<a href="#" data-thin="${t.id}">${escapeHtml(t.title)}</a> (${t.questions})`).join(', ') : '';
    } catch (err) { fail(err); }
  }
  $('rv-thin').addEventListener('click', e => {
    const a = e.target.closest('[data-thin]');
    if (a) { e.preventDefault(); openEditor(topicById(a.dataset.thin)); }
  });
  $('rv-save').addEventListener('click', async () => {
    try {
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ review: { on: $('rv-on').checked, firstDays: Number($('rv-first').value), secondDays: Number($('rv-second').value) } }) });
      toast('Saved'); await refresh(); loadReviews();
    } catch (err) { fail(err); }
  });

  // Yearly requirements
  let annual = [];
  const yrLabel = { current: '<span class="pill good">Up to date</span>', soon: '<span class="pill">Due soon</span>', overdue: '<span class="pill warn">Overdue</span>', never: '<span class="pill warn">Never done</span>' };
  async function loadAnnual() {
    try {
      annual = (await api('/api/admin/annual')).topics;
      $('yr-rows').innerHTML = annual.map(t => `<tr><td><a href="#" data-preview="${t.id}">${escapeHtml(t.title)}</a>${t.status !== 'active' ? ' <span class="pill warn">Not active</span>' : ''}</td>
        <td class="small">${whoLabel(t.departments)}</td><td>${t.current}</td><td>${t.soon}</td>
        <td>${t.overdue ? `<strong style="color:var(--warn)">${t.overdue}</strong>` : 0}</td><td>${t.never ? `<strong style="color:var(--warn)">${t.never}</strong>` : 0}</td>
        <td><button class="btn subtle" data-yr-view="${t.id}">Who's due</button></td></tr>`).join('')
        || '<tr><td colspan="7" class="muted">No yearly topics yet. Edit a topic and tick "Required every year".</td></tr>';
    } catch (err) { fail(err); }
  }
  $('yr-rows').addEventListener('click', e => {
    const b = e.target.closest('[data-yr-view]');
    if (!b) return;
    const t = annual.find(x => x.id === b.dataset.yrView);
    const order = { overdue: 0, never: 1, soon: 2, current: 3 };
    const people = t.people.slice().sort((a, c) => order[a.status] - order[c.status] || (a.due || '').localeCompare(c.due || '') || a.name.localeCompare(c.name));
    $('vw-title').textContent = t.title;
    $('vw-body').innerHTML = `<table style="margin-top:12px"><thead><tr><th>Name</th><th>Department</th><th>Status</th><th>Last done</th><th>Due</th></tr></thead><tbody>
      ${people.map(p => `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.department || '')}</td><td>${yrLabel[p.status]}</td><td>${p.last ? fmtDate(p.last) : ''}</td><td>${p.due ? fmtDate(p.due) : 'Now'}</td></tr>`).join('')
        || '<tr><td colspan="5" class="muted">No active staff in these departments.</td></tr>'}</tbody></table>`;
    $('viewer').showModal();
  });
  $('yr-csv').addEventListener('click', () => {
    const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const words = { soon: 'Due soon', overdue: 'Overdue', never: 'Never done' };
    const lines = [['Topic', 'Name', 'Workday last 4', 'Department', 'Status', 'Last done', 'Due'].join(',')]
      .concat(annual.flatMap(t => t.people.filter(p => p.status !== 'current').map(p => [t.title, p.name, p.last4, p.department, words[p.status], p.last || '', p.due || ''].map(cell).join(','))));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv' }));
    a.download = `yearly-requirements-due-${isoDay(new Date())}.csv`;
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
    loadTestData();
    $('set-alert-emails').value = (s.alertEmails || []).join('\n');
    $('set-missed-followup').checked = s.missedFollowup !== false;
    loadEmailStatus();
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
  // ---------- email alerts and follow-ups ----------
  async function loadEmailStatus() {
    try {
      const r = await api('/api/admin/followups');
      $('em-status').innerHTML = r.emailReady ? `<span class="pill good">Email connected</span> <span class="muted">Sends from ${escapeHtml(r.mailFrom)}</span>`
        : '<span class="pill warn">Email not connected yet</span> <span class="muted">Alerts still show on the Reports tab. To send email, add GMAIL_USER and GMAIL_APP_PASSWORD in Render → Environment.</span>';
      $('em-log').innerHTML = r.emailLog.length ? '<table style="margin-top:6px"><tbody>' + r.emailLog.map(l => `<tr><td style="white-space:nowrap">${fmtWhen(l.at)}</td><td>${escapeHtml(l.subject)}<div class="muted">${escapeHtml(l.to.join(', ') || '–')}</div></td><td>${l.status === 'sent' ? '<span class="pill good">Sent</span>' : `<span class="pill warn" title="${escapeHtml(l.error || '')}">${escapeHtml(l.status)}</span>`}</td></tr>`).join('') + '</tbody></table>'
        : '<div class="muted" style="margin-top:6px">None yet.</div>';
    } catch { /* leave as is */ }
  }
  $('save-email').addEventListener('click', async () => {
    try {
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ alertEmails: splitLines($('set-alert-emails').value), missedFollowup: $('set-missed-followup').checked }) });
      toast('Email settings saved'); await refresh();
    } catch (err) { fail(err); }
  });
  $('test-email').addEventListener('click', async () => {
    try { await post('/api/admin/email/test', { to: $('set-alert-emails').value }); toast('Test email sent. Check the inbox.'); }
    catch (err) { alert(err.message); }
    loadEmailStatus();
  });
  async function loadFollowups() {
    try {
      const { followups, emailReady } = await api('/api/admin/followups');
      const open = followups.filter(f => !f.attestedAt).length;
      $('fu-count').hidden = !open; $('fu-count').textContent = `${open} open`;
      $('fu-remind-all').hidden = !open;
      fillSelect($('fu-dept'), [['', 'All departments']], [...new Set(followups.map(f => f.department).filter(Boolean))].sort());
      $('fu-email-note').textContent = emailReady ? '' : 'Email isn\'t connected yet, so leaders aren\'t emailed. See Settings → Email alerts.';
      const fv = $('fu-filter').value, fd = $('fu-dept').value;
      const rows = followups.filter(f => (fv === 'all' || (fv === 'open' ? !f.attestedAt : f.attestedAt)) && (!fd || f.department === fd));
      $('fu-rows').innerHTML = rows.slice(0, 300).map(f => `<tr>
        <td style="white-space:nowrap">${fmtWhen(f.createdAt)}</td><td><strong>${escapeHtml(f.name)}</strong></td><td>${escapeHtml(f.department || '')}</td>
        <td>${escapeHtml(f.question)}<div class="muted small">${escapeHtml(f.topicTitle)} · Correct: ${escapeHtml(f.correctAnswer)}</div></td>
        <td>${escapeHtml(f.firstAnswer)}</td>
        <td class="small">${escapeHtml(f.leader || '')}${f.emailedTo.length ? `<div class="muted">✉ ${escapeHtml(f.emailedTo.join(', '))}</div>` : '<div class="muted">No leader email</div>'}</td>
        <td style="white-space:nowrap">${f.attestedAt ? `<span class="pill good">✓ Educated</span><div class="muted small">${escapeHtml(f.attestedBy)}, ${fmtWhen(f.attestedAt)}</div><a href="#" class="small" data-fu-undo="${f.id}">Undo</a>`
          : `<button class="btn subtle" data-fu-attest="${f.id}">Mark educated</button><button class="btn subtle" data-fu-remind="${f.id}" title="Email the leader a reminder">✉ Remind</button>${(f.reminders || []).length ? `<div class="muted small">Reminded ${f.reminders.length}×, last ${fmtWhen(f.reminders[f.reminders.length - 1])}</div>` : ''}`}</td></tr>`).join('')
        || `<tr><td colspan="7" class="muted">${fv === 'open' ? 'Nothing waiting. Everyone is caught up. 🎉' : 'None yet.'}</td></tr>`;
    } catch (err) { fail(err); }
  }
  ['fu-filter', 'fu-dept'].forEach(id => $(id).addEventListener('change', loadFollowups));
  $('fu-remind-all').addEventListener('click', async () => {
    if (!confirm('Email each department leader one reminder listing everyone still waiting on them?')) return;
    try {
      const r = await post('/api/admin/followups/remind-all');
      alert(`Sent to ${r.leaders} leader${r.leaders === 1 ? '' : 's'}.` + (r.skipped.length ? `\n\nNo leader email for: ${r.skipped.join(', ')}. Add one in Settings → Department leaders.` : ''));
    } catch (err) { alert(err.message); }
    loadFollowups();
  });
  $('fu-rows').addEventListener('click', async e => {
    const rm = e.target.closest('[data-fu-remind]');
    if (rm) {
      rm.disabled = true;
      try { const r = await post(`/api/admin/followups/${rm.dataset.fuRemind}/remind`); toast('Reminder sent to ' + r.to.join(', ')); }
      catch (err) { alert(err.message); }
      return loadFollowups();
    }
    const a = e.target.closest('[data-fu-attest]'), u = e.target.closest('[data-fu-undo]');
    if (!a && !u) return;
    e.preventDefault();
    let by = '';
    if (a) { by = prompt('Who educated them? (your name)', localStorage.getItem('fu-by') || ''); if (!by) return; try { localStorage.setItem('fu-by', by); } catch { /* ignore */ } }
    try { await post(`/api/admin/followups/${(a || u).dataset[a ? 'fuAttest' : 'fuUndo']}/attest`, a ? { by } : { undo: true }); toast(a ? 'Marked educated' : 'Undone'); loadFollowups(); }
    catch (err) { fail(err); }
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
    renderStreakSettings();
    if (document.activeElement !== $('an-bday-msgs')) $('an-bday-msgs').value = (state.settings.birthdayMessages || []).join('\n');
    if (document.activeElement !== $('an-anniv-msgs')) $('an-anniv-msgs').value = (state.settings.anniversaryMessages || []).join('\n');
    const up = state.upcomingCelebrations || [];
    $('an-upcoming').innerHTML = up.length
      ? up.map(c => `<div>${fmtDate(c.date)}: ${c.type === 'birthday' ? '🎂' : '🎉'} ${escapeHtml(c.name)}${c.department ? ` <span class="muted">(${escapeHtml(c.department)})</span>` : ''} ${c.type === 'birthday' ? 'birthday' : `${c.years} year${c.years === 1 ? '' : 's'} at work`}</div>`).join('')
      : '<span class="muted">None. Add birthdays and hire dates on the Staff tab.</span>';
  }
  function renderStreakSettings() {
    const k = state.settings.streaks || { shoutOuts: false, leaderboard: 'off', top: 3 };
    $('sk-shout').checked = !!k.shoutOuts; $('sk-where').value = k.leaderboard || 'off'; $('sk-top').value = String(k.top === 1 ? 1 : 3); $('sk-board').value = k.board || 'facility'; $('sk-button').checked = !!k.button;
    const top = state.streakTop || [];
    $('sk-now').innerHTML = top.length ? '<strong>Longest streaks right now:</strong> ' + top.map(l => `${escapeHtml(l.name)} (${escapeHtml(l.department || '')}) ${l.streak}`).join(' · ')
      : '<span class="muted">No one has a streak of 3 or more yet.</span>';
  }
  $('sk-save').addEventListener('click', async () => {
    try {
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ streaks: { shoutOuts: $('sk-shout').checked, leaderboard: $('sk-where').value, top: Number($('sk-top').value), board: $('sk-board').value, button: $('sk-button').checked } }) });
      toast('Saved. The iPad picks it up within a minute.'); await refresh();
    } catch (err) { fail(err); }
  });
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
  $('an-save-msgs').addEventListener('click', async () => {
    try {
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ birthdayMessages: splitLines($('an-bday-msgs').value), anniversaryMessages: splitLines($('an-anniv-msgs').value) }) });
      toast('Messages saved'); await refresh();
    } catch (err) { fail(err); }
  });
  $('an-celebrate').addEventListener('change', async () => {
    try { await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ celebrations: $('an-celebrate').checked }) }); toast('Saved'); await refresh(); }
    catch (err) { fail(err); }
  });

  // ---------- going live: clear test data ----------
  async function loadTestData() {
    if (!$('td-list').innerHTML) $('td-list').innerHTML = '<span class="muted small">Counting…</span>';
    try {
      const t = await api('/api/admin/test-data');
      const item = (key, label, n, on) => `<label style="display:flex;gap:8px;align-items:flex-start;margin:4px 0"><input type="checkbox" data-td="${key}"${on && n ? ' checked' : ''}${n ? '' : ' disabled'}> <span>${label}</span></label>`;
      $('td-list').innerHTML =
        item('responses', `All in-service answers and usage history <span class="muted">(${t.responses} answers). Streaks, training records and the Clock-in check start fresh.</span>`, t.responses, true) +
        item('sampleStaff', `Sample staff <span class="muted">(${t.sampleStaff.length ? t.sampleStaff.map(escapeHtml).join(', ') : 'none left'})</span>`, t.sampleStaff.length, true) +
        item('sampleSchedules', `The sample "topic of the week" schedule <span class="muted">(${t.sampleSchedules})</span>`, t.sampleSchedules, true) +
        item('announcements', `All announcements <span class="muted">(${t.announcements})</span>`, t.announcements, false) +
        item('required', `All required education <span class="muted">(${t.required})</span>`, t.required, false);
    } catch (err) {
      // Still offer the main choices if the counts can't be loaded.
      $('td-list').innerHTML = `<div class="err small">Couldn't count the test data (${escapeHtml(err.message)}). You can still clear it.</div>` +
        ['responses|All in-service answers and usage history', 'sampleStaff|Sample staff', 'sampleSchedules|The sample "topic of the week" schedule', 'announcements|All announcements', 'required|All required education']
          .map((x, i) => { const [k, l] = x.split('|'); return `<label style="display:flex;gap:8px;margin:4px 0"><input type="checkbox" data-td="${k}"${i < 3 ? ' checked' : ''}> ${l}</label>`; }).join('');
    }
  }
  $('td-go').addEventListener('click', async () => {
    const pick = {};
    $('td-list').querySelectorAll('[data-td]').forEach(c => { if (c.checked) pick[c.dataset.td] = true; });
    if (!Object.keys(pick).length) return alert('Tick what you want to clear first.');
    if (!confirm('Clear the ticked test data? This can only be undone by restoring a backup.')) return;
    try {
      const r = await post('/api/admin/test-data/clear', pick);
      alert(`Cleared. ${r.responses != null ? `${r.responses} answers. ` : ''}${r.sampleStaff != null ? `${r.sampleStaff} sample staff. ` : ''}${r.sampleSchedules != null ? `${r.sampleSchedules} sample schedule. ` : ''}${r.announcements != null ? `${r.announcements} announcements. ` : ''}${r.required != null ? `${r.required} required items. ` : ''}\n\nA copy from before was saved on the server as ${r.backup}.`);
      await refresh(); renderSettings();
    } catch (err) { fail(err); }
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


  // A small × in every text box that clears it (and tells its filters it changed).
  function addClearButtons(root) {
    root.querySelectorAll('input[type=text]:not([data-clear]), input[type=search]:not([data-clear])').forEach(input => {
      input.dataset.clear = '1';
      const wrap = document.createElement('span');
      wrap.className = 'clearwrap' + (input.classList.contains('grow') ? ' grow' : '');
      if (input.style.width) { wrap.style.width = input.style.width; input.style.width = '100%'; }
      if (input.style.minWidth) { wrap.style.minWidth = input.style.minWidth; input.style.minWidth = ''; }
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'clearbtn'; btn.setAttribute('aria-label', 'Clear'); btn.textContent = '×';
      wrap.appendChild(btn);
      const sync = () => { btn.hidden = !input.value; };
      input.addEventListener('input', sync); sync();
      btn.addEventListener('click', () => {
        input.value = ''; sync(); input.focus();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  }
  // Values set from code (e.g. opening an editor) don't fire 'input', so check every so often.
  setInterval(() => document.querySelectorAll('.clearwrap').forEach(w => { const i = w.querySelector('input'), b = w.querySelector('.clearbtn'); if (i && b) b.hidden = !i.value; }), 500);
  addClearButtons(document);
  new MutationObserver(() => addClearButtons(document)).observe(document.body, { childList: true, subtree: true });

  refresh().catch(fail);
})();
