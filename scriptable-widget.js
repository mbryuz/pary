// «Мои пары» — виджет для Scriptable (iPhone).
// Скрипт сгенерирован на https://mbryuz.github.io/pary/ — строки TOKEN и API_KEY не меняй.
// Размеры: маленький, средний, большой; на экране блокировки — строка, прямоугольник, круг.

const TOKEN = '__TOKEN__';
const API_KEY = '__KEY__';
const SITE = 'https://mbryuz.github.io/pary/';
const CACHE = 'pary_widget_cache_' + TOKEN.slice(0, 6);

const C = {
  bg1: new Color('#5b50f0'), bg2: new Color('#8b3fe8'),
  white: Color.white(), dim: new Color('#ffffff', 0.72), faint: new Color('#ffffff', 0.5),
  chip: new Color('#ffffff', 0.18), warn: new Color('#ffd27a'), bad: new Color('#ffb4b4')
};

async function load() {
  const url = `https://firestore.googleapis.com/v1/projects/raspisanie-spbu/databases/(default)/documents/widgets/${TOKEN}?key=${API_KEY}`;
  try {
    const r = new Request(url);
    r.timeoutInterval = 15;
    const j = await r.loadJSON();
    if (!j.fields || !j.fields.json) throw new Error('нет данных');
    const s = j.fields.json.stringValue;
    Keychain.set(CACHE, s);
    return JSON.parse(s);
  } catch (e) {
    if (Keychain.contains(CACHE)) return JSON.parse(Keychain.get(CACHE));
    return null;
  }
}

const pad = n => String(n).padStart(2, '0');
const hm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
const sod = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const dayDiff = (d, now) => Math.round((sod(d) - sod(now)) / 864e5);
function dayLabel(d, now) {
  const diff = dayDiff(d, now);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  const f = new DateFormatter(); f.locale = 'ru_RU'; f.dateFormat = 'EEE, d MMM';
  return f.string(d);
}
function until(d, now) {
  const m = Math.round((d - now) / 60000);
  if (m <= 0) return 'сейчас';
  if (m < 60) return `через ${m} мин`;
  const days = dayDiff(d, now);
  if (days === 0) return `через ${Math.floor(m / 60)} ч${m % 60 ? ' ' + (m % 60) + ' мин' : ''}`;
  return days === 1 ? 'завтра' : `через ${days} дн.`;
}
function txt(stack, s, size, weight, color, lines) {
  const t = stack.addText(String(s));
  t.font = weight === 'b' ? Font.boldSystemFont(size) : weight === 'm' ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  t.textColor = color || C.white;
  if (lines) t.lineLimit = lines;
  return t;
}
const kindIcon = k => ({ exam: '🎓', zach: '🎓', kr: '📝', re: '🔁', hw: '📌' }[k] || '📌');

// ---------- данные ----------
const data = await load();
const now = new Date();
const fam = config.widgetFamily || 'medium';
const evs = ((data && data.events) || []).map(e => ({ ...e, S: new Date(e.s), E: new Date(e.e) })).filter(e => e.E > now);
const cur = evs.find(e => e.S <= now);
const next = evs.find(e => e.S > now);
const show = cur || next;
const todayRest = evs.filter(e => dayDiff(e.S, now) === 0 && e !== show);
const dls = ((data && data.deadlines) || []).map(d => ({ ...d, D: new Date(d.d.length === 10 ? d.d + 'T12:00:00+03:00' : d.d) }))
  .filter(d => d.d.length === 10 ? dayDiff(d.D, now) >= 0 : d.D > now);
const stale = data && data.updated && (now - new Date(data.updated)) > 3 * 864e5;

const w = new ListWidget();
w.url = SITE;
w.refreshAfterDate = new Date(Date.now() + 15 * 60000);

