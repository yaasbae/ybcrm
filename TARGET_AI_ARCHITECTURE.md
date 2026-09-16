# Целевая AI-архитектура YBCRM

## Главный принцип

CRM остаётся самостоятельной системой. Отказ OpenAI, ChatGPT, MCP или агента не должен мешать менеджерам входить в CRM, работать с заказами, складом и клиентами.

```text
USER / CHATGPT / INTERNAL AUTOMATION
                 │
                 ▼
              MCP SERVER          ← только протокол и аутентификация
                 │
                 ▼
            AI TOOL LAYER         ← schema, permission, policy, audit
                 │
                 ▼
             CRM SERVICES         ← единая бизнес-логика
                 │
                 ├────────► JOB QUEUE / WORKERS
                 │
                 ▼
      DATABASE / EXTERNAL SERVICES
      Firestore, CDEK, Telegram, Meta, bank…
```

MCP, OpenAI API и внутренний scheduler должны вызывать один `AI Tool Layer`. Они являются адаптерами, а не отдельными копиями бизнес-логики.

## Слои и ответственность

| Слой | Делает | Не делает |
|---|---|---|
| MCP/API adapter | Проверяет токен, превращает protocol request в tool call | Не обращается к Firestore и банку напрямую |
| AI Tool Layer | Валидирует аргументы, проверяет permission/policy, вызывает service, пишет audit | Не хранит API keys и не реализует бизнес-расчеты повторно |
| CRM Services | Содержит правила клиентов, заказов, оплат, производства и т. д. | Не доверяет вызывающему клиенту |
| Approval Layer | Создает запрос подтверждения, проверяет срок/автора/точное действие | Не выполняет действие до подтверждения |
| Job Layer | Очередь, retry, timeout, idempotency, DLQ, progress | Не держит бесконечный браузер или HTTP-запрос |
| Integrations | Узкие клиенты Telegram/CDEK/банка и т. п. | Не отдают секреты агенту |
| Audit | Неизменяемая история вызовов и approvals | Не хранит секреты и полные PII без необходимости |

## Что реализовано на первом этапе

- отдельный `mcp/src/ai-tools` с единым registry;
- 12 read-only инструментов;
- проверка permission при каждом вызове;
- OAuth scope ограничен `crm.read`, токен — 8 часов;
- все tools не меняют бизнес-данные и помечены `destructiveHint:false`; `readOnlyHint:false` выставлен честно, потому что обязательный audit log сам является записью;
- REST adapter `/api/ai-tools/:name` вызывает тот же слой;
- audit в server-only коллекцию `ai_agent_audit_logs`;
- arguments очищаются от secrets, персональные значения fingerprint-ятся;
- результат в audit хранится как безопасная сводка, а не полная карточка клиента;
- прежние MCP write tools не публикуются.

## Следующие этапы

1. **Security gate до подключения ChatGPT.** Ротация раскрытого MCP PIN и других hardcoded credentials; закрытие публичных `settings`; инвентаризация/защита платежных маршрутов и webhooks; negative security tests.
2. **Единые сервисы.** Вынести доменную логику из `server.ts` и React постепенно, начиная с orders/payments. Встроенную копию MCP перевести только в proxy, затем удалить после контролируемого переключения.
3. **Нормализация source of truth.** Утвердить payment ledger, inventory movements, suppliers, employees/payroll и communications index. Только затем — миграции с preview, backup и rollback.
4. **Production-grade identity.** Отдельные service accounts/agent identities, короткие токены, audience/issuer validation, token revocation и точные permissions вместо общего `crm.read`.
5. **Approval service.** Базовый gate реализован для job queue: hash аргументов, TTL, single use и владелец подтверждения. До write tools требуется добавить человекочитаемый preview конкретного бизнес-действия и повторную проверку permission непосредственно перед исполнением.
6. **Job infrastructure.** Firestore job registry, idempotency keys, lease, exponential retry, timeout, DLQ, recovery, Telegram-уведомления и kill switch реализованы. Остаётся настроить внешний production scheduler и провести нагрузочный/аварийный pilot.
7. **Ограниченные write tools.** По одному домену: сначала `tasks.write`, затем черновики сообщений. Каждый инструмент отдельно тестируется и включается feature flag-ом.
8. **Финансовые действия.** Только prepare/preview. `finance.execute_payment`, налоги и возвраты остаются FORBIDDEN для автономного агента до отдельного решения владельца и банковского контроля.
9. **Наблюдаемость.** Экран «Что сделали AI-агенты», алерты по denied/error/cost, retention policy и экспорт аудита.
10. **Автономные агенты.** Только после прохождения security gate: ограниченный COO pilot с бюджетом, расписанием, kill switch и минимальными permissions. CEO Agent сейчас не создаётся.

## План отката первого этапа

Изменения находятся только в отдельной ветке. Production не изменён. При последующем pilot deploy откат — вернуть предыдущую revision сервиса `ybcrm-mcp`; основная CRM продолжит работать независимо.
