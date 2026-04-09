# Roadmap — openclaw-channel-telegram-userbot

## Current state (v0.1.0)
- 502 LOC, 8 files, 10 tests
- Text messages (inbound/outbound), DM + groups
- Machine-bound session encryption (AES-256-GCM)
- Reply delay + typing indicator
- Allowlist/denylist, per-group settings

---

## v0.2.0 — Media & Rich Messages
**Goal:** полноценная работа с медиа, не только текст

- [ ] **Inbound media** — фото, видео, документы, стикеры, голосовые → передача URL/path в OpenClaw
- [ ] **Outbound media** — отправка фото/файлов из ответа AI
- [ ] **Voice transcription** — голосовые → текст (Whisper) → AI → текстовый ответ
- [ ] **Message formatting** — Markdown/HTML в ответах (bold, italic, code blocks)
- [ ] **Reply context** — пересылка цитируемого сообщения как контекст для AI

## v0.3.0 — Conversations & Memory
**Goal:** AI помнит контекст разговора

- [ ] **Conversation history** — хранение последних N сообщений на чат
- [ ] **Thread support** — Telegram forum topics как отдельные сессии
- [ ] **Multi-turn context window** — настраиваемая глубина контекста (5/10/50 сообщений)
- [ ] **Session persistence** — сохранение между перезапусками (SQLite/файл)
- [ ] **System prompt per chat** — разные промпты для разных чатов/групп

## v0.4.0 — Smart Routing & Triggers
**Goal:** гибкое управление когда и как AI отвечает

- [ ] **Keyword triggers** — ответ только на определённые слова/паттерны
- [ ] **Schedule** — режим работы (рабочие часы, выходные off)
- [ ] **Rate limiting** — max N ответов в минуту/час на чат
- [ ] **Auto-away** — сообщение "отошёл" если AI выключен
- [ ] **Priority chats** — VIP-контакты с мгновенным ответом, остальные с задержкой
- [ ] **Ignore patterns** — не отвечать на спам, стикеры без текста, пересылки

## v0.5.0 — Multi-Account & Teams
**Goal:** несколько аккаунтов, шаринг между пользователями

- [ ] **Multi-account** — 2+ Telegram аккаунта в одном инстансе
- [ ] **Account routing** — разные AI-модели для разных аккаунтов
- [ ] **Shared config** — общие настройки для команды
- [ ] **Admin panel** — веб-UI для управления (опционально)

## v1.0.0 — Production Ready
**Goal:** стабильность, документация, community

- [ ] **Reconnection** — автопереподключение при обрыве сети
- [ ] **Health check** — эндпоинт для мониторинга
- [ ] **Metrics** — счётчики сообщений, latency, ошибки
- [ ] **Error recovery** — graceful degradation при ошибках GramJS
- [ ] **Migration guide** — с zkywalker и других плагинов
- [ ] **Integration tests** — полный E2E с мок-сервером Telegram
- [ ] **OpenClawDir verified badge** — подтверждённый плагин

---

## Ideas (backlog)
- Inline buttons в ответах AI
- Telegram reactions как feedback (👍 = good answer)
- Чтение истории чата для RAG-контекста
- Интеграция с Telegram Bot API как fallback
- Webhook mode (вместо polling) для serverless
- Шифрование сообщений E2E (Secret Chats API)
