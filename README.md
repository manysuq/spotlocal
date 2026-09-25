# 🎵 SpotLocal

<p align="center">
  <img src="app/static/icons/icon-192.png" width="100" alt="SpotLocal Logo" />
</p>

<p align="center">
  <b>Локальный селф-хостед стриминг музыки в стиле Spotify с веб-загрузчиком через spotDL и адаптацией под смартфоны (PWA).</b><br>
  <i>Self-hosted Spotify clone with integrated spotDL downloader & responsive mobile web app (PWA).</i>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.10%2B-blue?logo=python" alt="Python 3.10+">
  <img src="https://img.shields.io/badge/FastAPI-0.100%2B-009688?logo=fastapi" alt="FastAPI">
  <img src="https://img.shields.io/badge/spotDL-integrated-1ed760?logo=spotify" alt="spotDL">
  <img src="https://img.shields.io/badge/PWA-Ready-orange" alt="PWA">
  <img src="https://img.shields.io/badge/Docker-Ready-2496ed?logo=docker" alt="Docker">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License">
</p>

---

## 🌟 Ключевые возможности / Key Features

- **🎨 Аутентичный интерфейс в стиле Spotify (Dark Theme)**:
  - Фирменная тёмная палитра (`#121212`, `#181818`), неоново-зелёные акценты (`#1ed760`), обложки треков, списки, сетки карточек.
  - Удобная таблица треков, сортировка, живой поиск и фильтрация.
- **📱 Полная адаптация под мобильные устройства (PWA)**:
  - **Bottom Navigation Bar**: нижняя панель навигации (Главная, Поиск, Медиатека, Загрузчик).
  - **Sticky Mini-Player**: компактный плавающий плеер над нижней панелью с индикатором прогресса и кнопками.
  - **Full-Screen Mobile Player Drawer**: плавный полноэкранный плеер с большой обложкой, слайдером перемотки и элементами управления.
  - **PWA (Progressive Web App)**: устанавливается как нативное приложение на домашний экран iOS (Safari) и Android (Chrome).
- **⬇️ Встроенный загрузчик через spotDL**:
  - Вставляйте ссылки Spotify на **треки, альбомы, плейлисты** или просто поисковые запросы (`Артист - Название`).
  - **Real-time SSE стриминг логов**: живой вывод консоли spotDL прямо в веб-интерфейсе без перезагрузки страниц.
  - Автоматическое скачивание в лучшем качестве, извлечение тегов и обложек, мгновенное добавление в медиатеку.
- **🎧 Продвинутый аудиоплеер**:
  - Поддержка **HTTP 206 Partial Content (Range Requests)**: моментальная перемотка аудиофайлов на смартфонах и в браузере.
  - Режимы воспроизведения: **Shuffle** (случайный порядок), **Repeat** (повтор одного трека / всех треков / выкл).
  - Очередь воспроизведения (Queue) с возможностью перехода к любому треку.
  - **MediaSession API**: управление воспроизведением с экрана блокировки смартфона, шторки уведомлений и кнопок гарнитуры/наушников (отображаются название, исполнитель и обложка).
- **📚 Организация медиатеки**:
  - Автоматическое сканирование папки `music/` (MP3, FLAC, M4A, OGG, WAV, AAC).
  - Извлечение ID3-метаданных и встроенных обложек (Mutagen).
  - Создание и редактирование собственных плейлистов.
  - Раздел «Любимые треки» (лайк в один клик).
  - Группировка по исполнителям и альбомам.
- **🚀 Лёгкий запуск**:
  - Готовые `Dockerfile` и `docker-compose.yml`.
  - Отлично работает на Raspberry Pi, любом Linux-сервере, VPS или домашнем ПК.

---

## 📸 Интерфейс / UI Overview

```
Desktop:
┌────────────────┬────────────────────────────────────────────────────────┐
│  SpotLocal     │  [Поиск в локальной медиатеке...]        [Обновить]    │
│  ───────────── │ ────────────────────────────────────────────────────── │
│  🏠 Главная    │  Добрый вечер                                          │
│  🔍 Поиск      │  [ Любимые треки ]   [ Скачать со Spotify ]            │
│  📚 Медиатека  │                                                        │
│  ⬇️ Загрузчик  │  Все треки (34)                       [ Слушать все ] │
│  ───────────── │  #  Название       Исполнитель     Альбом      Время ♡ │
│  + Плейлисты   │  1  Song Title     Artist Name     Album Name   3:45  ♥│
│  ...           │  ...                                                   │
├────────────────┴────────────────────────────────────────────────────────┤
│ [Cover] Song Title - Artist   |   [🔀] [⏮] [ ▶ ] [⏭] [🔁]   |  [≡] [🔊 ───]│
└────────────────────────────────────────────────────────────────────────┘

Mobile (PWA):
┌─────────────────────────┐
│ SpotLocal          [🔄] │
│ ─────────────────────── │
│ Добрый вечер            │
│ [Любимые]  [Скачать]    │
│                         │
│ Все треки               │
│ ♫ Song Title - Artist   │
│ ♫ Track 2 - Artist 2    │
├─────────────────────────┤
│ [■] Song - Artist [♥][▶]│ <- Sticky Mini-Player
├─────────────────────────┤
│ [🏠]  [🔍]  [📚]  [⬇️]   │ <- Bottom Navigation Bar
└─────────────────────────┘
```

---

## 🚀 Быстрый запуск / Quick Start

### Вариант 1: Запуск через Docker Compose (Рекомендуется)

1. Клонируйте репозиторий:
   ```bash
   git clone https://github.com/your-username/spotlocal.git
   cd spotlocal
   ```

