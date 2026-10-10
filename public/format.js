// Turns lesson text into safe HTML.
// Supports: blank line = new paragraph, lines starting with "- " = bullet list, **bold**.
function formatLesson(text) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const out = [];
  let para = [];
  let list = [];
  const flushPara = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
  const flushList = () => { if (list.length) { out.push('<ul>' + list.map(li => '<li>' + inline(li) + '</li>').join('') + '</ul>'); list = []; } };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (/^[-•*]\s+/.test(line)) { flushPara(); list.push(line.replace(/^[-•*]\s+/, '')); }
    else if (!line) { flushPara(); flushList(); }
    else { flushList(); para.push(line); }
  }
  flushPara(); flushList();
  return out.join('');
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
