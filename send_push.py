"""Рассылка пуш-напоминаний «Мои пары».

Запускается GitHub Actions каждые 15 минут. Сайт сам кладёт в профиль пользователя
список reminders [{id, at, title, body}], здесь отправляются те, время которых подошло
(не старше 3 часов) и которые ещё не отправлялись (sentPush).

Секреты репозитория:
  FIREBASE_SA   — JSON служебного аккаунта Firebase (Project settings → Service accounts)
  VAPID_PRIVATE — приватный ключ VAPID (base64url, 32 байта)
"""
import datetime as dt
import json
import os

import firebase_admin
from firebase_admin import credentials, firestore
from pywebpush import WebPushException, webpush

SITE = 'https://mbryuz.github.io/pary/'
VAPID_PRIVATE = os.environ['VAPID_PRIVATE'].strip()
VAPID_SUB = 'mailto:noreply@mbryuz.github.io'

firebase_admin.initialize_app(credentials.Certificate(json.loads(os.environ['FIREBASE_SA'])))
db = firestore.client()
now = dt.datetime.now(dt.timezone.utc)
sent_total = 0

for doc in db.collection('users').stream():
    d = doc.to_dict() or {}
    subs = d.get('push') or {}
    if not subs:
        continue
    reminders = d.get('reminders') or []
    sent = d.get('sentPush') or {}
    upd = {}
    for r in reminders:
        try:
            at = dt.datetime.fromisoformat(r['at'].replace('Z', '+00:00'))
        except Exception:
            continue
        if r['id'] in sent or not (now - dt.timedelta(hours=3) <= at <= now):
            continue
        payload = json.dumps({'title': r.get('title', 'Мои пары'), 'body': r.get('body', ''), 'url': SITE, 'tag': r['id']}, ensure_ascii=False)
        for key, s in subs.items():
            try:
                webpush(subscription_info={'endpoint': s['endpoint'], 'keys': s['keys']}, data=payload,
                        vapid_private_key=VAPID_PRIVATE, vapid_claims={'sub': VAPID_SUB}, ttl=6 * 3600)
                sent_total += 1
            except WebPushException as e:
                code = e.response.status_code if e.response is not None else None
                print('push error', doc.id[:6], key, code, str(e)[:200])
                if code in (404, 410):          # подписка больше не действует
                    upd['push.' + key] = firestore.DELETE_FIELD
        upd['sentPush.' + r['id']] = True
    current = {r['id'] for r in reminders}
    for sid in sent:                             # чистим отметки об уже неактуальных напоминаниях
        if sid not in current:
            upd['sentPush.' + sid] = firestore.DELETE_FIELD
    if upd:
        doc.reference.update(upd)

print('sent', sent_total, 'at', now.isoformat())
