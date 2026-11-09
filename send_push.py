"""Сервер «Мои пары»: пуш-напоминания и обновление виджета.

Запускается GitHub Actions каждые 15 минут и работает без участия сайта:
  1. берёт расписание группы с timetable.spbu.ru (API, при сбое — страницы сайта), кеширует на час в Firestore;
  2. применяет выбор пользователя (элективы, преподаватели, пометки, свои занятия) — та же логика, что на сайте;
  3. рассылает пуши ровно за 24 часа до КР/зачёта/экзамена/пересдачи и до срока ДЗ;
  4. обновляет сводку для виджета (widgets/{токен}).

Секреты репозитория: FIREBASE_SA (JSON служебного аккаунта), VAPID_PRIVATE (base64url, 32 байта).
"""
import datetime as dt
import html as htmlmod
import json
import os
import re
import traceback
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import firebase_admin
from firebase_admin import credentials, firestore
from pywebpush import WebPushException, webpush

SITE = 'https://mbryuz.github.io/pary/'
VAPID_PRIVATE = os.environ['VAPID_PRIVATE'].strip()
VAPID_SUB = 'mailto:noreply@mbryuz.github.io'
MSK = dt.timezone(dt.timedelta(hours=3))
CACHE_MIN = 55

firebase_admin.initialize_app(credentials.Certificate(json.loads(os.environ['FIREBASE_SA'])))
db = firestore.client()
NOW = dt.datetime.now(dt.timezone.utc)
TODAY = NOW.astimezone(MSK).date().isoformat()


# ---------- утилиты (повторяют сайт) ----------
def jhash(s):
    """Тот же хеш, что hash() на сайте (djb2 по UTF-16, 32 бита, base36)."""
    h = 5381
    b = s.encode('utf-16-le')
    for i in range(0, len(b), 2):
        h = (h * 33 + (b[i] | (b[i + 1] << 8))) & 0xFFFFFFFF
    digits, out = '0123456789abcdefghijklmnopqrstuvwxyz', ''
    while True:
        h, r = divmod(h, 36)
        out = digits[r] + out
        if not h:
            break
    return 'k' + out


def add_days(d, n):
    return (dt.date.fromisoformat(d) + dt.timedelta(days=n)).isoformat()


def monday_of(d):
    x = dt.date.fromisoformat(d)
    return (x - dt.timedelta(days=x.weekday())).isoformat()


def semester():
    y, md = int(TODAY[:4]), TODAY[5:]
    if md >= '08-01':
        return f'{y}-09-01', f'{y + 1}-02-10'
    if md <= '02-10':
        return f'{y - 1}-09-01', f'{y}-02-10'
    return f'{y}-02-11', f'{y}-07-26'


SEM_FROM, SEM_TO = semester()


def msk(s):            # 'YYYY-MM-DDTHH:MM:SS' (московское) → aware datetime
    return dt.datetime.fromisoformat(s).replace(tzinfo=MSK)


def ctrl_kind(t):
    t = (t or '').lower()
    if re.search(r'зач[её]т|экзам', t):
        return 'zach'
    if 'контрол' in t:
        return 'kr'
    return None


def fk(t):
    k = ctrl_kind(t)
    if not k:
        return None
    return 're' if re.search(r'пересдач', t or '', re.I) else k


def is_lesson(t):
    return bool(re.search(r'лекц|семинар|практ|сам\. работа|лаборатор', t or '', re.I))


def short_name(s):
    return s.replace(' - продвинутый уровень', '')


TITLES = r',\s*(старший научный сотрудник|ведущий научный сотрудник|научный сотрудник|старший преподаватель|преподаватель|доцент|профессор|ассистент|заведующий кафедрой)'


def clean_teacher(s):
    return re.sub(TITLES, '', s or '', flags=re.I).strip()