2. Запустите контейнер:
   ```bash
   docker compose up -d
   ```

3. Откройте в браузере:
   **`http://localhost:8000`** (или `http://IP_ВАШЕГО_СЕРВЕРА:8000`)

---

### Вариант 2: Запуск без Docker (Python Virtualenv)

#### Системные требования:
- Python 3.10+
- `ffmpeg` (необходим для работы spotDL и конвертации аудио)

**Установка ffmpeg:**
- **Ubuntu / Debian**: `sudo apt install ffmpeg`
- **Arch Linux**: `sudo pacman -S ffmpeg`
- **macOS**: `brew install ffmpeg`
- **Windows**: `winget install Gyan.FFmpeg` или скачайте с [ffmpeg.org](https://ffmpeg.org)

#### Запуск:
```bash
git clone https://github.com/your-username/spotlocal.git
cd spotlocal

# Автоматический запуск через скрипт:
./run.sh
```

Либо вручную:
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Запуск сервера
python3 -m app.main
```

---

## 📱 Установка на телефон (PWA)

SpotLocal оптимизирован как **Progressive Web App**:

1. Откройте адрес сервера в браузере телефона (например, `http://192.168.1.50:8000` в вашей Wi-Fi сети или через VPN / Tailscale).
2. **На iOS (Safari)**:
   - Нажмите кнопку «Поделиться» (иконка со стрелочкой вверх).
   - Выберите **«На экран "Домой"» (Add to Home Screen)**.
3. **На Android (Chrome)**:
   - Нажмите три точки в правом верхнем углу.
   - Выберите **«Установить приложение»** или **«Добавить на главный экран»**.
4. Теперь SpotLocal запускается во весь экран без рамок браузера, поддерживает фоновое аудио и управление с экрана блокировки!

---

## ⚙️ Конфигурация / Configuration

Вы можете настроить параметры в файле `.env` или через переменные окружения:

```env
# Сетевой адрес и порт
SPOTLOCAL_HOST=0.0.0.0
SPOTLOCAL_PORT=8000

# Директории для музыки и данных
SPOTLOCAL_MUSIC_DIR=./music
SPOTLOCAL_DATA_DIR=./data

# Формат аудио spotDL (mp3, flac, m4a, ogg, opus)
SPOTLOCAL_AUDIO_FORMAT=mp3

# Шаблон имён скачиваемых файлов
SPOTLOCAL_OUTPUT_TEMPLATE={artist} - {title}.{output-ext}

# (Опционально) Учётные данные Spotify API для исключения лимитов spotDL:
# SPOTIFY_CLIENT_ID=your_spotify_client_id
# SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
```

---

## 📂 Структура проекта / Project Structure

```
spotlocal/
├── app/
│   ├── config.py           # Настройки и пути
│   ├── database.py         # SQLite БД: треки, плейлисты, история spotDL
│   ├── downloader.py       # Фоновый менеджер spotDL + Server-Sent Events
│   ├── scanner.py          # Сканер музыки и извлечение ID3/обложек
│   ├── main.py             # Точка входа FastAPI приложения
│   ├── routes/
│   │   ├── api.py          # REST API: треки, плейлисты, поиск
│   │   ├── download.py     # API загрузчика spotDL и SSE стрим
│   │   └── stream.py       # Аудиостриминг с поддержкой Range-запросов и обложек
│   └── static/
│       ├── index.html      # Одностраничное веб-приложение
│       ├── manifest.json   # Манифест PWA
│       ├── sw.js           # Service Worker для кеширования
│       ├── css/style.css   # Spotify Dark Theme и адаптивная вёрстка
│       ├── js/
│       │   ├── api.js      # Клиент API и SSE
│       │   ├── player.js   # HTML5 аудиоплеер + MediaSession API
│       │   └── app.js      # Контроллер страниц и событий
│       └── icons/          # Иконки приложения
├── music/                  # Директория с аудиофайлами
├── Dockerfile              # Сборка контейнера с ffmpeg и Python
├── docker-compose.yml      # Быстрый запуск сервиса
├── requirements.txt        # Зависимости Python
├── run.sh                  # Скрипт быстрого запуска
└── README.md
```

---

## 🛠️ REST API

SpotLocal предоставляет быстрый REST API:

| Метод | Эндпоинт | Описание |
|---|---|---|
| `GET` | `/api/tracks` | Список всех треков (поиск `?search=...`, фильтр `?favorites=true`) |
| `GET` | `/api/tracks/{id}` | Метаданные трека |
| `POST` | `/api/tracks/{id}/favorite` | Переключить статус «Любимый» |
| `GET` | `/api/stream/{id}` | Аудиопоток (поддержка заголовка `Range: bytes=...`) |
| `GET` | `/api/covers/{id}` | Обложка альбома (JPEG/PNG или SVG заглушка) |
| `GET` | `/api/playlists` | Список плейлистов |
| `POST` | `/api/playlists` | Создать новый плейлист |
| `POST` | `/api/playlists/{id}/tracks` | Добавить трек в плейлист |
| `POST` | `/api/download` | Запустить загрузку через spotDL (`{"query": "..."}`) |
| `GET` | `/api/download/events` | SSE-поток живых логов и прогресса spotDL |
| `POST` | `/api/library/rescan` | Принудительное сканирование папки с музыкой |

---

## 📄 Лицензия / License

Проект распространяется под лицензией [MIT](LICENSE).
Музыка загружается исключительно для личного локального использования через открытую утилиту [spotDL](https://github.com/spotDL/spotify-downloader).
