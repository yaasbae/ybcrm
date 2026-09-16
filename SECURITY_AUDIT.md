# Security audit YBCRM

Дата: 16 сентября 2026 года. Статический анализ, исправления и безопасное canary-внедрение в production.

## Итог

Подключать автономного агента или выдавать MCP write-доступ пока нельзя. Read-only фундамент опубликован: 12 инструментов, permissions, OAuth и обязательный server-side audit. Production прошёл backup, secret migration, zero-traffic smoke tests и переключение 5% → 25% → 100%.

## Критические риски

### S-01. Публичный доступ к настройкам Firestore

`firestore.rules` разрешает публичное чтение wildcard `settings/{document=**}`. В `settings` код хранит конфигурации Instagram, Tochka, Yandex Pay, Telegram sessions и другие интеграционные данные. Отдельные bot/broadcast/stealth documents допускают публичную запись.

Исправлено и опубликовано: wildcard и служебные коллекции закрыты, системные audit logs доступны только Admin SDK, добавлены deny-by-default emulator tests. Профили действующих сотрудников проверены перед публикацией Rules.

### S-02. Hardcoded credentials в Git и deploy workflow

В `server.ts` есть fallback значения для MCP PIN/token secret и Telegram API hash. В `.github/workflows/deploy-mcp.yml` MCP PIN записан открытым текстом.

Исправлено: fallback удалены, workflow и Cloud Run используют Secret Manager, MCP JWT/PIN и Gemini key заменены. Telegram/FAL/Meta credentials перенесены без раскрытия; их последующая плановая ротация остаётся рекомендуемой, поскольку старые ревизии могли содержать plaintext env.

### S-03. Платёжные маршруты без последовательной авторизации

В основном Express и Cloud Functions существуют маршруты сохранения банковских настроек, создания/поиска/сверки/refund платежей. У части маршрутов не обнаружена обязательная проверка Firebase user + owner/action permission перед бизнес-операцией. CORS Cloud Functions разрешает широкий доступ.

Исправлено в ветке: API закрыт Firebase bearer authentication, чувствительные настройки — owner-only, платёжные операции — permission guard, Cloud Functions CORS ограничен, webhook Точки проверяет RS256 подпись публичным ключом банка. `finance.execute_payment` для AI всё равно остаётся FORBIDDEN.

### S-04. Существовавший MCP write-доступ без per-tool RBAC

Отдельный MCP публиковал `orders.update`, `orders.create`, `tasks.create`; JWT scope не проверялся на уровне tool. Встроенная копия MCP в `server.ts` также содержит write tools.

Исправлено: отдельный MCP переведён в read-only registry с permission check и audit; legacy fallback в основном сервере больше не обслуживает MCP при недоступности upstream и возвращает 503.

## Высокие риски

### S-05. Fail-open legacy роли — исправлено в ветке

Профиль без записи, без `active: true` или без `orderActionsConfigured: true` теперь получает отказ. Поэтому перед deploy нужно явно заполнить профили действующих сотрудников.

### S-06. Слабая граница основного Express — исправлено частично

Добавлены allowlist CORS, security headers, общий rate limit, Firebase auth по умолчанию для `/api` и безопасная глобальная ошибка. Отдельные ответы старых интеграций всё ещё требуют поэтапной нормализации.

### S-07. OAuth MCP

Redirect URI теперь ограничен allowlist; scope — только `crm.read`, access token — 8 часов. Authorization code пока не имеет server-side one-time consumption, PIN остаётся общим bootstrap-механизмом; до production нужны consent/revocation.

### S-08. WebAuthn/passkey — исправлено в ветке

Production RP ID/origins зафиксированы на `ybcrm.ru`, а user verification теперь обязательна при регистрации и входе.

### S-09. Избыточные Firestore права сотрудников

Любой authenticated user может писать расходы, производство, маркетинг, контакты, смены и broadcasts. Некоторые публичные коллекции допускают write без auth. Это слишком широкие права для будущих агентов и обычных сотрудников.

### S-10. Зависимости

Результат `npm audit` на момент проверки:

| Пакет | Всего | High | Critical |
|---|---:|---:|---:|
| root | 15 | 0 | 0 |
| `mcp/` | 8 | 0 | 0 |
| `functions/` | 8 | 0 | 0 |

Безопасные обновления применены; обновлены в том числе Axios, Sharp и тестовый стек MCP. Остались только moderate/low транзитивные findings, требующие major-обновления Firebase Admin/CLI. `npm audit fix --force` не запускался.

## Средние архитектурные риски

- финансовые и производственные расчеты продублированы и имеют незафиксированную семантику;
- payroll и некоторые финансовые настройки находятся в `localStorage`;
- нет job queue/DLQ и гарантированного idempotency;
- audit основной CRM best-effort и при ошибке записи молча продолжает действие;
- коммуникации содержат PII, но нет общей retention/redaction policy;
- deploy workflow теперь запускает lint, build и тесты до публикации, но GitHub branch protection всё ещё нужно контролировать отдельно;
- проект Cloud Run (`gen-lang-client-0565901030`) и проект данных Firebase (`gen-lang-client-0267383721`) подтверждены по живой инфраструктуре и явно зафиксированы в workflow;
- Firebase Functions используют Node.js 20, который будет decommissioned 30 октября 2026 года; переход на новый runtime нельзя откладывать до этой даты.

## Secrets checklist

| Secret | Правильное целевое место | Статус аудита |
|---|---|---|
| MCP PIN/JWT secret | Secret Manager, короткая ротация | Перенесены и заменены |
| Telegram bot tokens/API hash/sessions | Secret Manager; sessions encrypted | Нарушение/высокий риск: fallback и Firestore settings |
| Instagram/Meta tokens | Secret Manager | Высокий риск: fallback чтения из public-readable settings |
| CDEK credentials | Secret Manager | Env/settings paths есть; требуется live IAM audit |
| Tochka/Yandex Pay | Secret Manager, owner-only server | Высокий риск: settings + маршруты |
| Налоговые credentials | Secret Manager/HSM | Интеграция не обнаружена |
| Email credentials | Secret Manager | Исходящая интеграция не обнаружена |
| Firebase web API key | Frontend допустим при строгих Rules/App Check | Ключ публичный по модели Firebase; текущие Rules недостаточно строгие |

## Условия допуска read-only pilot

1. Ротация раскрытых credentials.
2. Закрытие public read/write для sensitive settings с emulator-тестами.
3. Отключение встроенного MCP fallback или подтверждение, что он только proxy.
4. OAuth redirect allowlist и отдельная agent identity.
5. Проверка audit записи и retention в staging.
6. Staging smoke tests всех 12 tools на обезличенных данных.
7. Production pilot опубликован; до любых write tools требуется отдельный approval gate и период стабильного наблюдения.