# ---------- расписание СПбГУ ----------
def http_get(url, timeout=20, headers=None):
    req = urllib.request.Request(url, headers={'Accept-Language': 'ru-RU,ru;q=0.9', 'User-Agent': 'pary-bot/1.0', **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8', 'replace')


def fetch_api(gid):
    j = json.loads(http_get(f'https://timetable.spbu.ru/api/v1/groups/{gid}/events/{SEM_FROM}/{add_days(SEM_TO, 1)}', 15))
    return j.get('Days') or []


WD = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье']
strip = lambda s: re.sub(r'\s+', ' ', htmlmod.unescape(re.sub(r'<[^>]+>', ' ', s or ''))).strip()


def fetch_week_html(gid, monday):
    page = http_get(f'https://timetable.spbu.ru/ECON/StudentGroupEvents/Primary/{gid}/{monday}', 25)
    days = []
    for head, body in re.findall(r'<h4 class="panel-title">(.*?)</h4>\s*</div>\s*<ul[^>]*>(.*?)</ul>', page, re.S):
        head = strip(head).lower()
        off = next((i for i, w in enumerate(WD) if head.startswith(w)), -1)
        if off < 0:
            continue
        date = add_days(monday, off)
        evs = []
        for li in re.findall(r'<li class="common-list-item row">(.*?)</li>', body, re.S):
            dtb = re.search(r'studyevent-datetime[^>]*>(.*?)</div>\s*</div>', li, re.S)
            tm = re.search(r'(\d{1,2}:\d{2})\D+(\d{1,2}:\d{2})', strip(dtb.group(1)) if dtb else '')
            if not tm:
                continue
            subj = re.search(r'studyevent-subject[^>]*>(.*?)</div>\s*</div>\s*</div>', li, re.S)
            locs = re.findall(r'class="address-modal-btn"\s+data-lat="([^"]*)"\s+data-lng="([^"]*)"\s+data-address="([^"]*)"', li)
            loc_block = re.search(r'studyevent-locations[^>]*>(.*?)<div class="col-sm-3 studyevent-educators', li, re.S)
            edu = re.findall(r'<a href="/EducatorEvents/\d+">(.*?)</a>', li)
            evs.append({
                'Start': f'{date}T{tm.group(1).zfill(5)}:00', 'End': f'{date}T{tm.group(2).zfill(5)}:00',
                'Subject': strip(subj.group(1)) if subj else '',
                'LocationsDisplayText': '; '.join(htmlmod.unescape(a) for _, _, a in locs) if locs else strip(loc_block.group(1) if loc_block else ''),
                'EducatorsDisplayText': ', '.join(strip(x) for x in edu),
                'IsCancelled': 'cancelled' in li,
            })
        if evs:
            days.append({'Day': date, 'DayStudyEvents': evs})
    return days


def fetch_html(gid):
    weeks, m = [], monday_of(SEM_FROM)
    while m <= SEM_TO:
        weeks.append(m)
        m = add_days(m, 7)
    with ThreadPoolExecutor(4) as ex:
        res = list(ex.map(lambda w: fetch_week_html(gid, w), weeks))
    return [d for r in res for d in r]


def parse_events(days):
    out, seen = [], set()
    for d in days:
        for e in d.get('DayStudyEvents') or []:
            subj = e.get('Subject') or ''
            i = subj.rfind(', ')
            full = subj[:i] if i > 0 else subj
            typ = subj[i + 2:] if i > 0 else ''
            optional = bool(re.match(r'^(Электив|Факультатив)', full, re.I)) or bool(e.get('IsElective'))
            name = re.sub(r'^(Электив|Факультатив)\.\s*', '', full, flags=re.I)
            loc = e.get('LocationsDisplayText') or ''
            online = bool(re.search(r'информационно-коммуникационных', loc, re.I))
            if online:
                loc = 'Онлайн'
            teacher = clean_teacher(e.get('EducatorsDisplayText'))
            start, end = e['Start'][:19], e['End'][:19]
            ev = {'start': start, 'end': end, 'full': full, 'name': name, 'type': typ, 'optional': optional,
                  'teacher': teacher, 'loc': loc, 'online': online, 'cancelled': bool(e.get('IsCancelled')), 'sk': jhash(full)}
            ev['id'] = '|'.join([start, full, typ, teacher])
            ev['ok'] = jhash(ev['id'])
            key = ev['id'] + '|' + loc
            if key in seen:
                continue
            seen.add(key)
            out.append(ev)
    return sorted(out, key=lambda x: x['start'])


def group_events(gid):
    """Расписание группы с кешем на час (Firestore cache/grp_{id})."""
    ref = db.collection('cache').document(f'grp_{gid}')
    snap = ref.get()
    cached = snap.to_dict() if snap.exists else None
    if cached and (NOW.timestamp() - cached.get('t', 0)) < CACHE_MIN * 60:
        return json.loads(cached['events'])
    try:
        try:
            days = fetch_api(gid)
        except Exception:
            days = fetch_html(gid)
        evs = parse_events(days)
        if not evs and cached:
            raise RuntimeError('пустое расписание')
        ref.set({'t': NOW.timestamp(), 'events': json.dumps(evs, ensure_ascii=False)})
        return evs
    except Exception as e:
        print('schedule fail', gid, e)
        return json.loads(cached['events']) if cached else None


# ---------- «мои пары» (как filterMine на сайте) ----------
def filter_mine(all_evs, p):
    opt, teach, ov = p.get('opt') or {}, p.get('teach') or {}, p.get('ov') or {}
    slots = {}
    for e in all_evs:
        slots.setdefault(e['sk'] + '|' + e['start'], set()).add(e['teacher'])
    par = {k for k, v in slots.items() if len(v) > 1}
    slot_has = set()
    for e in all_evs:
        t, k = teach.get(e['sk']), e['sk'] + '|' + e['start']
        if t and k in par and t in e['teacher']:
            slot_has.add(k)
    res = []
    for e in all_evs:
        if e['optional'] and opt.get(e['sk']) is False:
            continue
        t, k = teach.get(e['sk']), e['sk'] + '|' + e['start']
        if t and k in slot_has and t not in e['teacher']:
            continue
        res.append(e)
    res += expand_mine(p)
    out = []
    for e in res:
        o = ov.get(e['ok'])
        if o:
            e = dict(e)
            if o.get('online'):
                e['online'], e['loc'] = True, 'Онлайн'
            if o.get('cancelled'):
                e['cancelled'] = True
        out.append(e)
    return sorted(out, key=lambda x: x['start'])


def expand_mine(p):
    out = []
    for mid, m in (p.get('mine') or {}).items():
        until = (m.get('until') or SEM_TO) if m.get('repeat') else m['date']
        d = m['date']
        while d <= until:
            if not (m.get('skip') or {}).get(d):
                evid = f'mine|{mid}|{d}'
                out.append({'start': f"{d}T{m['from']}:00", 'end': f"{d}T{m['to']}:00", 'full': m['name'], 'name': m['name'],
                            'type': m.get('type') or 'занятие', 'optional': False, 'teacher': m.get('teacher') or '',
                            'loc': m.get('loc') or '', 'online': bool(re.search('онлайн', m.get('loc') or '', re.I)),
                            'cancelled': False, 'sk': jhash(m['name']), 'id': evid, 'ok': jhash(evid)})
            if not m.get('repeat'):
                break
            d = add_days(d, 7)
    return out


def all_hw(p):
    out = []
    for hid, h in (p.get('hw') or {}).items():
        kind = h.get('kind') or ''
        is_kr = kind == 'kr' or (not kind and h.get('test'))
        is_exam = kind == 'exam'
        auto = is_kr or is_exam
        out.append({**h, 'id': hid, 'is_kr': is_kr, 'is_exam': is_exam,
                    'done': (h.get('due', '') < TODAY) if auto else bool(h.get('done'))})
    return sorted(out, key=lambda h: (h.get('due', ''), h.get('created') or 0))


# ---------- напоминания ----------
def reminders(evs, p):
    out = []
    for e in evs:
        k = fk(e['type'])
        if not k or e['cancelled']:
            continue
        label = 'пересдача' if k == 're' else 'экзамен' if re.search('экзам', e['type'], re.I) else 'зачёт' if k == 'zach' else 'контрольная'
        at = msk(e['start']) - dt.timedelta(days=1)
        out.append({'id': jhash('ev|' + e['ok'] + '|' + e['start']), 'at': at,
                    'title': f"Завтра {label}: {short_name(e['name'])}",
                    'body': f"{e['start'][11:16]} · {'онлайн' if e['online'] else e['loc']}"})
    for h in all_hw(p):
        if h['done'] or h.get('due', '') < TODAY:
            continue
        first = next((e for e in evs if e['name'] == h.get('subject') and e['start'][:10] == h['due'] and not e['cancelled']), None)
        at = (msk(first['start']) if first else msk(h['due'] + 'T09:00:00')) - dt.timedelta(days=1)
        what = 'Завтра зачёт/экзамен' if h['is_exam'] else 'Завтра тест/КР' if h['is_kr'] else 'Завтра сдать'
        out.append({'id': jhash('hw|' + h['id'] + '|' + h['due']), 'at': at, 'title': f"{what}: {h.get('text', '')}",
                    'body': short_name(h.get('subject', '')) + (f" · пара в {first['start'][11:16]}" if first else '')})
    t = p.get('testPush')
    if t:
        try:
            out.append({'id': t['id'], 'at': dt.datetime.fromisoformat(t['at'].replace('Z', '+00:00')), 'title': t.get('title', 'Проверка'), 'body': t.get('body', '')})
        except Exception:
            pass
    return out


def send_pushes(doc, p, evs):
    subs = p.get('push') or {}
    if not subs:
        return 0
    sent = p.get('sentPush') or {}
    upd, n = {}, 0
    rem = reminders(evs, p)
    for r in rem:
        if r['id'] in sent or not (NOW - dt.timedelta(hours=3) <= r['at'] <= NOW):
            continue
        payload = json.dumps({'title': r['title'], 'body': r['body'], 'url': SITE, 'tag': r['id']}, ensure_ascii=False)
        for key, s in subs.items():
            try:
                webpush(subscription_info={'endpoint': s['endpoint'], 'keys': s['keys']}, data=payload,
                        vapid_private_key=VAPID_PRIVATE, vapid_claims={'sub': VAPID_SUB}, ttl=6 * 3600)
                n += 1
            except WebPushException as e:
                code = e.response.status_code if e.response is not None else None
                print('push error', doc.id[:6], key, code, str(e)[:160])
                if code in (404, 410):
                    upd['push.' + key] = firestore.DELETE_FIELD
        upd['sentPush.' + r['id']] = NOW.isoformat()
    # отметки об отправке старше 10 дней больше не нужны
    for sid, when in sent.items():
        try:
            old = dt.datetime.fromisoformat(when) < NOW - dt.timedelta(days=10)
        except Exception:
            old = True
        if old:
            upd['sentPush.' + sid] = firestore.DELETE_FIELD
    if upd:
        doc.reference.update(upd)
    return n


# ---------- виджет (как widgetPayload на сайте) ----------
def room(e):
    if e['online']:
        return 'онлайн'
    loc = e['loc'] or ''
    return 'ауд. ' + loc.split(',')[-1].strip() if ',' in loc else loc


def widget_payload(evs, p):
    lim = add_days(TODAY, 10)
    ev = [{'s': e['start'] + '+03:00', 'e': e['end'] + '+03:00', 'n': short_name(e['name']), 't': e['type'], 'l': room(e), 'k': fk(e['type']) or ''}
          for e in evs if not e['cancelled'] and TODAY <= e['start'][:10] <= lim][:60]
    dl = []
    for h in all_hw(p):
        if not h['done'] and h.get('due', '') >= TODAY:
            dl.append({'d': h['due'], 't': h.get('text', ''), 'sub': short_name(h.get('subject', '')), 'k': 'exam' if h['is_exam'] else 'kr' if h['is_kr'] else 'hw'})
    for e in evs:
        k = fk(e['type'])
        if k and not e['cancelled'] and TODAY <= e['start'][:10] <= add_days(TODAY, 30):
            t = 'Пересдача' if k == 're' else 'Экзамен' if re.search('экзам', e['type'], re.I) else 'Зачёт' if k == 'zach' else 'КР'
            dl.append({'d': e['start'] + '+03:00', 't': t, 'sub': short_name(e['name']), 'k': k})
    dl.sort(key=lambda x: x['d'])
    return {'name': (p.get('group') or {}).get('name', ''), 'events': ev, 'deadlines': dl[:10]}


def update_widget(uid, p, evs):
    tok = p.get('widgetToken')
    if not tok:
        return False
    data = widget_payload(evs, p)
    ref = db.collection('widgets').document(tok)
    snap = ref.get()
    if snap.exists:
        try:
            old = json.loads(snap.to_dict().get('json', '{}'))
            upd = old.pop('updated', None)
            fresh = upd and dt.datetime.fromisoformat(upd.replace('Z', '+00:00')) > NOW - dt.timedelta(hours=6)
            if old == data and fresh:      # не изменилось и недавно подтверждали — не пишем
                return False
        except Exception:
            pass
    ref.set({'uid': uid, 'json': json.dumps({**data, 'updated': NOW.isoformat()}, ensure_ascii=False)})
    return True


# ---------- главный цикл ----------
groups, stats = {}, {'users': 0, 'pushes': 0, 'widgets': 0, 'errors': 0}
for doc in db.collection('users').stream():
    p = doc.to_dict() or {}
    gid = (p.get('group') or {}).get('id')
    if not gid or not (p.get('push') or p.get('widgetToken')):
        continue
    stats['users'] += 1
    try:
        if gid not in groups:
            groups[gid] = group_events(gid)
        base = groups[gid]
        if base is None:
            continue
        evs = filter_mine([dict(e) for e in base], p)
        stats['pushes'] += send_pushes(doc, p, evs)
        stats['widgets'] += 1 if update_widget(doc.id, p, evs) else 0
    except Exception:
        stats['errors'] += 1
        traceback.print_exc()

print('done', stats, 'at', NOW.isoformat())
