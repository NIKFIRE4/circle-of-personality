# Speech service

Изолированный FastAPI-сервис для распознавания коротких русскоязычных голосовых
сообщений. Модель `GigaAM v3_e2e_rnnt` загружается один раз при старте процесса и
переиспользуется между запросами. Версия исходного кода GigaAM закреплена на
коммите `5b5b4add01f8122e103b046f0ec82bd64369d4bc`.

## API

### `GET /health`

После полной загрузки модели отвечает `200`:

```json
{"status":"ok","model":"v3_e2e_rnnt","device":"cpu"}
```

До готовности модели сервис отвечает `503`. На практике ASGI-сервер начинает
принимать запросы только после завершения startup/lifespan.

### `POST /transcribe`

Принимает `multipart/form-data` с единственным обязательным полем `file`.

```bash
curl --fail-with-body \
  -F "file=@voice.webm;type=audio/webm" \
  http://localhost:8000/transcribe
```

Потоки WebM/Ogg, созданные браузерным `MediaRecorder`, могут не содержать
итоговую длительность в заголовке контейнера. В этом случае сервис проверяет
ограниченный фрагмент через FFmpeg и определяет фактическую длительность по
времени декодированного аудио.

Пример ответа:

```json
{
  "text": "поставь на пятницу танцы с тринадцати до семнадцати",
  "duration_seconds": 6.42,
  "model": "v3_e2e_rnnt"
}
```

Сервис принимает любой контейнер, который умеет прочитать FFmpeg. Наличие
аудиодорожки и длительность проверяются через `ffprobe`. По умолчанию файл не
может быть больше 20 MiB, а аудио — длиннее 24 секунд. Временный каталог и файл
удаляются после ответа, включая ошибочные и отменённые запросы.

Основные ошибки:

- `400` — пустой файл или некорректный HTTP-запрос;
- `413` — превышен лимит загрузки;
- `415` — файл не распознан как аудио;
- `422` — аудио длиннее допустимого;
- `503` — модель ещё не готова.

## Запуск в Docker

Из корня репозитория:

```bash
docker build -t life-balance-speech ./services/speech
docker run --rm \
  --publish 8000:8000 \
  --volume gigaam-models:/models \
  life-balance-speech
```

При первом старте GigaAM скачивает checkpoint и tokenizer в `/models`; named
volume сохраняет их между перезапусками. Первый запуск поэтому занимает заметно
больше времени. Контейнер работает от непривилегированного пользователя.

## Vercel Services

Для Vercel используется `Dockerfile.vercel`: он заранее добавляет checkpoint и
tokenizer в container image, устанавливает FFmpeg и запускает Uvicorn на
переменной `$PORT`. Корневой `vercel.json` связывает приватный сервис `speech` с
Next.js-сервисом `frontend` через автоматически внедряемую переменную
`SPEECH_SERVICE_URL`. Вручную задавать эту переменную в Vercel не нужно.

Для NVIDIA GPU контейнеру нужны совместимые CUDA/PyTorch runtime и драйверы;
текущий базовый образ ориентирован на простой CPU-запуск. На CPU распознавание
работает, но заметно медленнее.

## Локальный запуск

Нужны Python 3.10+ и установленные `ffmpeg`/`ffprobe` в `PATH`:

```bash
cd services/speech
python -m venv .venv
# Linux/macOS: source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

## Настройки

| Переменная | Значение по умолчанию | Назначение |
| --- | --- | --- |
| `SPEECH_DEVICE` | `auto` | `auto`, `cpu` или `cuda` |
| `SPEECH_MAX_UPLOAD_BYTES` | `20971520` | максимальный размер самого файла |
| `SPEECH_MAX_DURATION_SECONDS` | `24` | максимальная длительность аудио; можно только уменьшить |
| `SPEECH_FFPROBE_TIMEOUT_SECONDS` | `10` | timeout проверки метаданных |
| `GIGAAM_CACHE_DIR` | cache GigaAM | каталог checkpoint/tokenizer |

Один процесс обслуживает одновременно только один вызов модели: доступ к
`transcribe` защищён `asyncio.Lock`. Docker-команда намеренно запускает ровно
один Uvicorn worker. При горизонтальном масштабировании каждый replica загрузит
свою копию модели и будет иметь собственный лимит concurrency.

Сервис не выполняет пользовательскую авторизацию: его следует держать во
внутренней сети и вызывать через основной backend/API gateway, где уже проверена
сессия пользователя.
