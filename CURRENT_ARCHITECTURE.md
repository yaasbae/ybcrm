# Текущая архитектура YBCRM

Дата аудита: 16 сентября 2026 года. База: commit `e9111414`, исправления — в изолированной ветке. Production-данные и внешние сервисы не изменялись.

## Краткий вывод

CRM работает как React-приложение, которое одновременно обращается напрямую к Firestore и к большому Express-серверу. Сервер содержит бизнес-логику, webhooks, интеграции и фоновые циклы в одном файле `server.ts` размером более 13 тысяч строк. Часть банковской и passkey-логики продублирована в Cloud Functions. MCP тоже реализован дважды: в `server.ts` и в отдельном сервисе `mcp/`.

```text
Пользователь / браузер
        ├── React/Vite UI ───────────────► Firebase Auth
        ├── React/Vite UI ───────────────► Firestore / Storage напрямую
        └── React/Vite UI ─► Express server.ts ─► Firestore Admin/Client
                                      ├────► Telegram / MTProto
                                      ├────► Meta / Instagram
                                      ├────► CDEK
                                      ├────► Tochka / Yandex Pay
                                      ├────► Gemini / Anthropic / Fal
                                      └────► Web Push / Google Sheets

ChatGPT ─► /mcp в основной CRM ─► proxy либо встроенная копия MCP
                              └──► отдельный Cloud Run mcp/ ─► Firestore / Meta
```

## Компоненты

| Область | Реализация сейчас | Наблюдение |
|---|---|---|
| Frontend | React 19, Vite, TypeScript, Firebase Web SDK | Много прямых чтений и записей Firestore из компонентов; часть бизнес-логики находится в UI. |
| Backend | Express в `server.ts` | Монолит смешивает API, авторизацию, платежи, сообщения, AI и фоновые процессы. |
| Database | Firestore, named database `production` | Схема не формализована; документы разных поколений имеют разные поля. |
| Files | Firebase Storage | Фото товаров и материалы контента. |
| Auth | Firebase Auth: email/password, Google, custom token для passkey | `/api` теперь требует Firebase bearer token по умолчанию; публичные webhook/login маршруты перечислены явно. |
| Roles | `crm_access_profiles`, `manager_profiles`, hardcoded owner email | Есть роли экранов и действий заказа, но нет единого permission engine для всех доменов. |
| Cloud Functions | `functions/src/index.ts` | Passkeys и Tochka; логика частично дублирует основной сервер. |
| MCP | `mcp/` плюс встроенная реализация в `server.ts` | До этого аудита MCP публиковал и read, и write tools без per-tool RBAC/audit. |
| Deploy | GitHub Actions → Cloud Run | Push в `main` автоматически публикует основную CRM; изменения `mcp/**` публикуют MCP и затем перенастраивают CRM. |

## Карта source of truth

`Источник истины` — место, которое система считает главным при расхождении данных.

| Домен | Фактический основной источник | Дублирование или пробел |
|---|---|---|
| customers | `contacts` | Имя, телефон и Instagram также копируются внутрь `orders_new`; активность менеджеров — `manager_contacts`. |
| orders | `orders_new` | Legacy-коллекция `orders` всё ещё используется в банковских функциях и fallback-коде. Форматы исторических заказов различаются. |
| payments | Поля платежей внутри `orders_new` | Настройки и банковские данные находятся в `settings/*`, `tochka_logs`, `tochka_statements`, `finance_reconciliations`; отдельного неизменяемого payment ledger нет. |
| products | `products` | Справочник названий дополнительно живёт в `settings/handbook`; сценарии unit economics частично в `localStorage`. |
| inventory | Подтверждённого количественного реестра нет | `products` называется складом, но в основной модели товара нет обязательного количества/движений остатков. |
| production | `production_entries` | Производственные расходы автоматически отражаются в `expenses`; статус выполнения заказа отдельно находится в `orders_new`. |
| tasks | `tasks` | В текущей CRM полноценный UI/жизненный цикл задач не обнаружен; существующий MCP умел только создавать задачу. |
| employees | Firebase Auth + `crm_access_profiles` + `manager_profiles` | Смены — `manager_shifts`; параметры расчёта зарплаты хранятся в браузерном `localStorage`, поэтому отличаются по устройствам. |
| suppliers | Единого источника нет | Нет отдельной коллекции и подтверждённого контракта поставщика. |
| finance | Производные из `orders_new` + `expenses` | Банк и сверка отдельно; категории банковских расходов частично в `localStorage`; определения выручки отличаются между экранами/сервисами. |
| marketing | `marketing_stats`, `sales_goals`, заказы и Meta | Список блогеров дополнительно зашит в `src/data/bloggersYaasbae.ts`; единой attribution-модели нет. |
| content | `content_queue`, `social_publications`, `settings/*` | Медиа хранятся во внешних API/Storage; логика публикации сосредоточена в `server.ts`. |
| communications | `bot_messages`, `instagram_messages`, `instagram_conversations`, `site_chat_conversations/*/messages`, `messages` | Единый нормализованный журнал коммуникаций отсутствует. |

## Интеграции

| Интеграция | Статус в коде | Где работает |
|---|---|---|
| Telegram Bot API | Подключена | Уведомления заказов/оплат/релизов, inbox, bot, broadcast. |
| Telegram MTProto | Подключена | Аккаунты менеджеров и рассылки; сессии хранятся в Firestore settings. |
| Instagram / Meta Graph | Подключена | Direct/comments, статистика, публикации, content analytics. |
| CDEK | Подключена | Расчёт, создание/статусы отправлений, логи. |
| Tochka | Подключена | QR/эквайринг, поиск, сверка, refund; есть дублирование server/functions. |
| Yandex Pay | Подключена | Создание и возврат платежа. |
| Налоговая / ФНС | Не обнаружена | Нет подтверждённого API-клиента или credentials-контракта. |
| Email | Отдельный SMTP/provider не обнаружен | Email используется в Firebase Auth, но не как исходящий коммуникационный канал CRM. |
| Google Sheets | Ссылки/интеграционная логика присутствуют | Не является главным хранилищем CRM. |
| Gemini / Anthropic / Fal | Подключены | Текстовые и медиа AI-функции внутри приложения. |
| Сайт | `yaasbae.store`, storefront и site chat | Каталог связан с `products`; site chat — с Firestore. |

## Фоновые задачи и надежность

Для AI-действий добавлена отдельная серверная очередь `ai_jobs` с idempotency, lease, retry, timeout, DLQ и kill switch. Старые процессы CRM всё ещё используют `setTimeout`, `setInterval`, in-memory `Map/Set`, polling из браузера и коллекцию `push_jobs`. Поэтому перенос существующих бизнес-процессов в общий job layer остаётся отдельной поэтапной задачей:

- процесс теряет незавершённую работу при рестарте Cloud Run;
- часть сверки банка и CDEK зависит от открытого браузера;
- единая политика retry/idempotency/DLQ пока действует только для новых AI-заданий;
- нет единого статуса выполнения задания и механизма безопасного продолжения;
- уведомления и логи распределены по разным коллекциям.

## Границы текущего аудита

Не выполнялись реальные платежи, возвраты, публикации, отправка сообщений, миграции или deploy. Не проверялись содержимое production-документов и актуальность внешних токенов. Это намеренно: такие проверки могут изменить данные или деньги.
