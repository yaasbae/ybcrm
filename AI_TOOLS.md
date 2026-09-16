# AI Tool Layer: первый read-only этап

## Контракт

Все инструменты находятся в одном registry `mcp/src/ai-tools/tool-layer.ts`. Они read-only по отношению к бизнес-данным CRM. Вызов всегда проходит последовательность:

```text
authenticate → validate schema → check permission → CRM service → sanitize result → audit
```

Нельзя передать имя коллекции, произвольный Firestore query, URL внешнего API или secret. Лимиты заданы схемой. Поле `raw` из внутренних моделей не возвращается агенту.

## Инструменты

| Tool | Permission | Источник | Ограничение первого этапа |
|---|---|---|---|
| `get_customer` | `crm.customers.read` | `contacts` | По внутреннему ID |
| `search_customers` | `crm.customers.read` | `contacts`, order lookup | До 50 совпадений существующего service |
| `get_order` | `crm.orders.read` | `orders_new` | Поддерживает исторические варианты номера |
| `search_orders` | `crm.orders.read` | `orders_new` | Page size ≤ 100 |
| `get_sales_summary` | `crm.orders.read` | расчет из `orders_new` | Семантика paid revenue требует дальнейшего бизнес-утверждения |
| `get_payments` | `crm.payments.read` | payment fields в `orders_new` | Не обращается к банку; предупреждает об отсутствии ledger |
| `get_inventory` | `crm.inventory.read` | `products` | Честно сообщает, что количественный учет не подтверждён |
| `get_production_status` | `crm.production.read` | `production_entries` | До 200 строк ответа |
| `get_finance_summary` | `finance.read` | `orders_new` + `expenses` | Расчетная сводка, не банковский баланс |
| `get_tasks` | `crm.tasks.read` | `tasks` | Только чтение |
| `get_supplier` | `supplier.read` | источник отсутствует | Возвращает `found:false`, не выдумывает поставщика |
| `search_communications` | `crm.communications.read` | Telegram/Instagram/other top-level messages | Site chat subcollections пока не включены без безопасного индекса |

## Повторное использование

- MCP adapter регистрирует определения из registry.
- REST adapter вызывает `container.aiTools.execute(...)`.
- будущий OpenAI runner и внутренний worker должны импортировать этот же layer/container.

Добавлять прямой `db.collection(...)` в MCP handler, agent prompt или automation handler запрещено. Сначала создаётся/переиспользуется CRM service, затем маленький tool contract.

## Audit contract

Коллекция `ai_agent_audit_logs` создаётся только через Firebase Admin; клиентские Firestore Rules не дают ей доступа по умолчанию. Записываются:

- `agent_id`, `user_id`, `timestamp`;
- `tool`, безопасно очищенные `arguments`, `reason`;
- краткий `result`, `status`, `duration_ms`;
- `approval_required`, `approval_by`;
- `cost_tokens`, если runtime передал usage.

Если audit log записать нельзя, tool call завершается ошибкой: агент не получает успешный ответ без следа.

Поскольку audit log является записью, MCP metadata использует `readOnlyHint:false`, `destructiveHint:false`. Это намеренная точность контракта по правилам OpenAI: инструмент не меняет CRM, но технически имеет журналирующий side effect.

## Правило расширения

Read и write — разные инструменты. Нельзя превращать существующий read tool в инструмент с побочным эффектом. Любой новый write tool требует permission, policy, idempotency key, audit, негативные тесты и feature flag.
