(() => {
  const $ = id => document.getElementById(id);
  // Our own pop-up instead of the browser's: the text can be selected, and there's a Copy button.
  function alert(message) {
    let d = document.getElementById('notice');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'notice';
      d.innerHTML = '<div class="dlg-body"><div id="notice-text"></div></div><div class="dlg-foot"><span id="notice-copied" class="muted small"></span><button type="button" class="btn ghost" id="notice-copy">📋 Copy</button><button type="button" class="btn" id="notice-ok">OK</button></div>';
      document.body.appendChild(d);
      d.querySelector('#notice-ok').addEventListener('click', () => d.close());
      d.querySelector('#notice-copy').addEventListener('click', async () => {
        const text = d.querySelector('#notice-text').innerText;
        try { await navigator.clipboard.writeText(text); }
        catch {
          const r = document.createRange(); r.selectNodeContents(d.querySelector('#notice-text'));
          const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); document.execCommand('copy');
        }
        d.querySelector('#notice-copied').textContent = 'Copied ✓';
      });
    }
    d.querySelector('#notice-text').textContent = String(message);
    d.querySelector('#notice-copied').textContent = '';
    if (d.open) d.close();
    d.showModal();
    d.querySelector('#notice-ok').focus();
  }
  // Our own "Are you sure?" and "Type something" boxes instead of the browser's gray ones.
  // confirm(message, okLabel) resolves true/false; prompt(message, startValue) resolves the text or null.
  function askDialog({ message, okLabel = 'OK', input = null }) {
    let d = document.getElementById('ask');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'ask';
      d.innerHTML = '<form method="dialog"><div class="dlg-body"><div class="ask-icon"></div><div id="ask-text"></div><input type="text" id="ask-input" autocomplete="off" hidden></div>'
        + '<div class="dlg-foot"><button type="button" class="btn ghost" id="ask-no">Cancel</button><button type="submit" class="btn" id="ask-ok">OK</button></div></form>';
      document.body.appendChild(d);
    }
    const danger = /^(remove|delete|clear|retire|replace|mark|take|close)/i.test(okLabel);
    d.querySelector('#ask-text').textContent = String(message);
    d.querySelector('.ask-icon').textContent = input ? '✏️' : danger ? '⚠️' : '❓';
    const ok = d.querySelector('#ask-ok'), inp = d.querySelector('#ask-input');
    ok.textContent = okLabel; ok.classList.toggle('danger', danger);
    inp.hidden = !input; inp.value = input ? input.value || '' : ''; inp.placeholder = input ? input.placeholder || '' : '';
    return new Promise(resolve => {
      let answer = null;
      const done = () => { d.removeEventListener('close', done); resolve(answer); };
      d.addEventListener('close', done);
      d.querySelector('form').onsubmit = () => { answer = input ? inp.value : true; };
      d.querySelector('#ask-no').onclick = () => { answer = null; d.close(); };
      if (d.open) d.close();
      d.showModal();
      (input ? inp : ok).focus();
      if (input) inp.select();
    });
  }
  const confirm = (message, okLabel = 'OK') => askDialog({ message, okLabel }).then(v => v === true);
  const prompt = (message, value = '', okLabel = 'Save') => askDialog({ message, okLabel, input: { value } }).then(v => v === null ? null : String(v));
  let state = null;
  let editingTopicId = null;
  let editingStaffId = null;

  // ---------- helpers ----------
  async function api(path, opts = {}) {
    const res = await fetch(path, Object.assign({ cache: 'no-store', headers: { 'Content-Type': 'application/json' } }, opts));
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.signIn) { location.href = '/admin/login?next=' + encodeURIComponent(location.pathname); throw new Error('Signing in again…'); }
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
  // Cards that save on their own: a moment after any change, with a small "Saved ✓" by the heading.
  // save(true) means "quiet": no toast, and problems come back as an error to show by the heading.
  const pendingSaves = new Set();
  window.addEventListener('beforeunload', e => { if (pendingSaves.size) { e.preventDefault(); e.returnValue = ''; } });
  function autoSave(card, save, hideButtons = []) {
    if (!card) return;
    hideButtons.forEach(b => { if (!b) return; b.hidden = true; const p = b.parentElement; if (p && p !== card && ![...p.children].some(c => !c.hidden)) p.hidden = true; });
    const tick = document.createElement('span');
    tick.className = 'saved-tick';
    tick.setAttribute('aria-live', 'polite');
    (card.querySelector('h2, h3') || card).appendChild(tick);
    let timer = null, running = false, again = false;
    const run = async () => {
      timer = null;
      if (running) { again = true; return; }
      running = true;
      tick.className = 'saved-tick'; tick.textContent = 'Saving…';
      try { await save(true); tick.className = 'saved-tick ok'; tick.textContent = 'Saved ✓'; }
      catch (err) { tick.className = 'saved-tick bad'; tick.textContent = err.message || String(err); }
      running = false;
      if (again) { again = false; timer = setTimeout(run, 0); } else if (!timer) pendingSaves.delete(card);
    };
    const queue = ms => { pendingSaves.add(card); clearTimeout(timer); timer = setTimeout(run, ms); };
    card.addEventListener('input', e => { if (e.target.matches('input[type=text], input[type=number], input[type=email], input[type=color], textarea')) queue(900); });
    card.addEventListener('change', e => { if (e.target.matches('select, input[type=checkbox], input[type=radio], input[type=number], input[type=color]')) queue(200); });
    card.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b && !b.closest('table, dialog') && !b.matches('.cm-toggle, .cm-look, .linkish, [data-show-preview], [data-no-save]')) setTimeout(() => queue(200));
    });
    return { now: () => queue(0) };
  }
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
  // Edit reuses the add form above a list: it fills in, the heading and button change, and Cancel puts it back.
  function formEditor(addBtn, clear) {
    const card = addBtn.closest('.card'), h2 = card.querySelector('h2');
    const addLabel = addBtn.textContent, heading = h2.textContent;
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'btn ghost'; cancel.textContent = 'Cancel'; cancel.hidden = true;
    addBtn.after(' ', cancel);
    const ed = {
      id: null,
      start(id, title) {
        ed.id = id; addBtn.textContent = 'Save changes'; cancel.hidden = false; h2.textContent = title;
        card.classList.add('editing'); card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      stop() { ed.id = null; addBtn.textContent = addLabel; cancel.hidden = true; h2.textContent = heading; card.classList.remove('editing'); clear(); }
    };
    cancel.addEventListener('click', () => ed.stop());
    return ed;
  }

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
    syncGroups(b);
    try { localStorage.setItem('adminTab', b.dataset.tab); } catch { /* private window */ }
    if (b.dataset.tab === 'responses') { loadResponses(); loadUsage(); }
    if (b.dataset.tab === 'settings') renderSettings();
    if (b.dataset.tab === 'reports') { loadFollowups(); loadMissed(); loadAnnual(); loadReviews(); }
    // Today's numbers are fetched fresh each time the tab opens, so a follow-up closed elsewhere (or by a leader's email link) shows right away.
    if (b.dataset.tab === 'today') refresh();
  });
  // Coming back to the window (phone unlock, another tab) also re-pulls the numbers.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && document.querySelector('#nav button.on[data-tab="today"]')) refresh(); });

  // Six groups across the top; the pages in the chosen group show as small buttons under the header.
  // A group opens the page you were last on in it.
  const lastInGroup = {};
  function syncGroups(b) {
    const g = b.dataset.group;
    lastInGroup[g] = b.dataset.tab;
    document.querySelectorAll('#groups button').forEach(x => x.classList.toggle('on', x.dataset.group === g));
    const pages = [...document.querySelectorAll('#nav button')];
    pages.forEach(x => { x.hidden = x.dataset.group !== g; });
    $('subnav-wrap').hidden = pages.filter(x => !x.hidden).length < 2;
  }
  $('groups').addEventListener('click', e => {
    const gb = e.target.closest('button[data-group]');
    if (!gb) return;
    const g = gb.dataset.group;
    const b = document.querySelector(`#nav button[data-tab="${lastInGroup[g] || ''}"]`) || document.querySelector(`#nav button[data-group="${g}"]`);
    if (b) b.click();
    if (matchMedia('(max-width: 700px)').matches) gb.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
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
    for (const th of root.querySelectorAll('table:not(.la) thead th:not(.sortable)')) {
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
        go: () => { goTab('staff'); $('staff-filter').value = 'all'; $('staff-dept').value = ''; $('staff-missing').value = ''; $('staff-notdone').value = ''; $('staff-search').value = e.name; renderStaff(); } }));
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

  // A link that only runs a script ("#") should never jump the page to the top.
  document.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a[href="#"]'); if (a) e.preventDefault(); });
  // Redraws every page from fresh data. Keeps you where you were: same scroll spot, and the button you clicked
  // (when it's still there) stays focused. Some browsers (Safari) jumped to the top when the clicked button was redrawn.
  async function refresh() {
    state = await api('/api/admin/state');
    const y = window.scrollY, act = document.activeElement;
    const key = act && act !== document.body && act.closest('main') ? [...act.attributes].filter(x => x.name === 'id' || x.name.startsWith('data-')).map(x => `[${x.name}="${CSS.escape(x.value)}"]`).join('') : '';
    renderToday(); renderSchedule(); renderRequired(); renderStarter(); renderAnnouncements(); renderTopics(); renderStaff(); renderFilters(); renderReportFilters(); setTimeout(() => fitAllText(), 30); layouts.forEach(l => l.apply());
    if (key && !document.contains(act)) { const again = document.querySelector(key); if (again) again.focus({ preventScroll: true }); }
    if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
    requestAnimationFrame(() => { if (Math.abs(window.scrollY - y) > 2 && window.scrollY < 5) window.scrollTo(0, y); });
  }

  // ---------- add to home screen ----------
  // Chrome and Edge offer a real install prompt; Safari needs the Share menu, so we show the steps.
  let installPrompt = null;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  $('install-app').hidden = !!standalone;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
  window.addEventListener('appinstalled', () => { $('install-app').hidden = true; toast('Added. Look for the In-Service icon.'); });
  $('install-app').addEventListener('click', async () => {
    if (installPrompt) { installPrompt.prompt(); const c = await installPrompt.userChoice; installPrompt = null; if (c.outcome === 'accepted') $('install-app').hidden = true; return; }
    const ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const safariMac = /Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Edg/.test(ua), android = /Android/.test(ua);
    $('install-steps').innerHTML = ios ? '<b>On iPhone or iPad (Safari)</b><ol><li>Tap the <b>Share</b> button (the square with the arrow).</li><li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>.</li></ol>'
      : android ? '<b>On Android (Chrome)</b><ol><li>Tap the <b>⋮</b> menu at the top right.</li><li>Tap <b>Add to Home screen</b> or <b>Install app</b>.</li></ol>'
      : safariMac ? '<b>On a Mac (Safari)</b><ol><li>Click <b>File</b> in the menu bar.</li><li>Click <b>Add to Dock</b>.</li></ol>'
      : '<b>On a computer (Chrome or Edge)</b><ol><li>Click the <b>install</b> icon at the right end of the address bar, or the <b>⋮</b> / <b>…</b> menu.</li><li>Choose <b>Install In-Service</b> (in Edge: <b>Apps → Install this site as an app</b>).</li></ol>';
    $('install-dlg').showModal();
  });
  $('install-close').addEventListener('click', () => $('install-dlg').close());

  // ---------- today ----------
  function renderToday() {
    $('stat-today').textContent = state.responseCountToday;
    $('stat-missed').textContent = state.missedToday;
    const h = new Date().getHours();
    const nm = state.meName || (state.me && state.me !== 'admin' ? state.me : '');
    const who = nm ? ', ' + nm.charAt(0).toUpperCase() + nm.slice(1) : '';
    $('hello-title').textContent = (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening') + who + ' 👋';
    $('hello-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    loadDashboard();
    $('stat-required').textContent = state.required.filter(q => q.active).length;
    $('stat-staff').textContent = state.employees.filter(e => e.active).length;
    // The iPad opens this same site. On a laptop running it locally, list the network addresses instead.
    const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
    const urls = local && state.kioskUrls.length ? state.kioskUrls : [location.origin + '/'];
    $('kiosk-urls').innerHTML = urls.map(u => `<div><a href="${escapeHtml(u)}" target="_blank" rel="noopener"><code>${escapeHtml(u)}</code></a></div>`).join('');
    const openReq = state.required.filter(q => q.active);
    const DT_COLORS = ['#1f6f8b', '#c2410c', '#7c3aed', '#15803d', '#be185d', '#0e7490', '#a16207', '#4338ca'];
    $('today-rows').innerHTML = state.today.map((d, i) => {
      const reqs = openReq.filter(q => !q.departments.length || q.departments.includes(d.department));
      const why = d.source === 'schedule' ? '<span class="pill brand">📌 Scheduled</span>'
        : d.source === 'weekly' ? '<span class="pill">🔁 Topic of the week</span>'
        : d.source === 'culture' ? '<span class="pill">🌟 Culture day</span>'
        : d.source === 'quiz' ? '<span class="pill brand">🧠 Quiz day</span>'
        : d.source === 'random' ? `<span class="pill">🎲 Random from ${d.poolSize}</span>`
        : '<span class="pill">🔁 Topic of the day</span>';
      const reqNote = reqs.length ? `<span class="pill req">⚠️ ${reqs.length} required first</span>` : '';
      const swap = ['daily', 'weekly', 'culture'].includes(d.source) && d.topicId ? `<button class="btn subtle" data-swap="${escapeHtml(d.department)}" title="Pick a different rotation topic for today">🔀 Pick another</button>` : '';
      const title = d.title ? topicLink(d.topicId, d.title) : (d.source === 'random' ? '<span class="muted">Varies per person</span>' : d.source === 'quiz' ? '<span>One question from each person\'s past week</span>' : '<span class="muted">Nothing available</span>');
      const name = d.department || 'Everyone';
      return `<div class="dt-card" style="--dt:${DT_COLORS[i % DT_COLORS.length]}"><div class="dt-top"><div class="dt-av">${escapeHtml(name.slice(0, 1).toUpperCase())}</div><div class="dt-dept">${escapeHtml(name)}</div></div>
        <div class="dt-topic">${title}</div><div class="dt-foot">${why}${reqNote}${swap}</div></div>`;
    }).join('') || '<div class="muted">No departments yet. Add them in Settings.</div>';
  }
  // On phones, tables show as stacked cards; each cell needs its column name as a label.
  function labelTables() {
    document.querySelectorAll('.table-wrap > table:not(.la)').forEach(t => {
      const heads = [...t.querySelectorAll('thead th')].map(th => th.textContent.replace(/[↕▲▼]/g, '').trim());
      if (!heads.length) return;
      t.classList.add('stack');
      t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (!td.hasAttribute('data-label')) td.setAttribute('data-label', td.colSpan > 1 ? '' : heads[i] || ''); }));
    });
  }
  new MutationObserver(() => { clearTimeout(labelTables.t); labelTables.t = setTimeout(labelTables, 50); }).observe(document.body, { childList: true, subtree: true });
  // Keep the chosen tab in view in the swipeable tab row on phones.
  document.getElementById('nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b && matchMedia('(max-width: 700px)').matches) b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); });
  // ----- Today dashboard -----
  // Opens the Responses tab with these filters (blank = no filter).
  function openResponses(f) {
    respPerson = f.person || null;
    $('resp-from').value = f.from || ''; $('resp-to').value = f.to || ''; $('resp-dept').value = f.department || '';
    $('resp-topic').value = f.topicId || ''; $('resp-missed').checked = !!f.missed; $('resp-helpful').value = ''; $('resp-kind').value = f.kind || '';
    goTab('responses');
    if (document.querySelector('#nav button.on').dataset.tab === 'responses') loadResponses();
  }
  let dash = null;
  async function loadDashboard() {
    try { dash = await api('/api/admin/dashboard'); } catch { return; }
    const done = dash.days[dash.days.length - 1];
    const total = done.right + done.missed;
    $('stat-rate').textContent = total ? Math.round(100 * done.right / total) + '%' : '–';
    $('stat-fu').textContent = dash.followupsOpen;
    const older = dash.followupsOpen - (dash.followupsToday || 0);
    $('tile-fu').querySelector('.lbl').textContent = dash.followupsOpen && older ? `waiting on a leader follow-up (${dash.followupsToday || 0} from today, ${older} older)` : 'waiting on a leader follow-up';
    $('tile-fu').classList.toggle('alert', dash.followupsOpen > 0);
    $('tile-missed').classList.toggle('alert', state.missedToday > 0);
    drawDays(dash.days);
    drawDepts(dash.departments);
    $('dash-missq').innerHTML = dash.topMissed.length ? dash.topMissed.map(q => `<button class="missq" data-missq="${escapeHtml(q.topicId)}" data-missq-text="${escapeHtml(q.question)}"><b>${q.missed}×</b>${escapeHtml(q.question)}<div class="muted small">${escapeHtml(q.topicTitle)}</div></button>`).join('')
      + '<div style="margin-top:10px"><a href="#" class="small" data-go="missed-report">Full missed-questions report →</a></div>'
      : '<div class="muted">Nobody missed a question this week. 🎉</div>';
    const cel = dash.celebrationsToday || [];
    const line = (icon, html) => `<div style="display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)"><span>${icon}</span><span>${html}</span></div>`;
    $('dash-glance').innerHTML =
      line('🎂', cel.length ? cel.map(c => `${personLink(c.id, c.name)} <span class="muted">(${c.type === 'birthday' ? 'birthday' : c.years + '-year anniversary'})</span>`).join(', ') : '<span class="muted">No birthdays or work anniversaries today</span>') +
      (dash.quizDay || dash.quizzesToday ? line('🧠', `${dash.quizDay ? "It's quiz day." : dash.quizEvery ? `Pop quiz every ${dash.quizEvery}th in-service.` : ''} <a href="#" data-go="today-quiz">${dash.quizzesToday} pop quiz${dash.quizzesToday === 1 ? '' : 'zes'} done so far today</a>`) : '') +
      line('🙋', dash.unlistedToday ? `<a href="#" data-go="today-all">${dash.unlistedToday} not on the roster today</a>` : '<span class="muted">Everyone today was on the roster</span>') +
      line('⏸️', dash.unfinishedToday ? `<a href="#" data-go="today-all">${dash.unfinishedToday} started but didn't finish</a>` : '<span class="muted">No unfinished in-services today</span>') +
      (leaderGapHtml(true) ? line('⚠️', `<span style="color:var(--warn)">Follow-up emails can't reach some departments.</span><br>${leaderGapHtml(true)}`) : '') +
      line('📌', `${state.required.filter(q => q.active).length} required education item${state.required.filter(q => q.active).length === 1 ? '' : 's'} open`);
  }
  const tip = document.createElement('div');
  tip.className = 'viz-tip'; tip.hidden = true; document.body.appendChild(tip);
  const showTip = (e, html) => { tip.innerHTML = html; tip.hidden = false; const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(innerWidth - r.width - 8, e.clientX + 14) + 'px'; tip.style.top = Math.max(8, e.clientY - r.height - 12) + 'px'; };
  const hideTip = () => { tip.hidden = true; };
  // Hover a department in the missing-leader warning to see who's in it; click to open it on the Staff tab.
  const deptPeople = d => state.employees.filter(e => e.active && sameDept(e.department, d)).sort((a, b) => a.name.localeCompare(b.name));
  document.addEventListener('mouseover', e => {
    const a = e.target.closest('[data-gap-dept]');
    if (!a) return;
    const list = deptPeople(a.dataset.gapDept);
    showTip(e, `<b>${escapeHtml(a.dataset.gapDept)}</b> · ${list.length} active staff<br>` +
      (list.length ? list.slice(0, 15).map(p => escapeHtml(p.name) + (p.jobTitle ? ` <span style="opacity:.7">${escapeHtml(p.jobTitle)}</span>` : '')).join('<br>') + (list.length > 15 ? `<br>…and ${list.length - 15} more` : '') : 'No active staff') +
      '<br><span style="opacity:.7">Click to see them on the Staff tab</span>');
  });
  // Same instant pop-up for the department names on the look-ahead (the browser's own title tooltip takes a second to appear).
  document.addEventListener('mouseover', e => {
    const a = e.target.closest('[data-la-people]');
    if (!a) return;
    const dept = a.dataset.laPeople, list = dept ? deptPeople(dept) : state.employees.filter(x => x.active).sort((x, y) => x.name.localeCompare(y.name));
    showTip(e, `<b>${escapeHtml(dept || 'All staff')}</b> · ${list.length} active<br>` +
      (list.length ? list.slice(0, 15).map(p => escapeHtml(p.name) + (p.jobTitle ? ` <span style="opacity:.7">${escapeHtml(p.jobTitle)}</span>` : '')).join('<br>') + (list.length > 15 ? `<br>…and ${list.length - 15} more` : '') : 'No active staff yet') +
      '<br><span style="opacity:.7">Click to open the list</span>');
  });
  document.addEventListener('mouseout', e => { if (e.target.closest('[data-gap-dept], [data-rate-tip], [data-la-people]')) hideTip(); });
  // Hover the 👍/👎 on the topic library: the latest ratings, newest first.
  document.addEventListener('mouseover', e => {
    const a = e.target.closest('[data-rate-tip]');
    if (!a) return;
    const st = state.topicStats[a.dataset.rateTip] || {}, list = (st.rated || []).slice().reverse();
    const total = st.helpful + st.notHelpful;
    showTip(e, `<b>${Math.round(100 * st.helpful / (total || 1))}% found this lesson helpful</b> · ${total} rating${total === 1 ? '' : 's'}<br>` +
      list.map(r => `${r.up ? '👍' : '👎'} ${escapeHtml(r.name || 'Someone')}${r.department ? ` <span style="opacity:.7">${escapeHtml(r.department)}</span>` : ''} <span style="opacity:.7">· ${fmtDate(r.date)}</span>`).join('<br>') +
      (total > list.length ? `<br><span style="opacity:.7">…and ${total - list.length} more</span>` : '') + '<br><span style="opacity:.7">Click to see them all</span>');
  });
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-gap-dept]');
    if (!a) return;
    e.preventDefault(); hideTip();
    goTab('staff');
    $('staff-filter').value = 'all'; $('staff-search').value = ''; $('staff-missing').value = ''; $('staff-notdone').value = '';
    renderStaff();
    const opt = [...$('staff-dept').options].find(o => sameDept(o.value, a.dataset.gapDept));
    if (opt) { $('staff-dept').value = opt.value; renderStaff(); }
  });
  const dayLabel = d => { const [y, m, day] = d.split('-').map(Number); return new Date(y, m - 1, day); };
  // Stacked columns: right first try on the bottom, missed on top, 2px gap between, rounded top.
  function drawDays(days) {
    const W = 640, H = 230, L = 34, R = 6, T = 10, B = 34;
    const max = Math.max(1, ...days.map(d => d.right + d.missed));
    const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500].find(s => max / s <= 5) || Math.ceil(max / 5);
    const top = Math.ceil(max / step) * step;
    const y = v => T + (H - T - B) * (1 - v / top);
    const slot = (W - L - R) / days.length, bw = Math.min(30, slot * 0.62);
    const topRound = (x, y0, w, h, r) => h <= 0 ? '' : `M${x},${y0 + h}V${y0 + Math.min(r, h)}Q${x},${y0} ${x + Math.min(r, w / 2)},${y0}H${x + w - Math.min(r, w / 2)}Q${x + w},${y0} ${x + w},${y0 + Math.min(r, h)}V${y0 + h}Z`;
    let g = '';
    for (let v = 0; v <= top; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--axis)">${v}</text>`;
    const cols = days.map((d, i) => {
      const x = L + i * slot + (slot - bw) / 2, base = y(0);
      const hr = base - y(d.right), hm = d.missed ? base - y(d.missed) : 0;
      const gap = d.right && d.missed ? 2 : 0;
      const rightPath = d.missed ? `<rect x="${x}" y="${base - hr}" width="${bw}" height="${hr}" fill="var(--series-1)"/>` : `<path d="${topRound(x, base - hr, bw, hr, 4)}" fill="var(--series-1)"/>`;
      const missPath = d.missed ? `<path d="${topRound(x, base - hr - gap - hm, bw, hm, 4)}" fill="var(--series-2)"/>` : '';
      const dt = dayLabel(d.date), isToday = d.date === dash.today;
      const lbl = isToday ? 'Today' : (i % 2 === (days.length - 1) % 2 ? `${dt.getMonth() + 1}/${dt.getDate()}` : '');
      return `<g class="bar" data-day="${d.date}">${d.right ? rightPath : ''}${missPath}
        <text x="${x + bw / 2}" y="${H - B + 16}" text-anchor="middle" font-size="11" fill="${isToday ? 'var(--ink)' : 'var(--axis)'}" font-weight="${isToday ? 700 : 400}">${lbl}</text>
        <rect class="hit" x="${L + i * slot}" y="${T}" width="${slot}" height="${H - T - B + 20}" fill="transparent"/></g>`;
    }).join('');
    const empty = days.every(d => !d.right && !d.missed);
    $('dash-days').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="In-services per day for the last 14 days">${g}<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="#c9d3da"/>${cols}</svg>`
      + (empty ? '<div class="muted small" style="margin-top:-120px;text-align:center;height:120px">No in-services in the last 14 days yet.</div>' : '');
  }
  $('dash-days').addEventListener('mousemove', e => {
    const g = e.target.closest('[data-day]');
    if (!g) return hideTip();
    const d = dash.days.find(x => x.date === g.dataset.day), t = d.right + d.missed;
    showTip(e, `<strong>${dayLabel(d.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</strong><br>
      <i style="background:#2a78d6"></i>Right first try: ${d.right}<br><i style="background:#eb6834"></i>Missed first try: ${d.missed}${t ? `<br><span style="opacity:.75">${Math.round(100 * d.right / t)}% first try · click to see</span>` : ''}`);
  });
  $('dash-days').addEventListener('mouseleave', hideTip);
  $('dash-days').addEventListener('click', e => { const g = e.target.closest('[data-day]'); if (g) { hideTip(); openResponses({ from: g.dataset.day, to: g.dataset.day }); } });
  function drawDepts(list) {
    const max = Math.max(1, ...list.map(d => d.right + d.missed));
    $('dash-depts').innerHTML = list.length ? list.slice(0, 10).map(d => {
      const t = d.right + d.missed;
      return `<div class="hbar" data-dept="${escapeHtml(d.department)}" title="${escapeHtml(d.department)}: ${d.right} right first try, ${d.missed} missed. Click to see."><span class="name">${escapeHtml(d.department)}</span>
        <span class="track">${d.right ? `<span class="r" style="width:${100 * d.right / max}%"></span>` : ''}${d.missed ? `<span class="m" style="width:${100 * d.missed / max}%"></span>` : ''}</span><span class="val">${t}</span></div>`;
    }).join('') : '<div class="muted">No in-services this week yet.</div>';
  }
  $('dash-depts').addEventListener('click', e => {
    const r = e.target.closest('[data-dept]');
    if (r) openResponses({ from: dash.start7, to: dash.today, department: r.dataset.dept === 'No department' ? '' : r.dataset.dept });
  });
  $('dash-missq').addEventListener('click', e => {
    const b = e.target.closest('[data-missq]');
    const t = b && topicById(b.dataset.missq);
    if (t) showTopicResults(t, { fil: 'missed', q: t.questions.findIndex(q => stripFormat(q.text).trim() === b.dataset.missqText.trim()) });
    else if (b) openResponses({ from: dash.start7, to: dash.today, topicId: b.dataset.missq, missed: true });
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    e.preventDefault();
    const go = b.dataset.go, t = state.todayDate;
    if (go === 'today-all') openResponses({ from: t, to: t });
    if (go === 'today-quiz') openResponses({ from: t, to: t, kind: 'quiz' });
    else if (go === 'today-missed') openResponses({ from: t, to: t, missed: true });
    else if (go === 'followups') { $('fu-filter').value = 'open'; goTab('reports'); setTimeout(() => $('fu-card').scrollIntoView({ behavior: 'smooth' }), 80); }
    else if (go === 'leaders') { goTab('settings'); setTimeout(() => $('dept-card').scrollIntoView({ behavior: 'smooth', block: 'start' }), 80); }
    else if (go === 'look-ahead') { goTab('schedule'); setTimeout(() => $('la-card').scrollIntoView({ behavior: 'smooth' }), 80); }
    else if (go === 'missed-report') { goTab('reports'); setTimeout(() => $('mm-rows').closest('.card').scrollIntoView({ behavior: 'smooth' }), 80); }
    else goTab(go);
  });

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
  const quietMin = () => state && state.settings && Number.isInteger(state.settings.kioskQuietMin) ? state.settings.kioskQuietMin : 120;
  const ago = mins => mins < 1 ? 'just now' : mins < 60 ? `${Math.round(mins)} minute${Math.round(mins) === 1 ? '' : 's'} ago`
    : mins < 48 * 60 ? `${Math.round(mins / 60)} hour${Math.round(mins / 60) === 1 ? '' : 's'} ago` : `${Math.round(mins / 1440)} days ago`;
  async function checkKiosk() {
    let k;
    try { k = await api('/api/admin/kiosk-status'); } catch { return; }
    const now = new Date(k.now);
    const mins = k.kioskSeen ? (now - new Date(k.kioskSeen.at)) / 60000 : null;
    const upMins = (now - new Date(k.serverStartedAt)) / 60000;
    // Right after an update the site restarts and hasn't heard from the iPad yet; give it a few minutes.
    const limit = quietMin();
    const quiet = !!limit && (mins === null ? upMins > Math.max(5, limit) : mins > limit);
    const noneToday = !k.responseCountToday && new Date().getHours() >= 10;
    const alerts = [];
    if (quiet) alerts.push(`The iPad hasn't checked in for ${mins === null ? 'over ' + ago(upMins).replace(' ago', '') : ago(mins).replace(' ago', '')}. <span class="small">Check that it's charged, on Wi-Fi, and showing the in-service page.</span>`);
    else if (noneToday) alerts.push('No one has done an in-service on the iPad yet today. <span class="small">Check that the iPad is working and staff can reach it.</span>');
    $('kiosk-alert').innerHTML = alerts.map(a => `<div>⚠️ ${a}</div>`).join('');
    $('kiosk-alert').hidden = !alerts.length;
    $('kiosk-status').innerHTML = `<div><span class="dot${quiet ? ' off' : ''}"></span>${k.kioskSeen ? `Last checked in ${ago(mins)}${k.kioskSeen.device === 'iPad' ? ' from the iPad' : ''}.` : 'Waiting to hear from the iPad.'}</div>
      <div class="muted" style="margin-top:4px">Last in-service: ${k.lastResponseAt ? fmtWhen(k.lastResponseAt) : 'none yet'}. Completed today: ${k.responseCountToday}.</div>
      ${k.kioskSeen && k.kioskSeen.waiting ? `<div style="margin-top:4px">${k.kioskSeen.waiting} answer${k.kioskSeen.waiting === 1 ? '' : 's'} saved on the iPad while it was offline ${k.kioskSeen.waiting === 1 ? 'is' : 'are'} waiting to upload.</div>` : ''}
      <div style="margin-top:10px">The iPad checks in every minute while it shows the in-service page, whether or not anyone uses it. Warn me at the top of this page when it's been quiet for
        <select id="quiet-min">${[[30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours'], [480, '8 hours'], [0, 'never warn me']].map(([v, l]) => `<option value="${v}"${v === limit ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="muted" style="margin-top:4px">A warning also shows if no one has done an in-service by 10 am.</div>`;
  }
  checkKiosk();
  setInterval(checkKiosk, 60000);
  $('kiosk-status').addEventListener('change', async e => {
    if (e.target.id !== 'quiet-min') return;
    try {
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ kioskQuietMin: Number(e.target.value) }) });
      state.settings.kioskQuietMin = Number(e.target.value);
      toast('Saved'); checkKiosk();
    } catch (err) { fail(err); }
  });

  // ---------- schedule ----------
  function renderSchedule() {
    topicOptions($('sc-topic'));
    if (!$('sc-depts').dataset.init) { renderChecks($('sc-depts'), []); $('sc-depts').dataset.init = 1; }
    if (!$('sc-start').value) setWeek(0);
    loadLookAhead();
    document.querySelectorAll('input[name=fallback]').forEach(r => { r.checked = r.value === state.settings.fallbackMode; });
    $('culture-day').value = Number.isInteger(state.settings.cultureDay) ? String(state.settings.cultureDay) : '';
    $('quiz-day').value = Number.isInteger(state.settings.quizDay) ? String(state.settings.quizDay) : '';
    if (document.activeElement !== $('quiz-every')) $('quiz-every').value = String(state.settings.quizEvery || 4);
    $('quiz-mode').value = Number.isInteger(state.settings.quizDay) ? 'day' : state.settings.quizEvery ? 'every' : 'off';
    quizModeUi();
    const qt = state.settings.quizText || {};
    $('quiz-no-lesson').checked = !!state.settings.quizNoLesson;
    if (document.activeElement !== $('quiz-text-en')) $('quiz-text-en').value = qt.en || '';
    if (document.activeElement !== $('quiz-text-es')) $('quiz-text-es').value = qt.es || '';
    quizClash();
    const showPast = $('sc-show-past').checked;
    const rows = state.schedules
      .filter(s => showPast || !s.endDate || s.endDate >= state.todayDate)
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
    $('sc-rows').innerHTML = rows.map(s => {
      const t = topicById(s.topicId);
      const live = s.startDate <= state.todayDate && (!s.endDate || s.endDate >= state.todayDate);
      const status = live ? ' <span class="pill good">Running now</span>' : s.startDate > state.todayDate ? ' <span class="pill">Upcoming</span>' : ' <span class="pill">Ended</span>';
      return `<tr class="${!live && s.startDate < state.todayDate ? 'dim' : ''}">
        <td>${t ? topicLink(t.id, t.title) : '<span class="muted">Deleted topic</span>'}${t && t.status !== 'active' ? ' <span class="pill warn">Not active</span>' : ''}${status}
          ${s.note ? `<div class="muted small">${escapeHtml(s.note)}</div>` : ''}</td>
        <td>${whoLabel(s.departments)}</td>
        <td style="white-space:nowrap">${fmtDate(s.startDate)} – ${s.endDate ? fmtDate(s.endDate) : 'until removed'}</td>
        <td>${t ? t.questions.length : ''}</td>
        <td style="white-space:nowrap"><button class="btn subtle" data-edit-sched="${s.id}">✏️ Edit</button> <button class="btn subtle danger" data-del-sched="${s.id}">Remove</button></td></tr>`;
    }).join('') || '<tr><td colspan="5" class="muted">Nothing scheduled. Staff get topics from the rotation.</td></tr>';
  }
  // ---------- look ahead ----------
  let laStart = null;
  const addDay = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return isoDay(new Date(y, m - 1, d + n)); };
  const mondayOf = iso => { const [y, m, d] = iso.split('-').map(Number); const x = new Date(y, m - 1, d); return isoDay(new Date(y, m - 1, d - ((x.getDay() + 6) % 7))); };
  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const laLabel = { schedule: 'Scheduled', weekly: 'Topic of the week', daily: 'Topic of the day', culture: 'Culture day', random: '', quiz: 'Quiz day' };
  // Quiz day and culture day on the same weekday: say which one wins.
  function quizClash() { $('quiz-clash').hidden = !($('quiz-mode').value === 'day' && $('quiz-day').value !== '' && $('quiz-day').value === $('culture-day').value); }
  function quizModeUi() { const m = $('quiz-mode').value; $('quiz-every-wrap').hidden = m !== 'every'; $('quiz-day').hidden = m !== 'day'; quizClash(); }
  ['quiz-day', 'culture-day'].forEach(id => $(id).addEventListener('change', quizClash));
  $('quiz-mode').addEventListener('change', quizModeUi);
  async function loadLookAhead() {
    if (!laStart) laStart = mondayOf(state.todayDate);
    try {
      const f = await api(`/api/admin/forecast?start=${laStart}&weeks=${$('la-weeks').value}`);
      $('la-required').innerHTML = f.required.map(q => `<div class="la-req">📌 <b>Required education comes first:</b> ${q.topicId ? topicLink(q.topicId, q.title) : escapeHtml(q.title)} for ${whoLabel(q.departments)}, until everyone has done it${q.endDate ? ` or ${fmtDate(q.endDate)}` : ''}. People who've finished it get the topics below.</div>`).join('');
      const weeks = [];
      for (let i = 0; i < f.days.length; i += 7) weeks.push(f.days.slice(i, i + 7));
      const depts = f.days.length ? f.days[0].items.map(x => x.department) : [];
      $('la-grid').innerHTML = `<div class="table-wrap">${weeks.map(w => {
        const head = w.map((d, i) => `<th class="${d.date === f.today ? 'today' : ''}">${DAY_NAMES[i]}<br><span>${Number(d.date.slice(8))}</span></th>`).join('');
        const rows = depts.map((dept, r) => {
          const cells = [];
          for (let i = 0; i < w.length;) {
            const it = w[i].items[r];
            let j = i + 1;
            while (j < w.length) { const n = w[j].items[r]; if (n.source !== it.source || n.topicId !== it.topicId || n.scheduleId !== it.scheduleId) break; j++; }
            const from = w[i].date, to = w[j - 1].date;
            const cls = it.source === 'schedule' ? 'sched' : it.source === 'culture' ? 'culture' : it.source === 'quiz' ? 'quiz' : it.topicId || it.source === 'random' ? 'auto' : 'none';
            const title = it.source === 'random' ? 'A random rotation topic each visit' : it.source === 'quiz' ? '🧠 Pop quiz from their past week' : it.title || 'Nothing in the rotation';
            cells.push(`<td colspan="${j - i}"><button class="la-cell ${cls}${to < f.today ? ' past' : ''}" data-la-dept="${escapeHtml(dept)}" data-la-from="${from}" data-la-to="${to}" data-la-topic="${it.topicId || ''}" data-la-source="${it.source}"
              title="${escapeHtml(title)} · ${escapeHtml(dept || 'All staff')} · ${fmtDate(from)}${to !== from ? ' – ' + fmtDate(to) : ''}">${escapeHtml(title)}<small>${laLabel[it.source] || ''}</small></button></td>`);
            i = j;
          }
          return `<tr><td class="dept">${deptButton(dept)}</td>${cells.join('')}</tr>`;
        }).join('');
        return `<div class="la-week"><h3>Week of ${fmtDate(w[0].date)}</h3><table class="la"><thead><tr><th class="dept"></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
      }).join('')}</div>` + laPhoneList(f, depts);
    } catch (err) { fail(err); }
  }
  // On a phone the calendar is too narrow, so it becomes a day-by-day list for one department.
  let laPhoneDept = null;
  function laPhoneList(f, depts) {
    if (!depts.length) return '';
    const dept = depts.includes(laPhoneDept) ? laPhoneDept : depts[0], r = depts.indexOf(dept);
    const day = d => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const runs = [];
    for (let i = 0; i < f.days.length;) {
      const it = f.days[i].items[r];
      let j = i + 1;
      while (j < f.days.length) { const n = f.days[j].items[r]; if (n.source !== it.source || n.topicId !== it.topicId || n.scheduleId !== it.scheduleId) break; j++; }
      runs.push({ it, from: f.days[i].date, to: f.days[j - 1].date });
      i = j;
    }
    return `<div class="la-phone"><label class="small muted">Department <select id="la-phone-dept">${depts.map(d => `<option value="${escapeHtml(d)}"${d === dept ? ' selected' : ''}>${escapeHtml(d || 'All staff')}</option>`).join('')}</select></label>
      <div class="la-list">${runs.filter(x => x.to >= f.today).map(({ it, from, to }) => {
        const cls = it.source === 'schedule' ? 'sched' : it.source === 'culture' ? 'culture' : it.source === 'quiz' ? 'quiz' : it.topicId || it.source === 'random' ? 'auto' : 'none';
        const title = it.source === 'random' ? 'A random rotation topic each visit' : it.source === 'quiz' ? '🧠 Pop quiz from their past week' : it.title || 'Nothing in the rotation';
        return `<button class="la-cell la-row ${cls}" data-la-dept="${escapeHtml(dept)}" data-la-from="${from}" data-la-to="${to}" data-la-topic="${it.topicId || ''}" data-la-source="${it.source}">
          <span class="la-when">${from <= f.today && f.today <= to ? '<b>Now</b> · ' : ''}${day(from)}${to !== from ? ` – ${day(to)}` : ''}</span><span class="la-what">${escapeHtml(title)}<small>${laLabel[it.source] || ''}</small></span></button>`;
      }).join('')}</div></div>`;
  }
  $('la-grid').addEventListener('change', e => { if (e.target.id === 'la-phone-dept') { laPhoneDept = e.target.value; loadLookAhead(); } });
  $('la-prev').addEventListener('click', () => { laStart = addDay(laStart, -7); loadLookAhead(); });
  $('la-next').addEventListener('click', () => { laStart = addDay(laStart, 7); loadLookAhead(); });
  $('la-now').addEventListener('click', () => { laStart = null; loadLookAhead(); });
  $('la-weeks').addEventListener('change', loadLookAhead);
  // Tapping a square shows what that topic is, with buttons to schedule it (or swap it) and to preview it.
  // The department name at the left of a look-ahead row: hover shows who's in it, a click opens the list.
  const laPeople = dept => dept ? deptPeople(dept) : state.employees.filter(e => e.active).sort((a, b) => a.name.localeCompare(b.name));
  function deptButton(dept) {
    const people = laPeople(dept), n = people.length;
    return `<button class="linkish la-dept" data-la-people="${escapeHtml(dept)}">${escapeHtml(dept || 'All staff')}<small>${n}</small></button>`;
  }
  function showDeptPeople(dept) {
    vwPush(() => showDeptPeople(dept));
    const people = laPeople(dept);
    $('vw-title').textContent = `${dept || 'All staff'} · ${people.length} ${people.length === 1 ? 'person' : 'people'}`;
    $('vw-actions').innerHTML = '<button class="btn ghost" data-pv="staff">👥 Open in Staff</button>';
    $('vw-actions').onclick = e => {
      if (!e.target.closest('[data-pv="staff"]')) return;
      $('viewer').close(); goTab('staff');
      $('staff-filter').value = 'all'; $('staff-search').value = ''; $('staff-missing').value = ''; $('staff-notdone').value = '';
      const opt = [...$('staff-dept').options].find(o => sameDept(o.value, dept)); $('staff-dept').value = opt ? opt.value : ''; renderStaff();
    };
    $('vw-body').innerHTML = people.length ? `<ul class="pv-list">${people.map(p => `<li>${personLink(p.id, p.name)}${p.jobTitle ? ` <span class="muted small">${escapeHtml(p.jobTitle)}</span>` : ''}</li>`).join('')}</ul>`
      : '<p class="muted">Nobody active in this department yet. Add people on the Staff tab.</p>';
    openViewer();
  }
  $('la-grid').addEventListener('click', e => {
    const d = e.target.closest('[data-la-people]');
    if (d) return showDeptPeople(d.dataset.laPeople);
    const b = e.target.closest('[data-la-dept]');
    if (!b) return;
    const ds = b.dataset, t = ds.laTopic && topicById(ds.laTopic);
    if (!t) return laSchedule(ds);
    const when = `${fmtDate(ds.laFrom)}${ds.laTo !== ds.laFrom ? ' – ' + fmtDate(ds.laTo) : ''}`;
    const what = (b.querySelector('small') || {}).textContent || '';
    showDetails(t, {
      note: `📅 ${escapeHtml(ds.laDept || 'All staff')} · ${when}${what ? ' · ' + escapeHtml(what) : ''}`,
      actions: [
        ...(t.questions.length ? [['▶ Preview on the iPad', () => showPreview(t)]] : []),
        [ds.laSource === 'schedule' ? '📋 See it in the schedule list' : '📅 Schedule this or swap it', () => { $('viewer').close(); laSchedule(ds); }]
      ]
    });
  });
  function laSchedule(ds) {
    if (ds.laSource === 'schedule') {
      $('sc-rows').closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('sc-rows').closest('.card').classList.remove('flash-card'); void $('sc-rows').offsetWidth; $('sc-rows').closest('.card').classList.add('flash-card');
      return toast('Already scheduled. Remove it below to change it.');
    }
    // Fill in the form so they can keep the suggestion or swap the topic, then add it.
    $('sc-topic').value = ds.laTopic || '';
    $('sc-start').value = ds.laFrom < state.todayDate ? state.todayDate : ds.laFrom;
    $('sc-end').value = ds.laTo;
    $('sc-depts').querySelectorAll('input').forEach(i => { i.checked = !!ds.laDept && i.value === ds.laDept; });
    $('sc-note').value = '';
    const card = $('sc-form-card');
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.classList.remove('flash-card'); void card.offsetWidth; card.classList.add('flash-card');
    toast('Check the topic and dates, then press "Add to schedule"');
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
  const scEdit = formEditor($('sc-add'), () => { $('sc-note').value = ''; renderChecks($('sc-depts'), []); setWeek(0); $('sc-error').textContent = ''; });
  $('sc-add').addEventListener('click', async () => {
    $('sc-error').textContent = '';
    try {
      const body = JSON.stringify({ topicId: $('sc-topic').value, departments: checked($('sc-depts')), startDate: $('sc-start').value, endDate: $('sc-end').value, note: $('sc-note').value });
      if (scEdit.id) await api('/api/admin/schedules/' + scEdit.id, { method: 'PUT', body }); else await api('/api/admin/schedules', { method: 'POST', body });
      toast(scEdit.id ? 'Saved' : 'Scheduled');
      if (scEdit.id) scEdit.stop(); else $('sc-note').value = '';
      await refresh();
    } catch (err) { $('sc-error').textContent = err.message; }
  });
  $('sc-rows').addEventListener('click', async e => {
    const ed = e.target.closest('[data-edit-sched]');
    if (ed) {
      const s = state.schedules.find(x => x.id === ed.dataset.editSched);
      if (!s) return;
      $('sc-topic').value = s.topicId; renderChecks($('sc-depts'), s.departments);
      $('sc-start').value = s.startDate; $('sc-end').value = s.endDate || ''; $('sc-note').value = s.note || '';
      return scEdit.start(s.id, 'Edit scheduled topic');
    }
    const b = e.target.closest('[data-del-sched]');
    if (!b || !await confirm('Remove this from the schedule? Responses already recorded are kept.', 'Remove')) return;
    try { await api('/api/admin/schedules/' + b.dataset.delSched, { method: 'DELETE' }); toast('Removed'); await refresh(); }
    catch (err) { fail(err); }
  });
  autoSave($('save-fallback').closest('.card'), async () => {
    const v = document.querySelector('input[name=fallback]:checked');
    if (!v) return;
    const cd = $('culture-day').value, qd = $('quiz-day').value, qm = $('quiz-mode').value;
    await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ fallbackMode: v.value, cultureDay: cd === '' ? null : Number(cd),
      quizDay: qm === 'day' && qd !== '' ? Number(qd) : null, quizEvery: qm === 'every' ? Math.min(30, Math.max(2, Number($('quiz-every').value) || 4)) : 0,
      quizNoLesson: $('quiz-no-lesson').checked, quizText: { en: $('quiz-text-en').value, es: $('quiz-text-es').value } }) });
    await refresh();
  }, [$('save-fallback')]);

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
        <td>${t ? topicLink(t.id, t.title) : 'Deleted topic'} ${q.active ? '<span class="pill req">Open</span>' : '<span class="pill">Closed</span>'}
          ${q.reason ? `<div class="muted small">${escapeHtml(q.reason)}</div>` : ''}
          ${q.endDate ? `<div class="small ${q.endDate < todayStr() ? 'muted' : ''}">${q.endDate < todayStr() ? 'Ended' : 'Shows until'} ${escapeHtml(q.endDate)}</div>` : ''}</td>
        <td>${whoLabel(q.departments)}</td>
        <td style="white-space:nowrap">${fmtWhen(q.createdAt)}</td>
        <td><div class="progress-bar"><span style="width:${pct}%"></span></div><div class="small">${q.doneCount} of ${total} done</div></td>
        <td style="white-space:nowrap">
          <button class="btn subtle" data-rq-view="${q.id}">Who's done</button>
          <button class="btn subtle" data-rq-edit="${q.id}">✏️ Edit</button>
          <button class="btn subtle${q.active ? ' danger' : ''}" data-rq-toggle="${q.id}" data-active="${q.active ? 1 : 0}">${q.active ? 'Close' : 'Reopen'}</button>
        </td></tr>`;
    }).join('') || '<tr><td colspan="5" class="muted">No required education yet.</td></tr>';
  }
  const rqEdit = formEditor($('rq-add'), () => { $('rq-reason').value = ''; $('rq-end').value = ''; $('rq-topic').disabled = false; renderChecks($('rq-depts'), []); $('rq-error').textContent = ''; });
  $('rq-add').addEventListener('click', async () => {
    $('rq-error').textContent = '';
    const d = checked($('rq-depts'));
    if (rqEdit.id) {
      try {
        await api('/api/admin/required/' + rqEdit.id, { method: 'PUT', body: JSON.stringify({ departments: d, reason: $('rq-reason').value, endDate: $('rq-end').value || null }) });
        toast('Saved'); rqEdit.stop(); await refresh();
      } catch (err) { $('rq-error').textContent = err.message; }
      return;
    }
    const t = topicById($('rq-topic').value);
    if (t && !await confirm(`Require "${t.title}" for ${d.length ? d.join(', ') : 'all staff'}? Each person will get it the next time they clock in.`, 'Require it')) return;
    try {
      await post('/api/admin/required', { topicId: $('rq-topic').value, departments: d, reason: $('rq-reason').value, endDate: $('rq-end').value || null });
      $('rq-reason').value = ''; $('rq-end').value = '';
      toast('Required education added');
      await refresh();
    } catch (err) { $('rq-error').textContent = err.message; }
  });
  $('rq-rows').addEventListener('click', async e => {
    const ed = e.target.closest('[data-rq-edit]');
    if (ed) {
      const q = state.required.find(x => x.id === ed.dataset.rqEdit);
      if (!q) return;
      // The topic can't change, since who's done is counted against it. To switch topics, close this one and add a new one.
      $('rq-topic').value = q.topicId; $('rq-topic').disabled = true;
      renderChecks($('rq-depts'), q.departments); $('rq-reason').value = q.reason || ''; $('rq-end').value = q.endDate || '';
      return rqEdit.start(q.id, 'Edit required education');
    }
    const tg = e.target.closest('[data-rq-toggle]');
    const vw = e.target.closest('[data-rq-view]');
    try {
      if (tg) {
        const closing = tg.dataset.active === '1';
        if (closing && !await confirm('Close this? Staff who have not done it yet will no longer get it.', 'Close it')) return;
        await post(`/api/admin/required/${tg.dataset.rqToggle}/${closing ? 'close' : 'reopen'}`);
        await refresh();
      }
      if (vw) {
        const q = state.required.find(x => x.id === vw.dataset.rqView);
        const pr = await api(`/api/admin/required/${q.id}/progress`);
        const t = topicById(q.topicId);
        vwPush(() => { const x = document.querySelector(`[data-rq-view="${q.id}"]`); if (x) x.click(); });
        $('vw-title').textContent = t ? t.title : 'Required education';
        $('vw-body').innerHTML = `
          <h3 style="margin-top:14px">Still to do (${pr.pending.length})</h3>
          ${pr.pending.length ? `<table><tbody>${pr.pending.map(p => `<tr><td>${personLink(p.id, p.name)}</td><td>${escapeHtml(p.department)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Everyone is done.</p>'}
          <h3 style="margin-top:18px">Done (${pr.done.length})</h3>
          ${pr.done.length ? `<table><tbody>${pr.done.map(p => `<tr><td>${personLink(p.id, p.name)}</td><td>${escapeHtml(p.department)}</td><td>${fmtWhen(p.completedAt)}</td><td>${p.firstTryCorrect ? '<span class="pill good">Right first try</span>' : '<span class="pill warn">Needed a retry</span>'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No one yet.</p>'}`;
        openViewer();
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
      return `<li>${t ? topicLink(t.id, t.title) : '<span class="muted">Deleted topic</span>'}${t && t.status !== 'active' ? ' <span class="pill warn">Not active</span>' : ''}
        <span class="muted small">${t ? whoLabel(t.departments) : ''}</span>
        <button class="btn subtle" data-ns-up="${i}"${i ? '' : ' disabled'}>↑</button><button class="btn subtle" data-ns-down="${i}"${i < nsIds.length - 1 ? '' : ' disabled'}>↓</button>
        <button class="btn subtle danger" data-ns-del="${i}">Remove</button></li>`;
    }).join('') || '<li class="muted" style="list-style:none;margin-left:-20px">No topics yet. Add the ones every new person should see first.</li>';
    topicOptions($('ns-add-topic'));
    $('nh-rows').innerHTML = (state.newHires || []).map(n => `<tr><td>${personLink(n.id, n.name)}</td><td>${escapeHtml(n.department || '')}</td>
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
    const y = window.scrollY;
    nsDirty = true; renderStarter();
    // Keep the moved topic's arrow under your finger, and the page where it was.
    const i = b.dataset.nsUp ? Number(b.dataset.nsUp) - 1 : b.dataset.nsDown ? Number(b.dataset.nsDown) + 1 : -1;
    const next = i >= 0 && document.querySelector(`[data-ns-${b.dataset.nsUp ? 'up' : 'down'}="${i}"]:not([disabled])`);
    if (next) next.focus({ preventScroll: true });
    if (window.scrollY !== y) window.scrollTo(0, y);
  });
  $('ns-add').addEventListener('click', () => {
    const id = $('ns-add-topic').value;
    if (!id) return;
    if (!nsIds.includes(id)) nsIds.push(id);
    $('ns-add-topic').value = ''; nsDirty = true; renderStarter();
  });
  $('ns-days').addEventListener('input', () => { nsDirty = true; });
  autoSave($('ns-save').closest('.card'), async () => {
    await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ starter: { topicIds: nsIds, days: Number($('ns-days').value) } }) });
    nsDirty = false; await refresh();
  }, [$('ns-save')]);

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
      const n = st && st.responses ? Math.round(100 * st.firstTry / st.responses) : null;
      const pct = n === null ? '<span class="muted">–</span>'
        : `<div class="tl-pct"><span>${n}%</span><div class="tl-bar"><i style="width:${n}%;background:${n >= 80 ? 'var(--good)' : n >= 60 ? '#d39b1d' : 'var(--warn)'}"></i></div></div>`;
      const retired = t.status === 'retired', draft = t.status === 'draft';
      const tags = (t.category ? `<span class="pill">${escapeHtml(t.category)}</span>` : '') + (t.annual ? '<span class="pill req">Yearly</span>' : '') + (t.es && t.es.lesson ? '<span class="pill brand">Español</span>' : '') +
        (retired ? '<span class="pill">Retired</span>' : '') +
        (draft ? `<span class="pill warn" title="${escapeHtml((t.problems || []).join(' '))}">Needs work</span>` : '');
      const rated = st && st.helpful + st.notHelpful ? `<a href="#" class="tl-rate" data-ratings="${t.id}" data-rate-tip="${t.id}">👍 ${st.helpful} <span>·</span> 👎 ${st.notHelpful}</a>` : '';
      return `<tr class="${retired ? 'dim' : ''}">
        <td><button class="tl-title linkish" data-act="details" data-id="${t.id}" title="See the lesson and questions">${escapeHtml(t.title)}</button><div class="tl-tags">${tags}</div>${draft && t.problems ? `<div class="muted small">${escapeHtml(t.problems[0])}</div>` : ''}</td>
        <td class="small">${whoLabel(t.departments)}</td>
        <td><button class="tl-num" data-act="details" data-id="${t.id}" title="See the questions and answers"><span class="tl-count">${t.questions.length}</span></button>${t.questions.some(q => (q.departments || []).length) ? `<div class="muted small" title="Some questions only go to certain departments">${t.questions.filter(q => (q.departments || []).length).length} dept-only</div>` : ''}</td>
        <td>${retired || draft ? '<span class="muted">–</span>' : `<label class="sw" title="In rotation"><input type="checkbox" data-rotation="${t.id}"${t.inRotation ? ' checked' : ''} aria-label="In rotation"><span></span></label>`}</td>
        <td style="white-space:nowrap">${t.lastUsedDate ? `<button class="tl-num" data-act="results" data-id="${t.id}" title="Who did it and when">${fmtDate(t.lastUsedDate)}</button>` : fmtDate(t.lastUsedDate)}</td>
        <td>${st && st.responses ? `<button class="tl-num" data-act="results" data-id="${t.id}" title="Who got it right, who missed it">${st.responses}</button>` : 0}</td>
        <td>${n === null ? pct : `<button class="tl-num" data-act="results" data-id="${t.id}" title="Who got it right, who missed it, and which questions">${pct}</button>`}${rated}</td>
        <td><div class="tl-acts">
          <button class="tl-act" data-act="preview" data-id="${t.id}" title="Try it on the kiosk screens. Nothing is saved.">▶ Preview</button>
          <button class="tl-act" data-act="edit" data-id="${t.id}">✏️ Edit</button>
          <details class="tl-more"><summary class="tl-act" title="More">⋯</summary><div class="tl-menu">
            <button class="tl-act" data-act="details" data-id="${t.id}" title="All questions and answers on one page">🔑 Answer key</button>
            <button class="tl-act" data-act="duplicate" data-id="${t.id}">⧉ Copy</button>
            ${retired ? `<button class="tl-act" data-act="restore" data-id="${t.id}">↩ Restore</button>`
                      : `<button class="tl-act danger" data-act="retire" data-id="${t.id}">🗄 Retire</button>`}
          </div></details>
        </div></td></tr>`;
    }).join('') || '<tr><td colspan="8" class="muted">No topics match.</td></tr>';
    const live = state.topics.filter(t => t.status === 'active');
    $('topic-summary').textContent = `${live.length} active topic${live.length === 1 ? '' : 's'} · ${live.filter(t => t.inRotation).length} in rotation · ${state.topics.filter(t => t.status === 'draft').length} need work · ${live.filter(t => t.es && t.es.lesson).length} in Spanish`;
    const cats = [...new Set(state.topics.map(t => t.category).filter(Boolean))].sort();
    $('category-list').innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">`).join('');
  }
  // Only one "⋯" menu open at a time; a click anywhere else closes it.
  document.addEventListener('click', e => { document.querySelectorAll('.tl-more[open]').forEach(d => { if (!d.contains(e.target) || e.target.closest('.tl-menu')) d.open = false; }); });
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
      if (act === 'details') return showDetails(t, topicActions(t));
      if (act === 'results') return showTopicResults(t);
      if (act === 'edit') return openEditor(t);
      if (act === 'duplicate') {
        const { topic } = await post(`/api/admin/topics/${id}/duplicate`);
        await refresh();
        toast('Copy created. It is not in the rotation yet.');
        return openEditor(topicById(topic.id));
      }
      if (act === 'retire' && !await confirm(`Retire "${t.title}"? It will stop showing on the iPad but its history is kept.`, 'Retire')) return;
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
  // A topic's name at the top of a pop-up opens it in the editor.
  function vwTopicTitle(t) {
    $('vw-title').innerHTML = `<button type="button" class="linkish vw-topic" data-vw-edit="${escapeHtml(t.id)}" title="Open this topic to edit it">${escapeHtml(t.title)} <span class="vw-edit-hint">✏️ Edit</span></button>`;
  }
  $('vw-title').addEventListener('click', e => {
    const b = e.target.closest('[data-vw-edit]');
    if (!b) return;
    $('viewer').close(); openEditor(topicById(b.dataset.vwEdit));
  });
  const topicActions = t => ({ actions: [['📊 Results', () => showTopicResults(t)], ['▶ Preview', () => showPreview(t)], ['✏️ Edit', () => { $('viewer').close(); openEditor(t); }]] });
  // A topic's results: how it's going overall and per question, and who got it right or missed it, when, and on which question.
  // Everything opens from here: a person, their exact answer, the answer key, the editor.
  // opts: { fil: 'missed' | 'right', q: question number (from 0) } to open already narrowed down.
  async function showTopicResults(t, opts = {}) {
    if (!t) return;
    vwPush(() => showTopicResults(t, opts));
    vwTopicTitle(t);
    $('vw-actions').innerHTML = '<button class="btn ghost" data-tr="key">🔑 Answer key</button><button class="btn ghost" data-tr="preview">▶ Preview</button><button class="btn ghost" data-tr="edit">✏️ Edit</button><button class="btn ghost" data-tr="sheet" title="Everyone who completed it, all dates, ready to print or save as PDF">🖨 Printable sheet</button><button class="btn ghost" data-tr="all">All in Responses</button>';
    $('vw-actions').onclick = e => {
      const b = e.target.closest('[data-tr]'); if (!b) return;
      if (b.dataset.tr === 'key') return showDetails(t, topicActions(t));
      if (b.dataset.tr === 'preview') return showPreview(t);
      if (b.dataset.tr === 'sheet') return printSignInSheet(t);
      $('viewer').close();
      if (b.dataset.tr === 'edit') openEditor(t);
      if (b.dataset.tr === 'all') openResponses({ topicId: t.id });
    };
    $('vw-body').innerHTML = '<p class="muted">Loading…</p>';
    openViewer();
    try {
      const { responses } = await api('/api/admin/responses?topicId=' + encodeURIComponent(t.id));
      const rs = responses.filter(r => r.attempts.length).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
      const right = rs.filter(r => r.firstTryCorrect), missed = rs.filter(r => !r.firstTryCorrect);
      const pctOf = (a, b) => b ? Math.round(100 * a / b) : null;
      const color = n => n >= 80 ? 'var(--good)' : n >= 60 ? '#d39b1d' : 'var(--warn)';
      const up = rs.filter(r => r.helpful === true).length, down = rs.filter(r => r.helpful === false).length;
      // Per question: match by id, or by the text for answers given before the question had an id.
      const qOf = r => t.questions.findIndex(q => q.id === r.questionId || q.text === r.question);
      const byQ = t.questions.map((q, i) => {
        const mine = rs.filter(r => qOf(r) === i);
        const wrong = {};
        mine.filter(r => !r.firstTryCorrect).forEach(r => { wrong[r.attempts[0]] = (wrong[r.attempts[0]] || 0) + 1; });
        const top = Object.entries(wrong).sort((a, b) => b[1] - a[1])[0];
        return { q, n: mine.length, right: mine.filter(r => r.firstTryCorrect).length, top };
      });
      const old = rs.filter(r => qOf(r) < 0).length;
      const pct = pctOf(right.length, rs.length);
      $('vw-body').innerHTML = `
        <div class="pv-stats">
          <div><b>${rs.length}</b><span>in-services</span></div>
          <div><b>${pct === null ? '–' : pct + '%'}</b><span>right first try</span></div>
          <div><b>${missed.length}</b><span>missed first try</span></div>
          <div><b>${up + down ? `👍 ${up} · 👎 ${down}` : '–'}</b><span>lesson ratings</span></div>
        </div>
        <div class="muted small" style="margin-top:6px">For ${whoLabel(t.departments)} · last used ${t.lastUsedDate ? fmtDate(t.lastUsedDate) : 'never'}</div>
        ${t.questions.length ? `<h3 style="margin-top:16px">By question <span class="muted small">tap one to see who answered it</span></h3>
          ${byQ.map((x, i) => { const p = pctOf(x.right, x.n);
            return `<button class="tr-q" data-tr-q="${i}"><b>Q${i + 1}.</b> ${escapeHtml(stripFormat(x.q.text))}${(x.q.departments || []).length ? ` <span class="pill">Only ${escapeHtml(x.q.departments.join(', '))}</span>` : ''}
              <div class="tr-bar"><i style="width:${p || 0}%;background:${p === null ? 'transparent' : color(p)}"></i></div>
              <div class="small muted">${x.n ? `${p}% right first try · ${x.n} answered` : 'Not asked yet'}${x.top ? ` · most common wrong pick: <b>${escapeHtml(x.top[0])}</b> (${x.top[1]})` : ''}</div></button>`; }).join('')}
          ${old ? `<div class="muted small" style="margin-top:6px">${old} answer${old === 1 ? ' was' : 's were'} to questions that have since been changed or removed.</div>` : ''}` : ''}
        <div class="tr-filter" id="tr-filter">
          <button class="btn subtle on" data-trf="all">Everyone (${rs.length})</button>
          <button class="btn subtle" data-trf="missed">⚠️ Missed first try (${missed.length})</button>
          <button class="btn subtle" data-trf="right">✅ Right first try (${right.length})</button>
        </div>
        <div class="table-wrap"><table class="tr-rows"><thead><tr><th>When</th><th>Who</th><th>Question</th><th>Result</th></tr></thead><tbody id="tr-rows"></tbody></table></div>
        <div class="muted small" style="margin-top:6px">Tap a row to see exactly what they picked.</div>`;
      let fil = opts.fil || 'all', qi = Number.isInteger(opts.q) && opts.q >= 0 ? opts.q : null;
      $('tr-filter').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.trf === fil));
      $('vw-body').querySelectorAll('[data-tr-q]').forEach(x => x.classList.toggle('on', Number(x.dataset.trQ) === qi));
      const draw = () => {
        const inQ = rs.filter(r => qi === null || qOf(r) === qi);
        const label = { all: `Everyone${qi === null ? '' : ` on Q${qi + 1}`}`, missed: '⚠️ Missed first try', right: '✅ Right first try' };
        $('tr-filter').querySelectorAll('[data-trf]').forEach(x => { const k = x.dataset.trf;
          x.textContent = `${label[k]} (${inQ.filter(r => k === 'all' || (k === 'missed') === !r.firstTryCorrect).length})`; });
        const list = inQ.filter(r => fil === 'all' || (fil === 'missed') === !r.firstTryCorrect);
        $('tr-rows').innerHTML = list.map(r => `<tr data-resp="${r.id}"><td style="white-space:nowrap">${fmtWhen(r.submittedAt)}</td>
          <td>${r.employeeId ? personLink(r.employeeId, r.name) : escapeHtml(r.name)}<div class="muted small">${escapeHtml(r.department || '')}</div></td>
          <td class="small">${qOf(r) >= 0 ? `Q${qOf(r) + 1}. ` : ''}${escapeHtml(stripFormat(r.question || ''))}</td>
          <td>${!r.completed ? '<span class="pill warn">Unfinished</span>' : r.firstTryCorrect ? '<span class="pill good">Right first try</span>'
            : `<span class="pill warn">Missed</span><div class="small muted">First picked: ${escapeHtml(r.attempts[0] || '')}</div>`}
            <div><button type="button" class="linkish small">See answers ›</button></div></td></tr>`).join('')
          || '<tr><td colspan="4" class="muted">No one matches.</td></tr>';
      };
      draw();
      $('tr-filter').onclick = e => { const b = e.target.closest('[data-trf]'); if (!b) return; fil = opts.fil = b.dataset.trf; $('tr-filter').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); draw(); };
      $('vw-body').querySelectorAll('[data-tr-q]').forEach(b => b.onclick = () => {
        const i = Number(b.dataset.trQ); qi = opts.q = qi === i ? null : i;
        $('vw-body').querySelectorAll('[data-tr-q]').forEach(x => x.classList.toggle('on', Number(x.dataset.trQ) === qi)); draw();
        $('tr-filter').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      $('tr-rows').onclick = e => { if (e.target.closest('[data-person]')) return; const tr = e.target.closest('[data-resp]'); if (tr) showResponse(tr.dataset.resp); };
    } catch (err) { $('vw-body').innerHTML = `<p class="err">${escapeHtml(err.message)}</p>`; }
  }
  // opts: { note (html shown at the top), actions: [[label, fn], ...] for extra buttons at the bottom }
  function showDetails(t, opts = {}) {
    if (!t) return;
    vwPush(() => showDetails(t, opts));
    vwTopicTitle(t);
    // Every topic view can open the topic's results and the editor.
    const acts = (opts.actions || []).slice();
    if (!acts.some(([l]) => l.includes('Results'))) acts.push(['📊 Results', () => showTopicResults(t)]);
    if (!acts.some(([l]) => l.includes('Edit'))) acts.push(['✏️ Edit', () => { $('viewer').close(); openEditor(t); }]);
    opts = Object.assign({}, opts, { actions: acts });
    $('vw-actions').innerHTML = (opts.actions || []).map(([label], i) => `<button class="btn ghost" data-vw-act="${i}">${escapeHtml(label)}</button>`).join('');
    $('vw-actions').onclick = e => { const x = e.target.closest('[data-vw-act]'); if (x) opts.actions[x.dataset.vwAct][1](); };
    $('vw-body').innerHTML = `${opts.note ? `<div class="vw-note">${opts.note}</div>` : ''}<div class="muted small" style="margin-top:12px">For: ${whoLabel(t.departments)}</div>
      <div class="lesson-preview" style="margin-top:8px">${formatLesson(t.lesson) || '<span class="muted">No lesson yet.</span>'}</div>
      ${t.questions.map((q, n) => `
        <h3 style="margin-top:18px">Question ${n + 1}${q.type === 'multi' ? ' <span class="pill brand">Select all that apply</span>' : ''}${(q.departments || []).length ? ` <span class="pill" title="Only these departments get this question">Only ${escapeHtml(q.departments.join(', '))}</span>` : ''}: ${formatInline(q.text)}</h3>
        <ul>${q.correctAnswers.map(a => `<li>${escapeHtml(a)} <span class="pill good">Correct</span></li>`).join('')}${q.wrongAnswers.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul>
        ${q.hint ? `<div class="muted small"><strong>Hint after a wrong answer:</strong> ${escapeHtml(q.hint)}</div>` : ''}
        ${q.explanation ? `<div class="muted small"><strong>Explanation:</strong> ${escapeHtml(q.explanation)}</div>` : ''}`).join('')}
      ${t.es && t.es.lesson ? `<details class="es" style="margin-top:16px"><summary>Spanish version</summary>
        <h3 style="margin-top:10px">${escapeHtml(t.es.title || t.title)}</h3><div class="lesson-preview">${formatLesson(t.es.lesson)}</div>
        ${t.questions.filter(q => q.es).map(q => `<h3 style="margin-top:14px">${escapeHtml(q.es.text)}</h3>
          <ul>${q.es.correctAnswers.map(a => `<li>${escapeHtml(a)} <span class="pill good">Correcta</span></li>`).join('')}${q.es.wrongAnswers.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul>`).join('')}
        ${t.questions.some(q => !q.es) ? `<div class="muted small">${t.questions.filter(q => !q.es).length} question(s) have no Spanish yet and show in English only.</div>` : ''}</details>` : ''}
      <div class="muted small" style="margin-top:14px">Each person gets one question per visit, with the answers in a random order.</div>`;
    openViewer();
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
      <details class="q-only"${(q.departments || []).length ? ' open' : ''}><summary class="small">Only for certain departments <span class="q-only-sum muted"></span></summary>
        <div class="muted small" style="margin:4px 0 6px">Tick departments and only they get this question. Leave all unticked and everyone the topic is for can get it.</div>
        <div class="checks q-depts"></div>
      </details>
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
    renderChecks(card.querySelector('.q-depts'), q.departments || []);
    const syncOnly = () => { const d = checked(card.querySelector('.q-depts')); card.querySelector('.q-only-sum').textContent = d.length ? `· ${d.join(', ')}` : ''; card.classList.toggle('q-limited', d.length > 0); };
    card.querySelector('.q-depts').addEventListener('change', syncOnly); syncOnly();
    const syncLabel = () => { card.querySelector('.q-correct-label').innerHTML = card.querySelector('.q-multi').checked ? 'Correct answers <span class="hint">one per line</span>' : 'Correct answer'; };
    card.querySelector('.q-multi').addEventListener('change', syncLabel);
    syncLabel();
    card.querySelector('.q-remove').onclick = () => { if ($('f-questions').children.length > 1) { card.remove(); numberQuestions(); } };
    $('f-questions').appendChild(card);
    numberQuestions();
    const pref = esPref(); if (pref !== null) card.querySelector('details.es').open = pref === '1';
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
    showSaveProblem(t && t.problems ? t.problems : []);
    applyEsPref();
    updateLessonPreview();
    $('editor').showModal();
    $('f-title').focus();
  }
  function updateImagePreview() {
    const v = $('f-image').value.trim();
    $('f-image-preview').style.display = v ? 'block' : 'none';
    if (v) $('f-image-preview').src = v;
  }
  $('f-image').addEventListener('input', () => { const g = gifUrl($('f-image').value); if (g !== $('f-image').value.trim()) $('f-image').value = g; updateImagePreview(); });
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
  // The orange "can't save" banner in the footer. Each "Question N" problem links to that question and flags its card.
  function showSaveProblem(problems, jump = false) {
    const box = $('f-error');
    const list = (Array.isArray(problems) ? problems : String(problems || '').split(/(?<=\.)\s+(?=[A-Z])/)).map(x => x.trim()).filter(Boolean);
    document.querySelectorAll('#f-questions .qcard.flag').forEach(c => c.classList.remove('flag'));
    box.hidden = !list.length;
    if (!list.length) return;
    const cards = [...$('f-questions').children];
    const item = p => { const m = p.match(/^Question (\d+)/); const card = m && cards[Number(m[1]) - 1]; if (card) card.classList.add('flag');
      return `<li>${card ? `<a href="#" data-flag-q="${Number(m[1]) - 1}">${escapeHtml(p)}</a>` : escapeHtml(p)}</li>`; };
    box.innerHTML = `<b>⚠️ Not saved yet. Please fix:</b><ul>${list.map(item).join('')}</ul>`;
    const first = box.querySelector('[data-flag-q]');
    const go = i => { const c = cards[i]; if (!c) return; c.scrollIntoView({ behavior: 'smooth', block: 'center' }); const f = c.querySelector('textarea, input[type=text]'); if (f) f.focus({ preventScroll: true }); };
    box.querySelectorAll('[data-flag-q]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); go(Number(a.dataset.flagQ)); }));
    if (!jump) return;
    if (first) go(Number(first.dataset.flagQ));
    else $('f-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  // Show or hide every Spanish section at once; the choice is remembered on this computer.
  const esPref = () => { try { return localStorage.getItem('esShow'); } catch { return null; } };
  function applyEsPref() {
    const pref = esPref();
    const open = pref === null ? null : pref === '1';
    if (open !== null) document.querySelectorAll('#editor details.es').forEach(d => { d.open = open; });
    const anyOpen = [...document.querySelectorAll('#editor details.es')].some(d => d.open);
    $('f-es-toggle').textContent = anyOpen ? '🇪🇸 Hide Spanish' : '🇪🇸 Show Spanish';
  }
  $('f-es-toggle').addEventListener('click', () => {
    const anyOpen = [...document.querySelectorAll('#editor details.es')].some(d => d.open);
    try { localStorage.setItem('esShow', anyOpen ? '0' : '1'); } catch { /* private window */ }
    applyEsPref();
  });
  $('f-questions').addEventListener('toggle', e => { if (e.target.matches('details.es')) applyEsPref0(); }, true);
  function applyEsPref0() { const anyOpen = [...document.querySelectorAll('#editor details.es')].some(d => d.open); $('f-es-toggle').textContent = anyOpen ? '🇪🇸 Hide Spanish' : '🇪🇸 Show Spanish'; }
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
EXPLANATION: one short sentence on why the answer is right
ONLY FOR: (optional) department names, comma separated, if only they should get this question` + (es ? `
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
    const LABEL = /(?<!SPANISH)\s+(?=(?:\*\*)?(?:SPANISH\s+)?(?:TITLE|LESSON|QUESTION|TYPE|CORRECT|WRONG|HINT|EXPLANATION|ONLY\s+FOR)(?:\s+ANSWERS?)?\s*\d*\s*(?:\*\*)?\s*:)/g;
    let body = String(text).replace(/\r/g, '').replace(/```\w*/g, '').replace(LABEL, '\n');
    // Inside a squashed lesson, " - " or " • " starts a bullet.
    body = body.replace(/((?:^|\n)(?:SPANISH\s+)?LESSON\s*:[^\n]*)/gi, m => m.replace(/\s+[-•*]\s+(?=\S)/g, '\n- '));
    // "WRONG: a | b" or a list under the label both work; a bullet under CORRECT/WRONG becomes its own line of that kind.
    let lastKey = null;
    body = body.split('\n').map(line => {
      const k = line.match(/^[\s*_]*(?:SPANISH\s+)?(CORRECT|WRONG)\b/i);
      if (k) { lastKey = line.match(/^[\s*_]*((?:SPANISH\s+)?(?:CORRECT|WRONG))/i)[1].toUpperCase(); return line; }
      if (/^[\s*_]*(?:SPANISH\s+)?(TITLE|LESSON|QUESTION|TYPE|HINT|EXPLANATION|ONLY\s+FOR)\b/i.test(line)) lastKey = null;
      const b = lastKey && line.match(/^\s*(?:[-•*]|[a-d][.)])\s+(.+)$/i);
      return b ? `${lastKey}: ${b[1]}` : line;
    }).join('\n');
    for (const raw of body.split('\n')) {
      const clean = raw.replace(/^[\s>#*_`]*(\d+[.)]\s*)?[*_`]*/, '').replace(/^[-•]\s+(?=[A-Za-z ]+:)/, '');
      const m = clean.match(/^(spanish\s+)?(title|lesson|question|type|correct(?:\s+answers?)?|wrong(?:\s+answers?)?|hint|explanation|only\s+for|departments?)\s*\d*\s*[*_]*\s*:\s*[*_]*\s*(.*)$/i);
      if (m) {
        const sp = !!m[1], key = m[2].toLowerCase().split(/\s/)[0], val = m[3].replace(/[*_]+$/, '').replace(/\s+\d+[.)]$/, '').trim();
        if (key === 'question' && !sp) { q = { text: val, type: 'single', correctAnswers: [], wrongAnswers: [], hint: '', explanation: '', departments: [], es: { text: '', correctAnswers: [], wrongAnswers: [], hint: '', explanation: '' } }; out.questions.push(q); into = null; continue; }
        if (key === 'title') { (sp ? out.es : out).title = val; into = null; continue; }
        if (key === 'lesson') { into = sp ? out.es.lesson : out.lesson; if (val) into.push(val); continue; }
        into = null;
        if (!q) continue;
        const tgt = sp ? q.es : q;
        if (key === 'type') { if (/all/i.test(val)) q.type = 'multi'; }
        else if (key === 'only' || key === 'department' || key === 'departments') { if (!sp) q.departments = val.split(/\s*[,;|]\s*/).map(d => depts().find(x => sameDept(x, d)) || '').filter(Boolean); }
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
    toast(`Filled in by AI: ${r.questions.length} question${r.questions.length === 1 ? '' : 's'}. Check it over, then Save.`);
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
        departments: checked(c.querySelector('.q-depts')),
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
    } catch (err) { showSaveProblem(err.message, true); }
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

  // ---------- Spanish versions ----------
  function spanishStatus() {
    const ts = state.topics.filter(t => t.status !== 'retired');
    const full = ts.filter(t => t.es && t.es.lesson && t.questions.every(q => q.es)).length;
    const some = ts.filter(t => t.es && t.es.lesson).length - full;
    const pct = ts.length ? Math.round(full / ts.length * 100) : 0;
    $('es-status').innerHTML = `<div style="display:flex;justify-content:space-between;font-weight:650"><span>${full} of ${ts.length} topics fully in Spanish</span><span>${pct}%</span></div>
      <div style="height:8px;background:var(--bg);border-radius:8px;margin-top:6px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--good);border-radius:8px"></div></div>
      ${some ? `<div class="muted small" style="margin-top:6px">${some} more have a Spanish lesson but some questions are still English only.</div>` : ''}`;
  }
  $('spanish-btn').addEventListener('click', () => {
    $('es-file').value = ''; $('es-result').innerHTML = ''; $('es-error').textContent = '';
    spanishStatus(); $('spanish-dlg').showModal();
  });
  $('es-file').addEventListener('change', async e => {
    const file = e.target.files[0]; $('es-result').innerHTML = ''; $('es-error').textContent = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const r = await post('/api/admin/topics/spanish', { topics: data.topics || data });
      await refresh(); spanishStatus();
      $('es-result').innerHTML = `<div class="pill good" style="margin-top:6px">✓ Spanish added to ${r.topics} topic${r.topics === 1 ? '' : 's'} and ${r.questions} question${r.questions === 1 ? '' : 's'}</div>`
        + (r.problems.length ? `<div class="muted" style="margin-top:8px">Skipped:</div><ul style="margin:4px 0 0 18px">${r.problems.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : '');
    } catch (err) { $('es-error').textContent = err instanceof SyntaxError ? "That file isn't the translation file. Use the .json file you downloaded here." : err.message; }
  });

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
    // "Hasn't done an in-service": the last finished one is before the start of the chosen period (or there is none).
    const nd = $('staff-notdone').value, since = notDoneSince(nd);
    // "did-" choices are the opposite: their last finished in-service is on or after the start of the period.
    const notDoneFor = (e, k, s) => k.startsWith('did-') ? !!staffLastDone[e.id] && staffLastDone[e.id] >= s : !staffLastDone[e.id] || (k !== 'ever' && staffLastDone[e.id] < s);
    const notDone = e => staffLastDone && notDoneFor(e, nd, since);
    const no = $('staff-notdone').options;
    ['', 'today', 'week', 'd30', 'ever', 'did-today', 'did-week', 'did-d30'].forEach((k, i) => { if (!i) return; const s = notDoneSince(k); no[i].textContent = no[i].textContent.replace(/ \(\d+\)$/, '') + (staffLastDone ? ` (${inSet.filter(e => notDoneFor(e, k, s)).length})` : ''); });
    const rows = inSet
      .filter(e => !miss || (miss === 'birthday' ? !e.birthday : !e.hireDate))
      .filter(e => !nd || notDone(e))
      .filter(e => !q || [e.name, e.last4, e.department].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    staffShown = rows.map(e => e.id);
    $('staff-rows').innerHTML = rows.map(e => `<tr class="${e.active ? '' : 'dim'}">
      <td><input type="checkbox" data-pick="${e.id}"${staffPicked.has(e.id) ? ' checked' : ''}></td>
      <td><strong>${personLink(e.id, e.name)}</strong>${e.active ? '' : ' <span class="pill">Inactive</span>'}${e.birthday ? `<div class="muted small">🎂 ${e.birthday.split('-').map(Number).join('/')}</div>` : ''}</td>
      <td>${escapeHtml(e.last4)}</td><td>${escapeHtml(e.department)}${e.jobTitle && e.jobTitle !== e.department ? `<div class="muted small">${escapeHtml(e.jobTitle)}</div>` : ''}</td>
      <td data-last="${e.id}" class="small muted">…</td>
      <td data-rated="${e.id}" class="small" style="white-space:nowrap"></td>
      <td data-pending="${e.id}"></td>
      <td style="white-space:nowrap"><button class="btn subtle" data-edit-staff="${e.id}">Edit</button><button class="btn subtle" data-record="${e.id}">Training record</button></td></tr>`).join('')
      || `<tr><td colspan="8" class="muted">${state.employees.length ? (nd && !nd.startsWith('did-') ? 'Everyone here has done one. 🎉' : 'No one matches these filters.') : 'No staff yet. Add them one at a time or import your roster from a spreadsheet.'}</td></tr>`;
    fillStaffActivity();
    renderBulk();
    const sel = $('st-dept');
    sel.innerHTML = '<option value="">No department</option>' + depts().map(d => `<option>${escapeHtml(d)}</option>`).join('');
  }
  let staffLastDone = null;   // employee id -> date of their last finished in-service
  function notDoneSince(k) {
    const t = state.todayDate;
    k = k.replace(/^did-/, '');
    if (k === 'today') return t;
    if (k === 'week') { const d = new Date(t + 'T12:00:00'); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return isoDay(d); }
    if (k === 'd30') { const d = new Date(t + 'T12:00:00'); d.setDate(d.getDate() - 29); return isoDay(d); }
    return '';
  }
  async function fillStaffActivity() {
    try {
      const { responses } = await api('/api/admin/responses');
      const last = {}, doneReq = {}, rated = {};
      const firstLoad = !staffLastDone;
      staffLastDone = {};
      for (const r of responses) if (r.employeeId && r.completed && !(staffLastDone[r.employeeId] >= r.date)) staffLastDone[r.employeeId] = r.date;
      if (firstLoad) return renderStaff();
      for (const r of responses) {
        if (!r.employeeId) continue;
        if (!(last[r.employeeId] >= r.submittedAt)) last[r.employeeId] = r.submittedAt;
        if ('helpful' in r) { const x = rated[r.employeeId] || (rated[r.employeeId] = { up: 0, down: 0 }); x[r.helpful ? 'up' : 'down'] += 1; }
        if (r.requiredId && r.completed) (doneReq[r.employeeId] = doneReq[r.employeeId] || new Set()).add(r.requiredId);
      }
      for (const e of state.employees) {
        const c = document.querySelector(`[data-last="${e.id}"]`);
        if (c) c.innerHTML = last[e.id] ? `<a href="#" data-person="${e.id}" title="See their in-services">${fmtWhen(last[e.id])}</a>` : 'Never';
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
  $('staff-bulk-off').addEventListener('click', async () => { if (await confirm(`Mark ${staffPicked.size} staff inactive? They won't be able to sign in on the iPad.`, 'Mark inactive')) bulk({ active: false }, 'Marked inactive'); });
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
  // Departments with staff (or on the iPad list) that have no leader, or a leader with no email.
  function leaderGaps() {
    const L = (state.settings && state.settings.leaders) || {};
    const leaderOf = d => { const k = Object.keys(L).find(x => sameDept(x, d)); return k ? L[k] : ''; };
    const staffDepts = state.employees.filter(e => e.active && e.department).map(e => e.department);
    const all = [];
    for (const d of [...depts(), ...staffDepts]) if (!all.some(x => sameDept(x, d))) all.push(d);
    const noLeader = [], noEmail = [];
    for (const d of all) {
      const l = leaderOf(d);
      if (!l) noLeader.push(d);
      else if (!/[^\s<>,;:"'()]+@[^\s<>,;:"'()]+\.[a-z]{2,}/i.test(l)) noEmail.push(d);
    }
    return { noLeader, noEmail };
  }
  function leaderGapHtml(link) {
    const g = leaderGaps();
    if (!g.noLeader.length && !g.noEmail.length) return '';
    const go = link ? ' <a href="#" data-go="leaders">Fix it →</a>' : '';
    const chip = d => { const n = state.employees.filter(e => e.active && sameDept(e.department, d)).length;
      return `<a href="#" class="gap-dept" data-gap-dept="${escapeHtml(d)}">${escapeHtml(d)} <span class="muted">(${n})</span></a>`; };
    return [g.noLeader.length ? `<b>No leader:</b> ${g.noLeader.map(chip).join(', ')}` : '',
      g.noEmail.length ? `<b>Leader has no email:</b> ${g.noEmail.map(chip).join(', ')}` : ''].filter(Boolean).join('<br>') + go;
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
  $('staff-notdone').addEventListener('change', renderStaff);
  function openStaff(e) {
    editingStaffId = e ? e.id : null;
    $('staff-heading').textContent = e ? 'Edit staff' : 'Add staff';
    $('st-name').value = e ? e.name : '';
    $('st-last4').value = e ? e.last4 : '';
    $('st-dept').value = e ? e.department : '';
    $('st-active').checked = e ? e.active : true;
    $('st-noreview').checked = !!(e && e.noReview); $('st-noboard').checked = !!(e && e.noBoard);
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
  // The pop-up viewer keeps a trail: opening something from inside it (a person from a topic, an answer from a person)
  // shows "← Back" to return to what you were looking at.
  // Each view passes a way to show itself again; Back re-opens the one before.
  const vwTrail = [];
  let vwCurrent = null, vwBacking = false;
  function vwPush(redo) {
    if (!vwBacking && $('viewer').open && vwCurrent) vwTrail.push(vwCurrent);
    vwCurrent = redo || null;
    $('vw-back').hidden = !vwTrail.length;
  }
  function openViewer() { if (!$('viewer').open) $('viewer').showModal(); }
  $('vw-back').addEventListener('click', () => {
    const f = vwTrail.pop();
    if (!f) return;
    vwBacking = true;
    try { f(); } finally { vwBacking = false; }
  });
  // One rule for names: a person's name opens that person, a topic's name opens that topic.
  const personLink = (id, name) => state.employees.some(e => e.id === id) ? `<button class="linkish" data-person="${escapeHtml(id)}">${escapeHtml(name)}</button>` : escapeHtml(name);
  const topicLink = (id, title) => topicById(id) ? `<button class="linkish" data-topic="${escapeHtml(id)}">${escapeHtml(title)}</button>` : escapeHtml(title);
  document.addEventListener('click', e => {
    const p = e.target.closest('[data-person], [data-up-staff]');
    if (p) { e.preventDefault(); return showPerson(state.employees.find(x => x.id === (p.dataset.person || p.dataset.upStaff))); }
    const t = e.target.closest('[data-topic]');
    if (t) { e.preventDefault(); showTopicResults(topicById(t.dataset.topic)); }
  });
  $('viewer').addEventListener('close', () => { $('vw-actions').innerHTML = ''; $('vw-title').textContent = ''; vwTrail.length = 0; vwCurrent = null; $('vw-back').hidden = true; });
  // Who has seen a pop-up announcement (they tapped Got it), who came in and didn't, and who hasn't been in yet.
  async function showSeen(a) {
    if (!a) return;
    vwPush(() => showSeen(a));
    $('vw-title').textContent = a.title || 'Pop-up announcement';
    $('vw-actions').innerHTML = `<a class="btn ghost" href="/api/admin/announcements/${encodeURIComponent(a.id)}/seen.csv" title="One row per person with their answer, for Excel">⬇ Download spreadsheet</a>`;
    $('vw-body').innerHTML = '<p class="muted">Loading…</p>';
    openViewer();
    try {
      const { seen, missed, notIn, buttons, repeat = [] } = await api(`/api/admin/announcements/${a.id}/seen`);
      const list = (rows, when) => rows.length ? `<ul class="pv-list">${rows.map(p => `<li>${personLink(p.id, p.name)} <span class="muted small">${escapeHtml(p.department || '')}${when(p) ? ' · ' + when(p) : ''}</span></li>`).join('')}</ul>` : '';
      // Tapping an answer bar filters the list below to just those people; tapping a count tile shows just that group.
      // "Clear filter" / "Show all" brings everything back.
      const draw = (choice = '', view = '') => {
        const shown = choice ? seen.filter(p => p.choice === choice) : seen;
        const tile = (key, n, label) => `<div class="${view === key ? 'on' : ''}" data-view="${key}" role="button" tabindex="0" title="Tap to see who"><b>${n}</b><span>${label}</span></div>`;
        const only = view && view !== 'seen';
        $('vw-body').innerHTML = `<div class="muted small" style="margin-top:6px">Showing ${fmtDate(a.startDate)} – ${a.endDate ? fmtDate(a.endDate) : 'until removed'} · ${a.departments.length ? escapeHtml(a.departments.join(', ')) : 'All staff'}. "Seen" means they tapped ${buttons.length ? 'a button' : 'Got it'} on the iPad.</div>
        <div class="pv-stats">${tile('seen', seen.length, buttons.length ? 'answered' : 'saw it')}${tile('missed', missed.length, "came in but didn't see it")}${tile('notIn', notIn.length, "haven't been in since it started")}</div>
        ${only ? '' : buttons.length ? `<h3 style="margin-top:16px">Answers <span class="muted small" style="font-weight:400">· tap one to filter</span></h3><div class="pick-bars">${buttons.map(b => { const n = seen.filter(p => p.choice === b).length;
          return `<button type="button" class="${choice === b ? 'on' : ''}" data-choice="${escapeHtml(b)}" title="Show only the people who picked ${escapeHtml(b)}"><span>${escapeHtml(b)}</span><i style="width:${seen.length ? Math.round(100 * n / seen.length) : 0}%"></i><b>${n}</b></button>`; }).join('')}</div>` : ''}
        ${only ? '' : `<h3 style="margin-top:16px">${choice ? `${escapeHtml(choice)} (${shown.length})` : `✅ ${buttons.length ? 'Answered' : 'Saw it'} (${seen.length})`}${choice ? ' <button type="button" class="btn subtle" data-choice="" style="margin-left:8px">✕ Clear filter</button>' : ''}</h3>${list(shown, p => (p.choice ? `<b>${escapeHtml(p.choice)}</b> ${repeat.includes(p.choice) ? '<span class="pill" title="They see the pop-up again next clock-in">↻ asks again</span> ' : ''}` : 'tapped Got it ') + fmtWhen(p.at)) || '<p class="muted">No one yet.</p>'}`}
        ${!choice && (view === 'missed' || (!view && missed.length)) ? `<h3 style="margin-top:16px">⚠️ Came in but didn't see it (${missed.length})${only ? ' <button type="button" class="btn subtle" data-view="" style="margin-left:8px">✕ Show all</button>' : ''}</h3><div class="muted small">They did an in-service after it was added but never tapped Got it. They may have walked away, or the iPad lost its connection right then.</div>${list(missed, p => 'last in ' + fmtWhen(p.lastIn)) || '<p class="muted">No one.</p>'}` : ''}
        ${!choice && view === 'notIn' ? `<h3 style="margin-top:16px">Haven't been in since it started (${notIn.length}) <button type="button" class="btn subtle" data-view="" style="margin-left:8px">✕ Show all</button></h3><div class="muted small">No in-service on the iPad since the pop-up was added, so they haven't had the chance to see it.</div>${list(notIn, () => '') || '<p class="muted">No one.</p>'}` : ''}
        ${!choice && !view && notIn.length ? `<details style="margin-top:16px"><summary><b>Haven't been in since it started (${notIn.length})</b></summary>${list(notIn, () => '')}</details>` : ''}`;
        $('vw-body').querySelectorAll('[data-choice]').forEach(b => b.addEventListener('click', () => draw(b.dataset.choice === choice ? '' : b.dataset.choice)));
        $('vw-body').querySelectorAll('[data-view]').forEach(b => { const go = () => draw('', b.dataset.view === view ? '' : b.dataset.view); b.addEventListener('click', go); b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }); });
      };
      draw();
    } catch (err) { $('vw-body').innerHTML = `<p class="err">${escapeHtml(err.message)}</p>`; }
  }
  // A person at a glance: their numbers, recent answers, reviews and ratings, with Edit and Training record.
  async function showPerson(emp) {
    if (!emp) return;
    vwPush(() => showPerson(emp));
    $('vw-title').textContent = emp.name;
    $('vw-actions').innerHTML = '<button class="btn ghost" data-pv="edit">✏️ Edit</button><button class="btn ghost" data-pv="record">🖨 Training record</button><button class="btn ghost" data-pv="all">All their answers</button>';
    $('vw-actions').onclick = e => {
      const b = e.target.closest('[data-pv]'); if (!b) return;
      if (b.dataset.pv === 'record') return printRecord(emp);
      $('viewer').close();
      if (b.dataset.pv === 'edit') { goTab('staff'); openStaff(emp); }
      if (b.dataset.pv === 'all') openResponses({ person: emp });
    };
    $('vw-body').innerHTML = '<p class="muted">Loading…</p>';
    openViewer();
    try {
      const [{ responses }, { reviews }] = await Promise.all([api('/api/admin/responses?employeeId=' + encodeURIComponent(emp.id)), api('/api/admin/reviews').catch(() => ({ reviews: [] }))]);
      const done = responses.filter(r => r.completed), year = state.todayDate.slice(0, 4);
      const yr = done.filter(r => r.date.startsWith(year));
      const first = yr.filter(r => r.firstTryCorrect).length;
      const streak = (state.streakTop || []).find(l => l.id === emp.id);
      const mine = reviews.filter(r => r.employeeId === emp.id);
      const rated = responses.filter(r => typeof r.helpful === 'boolean');
      const up = rated.filter(r => r.helpful).length;
      const res = r => !r.completed ? '<span class="pill warn">Unfinished</span>' : r.firstTryCorrect ? '<span class="pill good">Right first try</span>' : `<span class="pill warn">Right on try ${r.attempts.length}</span>`;
      $('vw-body').innerHTML = `
        <div class="muted" style="margin-top:6px">${escapeHtml([emp.department, 'Workday …' + emp.last4, emp.hireDate && 'hired ' + fmtDate(emp.hireDate)].filter(Boolean).join(' · '))}${emp.active ? '' : ' <span class="pill">Inactive</span>'}</div>
        <div class="pv-stats">
          <div><b>${yr.length}</b><span>in-services in ${year}</span></div>
          <div><b>${yr.length ? Math.round(100 * first / yr.length) + '%' : '–'}</b><span>right first try</span></div>
          <div><b>${streak ? '🔥 ' + streak.streak : '–'}</b><span>${streak ? 'days in a row' : 'no streak yet'}</span></div>
          <div><b>${rated.length ? `👍 ${up} · 👎 ${rated.length - up}` : '–'}</b><span>lesson ratings</span></div>
        </div>
        ${mine.length ? `<h3 style="margin-top:16px">Coming back for review</h3><ul class="pv-list">${mine.map(r => `<li>${topicLink(r.topicId, r.title)} <span class="muted small">due ${fmtDate(r.due)}</span></li>`).join('')}</ul>` : ''}
        <h3 style="margin-top:16px">Recent answers</h3>
        ${responses.length ? `<ul class="pv-list">${responses.slice().sort((x, y) => String(y.submittedAt).localeCompare(String(x.submittedAt))).slice(0, 10).map(r => `<li><span class="pv-date">${fmtDate(r.date)}</span>${topicLink(r.topicId, r.topicTitle)} ${res(r)}${r.helpful === true ? ' 👍' : r.helpful === false ? ' 👎' : ''}<div class="muted small">${escapeHtml(stripFormat(r.question || ''))}</div></li>`).join('')}</ul>`
          : '<p class="muted">No in-services yet.</p>'}`;
    } catch (err) { $('vw-body').innerHTML = `<p class="err">${escapeHtml(err.message)}</p>`; }
  }
  // Pages opened in their own window (printouts, previews) get a "← Back" button. On the iPhone home-screen app
  // a new window has no back button of its own, so if closing doesn't work it goes back to the admin page.
  const backBtn = style => `<button onclick="try{window.close()}catch(e){}setTimeout(function(){location.href='${location.origin}/admin'},300)" style="${style}">← Back</button>`;
  // A printable training record for one person, for their HR file.
  async function printRecord(emp) {
    const win = window.open('', '_blank');
    if (!win) return alert('Your browser blocked the new window. Allow pop-ups for this site and try again.');
    win.document.write('<p style="font-family:sans-serif">Loading…</p>');
    try {
      const [{ responses }, { topics }] = await Promise.all([api('/api/admin/responses?employeeId=' + encodeURIComponent(emp.id)), api('/api/admin/annual')]);
      const done = responses.filter(r => r.completed);
      const year = state.todayDate.slice(0, 4);
      // Pop quizzes are counted on their own; in-services are everything else.
      const thisYear = done.filter(r => r.date.startsWith(year) && r.kind !== 'quiz');
      const quizYear = done.filter(r => r.date.startsWith(year) && r.kind === 'quiz');
      const first = thisYear.filter(r => r.firstTryCorrect).length;
      const yearly = topics.map(t => ({ title: t.title, p: t.people.find(x => x.id === emp.id) })).filter(x => x.p);
      const words = { current: 'Up to date', soon: 'Due soon', overdue: 'Overdue', never: 'Not done yet' };
      const kinds = { required: 'Required', scheduled: 'Scheduled', rotation: 'Rotation', starter: 'New hire', annual: 'Yearly', review: 'Review', quiz: 'Pop quiz' };
      const pct = thisYear.length ? Math.round(100 * first / thisYear.length) : null;
      const behind = yearly.filter(x => ['overdue', 'never'].includes(x.p.status)).length;
      const tone = { current: 'ok', soon: 'soon', overdue: 'bad', never: 'bad' };
      win.document.open();
      win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(emp.name)} training record</title><style>
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { font: 13px/1.45 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1d2b36; margin: 0; background: #eef3f6; }
        .page { max-width: 8.5in; margin: 24px auto; background: #fff; padding: 36px 44px; border-radius: 14px; box-shadow: 0 6px 30px rgba(16,40,60,.12); }
        .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; border-bottom: 3px solid #1f6f8b; padding-bottom: 14px; }
        .top img { height: 42px; } .doc { text-align: right; color: #5b6b78; font-size: 12px; }
        .doc b { display: block; color: #1f6f8b; font-size: 17px; letter-spacing: .3px; }
        .who { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; margin: 18px 0; border: 1px solid #dbe3e9; border-radius: 10px; overflow: hidden; }
        .who div { padding: 9px 12px; border-right: 1px solid #dbe3e9; } .who div:last-child { border-right: 0; }
        .who small { display: block; color: #5b6b78; font-size: 10.5px; text-transform: uppercase; letter-spacing: .6px; }
        .who strong { font-size: 14px; }
        .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 8px; }
        .stat { background: #f3f8fa; border-radius: 10px; padding: 10px 12px; } .stat b { display: block; font-size: 22px; color: #1f6f8b; line-height: 1.1; }
        .stat span { color: #5b6b78; font-size: 11.5px; } .stat.bad b { color: #a4521b; } .stat.ok b { color: #1e7a4c; }
        h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .8px; color: #1f6f8b; margin: 22px 0 8px; }
        table { width: 100%; border-collapse: collapse; } th, td { padding: 7px 9px; text-align: left; vertical-align: top; border-bottom: 1px solid #e3e9ee; }
        th { background: #1f6f8b; color: #fff; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; font-weight: 600; }
        th:first-child { border-top-left-radius: 8px; } th:last-child { border-top-right-radius: 8px; }
        tbody tr:nth-child(even) td { background: #f7fafb; }
        .pill { display: inline-block; padding: 1px 9px; border-radius: 10px; font-size: 11.5px; font-weight: 600; border: 1px solid; }
        .pill.ok { color: #1e7a4c; background: #e3f4ea; border-color: #b8e0c8; } .pill.soon { color: #8a6100; background: #fff5d6; border-color: #f0dc9c; }
        .pill.bad { color: #a4521b; background: #fbeee2; border-color: #f0cfb4; } .pill.plain { color: #1f5f7a; background: #e4f0f5; border-color: #c4dde8; }
        .sign { display: grid; grid-template-columns: 2fr 1fr; gap: 30px; margin-top: 34px; } .sign div { border-top: 1px solid #1d2b36; padding-top: 4px; font-size: 11px; color: #5b6b78; }
        .foot { margin-top: 18px; color: #8796a1; font-size: 10.5px; display: flex; justify-content: space-between; }
        .noprint { max-width: 8.5in; margin: 18px auto 0; display: flex; justify-content: space-between; gap: 10px; }
        .noprint button { font: 600 14px -apple-system, "Segoe UI", Roboto, Arial, sans-serif; padding: 9px 18px; border: 0; border-radius: 10px; background: #1f6f8b; color: #fff; cursor: pointer; }
        @media print { body { background: #fff; } .noprint { display: none; } .page { margin: 0; padding: 0; box-shadow: none; border-radius: 0; max-width: none; }
          @page { margin: 0.5in; } tr, .stat, .sign { break-inside: avoid; } thead { display: table-header-group; } }
      </style></head><body>
        <div class="noprint">${backBtn('background:#fff;color:#1f6f8b;border:1px solid #1f6f8b')}<button onclick="print()">🖨 Print or save as PDF</button></div>
        <div class="page">
        <div class="top"><img src="${location.origin}/logo.png" alt="${escapeHtml(state.settings.facilityName || '')}"><div class="doc"><b>In-Service Training Record</b>${escapeHtml(state.settings.facilityName || '')}<br>As of ${fmtDate(state.todayDate)}</div></div>
        <div class="who"><div><small>Employee</small><strong>${escapeHtml(emp.name)}</strong></div><div><small>Department</small><strong>${escapeHtml(emp.department || '—')}</strong></div>
          <div><small>Workday ID (last 4)</small><strong>${escapeHtml(emp.last4)}</strong></div><div><small>Hire date</small><strong>${emp.hireDate ? fmtDate(emp.hireDate) : '—'}</strong></div></div>
        <div class="stats">
          <div class="stat"><b>${thisYear.length}</b><span>in-services completed in ${year}</span></div>
          <div class="stat"><b>${pct === null ? '—' : pct + '%'}</b><span>correct on the first try in ${year}</span></div>
          <div class="stat"><b>${quizYear.length}</b><span>pop quiz${quizYear.length === 1 ? '' : 'zes'} in ${year}${quizYear.length ? `, ${Math.round(100 * quizYear.filter(r => r.firstTryCorrect).length / quizYear.length)}% first try` : ''}</span></div>
          <div class="stat ${yearly.length ? (behind ? 'bad' : 'ok') : ''}"><b>${yearly.length ? (behind ? behind + ' due' : '✓ All') : '—'}</b><span>${yearly.length ? (behind ? 'yearly requirements outstanding' : 'yearly requirements current') : 'no yearly requirements'}</span></div>
        </div>
        ${yearly.length ? `<h2>Yearly requirements</h2><table><thead><tr><th>Topic</th><th>Status</th><th>Last completed</th><th>Next due</th></tr></thead><tbody>
          ${yearly.map(x => `<tr><td>${escapeHtml(x.title)}</td><td><span class="pill ${tone[x.p.status]}">${words[x.p.status]}</span></td><td>${x.p.last ? fmtDate(x.p.last) : '—'}</td><td>${x.p.due ? fmtDate(x.p.due) : 'Now'}</td></tr>`).join('')}</tbody></table>` : ''}
        <h2>Completed in-services</h2>
        <table><thead><tr><th style="width:25%">Completed</th><th>Topic</th><th style="width:13%">Type</th><th style="width:20%">Knowledge check</th></tr></thead><tbody>
        ${done.map(r => `<tr><td style="white-space:nowrap">${fmtWhen(r.completedAt)}</td><td>${escapeHtml(r.topicTitle)}${r.lang === 'es' ? ' <span class="pill plain">Español</span>' : ''}</td><td>${kinds[r.kind] || ''}</td>
          <td><span class="pill ${r.firstTryCorrect ? 'ok' : 'plain'}">${r.firstTryCorrect ? '✓ Correct first try' : `✓ Correct on try ${r.attempts.length}`}</span></td></tr>`).join('') || '<tr><td colspan="4">None yet.</td></tr>'}
        </tbody></table>
        <div class="sign"><div>Reviewed by (name and title)</div><div>Date</div></div>
        <div class="foot"><span>Each in-service ends with a knowledge check. Staff retry with a hint until correct.</span><span>Printed ${escapeHtml(new Date().toLocaleString())}</span></div>
        </div>
      </body></html>`);
      win.document.close();
    } catch (err) { win.close(); fail(err); }
  }
  $('staff-form').addEventListener('submit', async e => {
    e.preventDefault();
    const body = { name: $('st-name').value, last4: $('st-last4').value, department: $('st-dept').value, active: $('st-active').checked, noReview: $('st-noreview').checked, noBoard: $('st-noboard').checked,
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
    fillRespEmp();
  }
  // The staff search on Responses: type part of a name, Workday digits or a department and pick from the matches.
  // The box shows the chosen person's name; clearing it shows everyone again.
  const empInput = $('resp-emp'), empRes = $('resp-emp-results');
  function fillRespEmp() { empInput.value = respPerson ? respPerson.name : ''; }
  function empMatches(q) {
    const words = q.split(/\s+/).filter(Boolean);
    return state.employees.filter(e => { const hay = `${e.name} ${e.last4 || ''} ${e.department || ''} ${e.jobTitle || ''}`.toLowerCase(); return words.every(w => hay.includes(w)); })
      .sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name)).slice(0, 12);
  }
  function showEmpResults() {
    const q = empInput.value.trim().toLowerCase();
    if (!q || (respPerson && q === respPerson.name.toLowerCase())) { empRes.hidden = true; return; }
    const list = empMatches(q);
    empRes.innerHTML = list.map((e, i) => `<button type="button" data-emp="${escapeHtml(e.id)}"${i ? '' : ' class="on"'}>${escapeHtml(e.name)}<span class="muted small"> · ${escapeHtml(e.department || '')}${e.active ? '' : ' · inactive'}</span></button>`).join('')
      || '<div class="muted small" style="padding:9px 14px">No one matches.</div>';
    empRes.hidden = false;
  }
  function pickEmp(id) {
    respPerson = state.employees.find(x => x.id === id) || null;
    empRes.hidden = true; fillRespEmp(); empInput.blur();
    loadResponses(); syncClear();
  }
  empInput.addEventListener('input', showEmpResults);
  empInput.addEventListener('focus', showEmpResults);
  empInput.addEventListener('change', () => { if (!empInput.value.trim() && respPerson) { respPerson = null; loadResponses(); } });
  empInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { empRes.hidden = true; return; }
    const btns = [...empRes.querySelectorAll('[data-emp]')], cur = btns.findIndex(b => b.classList.contains('on'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = (cur + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length; btns.forEach((b, i) => b.classList.toggle('on', i === n)); }
    if (e.key === 'Enter') { e.preventDefault(); const b = btns[cur] || btns[0]; if (b) pickEmp(b.dataset.emp); }
  });
  // mousedown, so the pick lands before the box loses focus.
  empRes.addEventListener('mousedown', e => { const b = e.target.closest('[data-emp]'); if (b) { e.preventDefault(); pickEmp(b.dataset.emp); } });
  empInput.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== empInput) { empRes.hidden = true; fillRespEmp(); } }, 150));
  function respQuery() {
    const p = new URLSearchParams();
    if ($('resp-from').value) p.set('from', $('resp-from').value);
    if ($('resp-to').value) p.set('to', $('resp-to').value);
    if ($('resp-dept').value) p.set('department', $('resp-dept').value);
    if ($('resp-topic').value) p.set('topicId', $('resp-topic').value);
    if ($('resp-missed').checked) p.set('missed', '1');
    if ($('resp-helpful').value) p.set('helpful', $('resp-helpful').value);
    if ($('resp-kind').value) p.set('kind', $('resp-kind').value);
    if (respPerson) p.set('employeeId', respPerson.id);
    return p.toString();
  }
  const kindLabel = { required: '<span class="pill req">Required</span>', scheduled: '<span class="pill brand">Scheduled</span>', rotation: '<span class="pill">Rotation</span>',
    starter: '<span class="pill good">New hire</span>', annual: '<span class="pill req">Yearly</span>', review: '<span class="pill brand">Review</span>', quiz: '<span class="pill quiz">🧠 Quiz</span>' };
  async function loadResponses() {
    try {
      fillRespEmp();
      const { responses } = await api('/api/admin/responses?' + respQuery());
      const first = responses.filter(r => r.firstTryCorrect).length;
      const quizzes = responses.filter(r => r.kind === 'quiz').length;
      $('resp-summary').textContent = responses.length
        ? `${responses.length} response${responses.length === 1 ? '' : 's'}${quizzes && quizzes < responses.length ? ` (${responses.length - quizzes} in-services, ${quizzes} quiz${quizzes === 1 ? '' : 'zes'})` : ''}. ${Math.round(100 * first / responses.length)}% right on the first try.`
        : 'No responses for this selection.';
      respList = responses; respShown = 0;
      $('resp-rows').innerHTML = '';
      showMoreResponses();
      $('resp-csv').href = '/api/admin/responses.csv?' + respQuery();
    } catch (err) { fail(err); }
  }
  // Responses show 100 at a time, with "Show more" at the bottom.
  let respList = [], respShown = 0;
  function showMoreResponses() {
    const next = respList.slice(respShown, respShown + 100);
    respShown += next.length;
    $('resp-rows').insertAdjacentHTML('beforeend', next.map(r => {
        const result = !r.completed ? '<span class="pill warn">Did not finish</span>'
          : r.firstTryCorrect ? '<span class="pill good">Right first try</span>'
          : `<span class="pill warn">Missed, right on try ${r.attempts.length}</span>`;
        return `<tr class="click-row" data-resp="${r.id}" title="Click to see their answers">
        <td style="white-space:nowrap">${fmtWhen(r.submittedAt)}</td>
        <td>${r.employeeId && state.employees.some(e => e.id === r.employeeId) ? personLink(r.employeeId, r.name) : `<a href="#" class="row-link">${escapeHtml(r.name)}</a>`}${r.verified ? '' : ' <span class="pill" title="Typed their name; not on the roster">Not on roster</span>'}<div class="muted small">${escapeHtml(r.last4 || '')}</div></td>
        <td>${escapeHtml(r.department || '')}</td><td>${kindLabel[r.kind] || ''}${r.lang === 'es' ? ' <span class="pill">Español</span>' : ''}${r.offline ? ' <span class="pill" title="Answered while the iPad was offline, uploaded later">Saved offline</span>' : ''}</td>
        <td>${topicById(r.topicId) ? topicLink(r.topicId, r.topicTitle) : `<a href="#" class="row-link">${escapeHtml(r.topicTitle)}</a>`}<div class="muted small">${escapeHtml(stripFormat(r.question))}</div></td>
        <td>${escapeHtml(r.attempts[0] || '')}</td><td>${result}${r.helpful === true ? ' <span title="Said the lesson was helpful">👍</span>' : r.helpful === false ? ' <span title="Said the lesson was not helpful">👎</span>' : ''}</td>
        <td class="resp-open-cell" data-label=""><button type="button" class="btn ghost resp-open">See their answers ›</button></td></tr>`;
      }).join(''));
    const left = respList.length - respShown;
    $('resp-more').hidden = left <= 0;
    $('resp-more').textContent = `Show ${Math.min(100, left)} more (${left} left)`;
  }
  $('resp-more').addEventListener('click', showMoreResponses);
  ['resp-from', 'resp-to', 'resp-dept', 'resp-topic', 'resp-missed', 'resp-helpful', 'resp-kind'].forEach(id => $(id).addEventListener('change', loadResponses));
  $('resp-rows').addEventListener('click', e => {
    const tr = e.target.closest('[data-resp]');
    if (!tr || e.target.closest('[data-person], [data-topic]')) return; // names open the person, topics open the topic
    e.preventDefault();
    showResponse(tr.dataset.resp);
  });
  // Everything about one response: the person, the in-service, every choice and what they picked on each try.
  async function showResponse(id) {
    vwPush(() => showResponse(id));
    try {
      const d = await api('/api/admin/responses/' + encodeURIComponent(id));
      $('vw-actions').innerHTML = '';
      const r = d.response, q = d.question, h = d.history;
      const triedAt = a => r.attempts.findIndex(x => x.split('; ').map(s => s.toLowerCase()).includes(a.toLowerCase()));
      const ordinal = n => ['1st', '2nd', '3rd'][n] || `${n + 1}th`;
      const choice = (a, correct) => {
        const t = triedAt(a);
        const picked = t >= 0;
        const cls = correct ? 'good' : picked ? 'bad' : '';
        return `<li class="rd-choice ${cls}"><span class="rd-mark">${correct ? '✓' : picked ? '✗' : ''}</span><span>${escapeHtml(a)}</span>
          ${picked ? `<span class="pill ${correct ? 'good' : 'warn'}">Picked on ${ordinal(t)} try</span>` : ''}${correct && !picked ? '<span class="muted small">Correct answer</span>' : ''}</li>`;
      };
      const result = !r.completed ? '<span class="pill warn">Did not finish</span>'
        : r.firstTryCorrect ? '<span class="pill good">Right first try</span>' : `<span class="pill warn">Missed, right on try ${r.attempts.length}</span>`;
      const pct = h.total ? Math.round(100 * h.firstTry / h.total) : null;
      const f = d.followup;
      $('vw-title').textContent = `${r.name} · ${fmtWhen(r.submittedAt)}`;
      $('vw-body').innerHTML = `
        <div class="rd-grid">
          <section class="rd-box">
            <div class="rd-label">Person</div>
            <div class="rd-big">${r.employeeId ? personLink(r.employeeId, r.name) : escapeHtml(r.name)}</div>
            <div class="muted small">${escapeHtml([r.department, d.person && d.person.jobTitle, r.last4 && 'Workday …' + r.last4].filter(Boolean).join(' · '))}</div>
            ${r.verified ? '' : '<div style="margin-top:6px"><span class="pill warn">Typed their name. Not on the roster.</span></div>'}
            ${h.total ? `<div class="rd-stat"><b>${h.total}</b> in-services · <b>${pct}%</b> right first try</div>
              <ul class="rd-recent">${h.recent.map(x => `<li${x.id === r.id ? ' class="me"' : ''}>${topicById(x.topicId) ? `<a href="#" data-rd-topic="${x.topicId}" title="See this topic's results">${escapeHtml(x.topicTitle)}</a>` : escapeHtml(x.topicTitle)}${x.id === r.id ? `<span class="small"><b>${fmtDate(x.date)}</b> <span class="muted">(this one)</span></span>` : `<a href="#" class="small" data-rd-open="${x.id}" title="See this answer">${fmtDate(x.date)}</a>`}${!x.completed ? '<span class="pill warn">Unfinished</span>' : x.firstTryCorrect ? '<span title="Right first try">✅</span>' : '<span title="Missed first try">⚠️</span>'}</li>`).join('')}</ul>` : ''}
            <div class="rd-actions">${d.person ? `<button class="btn subtle" data-rd-person="${d.person.id}">All their responses</button><button class="btn subtle" data-rd-staff="${d.person.id}">Staff record</button>` : ''}</div>
          </section>
          <section class="rd-box">
            <div class="rd-label">In-service</div>
            <div class="rd-big">${d.topic ? `<button class="linkish" data-rd-topic="${d.topic.id}">${escapeHtml(r.topicTitle)}</button>` : escapeHtml(r.topicTitle)}</div>
            <div style="margin-top:4px">${kindLabel[r.kind] || ''} ${r.lang === 'es' ? '<span class="pill">Español</span>' : ''} ${result} ${r.helpful === true ? '<span title="Said the lesson was helpful">👍 Lesson helpful</span>' : r.helpful === false ? '<span title="Said the lesson was not helpful">👎 Lesson not helpful</span>' : ''}</div>
            ${f ? `<div style="margin-top:8px" class="small">${f.attestedAt ? `<span class="pill good">✓ Educated</span> by ${escapeHtml(f.attestedBy)}, ${fmtWhen(f.attestedAt)}` : `<span class="pill warn">Waiting on leader follow-up</span> ${escapeHtml(f.leader || '')}`}</div>` : ''}
            <div class="rd-actions">${d.topic ? `<button class="btn subtle" data-rd-topic="${d.topic.id}">📊 Topic results</button><button class="btn subtle" data-rd-key="${d.topic.id}">Answer key</button><button class="btn subtle" data-rd-preview="${d.topic.id}">Preview</button>` : '<span class="muted small">This topic has since been deleted.</span>'}</div>
          </section>
        </div>
        <h3 style="margin:18px 0 6px">${formatInline(r.question)}${q && q.type === 'multi' ? ' <span class="pill brand">Select all that apply</span>' : ''}</h3>
        ${q ? `<ul class="rd-choices">${q.correctAnswers.map(a => choice(a, true)).join('')}${q.wrongAnswers.map(a => choice(a, false)).join('')}</ul>
            ${q.changed ? '<div class="muted small">This question was edited after they answered it, so the choices above are today\'s version.</div>' : ''}`
          : `<div class="muted small">The question has since been changed or removed. Correct answer: ${escapeHtml(r.correctAnswer || '')}</div>`}
        <div class="rd-tries"><div class="rd-label">Their tries</div>${r.attempts.map((a, i) => `<div><b>${ordinal(i)}:</b> ${escapeHtml(a)} ${i === r.attempts.length - 1 && r.completed ? '<span class="pill good">Correct</span>' : '<span class="pill warn">Wrong</span>'}</div>`).join('') || '<span class="muted">No answer yet.</span>'}</div>
        ${q && q.hint && !r.firstTryCorrect ? `<div class="small" style="margin-top:10px"><b>Hint they were shown:</b> ${escapeHtml(q.hint)}</div>` : ''}
        ${q && q.explanation ? `<div class="small" style="margin-top:6px"><b>Explanation:</b> ${escapeHtml(q.explanation)}</div>` : ''}
        ${d.topic && d.topic.lesson ? `<details style="margin-top:14px"><summary>The lesson they read</summary><div class="lesson-preview" style="margin-top:8px">${formatLesson(d.topic.lesson)}</div></details>` : ''}
        <div style="margin-top:18px;padding-top:12px;border-top:1px solid var(--line);text-align:right"><button class="btn subtle danger" data-rd-delete="${r.id}" data-rd-who="${escapeHtml(r.name)}" data-rd-when="${escapeHtml(fmtWhen(r.submittedAt))}">🗑 Delete this response</button></div>`;
      openViewer();
      $('vw-body').scrollTop = 0;
    } catch (err) { fail(err); }
  }
  $('vw-body').addEventListener('click', async e => {
    const del = e.target.closest('[data-rd-delete]');
    if (del) {
      if (!await confirm(`Delete ${del.dataset.rdWho}'s response from ${del.dataset.rdWhen}?\n\nIt will no longer count on their training record, streaks, reports or the Clock-in check.`, 'Delete')) return;
      if (!await confirm('Are you sure? This can\'t be undone from the admin page.', 'Delete it')) return;
      try { await api('/api/admin/responses/' + encodeURIComponent(del.dataset.rdDelete), { method: 'DELETE' }); $('viewer').close(); toast('Response deleted'); loadResponses(); refresh(); }
      catch (err) { fail(err); }
      return;
    }
  });
  $('vw-body').addEventListener('click', e => {
    const b = e.target.closest('[data-rd-open],[data-rd-person],[data-rd-staff],[data-rd-topic],[data-rd-key],[data-rd-preview]');
    if (!b) return;
    e.preventDefault();
    const ds = b.dataset;
    if (ds.rdOpen) return showResponse(ds.rdOpen);
    if (ds.rdTopic) return showTopicResults(topicById(ds.rdTopic));
    if (ds.rdKey) return showDetails(topicById(ds.rdKey));
    if (ds.rdPreview) return showPreview(topicById(ds.rdPreview));
    $('viewer').close();
    if (ds.rdPerson) openResponses({ person: state.employees.find(x => x.id === ds.rdPerson) });
    if (ds.rdStaff) { goTab('staff'); openStaff(state.employees.find(x => x.id === ds.rdStaff)); }
  });
  $('resp-person').addEventListener('click', e => { if (e.target.id !== 'resp-person-x') return; e.preventDefault(); respPerson = null; loadResponses(); });

  // ----- Drag and drop for file uploads -----
  // Each upload box becomes a big drop area; clicking it still opens the file picker.
  function makeDrop(id, what) {
    const input = $(id);
    const zone = document.createElement('label');
    zone.className = 'drop-zone';
    zone.innerHTML = `<span class="dz-icon">📄</span><span class="dz-main">Drag ${what} here</span><span class="dz-sub">or click to choose a file</span><span class="dz-name"></span>`;
    input.before(zone); zone.appendChild(input);
    const show = () => { const f = input.files && input.files[0]; zone.querySelector('.dz-name').textContent = f ? '✓ ' + f.name : ''; zone.classList.toggle('has-file', !!f); };
    input.addEventListener('change', show);
    ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('over'); }));
    ['dragleave', 'dragend'].forEach(ev => zone.addEventListener(ev, e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('over'); }));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('over');
      if (!e.dataTransfer.files.length) return;
      const dt = new DataTransfer(); dt.items.add(e.dataTransfer.files[0]);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const dlg = zone.closest('dialog');
    if (dlg) new MutationObserver(() => { if (dlg.open) show(); }).observe(dlg, { attributes: true, attributeFilter: ['open'] });
  }
  [['cc-file', 'your time clock export'], ['imp-file', 'your staff spreadsheet'], ['ti-file', 'your topics spreadsheet'], ['es-file', 'the translated file'],
    ['lb-file', 'your leaders spreadsheet'], ['restore-file', 'a backup file']].forEach(([id, w]) => { if ($(id)) makeDrop(id, w); });
  // A file dropped anywhere else would make the browser open it and leave the admin page.
  ['dragover', 'drop'].forEach(ev => window.addEventListener(ev, e => { if (!e.target.closest || !e.target.closest('.drop-zone')) e.preventDefault(); }));

  // ----- Quick date ranges and "Clear filters" -----
  // A "When" picker sits before each From/To pair; picking Today, This week... fills both dates.
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function rangeFor(k) {
    const t = new Date(state.todayDate + 'T12:00:00'), y = t.getFullYear(), m = t.getMonth();
    const add = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    const wk = add(t, -((t.getDay() + 6) % 7));   // weeks start on Monday, like the calendar and the topic of the week
    return { today: [t, t], yesterday: [add(t, -1), add(t, -1)], week: [wk, t], lastweek: [add(wk, -7), add(wk, -1)],
      month: [new Date(y, m, 1), t], lastmonth: [new Date(y, m - 1, 1), new Date(y, m, 0)], d30: [add(t, -29), t], d90: [add(t, -89), t],
      year: [new Date(y, 0, 1), t], any: null }[k];
  }
  const RANGES = [['any', 'Any time'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'],
    ['lastmonth', 'Last month'], ['d30', 'Last 30 days'], ['d90', 'Last 90 days'], ['year', 'This year'], ['custom', 'Custom dates']];
  [['resp-from', 'resp-to'], ['rp-from', 'rp-to'], ['mm-from', 'mm-to']].forEach(([f, t]) => {
    const sel = document.createElement('select');
    sel.className = 'range-pick'; sel.title = 'Quick dates';
    sel.innerHTML = RANGES.map(([v, l]) => `<option value="${v}">📅 ${l}</option>`).join('');
    $(f).closest('label').before(sel);
    sel.addEventListener('change', () => {
      if (sel.value === 'custom') return $(f).focus();
      const r = rangeFor(sel.value);
      $(f).value = r ? iso(r[0]) : ''; $(t).value = r ? iso(r[1]) : '';
      $(f).dispatchEvent(new Event('input', { bubbles: true }));
      $(t).dispatchEvent(new Event('change', { bubbles: true }));
    });
    // Typing dates by hand shows which quick range they match, or "Custom dates".
    const match = () => {
      if (!$(f).value && !$(t).value) return void (sel.value = 'any');
      // Keep the current pick when it still fits (on a Monday, "This week" and "Today" are the same days).
      const hit = [RANGES.find(([k]) => k === sel.value), ...RANGES].find(x => { const r = x && rangeFor(x[0]); return r && iso(r[0]) === $(f).value && iso(r[1]) === $(t).value; });
      sel.value = hit ? hit[0] : 'custom';
    };
    [f, t].forEach(id => $(id).addEventListener('change', match));
    match.sel = sel; $(f)._rangeMatch = match;
  });
  // Clear filters: puts every box in the toolbar back to its starting value. Shows only when something is filtered.
  const filterBars = ['topic-search', 'staff-search', 'resp-from', 'rp-from', 'mm-from'].map(id => $(id).closest('.toolbar'));
  const ctlDefault = el => el.type === 'checkbox' ? el.defaultChecked : el.tagName === 'SELECT' ? (([...el.options].find(o => o.defaultSelected) || el.options[0] || {}).value || '') : el.defaultValue || '';
  const ctlValue = el => el.type === 'checkbox' ? el.checked : el.value;
  const filterCtls = bar => [...bar.querySelectorAll('input:not([type=file]), select')].filter(el => !el.dataset.keep && !el.closest('.clear-filters'));
  function syncClear() {
    filterBars.forEach(bar => {
      const dirty = filterCtls(bar).some(el => ctlValue(el) !== ctlDefault(el)) || (bar.contains($('resp-from')) && respPerson);
      bar.querySelector('.clear-filters').hidden = !dirty;
    });
  }
  filterBars.forEach(bar => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn subtle clear-filters'; b.textContent = '✕ Clear filters'; b.hidden = true;
    bar.appendChild(b);
    b.addEventListener('click', () => {
      filterCtls(bar).forEach(el => { if (el.type === 'checkbox') el.checked = el.defaultChecked; else el.value = ctlDefault(el); });
      if (bar.contains($('resp-from'))) respPerson = null;
      filterCtls(bar).forEach(el => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
      syncClear();
    });
    bar.addEventListener('input', () => setTimeout(syncClear));
    bar.addEventListener('change', () => setTimeout(syncClear));
  });
  document.getElementById('nav').addEventListener('click', () => setTimeout(() => { syncClear(); document.querySelectorAll('.range-pick').forEach(s => { const f = s.nextElementSibling && s.nextElementSibling.querySelector('input'); if (f && f._rangeMatch) f._rangeMatch(); }); }, 50));


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
      const p = by.get(k) || { name: r.name, employeeId: r.employeeId, last4: r.last4, department: r.department, leader: r.leader || (r.onRoster ? '' : 'Not on roster'), onRoster: r.onRoster, shifts: 0, done: 0, missedDates: [] };
      p.shifts++;
      if (r.status === 'done') p.done++; else p.missedDates.push(r.date);
      by.set(k, p);
    }
    return [...by.values()].filter(p => p.missedDates.length)
      .sort((a, b) => (!a.leader - !b.leader) || a.leader.localeCompare(b.leader) || b.missedDates.length - a.missedDates.length || a.name.localeCompare(b.name));
  }
  // People unticked here are left off the leader emails.
  const ccKey = p => `${p.last4}|${p.name.toLowerCase()}`;
  const ccLeftOff = new Set();
  function renderClockCheck() {
    const people = $('cc-filter').value === 'people';
    $('cc-shift-table').hidden = people; $('cc-people-table').hidden = !people;
    $('cc-email').hidden = !people;
    if (people) {
      const list = ccPeople();
      let lastLeader = null;
      $('cc-people-rows').innerHTML = list.map(p => {
        const head = p.leader !== lastLeader ? `<tr class="group"><th colspan="5">${escapeHtml(p.leader || 'No leader set')} <span class="muted small">(${list.filter(x => x.leader === p.leader).length} to follow up)</span></th></tr>` : '';
        lastLeader = p.leader;
        return head + `<tr class="${ccLeftOff.has(ccKey(p)) ? 'dim' : ''}"><td><input type="checkbox" data-cc-pick="${escapeHtml(ccKey(p))}"${ccLeftOff.has(ccKey(p)) ? '' : ' checked'} title="Include in the leader email"></td><td>${p.employeeId ? personLink(p.employeeId, p.name) : escapeHtml(p.name)}${p.onRoster ? '' : ' <span class="pill" title="This Workday ID is not on the Staff tab">Not on roster</span>'}<div class="muted small">${escapeHtml(p.last4)}</div></td>
          <td>${escapeHtml(p.department || '')}</td>
          <td><strong>${p.missedDates.length}</strong> of ${p.shifts}${p.done ? '' : ' <span class="pill warn">Never did it</span>'}</td>
          <td>${p.missedDates.map(shortDay).join(', ')}</td></tr>`;
      }).join('') || '<tr><td colspan="5" class="muted">Nobody to follow up with. Everyone did their in-service.</td></tr>';
      $('cc-all').checked = list.every(p => !ccLeftOff.has(ccKey(p)));
      return;
    }
    $('cc-rows').innerHTML = ccFiltered().map(r => `<tr>
      <td style="white-space:nowrap">${fmtDate(r.date)}</td><td>${escapeHtml(r.time || '')}</td>
      <td>${personLink(r.employeeId, r.name)}${r.onRoster ? '' : ' <span class="pill" title="This Workday ID is not on the Staff tab">Not on roster</span>'}${r.ambiguous ? ' <span class="pill warn" title="Several staff share these last 4 digits">Shared ID</span>' : ''}</td>
      <td>${escapeHtml(r.last4)}</td><td>${escapeHtml(r.department || '')}</td>
      <td>${ccLabel[r.status]}${r.status === 'done' ? `<div class="muted small">${fmtWhen(r.completedAt)}</div>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="6" class="muted">Nothing to show. Everyone did their in-service.</td></tr>';
  }
  ['cc-col-id', 'cc-col-name', 'cc-col-date', 'cc-col-time', 'cc-col-pay', 'cc-col-job'].forEach(id => $(id).addEventListener('change', runClockCheck));
  $('cc-run').addEventListener('click', runClockCheck);
  $('cc-filter').addEventListener('change', renderClockCheck);
  $('cc-people-rows').addEventListener('change', e => {
    const c = e.target.closest('[data-cc-pick]');
    if (!c) return;
    if (c.checked) ccLeftOff.delete(c.dataset.ccPick); else ccLeftOff.add(c.dataset.ccPick);
    c.closest('tr').classList.toggle('dim', !c.checked);
    $('cc-all').checked = ccPeople().every(p => !ccLeftOff.has(ccKey(p)));
  });
  $('cc-all').addEventListener('change', () => {
    ccPeople().forEach(p => { if ($('cc-all').checked) ccLeftOff.delete(ccKey(p)); else ccLeftOff.add(ccKey(p)); });
    renderClockCheck();
  });
  $('cc-email').addEventListener('click', async () => {
    const people = ccPeople().filter(p => !ccLeftOff.has(ccKey(p)));
    if (!people.length) return alert('Tick at least one person to email about.');
    if (!await confirm(`Email department leaders about ${people.length} ${people.length === 1 ? 'person' : 'people'} who clocked in without doing the in-service?`, 'Send emails')) return;
    try {
      const r = await post('/api/admin/clock-check/email', { people: people.map(p => ({ name: p.name, last4: p.last4, department: p.department, shifts: p.shifts, neverDone: !p.done, missedDates: p.missedDates })) });
      alert(`Sent to ${r.leaders} leader${r.leaders === 1 ? '' : 's'} about ${r.people} ${r.people === 1 ? 'person' : 'people'}.` +
        (r.skipped.length ? `\n\nNot emailed (no leader email for their department): ${r.skipped.join(', ')}. Add leader emails in Settings → Department leaders.` : ''));
    } catch (err) { alert(err.message); }
  });
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
  $('rp-print').addEventListener('click', () => {
    $('rp-error').textContent = '';
    const t = topicById($('rp-topic').value);
    if (!t) { $('rp-error').textContent = 'Choose a topic.'; return; }
    printSignInSheet(t, { from: $('rp-from').value, to: $('rp-to').value, dept: $('rp-dept').value }, msg => { $('rp-error').textContent = msg; });
  });
  // Also offered from the topic results view (all dates, all staff), so nobody has to go through Reports for it.
  async function printSignInSheet(t, { from = '', to = '', dept = '' } = {}, onError = toast) {
    const win = window.open('', '_blank'); // open now, while the click still counts, so it isn't blocked as a pop-up
    if (!win) { onError('Your browser blocked the new window. Allow pop-ups for this site and try again.'); return; }
    win.document.write('<p style="font-family:sans-serif">Loading…</p>');
    try {
      const shortWhen = iso => { const d = new Date(iso); return isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`; };
      const qNum = r => { const i = t.questions.findIndex(q => q.id === r.questionId); return i < 0 ? '' : `Q${i + 1}`; };
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
        table { width: 100%; border-collapse: collapse; margin-top: 6px; } th, td { border: 1px solid #bbb; padding: 4px 6px; text-align: left; vertical-align: top; }
        th { background: #eee; font-size: 11px; } td.nw { white-space: nowrap; } td.num { text-align: right; color: #555; } td.ans { width: 32%; } td.res { font-size: 11px; } .first { color: #555; font-size: 11px; } ul { margin: 4px 0 8px; padding-left: 20px; } p { margin: 0 0 8px; }
        .sign { margin-top: 28px; display: flex; gap: 28px; } .sign div { flex: 1; border-top: 1px solid #333; padding-top: 4px; font-size: 12px; }
        .noprint { margin-bottom: 14px; } @media print { .noprint { display: none; } body { margin: 0.4in; } tr { break-inside: avoid; } }
      </style></head><body>
        <div class="noprint" style="display:flex;gap:10px">${backBtn('font-size:15px;padding:6px 14px')}<button onclick="print()" style="font-size:15px;padding:6px 14px">Print or save as PDF</button></div>
        <h1>${escapeHtml(state.settings.facilityName || '')} In-Service Sign-In Sheet</h1>
        <div class="meta"><strong>Topic:</strong> ${escapeHtml(t.title)}${t.category ? ` (${escapeHtml(t.category)})` : ''}<br>
          <strong>Dates:</strong> ${range} &nbsp; <strong>Staff:</strong> ${dept ? escapeHtml(dept) : whoLabel(t.departments)}<br>
          <strong>Format:</strong> Self-paced micro in-service on the facility iPad, with a knowledge check. Staff who answer wrong get a hint and must answer correctly to finish.</div>
        <h2>Content presented</h2><div class="box">${formatLesson(t.lesson)}</div>
        <h2>Knowledge check questions</h2><div class="box">${t.questions.map((q, i) => `<div><strong>Q${i + 1}. ${escapeHtml(stripFormat(q.text))}</strong>
          <ul>${q.correctAnswers.map(a => `<li>${escapeHtml(a)} (correct)</li>`).join('')}${q.wrongAnswers.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul></div>`).join('')}</div>
        <h2>Attendance: ${people.length} staff completed${people.length ? `, ${Math.round(100 * first / people.length)}% correct on the first try` : ''}</h2>
        <table><thead><tr><th>#</th><th>Name</th><th>Dept</th><th>Last 4</th><th>Completed</th><th>Question</th><th>Answer given</th><th>Result</th></tr></thead><tbody>
        ${people.map((r, i) => `<tr><td class="num">${i + 1}</td><td class="nw">${escapeHtml(r.name)}</td><td>${escapeHtml(r.department || '')}</td><td class="nw">${escapeHtml(r.last4 || '')}</td>
          <td class="nw">${shortWhen(r.completedAt)}</td><td class="nw">${qNum(r)}</td>
          <td class="ans">${escapeHtml(r.attempts[r.attempts.length - 1] || '')}${r.firstTryCorrect || r.attempts.length < 2 ? '' : `<div class="first">First picked: ${escapeHtml(r.attempts[0])}</div>`}</td>
          <td class="res">${r.firstTryCorrect ? 'Correct first try' : `Correct on try ${r.attempts.length}`}</td></tr>`).join('')
          || '<tr><td colspan="8">No one has completed this topic in these dates.</td></tr>'}
        </tbody></table>
        <div class="sign"><div>In-service coordinator</div><div>Title</div><div>Date</div></div>
        <p style="margin-top:14px;color:#666;font-size:11px">Printed ${escapeHtml(new Date().toLocaleString())} from the in-service admin page.</p>
      </body></html>`);
      win.document.close();
    } catch (err) { win.close(); onError(err.message); }
  }

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
        return `<tr class="${g.asked < 5 ? 'dim' : ''}"><td>${t && q ? `<button class="linkish" data-mm-q="${t.id}|${t.questions.indexOf(q)}" title="See who missed it">${escapeHtml(stripFormat(q.text))}</button>` : escapeHtml(g.question)}<div class="muted small">${t ? topicLink(t.id, t.title) : escapeHtml(g.topicTitle)}</div></td>
          <td>${g.asked}</td><td><strong>${pct}%</strong> <span class="muted small">(${g.missed})</span></td>
          <td>${wrong ? `${escapeHtml(wrong)} <span class="muted small">(${n})</span>` : ''}</td>
          <td style="white-space:nowrap">${t ? `<button class="btn subtle" data-mm-edit="${t.id}">Edit topic</button>` : ''}</td></tr>`;
      }).join('') || '<tr><td colspan="5" class="muted">No missed questions for this selection.</td></tr>';
    } catch (err) { fail(err); }
  }
  ['mm-from', 'mm-to', 'mm-dept'].forEach(id => $(id).addEventListener('change', loadMissed));
  $('mm-rows').addEventListener('click', e => {
    const mq = e.target.closest('[data-mm-q]');
    if (mq) { const [id, i] = mq.dataset.mmQ.split('|'); return showTopicResults(topicById(id), { fil: 'missed', q: Number(i) }); }
    const b = e.target.closest('[data-mm-edit]');
    if (b) openEditor(topicById(b.dataset.mmEdit));
  });

  // Spaced review
  async function loadReviews() {
    try {
      const { reviews, thin, settings } = await api('/api/admin/reviews');
      $('rv-on').checked = !!settings.on; $('rv-first').value = settings.firstDays; $('rv-second').value = settings.secondDays;
      const today = state.todayDate;
      $('rv-rows').innerHTML = reviews.map(r => `<tr><td>${personLink(r.employeeId, r.name)}<div class="muted small">${escapeHtml(r.department || '')}</div></td>
        <td>${topicLink(r.topicId, r.title)}<div class="muted small">missed ${fmtDate(r.since)}</div></td>
        <td>${r.stage === 1 ? 'First' : 'Final'}</td>
        <td style="white-space:nowrap">${fmtDate(r.due)} ${r.due <= today ? '<span class="pill warn">Due now</span>' : ''}</td>
        <td style="white-space:nowrap"><button class="btn subtle" data-rv-skip="${r.employeeId}|${r.topicId}" data-rv-name="${escapeHtml(r.name)}" data-rv-title="${escapeHtml(r.title)}" title="Remove this review. It comes back only if they miss this topic again.">Take off</button></td></tr>`).join('')
        || '<tr><td colspan="5" class="muted">No one has anything to review right now.</td></tr>';
      $('rv-thin').innerHTML = thin.length ? `<strong>Topics with fewer than 3 questions</strong> <span class="muted">(add more so a review can ask it a different way):</span> ` +
        thin.map(t => `<a href="#" data-thin="${t.id}">${escapeHtml(t.title)}</a> (${t.questions})`).join(', ') : '';
    } catch (err) { fail(err); }
  }
  $('rv-rows').addEventListener('click', async e => {
    const b = e.target.closest('[data-rv-skip]');
    if (!b) return;
    if (!await confirm(`Take ${b.dataset.rvName} off the "${b.dataset.rvTitle}" review? It only comes back if they miss this topic again.`, 'Take off')) return;
    const [employeeId, topicId] = b.dataset.rvSkip.split('|');
    try { await post('/api/admin/reviews/skip', { employeeId, topicId }); toast('Taken off review'); loadReviews(); }
    catch (err) { fail(err); }
  });
  $('rv-thin').addEventListener('click', e => {
    const a = e.target.closest('[data-thin]');
    if (a) { e.preventDefault(); openEditor(topicById(a.dataset.thin)); }
  });
  autoSave($('rv-save').closest('.card'), async () => {
    await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ review: { on: $('rv-on').checked, firstDays: Number($('rv-first').value), secondDays: Number($('rv-second').value) } }) });
    await refresh();
  }, [$('rv-save')]);

  // Yearly requirements
  let annual = [];
  const yrLabel = { current: '<span class="pill good">Up to date</span>', soon: '<span class="pill">Due soon</span>', overdue: '<span class="pill warn">Overdue</span>', never: '<span class="pill warn">Never done</span>' };
  async function loadAnnual() {
    try {
      annual = (await api('/api/admin/annual')).topics;
      $('yr-rows').innerHTML = annual.map(t => `<tr><td>${topicLink(t.id, t.title)}${t.status !== 'active' ? ' <span class="pill warn">Not active</span>' : ''}</td>
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
    vwPush(() => { const x = document.querySelector(`[data-yr-view="${t.id}"]`); if (x) x.click(); });
    $('vw-title').innerHTML = topicById(t.id) ? topicLink(t.id, t.title) : escapeHtml(t.title);
    $('vw-body').innerHTML = `<table style="margin-top:12px"><thead><tr><th>Name</th><th>Department</th><th>Status</th><th>Last done</th><th>Due</th></tr></thead><tbody>
      ${people.map(p => `<tr><td>${personLink(p.id, p.name)}</td><td>${escapeHtml(p.department || '')}</td><td>${yrLabel[p.status]}</td><td>${p.last ? fmtDate(p.last) : ''}</td><td>${p.due ? fmtDate(p.due) : 'Now'}</td></tr>`).join('')
        || '<tr><td colspan="5" class="muted">No active staff in these departments.</td></tr>'}</tbody></table>`;
    openViewer();
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
        return `<tr><td>${fmtDate(u.date)}</td><td>${t ? topicLink(t.id, t.title) : escapeHtml(u.title)}</td><td>${u.responses}</td></tr>`;
      }).join('') || '<tr><td colspan="3" class="muted">No in-services completed yet.</td></tr>';
    } catch (err) { fail(err); }
  }

  // ---------- settings ----------
  // ---------- Tile layouts: order, width and height of the cards on a tab, saved per login ----------
  const WIDTHS = [[4, '⅓'], [6, '½'], [8, '⅔'], [12, 'Full']];
  const LAYOUT_HELP = 'Drag any tile to move it. Drag its right edge to make it wider, or its bottom edge to make it shorter (it scrolls inside). Changes save for your login.';
  const layouts = [];
  function makeLayout(page, grid, defaults, bar) {
    const tiles = () => [...grid.children].filter(c => c.dataset.tile);
    const spanOf = t => Number(getComputedStyle(t).getPropertyValue('--span')) || 6;
    function apply() {
      if (grid.classList.contains('editing')) return;
      const saved = (state.layouts && state.layouts[page]) || [];
      const order = saved.length ? saved.map(t => [t.id, t.span, t.h]) : defaults;
      const byId = Object.fromEntries(tiles().map(t => [t.dataset.tile, t]));
      // Already in this order? Then only sizes change. Moving tiles around blurs whatever you just clicked.
      const want = [...order.map(o => o[0]).filter(id => byId[id]), ...defaults.map(d => d[0]).filter(id => byId[id] && !order.some(o => o[0] === id))];
      const same = want.join('|') === tiles().map(t => t.dataset.tile).join('|');
      if (same) {
        const sizes = Object.fromEntries([...defaults.map(([id, span]) => [id, [span, 0]]), ...order.map(([id, span, h]) => [id, [span, h]])]);
        for (const id of want) { byId[id].style.setProperty('--span', sizes[id][0]); setTileHeight(byId[id], sizes[id][1] || 0); }
        tiles().forEach(markWidth);
        return;
      }
      const placed = new Set();
      for (const [id, span, h] of order) {
        const t = byId[id];
        if (!t) continue;
        t.style.setProperty('--span', span); setTileHeight(t, h || 0); grid.appendChild(t); placed.add(id);
      }
      // Tiles added after the layout was saved go at the end, at their default width.
      for (const [id, span] of defaults) if (!placed.has(id) && byId[id]) { byId[id].style.setProperty('--span', span); setTileHeight(byId[id], 0); grid.appendChild(byId[id]); }
      tiles().forEach(markWidth);
    }
    // A chosen height: the tile scrolls inside when its content is taller. 0 = fit the content.
    function setTileHeight(t, h) {
      t.dataset.h = h || 0;
      t.classList.toggle('fixed-h', !!h);
      t.style.setProperty('--h', h ? h + 'px' : 'none');
      const lab = t.querySelector('.tile-ctl .hlab');
      if (lab) lab.innerHTML = h ? `${h}px tall <button type="button" class="hauto" title="Fit the content again">Auto</button>` : 'Auto height';
    }
    function markWidth(t) {
      const span = spanOf(t);
      t.querySelectorAll('.tile-ctl .w button').forEach(b => b.classList.toggle('on', Number(b.dataset.span) === span));
    }
    async function save() {
      const list = tiles().map(t => ({ id: t.dataset.tile, span: spanOf(t), h: Number(t.dataset.h) || 0 }));
      state.layouts = Object.assign({}, state.layouts, { [page]: list });
      try { await api('/api/admin/layout', { method: 'PUT', body: JSON.stringify({ page, tiles: list }) }); } catch (err) { fail(err); }
    }
    function addTileControls() {
      for (const t of tiles()) {
        if (t.querySelector(':scope > .tile-ctl')) continue;
        const ctl = document.createElement('div');
        ctl.className = 'tile-ctl';
        ctl.innerHTML = `<span class="grip">⠿</span><span class="t">${escapeHtml(t.dataset.title || '')}</span><span class="hlab small"></span><span class="w">${WIDTHS.map(([n, l]) => `<button type="button" data-span="${n}" title="${l === 'Full' ? 'Full width' : l + ' width'}">${l}</button>`).join('')}</span>`;
        t.prepend(ctl);
        const rz = document.createElement('div');
        rz.className = 'tile-resize'; rz.title = 'Drag to make wider or narrower';
        t.appendChild(rz);
        const rh = document.createElement('div');
        rh.className = 'tile-resize-b'; rh.title = 'Drag to make taller or shorter';
        t.appendChild(rh);
        setTileHeight(t, Number(t.dataset.h) || 0);
        ctl.addEventListener('click', e => { if (e.target.closest('.hauto')) { setTileHeight(t, 0); save(); } });
        // Drag the bottom edge to set the height; the content scrolls inside if it's taller.
        rh.addEventListener('pointerdown', e => {
          e.preventDefault(); e.stopPropagation();
          rh.setPointerCapture(e.pointerId);
          const top = t.getBoundingClientRect().top;
          const move = ev => setTileHeight(t, Math.max(160, Math.round(ev.clientY - top)));
          const up = () => { rh.removeEventListener('pointermove', move); rh.removeEventListener('pointerup', up); rh.removeEventListener('pointercancel', up); save(); };
          rh.addEventListener('pointermove', move); rh.addEventListener('pointerup', up); rh.addEventListener('pointercancel', up);
        });
        ctl.querySelector('.w').addEventListener('click', e => {
          const b = e.target.closest('[data-span]');
          if (!b) return;
          t.style.setProperty('--span', b.dataset.span); markWidth(t); save();
        });
        // Drag anywhere on a tile to move it (mouse, trackpad or touch). The tile follows the pointer,
        // a dashed space shows where it will land, and the other tiles slide out of the way.
        t.addEventListener('pointerdown', e => {
          if (!grid.classList.contains('editing') || e.button > 0 || e.target.closest('.w, .tile-resize, .tile-resize-b, .hauto')) return;
          e.preventDefault();
          const r0 = t.getBoundingClientRect();
          const dx = e.clientX - r0.left, dy = e.clientY - r0.top;
          const ph = document.createElement('div');
          ph.className = 'tile-ph';
          ph.style.setProperty('--span', spanOf(t));
          ph.style.height = r0.height + 'px';
          t.after(ph);
          Object.assign(t.style, { position: 'fixed', left: r0.left + 'px', top: r0.top + 'px', width: r0.width + 'px', height: r0.height + 'px', zIndex: 50 });
          t.classList.add('lifted');
          let lastX = e.clientX, lastY = e.clientY, scrollTimer = null;
          // Smoothly slide tiles from where they were to where they are now.
          const slide = fn => {
            const others = tiles().filter(x => x !== t);
            const before = new Map(others.map(x => [x, x.getBoundingClientRect()]));
            fn();
            for (const x of others) {
              const b = before.get(x), n = x.getBoundingClientRect();
              if (!b || (b.left === n.left && b.top === n.top)) continue;
              x.animate([{ transform: `translate(${b.left - n.left}px, ${b.top - n.top}px)` }, { transform: 'none' }], { duration: 180, easing: 'ease-out' });
            }
          };
          const place = () => {
            t.style.left = (lastX - dx) + 'px'; t.style.top = (lastY - dy) + 'px';
            const over = tiles().filter(x => x !== t).find(x => { const r = x.getBoundingClientRect(); return lastX >= r.left && lastX <= r.right && lastY >= r.top && lastY <= r.bottom; });
            if (!over) return;
            const r = over.getBoundingClientRect();
            // Same row: left or right half decides. Full-width tiles: top or bottom half.
            const after = r.width > grid.clientWidth * 0.75 ? lastY > r.top + r.height / 2 : lastX > r.left + r.width / 2;
            if (after ? over.nextElementSibling === ph : over.previousElementSibling === ph) return;
            slide(() => grid.insertBefore(ph, after ? over.nextSibling : over));
          };
          const move = ev => { lastX = ev.clientX; lastY = ev.clientY; place(); };
          // Scroll the page when dragging near the top or bottom edge.
          scrollTimer = setInterval(() => {
            const edge = 90, speed = lastY < edge ? -(edge - lastY) / 3 : lastY > innerHeight - edge ? (lastY - innerHeight + edge) / 3 : 0;
            if (speed) { scrollBy(0, speed); place(); }
          }, 16);
          const up = () => {
            clearInterval(scrollTimer);
            removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
            ph.replaceWith(t);
            Object.assign(t.style, { position: '', left: '', top: '', width: '', height: '', zIndex: '' });
            t.classList.remove('lifted');
            const rn = t.getBoundingClientRect();
            t.animate([{ transform: `translate(${lastX - dx - rn.left}px, ${lastY - dy - rn.top}px)` }, { transform: 'none' }], { duration: 160, easing: 'ease-out' });
            save();
          };
          addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
        });
        // Drag the right edge to resize; it snaps to the 12-column grid.
        rz.addEventListener('pointerdown', e => {
          e.preventDefault();
          rz.setPointerCapture(e.pointerId);
          const g = grid.getBoundingClientRect();
          const gap = parseFloat(getComputedStyle(grid).columnGap) || 18;
          const colW = (g.width + gap) / 12;
          const left = t.getBoundingClientRect().left;
          const move = ev => { t.style.setProperty('--span', Math.min(12, Math.max(3, Math.round((ev.clientX - left + gap) / colW)))); markWidth(t); };
          const up = () => { rz.removeEventListener('pointermove', move); rz.removeEventListener('pointerup', up); rz.removeEventListener('pointercancel', up); save(); };
          rz.addEventListener('pointermove', move); rz.addEventListener('pointerup', up); rz.addEventListener('pointercancel', up);
        });
      }
    }
    const [help, reset, edit] = ['.lay-help', '.lay-reset', '.lay-edit'].map(q => bar.querySelector(q));
    edit.addEventListener('click', () => {
      const on = !grid.classList.contains('editing');
      addTileControls();
      tiles().forEach(markWidth);
      grid.classList.toggle('editing', on);
      edit.textContent = on ? '✓ Done' : '✥ Edit layout';
      edit.classList.toggle('ghost', !on);
      help.hidden = !on; reset.hidden = !on;
    });
    reset.addEventListener('click', async () => {
      state.layouts = Object.assign({}, state.layouts, { [page]: [] });
      grid.classList.remove('editing'); apply(); grid.classList.add('editing');
      try { await api('/api/admin/layout', { method: 'PUT', body: JSON.stringify({ page, reset: true }) }); toast('Back to the default layout'); } catch (err) { fail(err); }
    });
    const lay = { apply, page };
    layouts.push(lay);
    return lay;
  }
  const layoutBar = () => {
    const bar = document.createElement('div');
    bar.className = 'layout-bar';
    bar.innerHTML = `<span class="lay-help" hidden>${LAYOUT_HELP}</span><button class="btn ghost lay-reset" hidden>Reset to default</button><button class="btn ghost lay-edit">✥ Edit layout</button>`;
    return bar;
  };
  const settingsLayout = makeLayout('settings', $('set-grid'), [['kiosk', 6], ['email', 6], ['depts', 12], ['closing', 12], ['logins', 6], ['password', 6], ['backup', 6], ['decor', 12]], $('lay-bar'));
  // Other tabs: their cards become tiles. Ids come from each card's heading, so they stay the same between visits.
  function tileTab(page, blocks) {
    const sec = $('tab-' + page);
    const grid = document.createElement('div');
    grid.className = 'tiles-grid';
    const bar = layoutBar();
    const els = blocks.map(([el]) => el).filter(Boolean);
    if (!els.length) return;
    els[0].before(grid); grid.after(bar);
    const used = new Set(), defaults = [];
    blocks.forEach(([el, span, title]) => {
      if (!el) return;
      const name = title || ((el.querySelector('h2, h3') || {}).textContent || page).trim();
      let id = name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 24) || 'tile';
      while (used.has(id)) id += 'x';
      used.add(id);
      Object.assign(el.dataset, { tile: id, title: name });
      el.style.setProperty('--span', span);
      grid.appendChild(el);
      defaults.push([id, span]);
    });
    makeLayout(page, grid, defaults, bar);
  }
  {
    const kids = id => [...$('tab-' + id).children].filter(c => c.matches('.card') && !c.matches('.bare') && !c.hidden && c.id !== 'cc-results');
    const t = $('tab-today'), dashes = [...t.querySelectorAll(':scope > .dash')];
    const stats = t.querySelector(':scope > .tiles');
    const statCard = document.createElement('div'); statCard.className = 'card bare'; stats.before(statCard); statCard.appendChild(stats);
    tileTab('today', [[statCard, 12, 'Today\'s numbers'], ...dashes.flatMap(d => [...d.children].map((c, i) => [c, i ? 5 : 7])), ...kids('today').map(c => [c, 12])]);
    dashes.forEach(d => d.remove());
    tileTab('announcements', kids('announcements').map((c, i) => [c, 12]));
    tileTab('schedule', kids('schedule').map(c => [c, 12]));
    tileTab('required', kids('required').map(c => [c, 12]));
    tileTab('reports', kids('reports').map(c => [c, 12]));
  }

  function renderSettings() {
    const s = state.settings;
    settingsLayout.apply();
    $('set-facility').value = s.facilityName || '';
    $('set-depts').querySelectorAll('.re-row').forEach(r => r.remove());
    depts().forEach(d => addDeptRow(d));
    $('set-leaders').querySelectorAll('.re-row').forEach(r => r.remove());
    Object.entries(s.leaders || {}).forEach(([d, l]) => addLeaderRow(d, l));
    const gap = leaderGapHtml(false);
    $('leader-gaps').hidden = !gap;
    $('leader-gaps').innerHTML = gap ? '⚠️ Follow-up emails can\'t reach these departments yet.<br>' + gap : '';
    $('set-unlisted').checked = !!s.allowUnlisted;
    $('set-fit').checked = s.fitScreen !== false;
    $('set-closing').innerHTML = '';
    (s.closingMessages || []).forEach(m => addClosingRow(m));
    $('set-news-seconds').value = s.newsSeconds || 3;
    const main = state.isMainAdmin !== false;
    $('pw-env').hidden = !state.passwordFromEnv || !main;
    loadAdminUsers();
    renderDecor();
    loadTestData();
    $('set-alert-emails').value = (s.alertEmails || []).join('\n');
    $('set-missed-followup').checked = s.missedFollowup !== false;
    loadEmailStatus();
    $('pw-form').hidden = !!state.passwordFromEnv && main;
    $('pw-form').querySelector('.muted').innerHTML = main ? 'Used to open this admin page. The username is <code>admin</code>.' : `You're signed in as <code>${escapeHtml(state.me || '')}</code>. Change your own password here.`;
    // Nothing to change here when the hosting service sets the main password; the Admin logins card says so instead.
    document.querySelector('[data-tile="password"]').hidden = !!state.passwordFromEnv && main;
    renderIpadMap();
  }
  // Settings → "What staff see on the iPad": every setting that changes the iPad, with a link to where it lives.
  const IPAD_MAP = [
    ['🗓️', 'Which topic shows each day', 'Topic of the week, culture day, quiz day', () => $('save-fallback')],
    ['📌', 'Scheduled topics', 'A set topic for a week or a department', () => $('sc-add')],
    ['❗', 'Required education', 'Shows first, until it\'s done', () => $('rq-topic')],
    ['🌱', 'New hire starter topics', 'What a new person sees first', () => $('ns-save')],
    ['📣', 'Announcements and pop-ups', 'Above the keypad, after the in-service, or a full pop-up', () => $('an-popup')],
    ['🎂', 'Birthdays and anniversaries', 'Messages and the celebration screen', () => $('an-celebrate')],
    ['🔥', 'Streaks and leaderboard', 'Shout-outs and the 🏆 button', () => document.querySelector('.sk-card')],
    ['🔁', 'Spaced review', 'Missed topics come back a few days later', () => $('rv-on')],
    ['💬', 'End-screen messages', 'The thank-you line after each in-service', () => $('closing-card')],
    ['🍂', 'Home screen decor', 'Seasonal decorations, message and color', () => $('decor-on')],
    ['🏷️', 'Facility name and banner speed', 'Plus staff who aren\'t on the roster', () => $('set-facility')],
    ['👥', 'Departments', 'Used everywhere a department is picked', () => $('dept-card')],
  ];
  function renderIpadMap() {
    $('ipad-map').innerHTML = IPAD_MAP.map(([icon, title, sub], i) => {
      const el = IPAD_MAP[i][3](), tab = el && el.closest('.tab');
      const where = tab ? (document.querySelector(`#nav button[data-tab="${tab.id.slice(4)}"]`) || {}).textContent : '';
      return `<button class="map-item" data-map="${i}"><span class="mi-icon">${icon}</span><span><b>${title}</b><small>${sub}</small></span><span class="mi-where">${escapeHtml((where || '').trim())} ›</span></button>`;
    }).join('');
  }
  $('ipad-map').addEventListener('click', e => {
    const b = e.target.closest('[data-map]'); if (!b) return;
    const el = IPAD_MAP[Number(b.dataset.map)][3](); if (!el) return;
    const tab = el.closest('.tab');
    if (tab) goTab(tab.id.slice(4));
    showFound(el.closest('.card') || el);
  });
  // Simple row editors: one box per item, with a remove button.
  const EMAIL_RE = /[^\s<>,;:"'()]+@[^\s<>,;:"'()]+\.[a-z]{2,}/gi;
  function reRow(box, inner) {
    const row = document.createElement('div');
    row.className = 're-row';
    row.innerHTML = inner + '<button type="button" class="re-x" title="Remove">×</button>';
    box.appendChild(row);
    return row;
  }
  function addDeptRow(v = '') { return reRow($('set-depts'), `<input type="text" data-clear="1" maxlength="60" placeholder="Department" value="${escapeHtml(v)}">`); }
  // Message boxes grow to fit their words. A box on a hidden tab measures 0, so they're re-fit when shown.
  function fitText(ta) { if (!ta.offsetParent) return; ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; }
  const fitAllText = () => document.querySelectorAll('.cm-text').forEach(fitText);
  document.getElementById('nav').addEventListener('click', () => setTimeout(fitAllText, 30));
  window.addEventListener('resize', () => { clearTimeout(fitAllText.t); fitAllText.t = setTimeout(fitAllText, 150); });
  // End-screen message rows: the text, plus an optional font, color, size and GIF.
  function addClosingRow(v = '', box = $('set-closing'), placeholder = 'Thanks for keeping our residents safe!') {
    const m = typeof v === 'string' ? { text: v } : v;
    const row = reRow(box, `<textarea class="cm-text" rows="1" maxlength="300" placeholder="${escapeHtml(placeholder)}">${escapeHtml(m.text || '')}</textarea>
      <button type="button" class="re-x cm-look" title="See it like the iPad shows it">👁</button>
      <button type="button" class="re-x cm-toggle" title="Font, color, size and GIF">🎨</button>`);
    row.classList.add('cm-row');
    const panel = document.createElement('div');
    panel.className = 'cm-style';
    panel.hidden = true;
    panel.innerHTML = `<label>Font <select class="cm-font">${Object.entries(MESSAGE_FONTS).map(([k, f]) => `<option value="${k}"${(m.font || '') === k ? ' selected' : ''} style="font-family:${escapeHtml(f.css)}">${f.label}</option>`).join('')}</select></label>
      <label>Size <select class="cm-size">${Object.entries(MESSAGE_SIZES).map(([k, [l]]) => `<option value="${k === 'm' ? '' : k}"${(m.size || '') === (k === 'm' ? '' : k) ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Color <input type="color" class="cm-color" value="${/^#[0-9a-f]{6}$/i.test(m.color || '') ? m.color : '#1f6f8b'}"> <label class="small"><input type="checkbox" class="cm-color-on"${m.color ? ' checked' : ''}> use it</label></label>
      <div class="cm-gif-line"><span>GIF or picture</span> <input type="file" class="cm-gif-file" accept="image/gif,image/png,image/jpeg,image/webp">
        <input type="text" class="cm-gif" data-clear="1" placeholder="or paste a link, including a GIPHY page link" value="${escapeHtml(m.gif || '')}"> <a href="https://giphy.com" target="_blank" rel="noopener" class="small">Find one on GIPHY</a></div>
      <div class="cm-preview"></div>`;
    row.appendChild(panel);
    const sync = () => {
      const msg = closingFromRow(row);
      const styled = typeof msg === 'object';
      row.querySelector('.cm-toggle').classList.toggle('on', styled);
      row.querySelector('.cm-text').setAttribute('style', messageStyle(Object.assign({}, msg, { size: '' })));
      panel.querySelector('.cm-preview').innerHTML = `<div class="muted small">On the iPad:</div>` + (msg && msg.gif ? `<img src="${escapeHtml(msg.gif)}" alt="">` : '') +
        `<div style="font-size:26px;font-weight:700;color:#1f6f8b;${messageStyle(msg)}">${formatMessage(sampleText(messageText(msg))) || '<span class="muted">Type a message</span>'}</div>`;
      fitText(row.querySelector('.cm-text'));
    };
    row.addEventListener('input', e => { if (e.target.classList.contains('cm-gif')) { const g = gifUrl(e.target.value); if (g !== e.target.value.trim()) e.target.value = g; } sync(); });
    row.addEventListener('change', sync);
    row.querySelector('.cm-toggle').addEventListener('click', () => { panel.hidden = !panel.hidden; });
    row.querySelector('.cm-look').addEventListener('click', () => showMessagePreview(closingFromRow(row)));
    panel.querySelector('.cm-color').addEventListener('input', () => { panel.querySelector('.cm-color-on').checked = true; });
    panel.querySelector('.cm-gif-file').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 10e6) return alert('That file is over 10 MB. Please use a smaller one.');
      try {
        const dataUrl = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(f); });
        const r = await post('/api/admin/media', { dataUrl });
        panel.querySelector('.cm-gif').value = r.url; sync();
        panel.querySelector('.cm-gif').dispatchEvent(new Event('input', { bubbles: true }));
      } catch (err) { fail(err); }
    });
    sync();
    if (typeof v !== 'string' && (m.gif || m.font || m.color || m.size)) panel.hidden = true;
    return row;
  }
  // The end screen as the iPad shows it, with this message.
  // Fill in {name} and {years} with an example so previews read naturally.
  const sampleText = t => String(t || '').replace(/\{name\}/gi, 'Maria').replace(/\{years\}/gi, '5').replace(/^[^:\n]{1,60}:\s*(?=\S)/, m => depts().some(d => sameDept(d, m.replace(/:\s*$/, ''))) ? '' : m);
  function showMessagePreview(msg) {
    $('vw-title').textContent = 'End-screen preview';
    $('vw-body').innerHTML = `<div class="ipad-mock"><div class="ipad-screen">
      <div class="ipad-check">✓</div><div class="ipad-great">Correct!</div>
      ${msg && msg.gif ? `<img src="${escapeHtml(msg.gif)}" alt="">` : ''}
      <div class="ipad-msg" style="${messageStyle(msg)}">${formatMessage(sampleText(messageText(msg)))}</div></div></div>`;
    openViewer();
  }
  function closingFromRow(row) {
    const q = c => row.querySelector(c);
    const m = { text: q('.cm-text').value.trim(), font: q('.cm-font').value, size: q('.cm-size').value,
      color: q('.cm-color-on').checked ? q('.cm-color').value : '', gif: q('.cm-gif').value.trim() };
    for (const k of Object.keys(m)) if (!m[k]) delete m[k];
    return Object.keys(m).length === 1 && m.text ? m.text : m;
  }
  const closingValues = (box = $('set-closing')) => [...box.querySelectorAll('.cm-row')].map(closingFromRow).filter(m => typeof m === 'string' ? m : (m.text || m.gif));
  function addLeaderRow(dept = '', leader = '') {
    const emails = String(leader).match(EMAIL_RE) || [];
    const name = String(leader).replace(EMAIL_RE, '').replace(/[\s,;<>()]+$/, '').replace(/^[\s,;<>()]+/, '').replace(/[\s,;]+(?=[,;])/g, '').trim();
    const opts = [...new Set([...depts(), ...mainDepts(), dept].filter(Boolean))];
    return reRow($('set-leaders'), `<select>${opts.map(d => `<option${sameDept(d, dept) ? ' selected' : ''}>${escapeHtml(d)}</option>`).join('')}</select>
      <input type="text" data-clear="1" maxlength="80" placeholder="Name" value="${escapeHtml(name)}">
      <input type="text" data-clear="1" maxlength="200" placeholder="name@stonehenge.com" value="${escapeHtml(emails.join(', '))}">`);
  }
  const focusLast = row => row.querySelector('input').focus();
  $('add-dept').addEventListener('click', () => focusLast(addDeptRow()));
  $('add-closing').addEventListener('click', () => focusLast(addClosingRow()));
  $('add-leader').addEventListener('click', () => focusLast(addLeaderRow()));
  ['set-depts', 'set-leaders', 'set-closing', 'an-bday-msgs', 'an-anniv-msgs', 'an-bbday-msgs', 'an-banniv-msgs'].forEach(id => $(id).addEventListener('click', e => { const x = e.target.closest('.re-x:not(.cm-toggle):not(.cm-look)'); if (x) x.closest('.re-row').remove(); }));
  $('set-leaders').addEventListener('input', e => {
    const i = e.target;
    if ((i.placeholder || '').includes('@')) i.classList.toggle('bad', !!i.value.trim() && (i.value.replace(EMAIL_RE, '').replace(/[\s,;]/g, '') !== ''));
  });
  const rowValues = id => [...$(id).querySelectorAll('.re-row input')].map(i => i.value.trim()).filter(Boolean);
  function leaderValues() {
    const out = {}, bad = [];
    for (const row of $('set-leaders').querySelectorAll('.re-row')) {
      const [sel, name, email] = row.querySelectorAll('select, input');
      const emails = email.value.match(EMAIL_RE) || [];
      if (email.value.trim() && email.value.replace(EMAIL_RE, '').replace(/[\s,;]/g, '')) bad.push(sel.value);
      const v = [name.value.trim(), ...emails].filter(Boolean).join(', ');
      if (sel.value && v) out[sel.value] = out[sel.value] ? out[sel.value] + ', ' + v : v;
    }
    return { out, bad };
  }
  // Bulk add leaders: paste three columns from Excel, or upload the sheet.
  let lbRows = [];
  function parseLeaderRows(rows) {
    if (!rows.length) return [];
    const head = rows[0].map(c => String(c).trim());
    let di = findCol(head, [/^dep/i, /^dept/i, /^unit/i]), ni = findCol(head, [/name|leader|manager|supervisor/i]), ei = findCol(head, [/e-?mail/i]);
    const hasHeader = di >= 0 && (ni >= 0 || ei >= 0) && !String(rows[0].join(' ')).match(EMAIL_RE);
    if (!hasHeader) { di = 0; ni = 1; ei = 2; }
    const out = [];
    for (const r of rows.slice(hasHeader ? 1 : 0)) {
      const cells = r.map(c => String(c).trim());
      const dept = cells[di] || '';
      // Emails anywhere in the row count, so a missing or shifted column still works.
      const emails = [...new Set((cells.join(' ').match(EMAIL_RE) || []).map(e => e.toLowerCase()))];
      let name = (ni >= 0 ? cells[ni] : '') || '';
      if (name.match(EMAIL_RE)) name = '';
      if (dept && (name || emails.length)) out.push({ dept, name, emails });
    }
    return out;
  }
  function showLeaderPreview() {
    $('lb-go').disabled = !lbRows.length;
    $('lb-preview').innerHTML = lbRows.length
      ? `<b>${lbRows.length} leader${lbRows.length === 1 ? '' : 's'} found:</b><table style="margin-top:6px"><tbody>${lbRows.map(r => `<tr><td>${escapeHtml(r.dept)}</td><td>${escapeHtml(r.name)}</td><td>${r.emails.length ? escapeHtml(r.emails.join(', ')) : '<span class="err">no email</span>'}</td></tr>`).join('')}</tbody></table>`
      : ($('lb-text').value.trim() ? '<span class="err">Couldn\'t find any rows with a department and a name or email.</span>' : '');
  }
  $('bulk-leaders').addEventListener('click', () => { $('lb-text').value = ''; $('lb-file').value = ''; lbRows = []; showLeaderPreview(); $('leader-bulk').showModal(); });
  $('lb-text').addEventListener('input', () => { lbRows = parseLeaderRows(parseCsv($('lb-text').value)); showLeaderPreview(); });
  $('lb-file').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try { lbRows = parseLeaderRows(await readSheet(f, /leader|manager/i)); showLeaderPreview(); } catch (err) { fail(err); }
  });
  $('lb-go').addEventListener('click', () => {
    let added = 0, updated = 0;
    for (const r of lbRows) {
      const existing = [...$('set-leaders').querySelectorAll('.re-row')].find(row => sameDept(row.querySelector('select').value, r.dept));
      if (existing) existing.remove();
      addLeaderRow(r.dept, [r.name, ...r.emails].filter(Boolean).join(', '));
      existing ? updated++ : added++;
    }
    $('leader-bulk').close();
    $('dept-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast(`${added ? `${added} added` : ''}${added && updated ? ', ' : ''}${updated ? `${updated} updated` : ''}`);
    deptSave.now();
  });
  async function saveSettings() {
    const lv = leaderValues();
    if (lv.bad.length) throw new Error(`Check the email for ${lv.bad.join(', ')}`);
    {
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({
        facilityName: $('set-facility').value,
        departments: [...new Set(rowValues('set-depts'))],
        leaders: lv.out,
        allowUnlisted: $('set-unlisted').checked,
        fitScreen: $('set-fit').checked,
        closingMessages: closingValues(),
        newsSeconds: Number($('set-news-seconds').value)
      }) });
      $('sc-depts').dataset.init = ''; $('rq-depts').dataset.init = ''; $('an-depts').dataset.init = '';
      await refresh();
    }
  }
  autoSave($('save-settings').closest('.card'), saveSettings, [$('save-settings')]);
  const deptSave = autoSave($('save-depts').closest('.card'), saveSettings, [$('save-depts')]);
  autoSave($('save-closing').closest('.card'), saveSettings, [$('save-closing')]);
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
  autoSave($('save-email').closest('.card'), async () => {
    await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ alertEmails: splitLines($('set-alert-emails').value), missedFollowup: $('set-missed-followup').checked }) });
    await refresh();
  }, [$('save-email')]);
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
        <td style="white-space:nowrap">${fmtWhen(f.createdAt)}</td><td><strong>${f.employeeId ? personLink(f.employeeId, f.name) : escapeHtml(f.name)}</strong></td><td>${escapeHtml(f.department || '')}</td>
        <td><a href="#" data-fu-open="${f.responseId}">${escapeHtml(f.question)}</a><div class="muted small">${f.topicId ? topicLink(f.topicId, f.topicTitle) : escapeHtml(f.topicTitle)} · Correct: ${escapeHtml(f.correctAnswer)}</div></td>
        <td>${escapeHtml(f.firstAnswer)}</td>
        <td class="small">${escapeHtml(f.leader || '')}${f.emailedTo.length ? `<div class="muted">✉ ${escapeHtml(f.emailedTo.join(', '))}</div>` : '<div class="muted">No leader email</div>'}</td>
        <td style="white-space:nowrap">${f.attestedAt ? `<span class="pill good">✓ Educated</span><div class="muted small">${escapeHtml(f.attestedBy)}, ${fmtWhen(f.attestedAt)}</div><a href="#" class="small" data-fu-undo="${f.id}">Undo</a>`
          : `<button class="btn subtle" data-fu-attest="${f.id}">Mark educated</button><button class="btn subtle" data-fu-remind="${f.id}" title="Email the leader a reminder">✉ Remind</button>${(f.reminders || []).length ? `<div class="muted small">Reminded ${f.reminders.length}×, last ${fmtWhen(f.reminders[f.reminders.length - 1])}</div>` : ''}`}</td></tr>`).join('')
        || `<tr><td colspan="7" class="muted">${fv === 'open' ? 'Nothing waiting. Everyone is caught up. 🎉' : 'None yet.'}</td></tr>`;
    } catch (err) { fail(err); }
  }
  ['fu-filter', 'fu-dept'].forEach(id => $(id).addEventListener('change', loadFollowups));
  $('fu-rows').addEventListener('click', e => { const a = e.target.closest('[data-fu-open]'); if (a) { e.preventDefault(); showResponse(a.dataset.fuOpen); } });
  $('fu-remind-all').addEventListener('click', async () => {
    if (!await confirm('Email each department leader one reminder listing everyone still waiting on them?', 'Send reminders')) return;
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
    if (a) { by = await prompt('Who educated them? (your name)', localStorage.getItem('fu-by') || '', 'Mark educated'); if (!by) return; try { localStorage.setItem('fu-by', by); } catch { /* ignore */ } }
    try { await post(`/api/admin/followups/${(a || u).dataset[a ? 'fuAttest' : 'fuUndo']}/attest`, a ? { by } : { undo: true }); toast(a ? 'Marked educated' : 'Undone'); loadFollowups(); loadDashboard(); }
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
      const what = a.popup ? `${a.image ? `<img class="an-thumb" src="${escapeHtml(a.image)}" alt="">` : ''}<span class="pill">📲 Pop-up</span> <b>${escapeHtml(a.title || '')}</b>${a.text ? `<div class="small">${formatMessage(a.text)}</div>` : ''}
        <div class="small muted">${a.everyTime ? 'Every clock-in' : 'Once per person'} · <a href="#" data-ann-seen="${a.id}">${(a.buttons || []).length
          ? a.buttons.map((b, i) => `${escapeHtml(b)}${(a.repeat || []).includes(b) ? ' ↻' : ''}: ${(a.picks || [])[i] || 0}`).join(' · ') + ' · who?' : `seen by ${a.seen || 0} · who?`}</a></div>` : formatInline(a.text);
      return `<tr class="${!live && a.startDate < state.todayDate ? 'dim' : ''}"><td>${what}${status}</td><td>${whoLabel(a.departments)}</td>
        <td style="white-space:nowrap">${fmtDate(a.startDate)} – ${a.endDate ? fmtDate(a.endDate) : 'until removed'}</td>
        <td style="white-space:nowrap"><button class="btn subtle" data-prev-ann="${a.id}">👁 Preview</button> <button class="btn subtle" data-edit-ann="${a.id}">✏️ Edit</button> <button class="btn subtle danger" data-del-ann="${a.id}">Remove</button></td></tr>`;
    }).join('') || '<tr><td colspan="4" class="muted">No announcements yet.</td></tr>';
    $('an-celebrate').checked = state.settings.celebrations !== false;
    const bl = state.settings.belated || {};
    $('an-belated').checked = !!bl.on;
    if (document.activeElement !== $('an-belated-days')) $('an-belated-days').value = bl.days || 7;
    renderStreakSettings();
    for (const [id, key, ph] of [['an-bday-msgs', 'birthdayMessages', 'Happy birthday, {name}!'], ['an-anniv-msgs', 'anniversaryMessages', 'Happy {years}-year anniversary, {name}!'],
      ['an-bbday-msgs', 'belatedBirthdayMessages', 'Happy belated birthday, {name}!'], ['an-banniv-msgs', 'belatedAnniversaryMessages', 'Happy belated {years}-year anniversary, {name}!']]) {
      if ($(id).contains(document.activeElement)) continue;
      $(id).innerHTML = '';
      (state.settings[key] || []).forEach(m => addClosingRow(m, $(id), ph));
    }
    const up = state.upcomingCelebrations || [];
    const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const daysAway = d => Math.round((Date.parse(d) - Date.parse(state.todayDate)) / 864e5);
    $('an-upcoming').innerHTML = up.length
      ? up.map(c => { const n = daysAway(c.date);
          return `<div class="up-row"><div class="up-date"><span>${MON[Number(c.date.slice(5, 7)) - 1]}</span><b>${Number(c.date.slice(8))}</b></div>
          <div>${c.type === 'birthday' ? '🎂' : '🎉'} <button class="linkish" data-up-staff="${escapeHtml(c.id)}">${escapeHtml(c.name)}</button>${c.department ? ` <span class="muted">· ${escapeHtml(c.department)}</span>` : ''}
          <div class="muted small">${c.type === 'birthday' ? 'Birthday' : `${c.years} year${c.years === 1 ? '' : 's'} at work`}</div></div>
          <div class="up-when${n === 0 ? ' today' : ''}">${n === 0 ? 'Today 🎈' : n === 1 ? 'Tomorrow' : `in ${n} days`}</div></div>`; }).join('')
      : '<span class="muted">None. Add birthdays and hire dates on the Staff tab.</span>';
  }
  function renderStreakSettings() {
    const k = state.settings.streaks || { shoutOuts: false, leaderboard: 'off', top: 3 };
    $('sk-shout').checked = !!k.shoutOuts; $('sk-where').value = k.leaderboard || 'off'; $('sk-top').value = String(k.top === 1 ? 1 : 3); $('sk-board').value = k.board || 'facility'; $('sk-button').checked = !!k.button;
    syncSegs();
    const top = state.streakTop || [];
    const medal = ['🥇', '🥈', '🥉'];
    const places = [...new Set(top.filter(l => !l.hidden).map(l => l.streak))];
    // Hidden people (department heads who'd always be on top) sit greyed out at the bottom with a Show button.
    $('sk-now').innerHTML = top.length ? top.map(l => { const i = places.indexOf(l.streak); return `<div class="sk-row${l.hidden ? ' off' : ''}"><div class="sk-rank">${medal[i] || i + 1}</div>
        <div class="sk-who"><button class="linkish" data-up-staff="${escapeHtml(l.id)}">${escapeHtml(l.name)}</button>${l.department ? ` <small>· ${escapeHtml(l.department)}</small>` : ''}${l.hidden ? ' <small>· off the board</small>' : ''}</div>
        <div class="sk-n">🔥 ${l.streak} days in a row</div>
        <button class="sk-hide" data-sk-hide="${escapeHtml(l.id)}" data-hidden="${l.hidden ? 1 : 0}" title="${l.hidden ? 'Put them back on the iPad streak board' : 'Take them off the iPad streak board'}">${l.hidden ? 'Show' : 'Hide'}</button></div>`; }).join('')
      : '<div class="muted small">No one has a streak of 3 or more yet.</div>';
  }
  $('sk-now').addEventListener('click', async e => {
    const b = e.target.closest('[data-sk-hide]');
    if (!b) return;
    try { await post(`/api/admin/employees/${b.dataset.skHide}/board`, { hide: b.dataset.hidden !== '1' }); toast(b.dataset.hidden === '1' ? 'Back on the board' : 'Off the board'); await refresh(); }
    catch (err) { fail(err); }
  });
  // Segmented buttons write to the hidden input named in data-for, then save.
  function syncSegs() { document.querySelectorAll('.seg[data-for]').forEach(g => g.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === $(g.dataset.for).value))); }
  document.querySelectorAll('.seg[data-for]').forEach(g => g.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    $(g.dataset.for).value = b.dataset.v; syncSegs();
  }));
  autoSave(document.querySelector('.sk-card'), async () => {
    await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ streaks: { shoutOuts: $('sk-shout').checked, leaderboard: $('sk-where').value, top: Number($('sk-top').value), board: $('sk-board').value, button: $('sk-button').checked } }) });
    await refresh();
  });
  $('an-show-past').addEventListener('change', renderAnnouncements);
  // Pop-up announcements: title, picture (uploaded like topic pictures), once or every time.
  function popupForm() {
    const on = $('an-popup').checked;
    $('an-popup-fields').hidden = !on;
    $('an-text-label').textContent = on ? 'Message under the picture (optional)' : 'Announcement';
    $('an-text').maxLength = on ? 400 : 200; $('an-text').rows = on ? 3 : 1;
    $('an-text').placeholder = on ? 'Scan the code with your phone camera to RSVP by Dec 1.' : '📅 All-staff meeting Thursday at 2 pm in the dining room';
    const custom = annButtons().length > 0;
    $('an-confirm').disabled = !custom; $('an-confirm-wrap').classList.toggle('muted', !custom);
  }
  const annButtons = () => [...$('an-buttons').querySelectorAll('input[type=text]')].map(i => i.value.trim()).filter(Boolean);
  // Buttons ticked "ask again": the person sees the pop-up again next time.
  const annRepeat = () => [...$('an-buttons').querySelectorAll('div')].filter(d => d.querySelector('input[type=checkbox]').checked).map(d => d.querySelector('input[type=text]').value.trim()).filter(Boolean);
  const setAnnButtons = (list, repeat) => $('an-buttons').querySelectorAll('div').forEach((d, n) => {
    const v = (list || [])[n] || '';
    d.querySelector('input[type=text]').value = v;
    d.querySelector('input[type=checkbox]').checked = !!v && (repeat || []).includes(v);
    d.querySelector('.an-rep').classList.toggle('on', d.querySelector('input[type=checkbox]').checked);
  });
  $('an-buttons').addEventListener('input', popupForm);
  $('an-buttons').addEventListener('change', e => { const l = e.target.closest('.an-rep'); if (l) l.classList.toggle('on', e.target.checked); });
  function popupImage(url) {
    $('an-image').value = url || '';
    $('an-image-preview').hidden = !url;
    if (url) $('an-image-preview').querySelector('img').src = url;
  }
  $('an-popup').addEventListener('change', popupForm);
  makeDrop('an-image-file', 'your picture or QR code');
  $('an-image-file').addEventListener('change', async () => {
    const f = $('an-image-file').files[0];
    if (!f) return;
    if (f.size > 10e6) { $('an-image-status').textContent = 'That picture is over 10 MB. Please use a smaller one.'; return; }
    $('an-image-status').textContent = 'Uploading...';
    try {
      const dataUrl = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(f); });
      const r = await post('/api/admin/media', { dataUrl });
      popupImage(r.url);
      $('an-image-status').textContent = '';
    } catch (err) { $('an-image-status').textContent = err.message; }
  });
  $('an-image-clear').addEventListener('click', () => { popupImage(''); $('an-image-file').value = ''; $('an-image-file').dispatchEvent(new Event('change')); });
  // Preview an announcement on the real iPad screens: a pop-up as staff see it after picking their name,
  // a regular one on the last screen (where it's listed after an in-service).
  function previewAnnouncement(a) {
    try { localStorage.setItem('previewDraft', JSON.stringify(a.popup ? { popup: { title: a.title, text: a.text, image: a.image, buttons: a.buttons || [], confirm: !!a.confirm } } : { news: a.text })); } catch { /* private window */ }
    const w = window.open('/admin/preview?show=' + (a.popup ? 'popup' : 'news'), 'inservice-preview', 'width=820,height=1080');
    if (w) w.focus();
  }
  $('an-popup-preview').addEventListener('click', () => previewAnnouncement({ popup: $('an-popup').checked, title: $('an-title').value, text: $('an-text').value, image: $('an-image').value,
    buttons: annButtons(), confirm: $('an-confirm').checked }));
  function clearAnnForm() {
    $('an-text').value = ''; $('an-end').value = ''; $('an-start').value = state.todayDate; renderChecks($('an-depts'), []);
    $('an-popup').checked = false; $('an-title').value = ''; $('an-everytime').checked = false; popupImage(''); $('an-image-file').value = '';
    setAnnButtons([], []); $('an-confirm').checked = false; $('an-error').textContent = ''; popupForm();
  }
  const anEdit = formEditor($('an-add'), clearAnnForm);
  $('an-add').addEventListener('click', async () => {
    $('an-error').textContent = '';
    try {
      const a = state.announcements.find(x => x.id === anEdit.id);
      const lost = a && a.popup ? (a.buttons || []).filter((b, i) => (a.picks || [])[i] && !annButtons().includes(b) && !annButtons()[i]) : [];
      if (lost.length && !await confirm(`People already picked "${lost.join('", "')}". If you remove it, their answers are cleared and they'll see the pop-up again. Save anyway?`, 'Save anyway')) return;
      const body = JSON.stringify({ text: $('an-text').value, departments: checked($('an-depts')), startDate: $('an-start').value, endDate: $('an-end').value,
        popup: $('an-popup').checked, title: $('an-title').value, image: $('an-image').value, everyTime: $('an-everytime').checked,
        buttons: annButtons(), confirm: $('an-confirm').checked, repeat: annRepeat() });
      if (anEdit.id) await api('/api/admin/announcements/' + anEdit.id, { method: 'PUT', body }); else await api('/api/admin/announcements', { method: 'POST', body });
      toast(anEdit.id ? 'Saved. The iPad shows the change within a minute.' : 'Announcement added. The iPad shows it within a minute.');
      if (anEdit.id) anEdit.stop(); else clearAnnForm();
      await refresh();
    } catch (err) { $('an-error').textContent = err.message; }
  });
  $('an-rows').addEventListener('click', async e => {
    const ed = e.target.closest('[data-edit-ann]');
    if (ed) {
      const a = state.announcements.find(x => x.id === ed.dataset.editAnn);
      if (!a) return;
      $('an-popup').checked = !!a.popup; $('an-title').value = a.title || ''; $('an-text').value = a.text || '';
      popupImage(a.image || ''); $('an-image-file').value = ''; $('an-everytime').checked = !!a.everyTime;
      setAnnButtons(a.buttons, a.repeat); $('an-confirm').checked = !!a.confirm;
      $('an-start').value = a.startDate; $('an-end').value = a.endDate || ''; renderChecks($('an-depts'), a.departments);
      popupForm();
      return anEdit.start(a.id, a.popup ? 'Edit pop-up' : 'Edit announcement');
    }
    const sn = e.target.closest('[data-ann-seen]');
    if (sn) { e.preventDefault(); return showSeen(state.announcements.find(x => x.id === sn.dataset.annSeen)); }
    const pv = e.target.closest('[data-prev-ann]');
    if (pv) return previewAnnouncement((state.announcements || []).find(a => a.id === pv.dataset.prevAnn) || {});
    const b = e.target.closest('[data-del-ann]');
    if (!b || !await confirm('Remove this announcement?', 'Remove')) return;
    try { await api('/api/admin/announcements/' + b.dataset.delAnn, { method: 'DELETE' }); toast('Removed'); await refresh(); }
    catch (err) { fail(err); }
  });
  $('add-bday').addEventListener('click', () => focusLast(addClosingRow('', $('an-bday-msgs'), 'Happy birthday, {name}!')));
  $('add-anniv').addEventListener('click', () => focusLast(addClosingRow('', $('an-anniv-msgs'), 'Happy {years}-year anniversary, {name}!')));
  $('add-bbday').addEventListener('click', () => focusLast(addClosingRow('', $('an-bbday-msgs'), 'Happy belated birthday, {name}!')));
  $('add-banniv').addEventListener('click', () => focusLast(addClosingRow('', $('an-banniv-msgs'), 'Happy belated {years}-year anniversary, {name}!')));
  // Plays the real iPad last screen (confetti, balloons, leaderboard) with a pretend person. Unsaved messages are included.
  function previewLastScreen(show) {
    try { localStorage.setItem('previewDraft', JSON.stringify({ messages: { birthdayMessages: closingValues($('an-bday-msgs')), anniversaryMessages: closingValues($('an-anniv-msgs')),
      belatedBirthdayMessages: closingValues($('an-bbday-msgs')), belatedAnniversaryMessages: closingValues($('an-banniv-msgs')) },
      streaks: { board: $('sk-board').value, top: Number($('sk-top').value) } })); } catch { /* preview uses saved messages */ }
    const w = window.open('/admin/preview?show=' + show, 'inservice-preview', 'width=820,height=1080');
    if (w) w.focus();
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-show-preview]'); if (b) previewLastScreen(b.dataset.showPreview); });
  autoSave($('an-save-msgs').closest('.card'), async () => {
    await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ celebrations: $('an-celebrate').checked,
      belated: { on: $('an-belated').checked, days: Number($('an-belated-days').value) || 7 },
      birthdayMessages: closingValues($('an-bday-msgs')), anniversaryMessages: closingValues($('an-anniv-msgs')),
      belatedBirthdayMessages: closingValues($('an-bbday-msgs')), belatedAnniversaryMessages: closingValues($('an-banniv-msgs')) }) });
    await refresh();
  }, [$('an-save-msgs')]);

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
    if (!await confirm('Clear the ticked test data? This can only be undone by restoring a backup.', 'Clear it')) return;
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
        <td><a href="/admin/preview?month=${i + 1}" target="_blank" rel="noopener">Preview</a></td></tr>`;
    }).join('');
  }
  autoSave($('save-decor').closest('.card'), async () => {
    const months = [...$('decor-rows').querySelectorAll('tr')].map(tr => ({
      emoji: tr.querySelector('[data-decor=emoji]').value, message: tr.querySelector('[data-decor=message]').value, color: tr.querySelector('[data-decor=color]').value }));
    await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ decor: { on: $('decor-on').checked, months } }) });
    await refresh();
  }, [$('save-decor')]);
  // ----- extra admin logins -----
  async function loadAdminUsers() {
    try {
      const { users } = await api('/api/admin/users');
      const main = state.isMainAdmin !== false;
      $('au-add').hidden = !main;
      $('au-rows').innerHTML = `<tr><td><strong>${escapeHtml(state.settings.adminName || 'Main login')}</strong><div class="muted small">Main login${state.passwordFromEnv ? ' · password is set in Render' : ''}</div></td><td><code>admin</code></td><td class="muted small">–</td><td></td></tr>` + users.map(u => `<tr>
        <td><strong>${escapeHtml(u.name)}</strong></td><td><code>${escapeHtml(u.username)}</code></td>
        <td class="small">${u.lastSeen ? fmtWhen(u.lastSeen) : '<span class="muted">Not yet</span>'}</td>
        <td style="white-space:nowrap">${main ? `<button class="btn subtle" data-au-pw="${u.id}">New password</button><button class="btn subtle danger" data-au-del="${u.id}">Remove</button>` : ''}</td></tr>`).join('');
    } catch { /* leave */ }
  }
  const makePassword = () => { const w = 'apple brave cedar delta eagle maple ocean pearl river stone tiger tulip'.split(' '); return w[Math.floor(Math.random() * w.length)] + '-' + w[Math.floor(Math.random() * w.length)] + '-' + (10 + Math.floor(Math.random() * 90)); };
  $('au-gen').addEventListener('click', () => { $('au-pass').value = makePassword(); });
  $('au-name').addEventListener('input', () => { if (!$('au-user').dataset.touched) $('au-user').value = $('au-name').value.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9._-]/g, ''); });
  $('au-user').addEventListener('input', () => { $('au-user').dataset.touched = 1; });
  $('au-go').addEventListener('click', async () => {
    $('au-error').textContent = '';
    try {
      await post('/api/admin/users', { name: $('au-name').value, username: $('au-user').value, password: $('au-pass').value });
      alert(`Login added. Send ${$('au-name').value.trim()} these:\n\nAddress: ${location.origin}/admin\nUsername: ${$('au-user').value.trim().toLowerCase()}\nPassword: ${$('au-pass').value}\n\nThey can change their password in Settings after signing in.`);
      $('au-name').value = ''; $('au-user').value = ''; $('au-pass').value = ''; delete $('au-user').dataset.touched;
      loadAdminUsers();
    } catch (err) { $('au-error').textContent = err.message; }
  });
  $('au-rows').addEventListener('click', async e => {
    const pw = e.target.closest('[data-au-pw]'), del = e.target.closest('[data-au-del]');
    try {
      if (pw) {
        const np = await prompt('New password (8+ characters):', makePassword(), 'Set password');
        if (!np) return;
        await post(`/api/admin/users/${pw.dataset.auPw}/password`, { password: np });
        alert('Password changed to: ' + np);
      }
      if (del) {
        if (!await confirm('Remove this login? They will no longer be able to open the admin page.', 'Remove login')) return;
        await api('/api/admin/users/' + del.dataset.auDel, { method: 'DELETE' });
        toast('Login removed');
      }
      loadAdminUsers();
    } catch (err) { alert(err.message); }
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
      if (!await confirm(`Replace ALL current data with "${file.name}"?`, 'Replace everything')) return;
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
  // Bold, italic, underline and strikethrough buttons for text the iPad shows.
  // They wrap the selected words in **, *, __ or ~~, which the iPad turns into the style.
  const FMT_FIELDS = '#f-lesson, #f-es-lesson, .q-text, .q-es-text, #an-text';
  const FMT_GROUPS = '#set-closing, #an-bday-msgs, #an-anniv-msgs, #an-bbday-msgs, #an-banniv-msgs';
  const FMT_MARKS = { b: '**', i: '*', u: '__', s: '~~' };
  let lastFmt = null;
  function applyFmt(field, kind) {
    if (!field) return;
    const m = FMT_MARKS[kind];
    const a = field.selectionStart, z = field.selectionEnd, v = field.value;
    let sel = v.slice(a, z);
    // Keep spaces outside the marks, so "**word **" can't happen.
    const lead = sel.match(/^\s*/)[0], trail = sel.match(/\s*$/)[0];
    sel = sel.trim();
    const before = v.slice(0, a) + lead, after = trail + v.slice(z);
    if (sel && sel.startsWith(m) && sel.endsWith(m) && sel.length > 2 * m.length) {
      // Already styled: take the style off.
      const inner = sel.slice(m.length, -m.length);
      field.value = before + inner + after;
      field.setSelectionRange(before.length, before.length + inner.length);
    } else if (before.endsWith(m) && after.startsWith(m) && sel) {
      field.value = before.slice(0, -m.length) + sel + after.slice(m.length);
      field.setSelectionRange(before.length - m.length, before.length - m.length + sel.length);
    } else {
      const text = sel || 'text';
      field.value = before + m + text + m + after;
      field.setSelectionRange(before.length + m.length, before.length + m.length + text.length);
    }
    field.focus();
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function fmtBar(target) {
    const bar = document.createElement('div');
    bar.className = 'fmt-bar';
    bar.innerHTML = '<button type="button" data-fmt="b" title="Bold (Ctrl or ⌘ + B)"><b>B</b></button><button type="button" data-fmt="i" title="Italic (Ctrl or ⌘ + I)"><i>I</i></button>' +
      '<button type="button" data-fmt="u" title="Underline (Ctrl or ⌘ + U)"><u>U</u></button><button type="button" data-fmt="s" title="Strikethrough (Ctrl or ⌘ + Shift + X)"><s>S</s></button>' +
      '<span class="fmt-tip">Select words, then pick a style</span>';
    bar.addEventListener('mousedown', e => e.preventDefault()); // keep the selection in the text box
    bar.addEventListener('click', e => {
      const b = e.target.closest('[data-fmt]');
      if (b) applyFmt(target || lastFmt, b.dataset.fmt);
    });
    return bar;
  }
  function addFmtBars(root) {
    root.querySelectorAll(FMT_FIELDS).forEach(f => {
      if (f.dataset.fmtBar) return;
      f.dataset.fmtBar = '1';
      const at = f.closest('.clearwrap') || f;
      at.parentNode.insertBefore(fmtBar(f), at);
    });
    root.querySelectorAll(FMT_GROUPS).forEach(g => {
      if (g.dataset.fmtBar) return;
      g.dataset.fmtBar = '1';
      g.parentNode.insertBefore(fmtBar(null), g);
    });
  }
  const isFmtField = el => el && el.matches && (el.matches(FMT_FIELDS) || !!el.closest(FMT_GROUPS) && el.matches('.cm-text'));
  document.addEventListener('focusin', e => { if (isFmtField(e.target)) lastFmt = e.target; });
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || !isFmtField(e.target)) return;
    const k = e.key.toLowerCase();
    const kind = !e.shiftKey && { b: 'b', i: 'i', u: 'u' }[k] || (e.shiftKey && k === 'x' ? 's' : null);
    if (!kind) return;
    e.preventDefault();
    applyFmt(e.target, kind);
  });
  addFmtBars(document);
  new MutationObserver(() => addFmtBars(document)).observe(document.body, { childList: true, subtree: true });


  // Responses start on this week; Any time is one click away.
  refresh().then(() => {
    const [m, t] = rangeFor('week');
    $('resp-from').defaultValue = iso(m); $('resp-to').defaultValue = iso(t);
    const pick = $('resp-from').closest('label').previousElementSibling;
    pick.querySelector('[value=week]').defaultSelected = true; pick.value = 'week';
    // Come back to the page you were on (for example after "← Back" from a printout on the iPhone app).
    let tab = ''; try { tab = localStorage.getItem('adminTab') || ''; } catch { /* none */ }
    const tb = tab && document.querySelector(`#nav button[data-tab="${tab}"]`);
    if (tb && !tb.classList.contains('on')) tb.click();
  }).catch(fail);
})();
