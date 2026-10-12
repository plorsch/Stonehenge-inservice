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

// Fonts for end-screen messages. Built into iPads and Macs, with look-alike fallbacks elsewhere.
const MESSAGE_FONTS = {
  '': { label: 'Standard', css: "" },
  hand: { label: 'Handwritten', css: "'Bradley Hand', 'Noteworthy', 'Segoe Print', cursive" },
  marker: { label: 'Marker', css: "'Marker Felt', 'Chalkboard SE', 'Comic Sans MS', cursive" },
  chalk: { label: 'Chalkboard', css: "'Chalkboard SE', 'Chalkboard', 'Comic Sans MS', cursive" },
  script: { label: 'Fancy script', css: "'Snell Roundhand', 'Apple Chancery', 'Brush Script MT', cursive" },
  type: { label: 'Typewriter', css: "'American Typewriter', 'Courier New', monospace" },
  serif: { label: 'Classic serif', css: "Georgia, 'Times New Roman', serif" },
  bold: { label: 'Big and bold', css: "Futura, 'Avenir Next', 'Arial Black', sans-serif", weight: 800 }
};
const MESSAGE_SIZES = { s: ['Small', 20], m: ['Normal', 26], l: ['Large', 34], xl: ['Huge', 46] };
// An end-screen message is plain text, or { text, font, color, size, gif }.
const messageText = m => typeof m === 'string' ? m : (m && m.text) || '';
function messageStyle(m) {
  if (!m || typeof m === 'string') return '';
  const f = MESSAGE_FONTS[m.font] || MESSAGE_FONTS[''];
  return [f.css && `font-family:${f.css}`, f.weight && `font-weight:${f.weight}`, /^#[0-9a-f]{6}$/i.test(m.color || '') && `color:${m.color}`,
    MESSAGE_SIZES[m.size] && `font-size:${MESSAGE_SIZES[m.size][1]}px`].filter(Boolean).join(';');
}
// A message with line breaks kept, each line styled.
const formatMessage = text => String(text || '').split('\n').map(formatInline).join('<br>');
// A GIPHY page link (giphy.com/gifs/happy-dance-abc123) becomes the GIF itself, so either kind of link works.
function gifUrl(v) {
  const s = String(v || '').trim();
  const m = s.match(/^https?:\/\/(?:www\.)?giphy\.com\/(?:gifs|stickers)\/(?:[\w-]*-)?([A-Za-z0-9]+)\/?(?:[?#].*)?$/) || s.match(/^https?:\/\/gph\.is\/g\/([A-Za-z0-9]+)/);
  return m && !/^https?:\/\/gph/.test(s) ? `https://media.giphy.com/media/${m[1]}/giphy.gif` : s;
}
