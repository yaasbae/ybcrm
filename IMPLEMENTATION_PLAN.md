# Изменения, риски и план внедрения

## Изменения первого этапа

- создан изолированный worktree/branch `codex/ai-agent-foundation`;
- создан единый read-only AI Tool Layer;
- добавлены permissions и SAFE/APPROVAL/FORBIDDEN policy catalog;
- добавлен обязательный server-side audit log с redaction;
- добавлены read services для payments, inventory, production, tasks, suppliers и communications;
- MCP registry заменён на 12 tools, читающих только бизнес-данные; metadata учитывает обязательную запись audit log;
- REST adapter направлен в тот же Tool Layer;
- удалены write endpoints из отдельного MCP REST adapter;
- OAuth отдельного MCP выдаёт только `crm.read` на 8 часов;
- OpenAPI обновлён под read-only контракт;
- добавлены unit и MCP integration tests.
- закрыты основные API по Firebase auth и owner/action guards;
- включена проверка RS256 подписи webhook Точки;
- закрыты sensitive Firestore settings и включён fail-closed доступ к заказам;
- ManyChat и Chatwoot полностью удалены из маршрутов, UI и конфигурационных типов по решению владельца;
- AI API keys убраны из браузерных форм и Firestore-записи, используются server env/secrets;
- безопасно обновлены зависимости без `--force`.

## Статус production-внедрения — 16 сентября 2026

- создан и проверен полный Firestore backup в отдельном versioned EU bucket;
- действующие профили доступа проверены до включения fail-closed Rules;
- Firestore Rules опубликованы в базе `production`;
- ключ Gemini заменён, перенесён в Secret Manager и удалён из Firestore;
- секреты Cloud Run перенесены из plaintext env в Secret Manager;
- MCP и основная CRM прошли zero-traffic canary, smoke tests и поэтапное переключение 5% → 25% → 100%;
- Cloud Functions обновлены, прямые чувствительные endpoints без авторизации возвращают `401`;
- предыдущая secret-based ревизия сохранена для быстрого отката.

## Оставшиеся риски

1. Нет надежных source of truth для payment ledger, inventory, suppliers и payroll.
2. Finance summary — расчетная модель, которую должен утвердить владелец бизнеса.
3. Поиск communications читает несколько коллекций и пока не имеет специализированного поискового индекса.
4. Существующие сервисы загружают до 5–10 тысяч документов и фильтруют в памяти; для роста нужны серверные индексы/cursors.
5. Нет production job queue, DLQ, approval UI и kill switch.
6. Остались moderate/low транзитивные dependency findings, исправляемые только major-upgrade Firebase tooling/admin.
7. Firebase Functions работают на Node.js 20, который будет отключён 30 октября 2026 года; нужен отдельный проверяемый переход на поддерживаемый runtime.

## Пошаговое внедрение

### Этап 0 — текущая ветка

Review кода и документов, без deploy. Проверить diff и согласовать security gate.

### Этап 1 — security remediation

Ротация credentials; Secret Manager; deny-by-default Rules; защита payment/webhook routes; App Check где применимо; OAuth allowlist; CI tests. Каждый блок — отдельный pull request с rollback.

### Этап 2 — staging read-only

Развернуть отдельную staging revision MCP, использовать read-only service account, подключить копию/обезличенный набор данных, проверить 12 tools, audit и отказоустойчивость. Основная CRM не зависит от staging MCP.

### Этап 3 — read-only production pilot

Feature flag, один владелец, короткий токен, rate/budget limits, мониторинг. Вопрос «Что сегодня произошло в бизнесе?» собирается только из safe read tools.

### Этап 4 — data foundation

По очереди утвердить payment ledger, inventory movements, suppliers, employees/payroll и unified communication index. Для каждой миграции: backup, preview, checksum, canary, rollback.

### Этап 5 — jobs и approvals

Persistent queue, workers, retry/backoff, timeout, idempotency, DLQ, notifications; затем approval request service/UI.

### Этап 6 — первые write tools

Начать с создания черновика задачи и черновика сообщения. Не отправлять автоматически. Только после метрик pilot — ограниченная отправка с approval.

### Этап 7 — агентная команда

Только после нескольких недель стабильного audit/approval: узкоспециализированные агенты с отдельными identities и budgets. Главный COO/CEO orchestrator последним, без прямого доступа к базе или secrets.