if (fam.startsWith('accessory')) {
  // ---------- экран блокировки ----------
  if (fam === 'accessoryInline') {
    txt(w, show ? `${hm(show.S)} ${show.n}${show.l ? ' · ' + show.l : ''}` : 'Пар нет', 12, 'm');
  } else if (fam === 'accessoryCircular') {
    w.addSpacer();
    const t1 = txt(w, show ? hm(show.S) : '—', 13, 'b'); t1.centerAlignText();
    const t2 = txt(w, show ? (cur ? 'идёт' : dayDiff(show.S, now) ? dayLabel(show.S, now).slice(0, 5) : 'пара') : 'пар нет', 9); t2.centerAlignText();
    w.addSpacer();
  } else {
    if (show) {
      txt(w, `${cur ? 'Сейчас' : dayDiff(show.S, now) ? dayLabel(show.S, now) : 'Далее'} · ${hm(show.S)}–${hm(show.E)}`, 12, 'b', null, 1);
      txt(w, show.n, 13, 'm', null, 1);
      txt(w, [show.l, cur ? `до конца ${Math.round((show.E - now) / 60000)} мин` : until(show.S, now)].filter(Boolean).join(' · '), 11, '', null, 1);
    } else {
      txt(w, 'Пар нет', 13, 'b');
      if (dls[0]) txt(w, `${dayLabel(dls[0].D, now)}: ${dls[0].t}`, 11, '', null, 2);
    }
  }
} else {
  // ---------- экран «Домой» ----------
  const g = new LinearGradient();
  g.colors = [C.bg1, C.bg2]; g.locations = [0, 1];
  g.startPoint = new Point(0, 0); g.endPoint = new Point(1, 1);
  w.backgroundGradient = g;
  w.setPadding(14, 14, 12, 14);

  const nextBlock = (st, big) => {
    if (!data) { txt(st, 'Мои пары', 14, 'b'); txt(st, 'Открой сайт, чтобы виджет получил данные', 11, '', C.dim, 3); return; }
    if (!show) { txt(st, 'ПАР НЕТ', 10, 'b', C.dim); txt(st, 'Ближайшие 10 дней свободны 🎉', big ? 15 : 13, 'b', null, 3); return; }
    txt(st, (cur ? 'СЕЙЧАС' : dayDiff(show.S, now) ? dayLabel(show.S, now).toUpperCase() : 'ДАЛЕЕ') + ' · ' + (cur ? `ещё ${Math.round((show.E - now) / 60000)} мин` : until(show.S, now)), 10, 'b', C.dim, 1);
    st.addSpacer(3);
    txt(st, `${hm(show.S)}–${hm(show.E)}`, big ? 22 : 18, 'b', null, 1);
    txt(st, show.n, big ? 15 : 13, 'm', null, big ? 2 : 3);
    st.addSpacer(2);
    txt(st, [show.t, show.l].filter(Boolean).join(' · '), 11, '', C.dim, 2);
  };
  const dlLine = (st, d, size) => {
    const row = st.addStack(); row.spacing = 4;
    txt(row, kindIcon(d.k), size);
    txt(row, `${dayLabel(d.D, now)}: ${d.t}${d.sub && d.k === 'hw' ? ' · ' + d.sub : d.sub ? ' ' + d.sub : ''}`, size, '', dayDiff(d.D, now) <= 1 ? C.warn : C.white, 1);
  };
  const evLine = (st, e, size) => {
    const row = st.addStack(); row.spacing = 6;
    txt(row, hm(e.S), size, 'b');
    txt(row, e.n + (e.l ? ' · ' + e.l : ''), size, '', C.dim, 1);
  };

  if (fam === 'small') {
    nextBlock(w, false);
    w.addSpacer();
    if (dls[0]) dlLine(w, dls[0], 10);
  } else if (fam === 'medium') {
    const row = w.addStack(); row.layoutHorizontally();
    const left = row.addStack(); left.layoutVertically(); left.size = new Size(150, 0);
    nextBlock(left, false);
    left.addSpacer();
    row.addSpacer(10);
    const right = row.addStack(); right.layoutVertically();
    if (todayRest.length) {
      txt(right, 'ЕЩЁ СЕГОДНЯ', 9, 'b', C.faint);
      todayRest.slice(0, 2).forEach(e => evLine(right, e, 11));
      right.addSpacer(6);
    }
    txt(right, 'ДЕДЛАЙНЫ', 9, 'b', C.faint);
    if (dls.length) dls.slice(0, todayRest.length ? 2 : 4).forEach(d => dlLine(right, d, 11));
    else txt(right, 'Ничего не горит 🎉', 11, '', C.dim);
    right.addSpacer();
  } else {
    const head = w.addStack(); head.centerAlignContent();
    txt(head, 'Мои пары', 13, 'b', C.dim);
    head.addSpacer();
    if (data && data.name) txt(head, data.name, 11, '', C.faint);
    w.addSpacer(8);
    nextBlock(w, true);
    w.addSpacer(10);
    txt(w, todayRest.length ? 'ЕЩЁ СЕГОДНЯ' : 'СЕГОДНЯ БОЛЬШЕ ПАР НЕТ', 9, 'b', C.faint);
    todayRest.slice(0, 4).forEach(e => evLine(w, e, 12));
    w.addSpacer(10);
    txt(w, 'ДЕДЛАЙНЫ', 9, 'b', C.faint);
    if (dls.length) dls.slice(0, 5).forEach(d => dlLine(w, d, 12));
    else txt(w, 'Ничего не горит 🎉', 12, '', C.dim);
    w.addSpacer();
  }
  if (stale) { w.addSpacer(2); txt(w, 'Давно не обновлялось — открой сайт', 9, '', C.bad, 1); }
}

if (config.runsInWidget) Script.setWidget(w);
else await w.presentMedium();
Script.complete();
