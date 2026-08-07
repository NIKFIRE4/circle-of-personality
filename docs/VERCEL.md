# Развёртывание на Vercel

Next.js-приложение разворачивается на Vercel напрямую из GitHub. Корневой `Dockerfile` предназначен для самостоятельного хостинга и локального production-запуска; Vercel его не использует.

## 1. Создать PostgreSQL

Приложению нужна постоянная PostgreSQL. В Vercel откройте **Storage / Marketplace**, подключите Neon, Supabase, Prisma Postgres или другого PostgreSQL-провайдера и получите строку подключения. Для serverless-нагрузки предпочтителен URL через connection pooler; если провайдер выдаёт отдельный direct URL, сохраните его для миграций.

## 2. Импортировать GitHub-репозиторий

1. Откройте [Vercel Projects](https://vercel.com/nikfire4s-projects).
2. Нажмите **Add New → Project** и импортируйте публичный репозиторий.
3. Оставьте **Framework Preset: Next.js**, **Root Directory: `.`** и стандартные команды установки/сборки.
4. До первого production-деплоя добавьте переменные окружения.

## 3. Настроить переменные

Обязательные для Production:

| Переменная | Значение |
| --- | --- |
| `DATABASE_URL` | pooled PostgreSQL URL от выбранного провайдера |
| `APP_URL` | итоговый адрес, например `https://имя-проекта.vercel.app` |
| `AUDIT_HASH_SECRET` | случайная строка не короче 32 байт |
| `CALENDAR_FEED_ENCRYPTION_KEY` | ровно 32 случайных байта в Base64 с префиксом `base64:` |

Рекомендуемые настройки для первого запуска:

```dotenv
SESSION_TTL_SECONDS=2592000
BCRYPT_ROUNDS=12
VOICE_DEMO_MODE=true
TASK_AI_TIMEOUT_MS=20000
```

Для ИИ-разбора добавьте только один профиль из `.env.example`, например `OPENROUTER_API_KEY`. Для legacy Google OAuth дополнительно понадобятся `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` и `GOOGLE_TOKEN_ENCRYPTION_KEY`; обычный read-only импорт iCal/ICS работает без OAuth.

Создать ключи можно локально:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('base64:' + require('crypto').randomBytes(32).toString('base64'))"
```

Первую строку используйте как `AUDIT_HASH_SECRET`, вторую — как `CALENDAR_FEED_ENCRYPTION_KEY`. Не копируйте локальный `.env` целиком и не добавляйте `POSTGRES_*`, `SEED_DEMO_*` или `NODE_ENV` в Vercel без необходимости.

## 4. Применить миграции

До первого входа примените закоммиченные миграции к production-базе:

1. В GitHub откройте **Settings → Secrets and variables → Actions**.
2. Создайте secret `PRODUCTION_DATABASE_URL`. Если база предоставляет direct URL, используйте его здесь.
3. Откройте **Actions → Production database migration → Run workflow**.

Workflow запускает только `prisma migrate deploy` и никогда не выполняет `migrate dev` или `db push`. Повторяйте его после добавления новых production-миграций.

## 5. Проверить deployment

После первого деплоя откройте:

- `/api/health` — проверка приложения и базы;
- `/` — регистрация и вход;
- `/overview` — защищённый экран после входа.

Если менялся `APP_URL` или любой secret, выполните Redeploy: старые deployment не получают новые значения автоматически.

## Ограничение голосового ввода

Контейнер `services/speech` с PyTorch, FFmpeg и GigaAM не запускается вместе с Next.js-проектом на Vercel. Для первой демонстрации оставьте `VOICE_DEMO_MODE=true`. Для настоящего распознавания разверните speech-сервис отдельно в приватной сети и задайте его HTTPS-адрес в `SPEECH_SERVICE_URL`. У Vercel Functions также есть лимит размера тела запроса, поэтому аудио должно оставаться коротким.
