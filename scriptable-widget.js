// «Мои пары» — виджет для Scriptable (iPhone).
// Скрипт сгенерирован на https://mbryuz.github.io/pary/ — строки TOKEN и API_KEY не меняй.
//
// Варианты (в настройках виджета, поле «Parameter»):
//   пусто   — мои пары
//   вместе  — мои пары и пары партнёра рядом + когда вы оба свободны (нужен «Совместный режим»)
// Размеры: маленький, средний, большой; на экране блокировки — строка, прямоугольник, круг.

const TOKEN = '__TOKEN__';
const API_KEY = '__KEY__';
const SITE = 'https://mbryuz.github.io/pary/';
const CACHE = 'pary_widget_cache_' + TOKEN.slice(0, 6);

// ---------- цвета: светлые днём, тёмные при тёмной теме iPhone ----------
const dyn = (l, d) => Color.dynamic(new Color(l), new Color(d));
const C = {
  bg: dyn('#ffffff', '#1e1c1b'),
  txt: dyn('#1d1b1a', '#f5f2ef'),
  dim: dyn('#7a736e', '#a8a29e'),
  chip: dyn('#fff1e4', '#2d2620'),
  chip2: dyn('#f2f0ee', '#2a2826'),
  or: new Color('#ff7a00'),
  or2: new Color('#ff5a00'),
  white: Color.white(),
  ok: dyn('#1f9d55', '#4ade80'),
  okbg: dyn('#e6f6ec', '#1d3326')
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

// ---------- утилиты ----------
const pad = n => String(n).padStart(2, '0');
const hm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
const sod = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const dayDiff = (d, now) => Math.round((sod(d) - sod(now)) / 864e5);
const fmt = (d, f) => { const x = new DateFormatter(); x.locale = 'ru_RU'; x.dateFormat = f; return x.string(d); };
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const WDL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
function dayLabel(d, now) {
  const diff = dayDiff(d, now);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  return fmt(d, 'EEE, d MMM');
}
function until(d, now) {
  const m = Math.round((d - now) / 60000);
  if (m <= 0) return 'сейчас';
  if (m < 60) return `через ${m} мин`;
  if (dayDiff(d, now) === 0) return `через ${Math.floor(m / 60)} ч${m % 60 ? ' ' + (m % 60) + ' мин' : ''}`;
  return dayDiff(d, now) === 1 ? 'завтра' : `через ${dayDiff(d, now)} дн.`;
}
const plural = (n, a, b, c) => { const x = n % 10, y = n % 100; return n + ' ' + (x === 1 && y !== 11 ? a : x >= 2 && x <= 4 && (y < 10 || y >= 20) ? b : c); };
const shortN = s => s.replace('Английский язык в сфере профессиональной коммуникации', 'Английский язык').replace('Экспериментальная', 'Эксп.');
function txt(st, s, size, weight, color, lines) {
  const t = st.addText(String(s));
  t.font = weight === 'b' ? Font.boldSystemFont(size) : weight === 'm' ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  t.textColor = color || C.txt;
  if (lines) t.lineLimit = lines;
  return t;
}
function card(parent, title, sub, opt = {}) {
  const c = parent.addStack();
  c.layoutHorizontally(); c.centerAlignContent();
  c.cornerRadius = 10;
  c.setPadding(opt.pv || 5, 8, opt.pv || 5, 8);
  if (opt.now) {
    const g = new LinearGradient(); g.colors = [C.or, C.or2]; g.locations = [0, 1];
    g.startPoint = new Point(0, 0); g.endPoint = new Point(1, 1); c.backgroundGradient = g;
  } else c.backgroundColor = opt.bg || C.chip;
  if (opt.hot) { c.borderColor = C.or; c.borderWidth = 1.5; }
  if (opt.icon) {
    const ic = c.addStack(); ic.size = new Size(16, 16); ic.cornerRadius = 4; ic.centerAlignContent();
    ic.backgroundColor = opt.now ? C.white : opt.iconColor || C.or;
    const t = ic.addText(opt.icon); t.font = Font.boldSystemFont(9); t.textColor = opt.now ? C.or : C.white;
    c.addSpacer(7);
  }
  const col = c.addStack(); col.layoutVertically();
  txt(col, title, opt.size || 13, 'm', opt.now ? C.white : opt.titleColor || C.txt, 1);
  if (sub) txt(col, sub, (opt.size || 13) - 1.5, '', opt.now ? new Color('#ffffff', 0.86) : C.dim, 1);
  c.addSpacer();
  return c;
}
const label = (st, s) => { const t = txt(st, s.toUpperCase(), 10, 'b', C.dim, 1); return t; };

// ---------- данные ----------
const data = await load();
const now = new Date();
const fam = config.widgetFamily || 'large';
const mode = String(args.widgetParameter || '').trim().toLowerCase();
const together = /вмест|together|мы/.test(mode);
const toEv = list => (list || []).map(e => ({ ...e, S: new Date(e.s), E: new Date(e.e) }));
const mine = toEv(data && data.events);
const partner = data && data.partner ? { name: data.partner.name || 'Партнёр', events: toEv(data.partner.events) } : null;
const upcoming = mine.filter(e => e.E > now);
const cur = upcoming.find(e => e.S <= now);
const next = upcoming.find(e => e.S > now);
const show = cur || next;
const dls = ((data && data.deadlines) || []).map(d => ({ ...d, D: new Date(d.d.length === 10 ? d.d + 'T12:00:00+03:00' : d.d) }))
  .filter(d => d.d.length === 10 ? dayDiff(d.D, now) >= 0 : d.D > now);
const stale = data && data.updated && (now - new Date(data.updated)) > 2 * 864e5;

const w = new ListWidget();
w.url = SITE;
w.refreshAfterDate = new Date(Date.now() + 15 * 60000);

// ---------- экран блокировки ----------
function lockScreen() {
  if (fam === 'accessoryInline') { txt(w, show ? `${hm(show.S)} ${shortN(show.n)}${show.l ? ' · ' + show.l : ''}` : 'Пар нет', 12, 'm'); return; }
  if (fam === 'accessoryCircular') {
    w.addSpacer();
    txt(w, show ? hm(show.S) : '—', 13, 'b').centerAlignText();
    txt(w, show ? (cur ? 'идёт' : dayDiff(show.S, now) ? dayLabel(show.S, now).slice(0, 5) : 'пара') : 'пар нет', 9).centerAlignText();
    w.addSpacer();
    return;
  }
  if (show) {
    txt(w, `${cur ? 'Сейчас' : dayDiff(show.S, now) ? dayLabel(show.S, now) : 'Далее'} · ${hm(show.S)}–${hm(show.E)}`, 12, 'b', null, 1);
    txt(w, shortN(show.n), 13, 'm', null, 1);
    txt(w, [show.l, cur ? `до конца ${Math.round((show.E - now) / 60000)} мин` : until(show.S, now)].filter(Boolean).join(' · '), 11, '', null, 1);
  } else {
    txt(w, 'Пар нет', 13, 'b');
    if (dls[0]) txt(w, `${dayLabel(dls[0].D, now)}: ${dls[0].t}`, 11, '', null, 2);
  }
}

// ---------- мои пары ----------
function dayHead(st, d, big) {
  const col = st.addStack(); col.layoutVertically();
  txt(col, (big ? WDL : WD)[d.getDay()], big ? 13 : 13, 'm', C.or);
  txt(col, big ? fmt(d, 'd MMMM') : String(d.getDate()), big ? 24 : 34, '', C.txt, 1);
  return col;
}
function mineWidget() {
  const day = show ? show.S : now;
  const dayEvs = upcoming.filter(e => dayDiff(e.S, day) === 0);
  const pairCard = (st, e, size) => card(st, shortN(e.n), [`${hm(e.S)}–${hm(e.E)}`, e.l, e === show && !cur ? until(e.S, now) : e === cur ? `ещё ${Math.round((e.E - now) / 60000)} мин` : ''].filter(Boolean).join(' · '), { now: e === show, icon: e === show ? '▶' : '●', size });
  const dlCard = (st, d, size) => card(st, d.t, [dayLabel(d.D, now), d.sub].filter(Boolean).join(' · '), { icon: d.k === 'hw' ? '◆' : '!', hot: dayDiff(d.D, now) <= 1, bg: C.bg, size, iconColor: C.or });

  if (fam === 'small') {
    const top = w.addStack(); top.layoutHorizontally();
    dayHead(top, day, false); top.addSpacer();
    if (show) { const u = top.addStack(); u.layoutVertically(); txt(u, cur ? 'идёт' : until(show.S, now), 11, 'm', C.or, 2).rightAlignText(); }
    w.addSpacer();
    if (show) card(w, shortN(show.n), `${hm(show.S)}–${hm(show.E)}`, { now: true, icon: '▶', size: 12 });
    else txt(w, 'Пар нет 🎉', 13, 'm');
    if (dls[0]) { w.addSpacer(4); dlCard(w, dls[0], 12); }
    return;
  }
  if (fam === 'medium') {
    const row = w.addStack(); row.layoutHorizontally();
    const left = row.addStack(); left.layoutVertically(); left.size = new Size(62, 0);
    dayHead(left, day, false);
    txt(left, dayEvs.length ? plural(dayEvs.length, 'пара', 'пары', 'пар') : 'пар нет', 11, '', C.dim);
    left.addSpacer();
    row.addSpacer(6);
    const right = row.addStack(); right.layoutVertically(); right.spacing = 4;
    if (!show) { txt(right, 'Ближайшие 10 дней пар нет 🎉', 13, 'm', null, 2); if (dls[0]) dlCard(right, dls[0], 12); }
    else dayEvs.slice(0, 3).forEach(e => pairCard(right, e, 13));
    right.addSpacer();
    return;
  }
  // большой
  const head = w.addStack(); head.layoutHorizontally(); head.bottomAlignContent();
  dayHead(head, day, true); head.addSpacer();
  const hr = head.addStack(); hr.layoutVertically();
  txt(hr, 'Мои пары', 11, '', C.dim).rightAlignText();
  if (data && data.name) txt(hr, data.name, 11, '', C.dim).rightAlignText();
  w.addSpacer(8);
  const list = w.addStack(); list.layoutVertically(); list.spacing = 4;
  if (!show) txt(list, 'Ближайшие 10 дней пар нет 🎉', 14, 'm');
  else dayEvs.slice(0, 4).forEach(e => pairCard(list, e, 13));
  if (dayEvs.length > 4) txt(list, `+ ещё ${dayEvs.length - 4}`, 11, '', C.dim);
  w.addSpacer(10);
  label(w, 'Дедлайны'); w.addSpacer(4);
  const dl = w.addStack(); dl.layoutVertically(); dl.spacing = 4;
  if (!dls.length) txt(dl, 'Ничего не горит 🎉', 12, '', C.dim);
  dls.slice(0, 2).forEach((d, i) => dlCard(dl, d, 13));
  if (dls.length > 2) txt(dl, `+ ещё ${dls.length - 2}`, 11, '', C.dim);
  w.addSpacer();
}

// ---------- вместе ----------
function freeWindows(a, b) {
  const mins = d => d.getHours() * 60 + d.getMinutes();
  const busy = a.concat(b).map(e => [mins(e.S), mins(e.E)]).sort((x, y) => x[0] - y[0]);
  const out = []; let t = 9 * 60;
  for (const [s, e] of busy) { if (s - t >= 60) out.push([t, s]); t = Math.max(t, e); }
  if (21 * 60 - t >= 60) out.push([t, 21 * 60]);
  return out;
}
const fmtMin = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
function timeline(a, b, wins, W) {
  const H = 44, dc = new DrawContext();
  dc.size = new Size(W, H); dc.opaque = false; dc.respectScreenScale = true;
  const x = m => (m - 540) / 720 * W;
  const mins = d => d.getHours() * 60 + d.getMinutes();
  const rr = (X, Y, w2, h, r, color) => { const p = new Path(); p.addRoundedRect(new Rect(X, Y, Math.max(w2, 2), h), r, r); dc.addPath(p); dc.setFillColor(color); dc.fillPath(); };
  rr(0, 0, W, H, 10, new Color('#8a8580', 0.14));
  wins.forEach(([s, e]) => rr(x(s), 0, x(e) - x(s), H, 6, new Color('#22c55e', 0.22)));
  a.forEach(e => rr(x(Math.max(540, mins(e.S))), 5, x(Math.min(1260, mins(e.E))) - x(Math.max(540, mins(e.S))) - 3, 16, 5, new Color('#ff7a00')));
  b.forEach(e => rr(x(Math.max(540, mins(e.S))), 23, x(Math.min(1260, mins(e.E))) - x(Math.max(540, mins(e.S))) - 3, 16, 5, new Color('#a8a29e')));
  return dc.getImage();
}
function togetherWidget() {
  if (!partner) {
    txt(w, 'Мы', 14, 'b'); w.addSpacer(6);
    txt(w, 'Включи «Совместный режим» на сайте — тогда здесь появятся пары партнёра и общие свободные окна.', 12, '', C.dim, 5);
    return;
  }
  const day = now.getHours() >= 20 ? new Date(now.getTime() + 864e5) : now;
  const A = mine.filter(e => dayDiff(e.S, day) === 0), B = partner.events.filter(e => dayDiff(e.S, day) === 0);
  const wins = freeWindows(A, B);
  const pn = partner.name;
  const isToday = dayDiff(day, now) === 0;

  const head = w.addStack(); head.layoutHorizontally(); head.bottomAlignContent();
  txt(head, (fam === 'large' ? WDL : WD)[day.getDay()], 13, 'm', C.or); head.addSpacer(6);
  txt(head, fmt(day, 'd MMMM'), fam === 'large' ? 20 : 17, 'm'); head.addSpacer();
  txt(head, isToday ? 'Мы · сегодня' : 'Мы · завтра', 11, '', C.dim);
  w.addSpacer(8);

  if (fam === 'small') {
    const one = (who, list) => { const e = list.find(x => x.E > now) || null; label(w, who); txt(w, e ? `${hm(e.S)} ${shortN(e.n)}` : 'свободен(на)', 12, 'm', e ? C.txt : C.ok, 1); w.addSpacer(4); };
    one('Я', A); one(pn, B);
    w.addSpacer();
    txt(w, wins.length ? `💞 с ${fmtMin(wins[wins.length - 1][0])}` : 'общих окон нет', 11, 'b', C.ok, 1);
    return;
  }
  const max = fam === 'large' ? 4 : 2;
  const cols = w.addStack(); cols.layoutHorizontally(); cols.topAlignContent();
  const col = (who, list, her) => {
    const c = cols.addStack(); c.layoutVertically(); c.spacing = 4; c.size = new Size(fam === 'large' ? 150 : 145, 0);
    label(c, fam === 'large' ? who : `${who} · ${list.length ? plural(list.length, 'пара', 'пары', 'пар') : 'без пар'}`);
    list.slice(0, max).forEach(e => card(c, shortN(e.n), `${hm(e.S)}–${hm(e.E)}${e.l ? ' · ' + e.l.replace('ауд. ', '') : ''}`, { now: !her && e === show, bg: her ? C.chip2 : C.chip, size: 12, pv: 4 }));
    if (list.length > max) txt(c, `+ ещё ${list.length - max} · до ${hm(list[list.length - 1].E)}`, 10, '', C.dim);
    else if (list.length && fam === 'large') txt(c, `После ${hm(list[list.length - 1].E)} ${her ? 'свободна' : 'свободен'}`, 11, 'm', C.ok);
    else if (!list.length) txt(c, her ? 'Весь день свободна' : 'Весь день свободен', 11, 'm', C.ok);
  };
  col('Я', A, false); cols.addSpacer(8); col(pn, B, true);
  if (fam === 'large') {
    w.addSpacer();
    label(w, 'День'); w.addSpacer(4);
    const img = w.addImage(timeline(A, B, wins, 300)); img.imageSize = new Size(300, 44);
    const ticks = w.addStack(); ticks.layoutHorizontally(); ticks.size = new Size(300, 0);
    ['9', '12', '15', '18', '21'].forEach((t, i) => { if (i) ticks.addSpacer(); txt(ticks, t, 9, '', C.dim); });
    w.addSpacer(8);
  } else w.addSpacer();
  const win = w.addStack(); win.backgroundColor = C.okbg; win.cornerRadius = 10; win.setPadding(5, 9, 5, 9);
  txt(win, wins.length ? '💞 Оба свободны: ' + wins.map(([s, e]) => `${fmtMin(s)}–${fmtMin(e)}`).join(', ') : 'Общих свободных окон днём нет', 12, 'b', C.ok, 1);
  win.addSpacer();
}

// ---------- сборка ----------
if (fam.startsWith('accessory')) lockScreen();
else {
  w.backgroundColor = C.bg;
  w.setPadding(14, 14, 12, 14);
  if (!data) { txt(w, 'Мои пары', 14, 'b'); txt(w, 'Открой сайт, чтобы виджет получил данные', 12, '', C.dim, 3); }
  else if (together) togetherWidget();
  else mineWidget();
  if (stale) { w.addSpacer(2); txt(w, 'Данные давно не обновлялись', 9, '', C.or2, 1); }
}

if (config.runsInWidget) Script.setWidget(w);
else if (together) await w.presentLarge();
else await w.presentMedium();
Script.complete();
