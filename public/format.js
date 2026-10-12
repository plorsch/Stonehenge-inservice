// Turns lesson text into safe HTML.
// Supports: blank line = new paragraph, lines starting with "- " = bullet list, plus the inline styles below.
function formatLesson(text) {
  const inline = formatInline;
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

// **bold**, *italic*, __underline__ and ~~strikethrough~~ in one line of text, as safe HTML.
function formatInline(text) {
  return escapeHtml(text)
    .replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)(.+?)__/g, '<u>$1</u>')
    .replace(/~~(?=\S)(.+?)~~/g, '<s>$1</s>')
    .replace(/(^|[^*\w])\*(?=\S)([^*]+?)\*(?![*\w])/g, '$1<em>$2</em>');
}
// The same text with the style marks removed, for plain-text places like tables and emails.
function stripFormat(text) {
  const d = document.createElement('div');
  d.innerHTML = formatInline(text);
  return d.textContent;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
