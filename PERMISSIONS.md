# Разрешения и Human Approval Layer

## Модель

Permission отвечает на вопрос «может ли этот субъект запрашивать действие». Policy отвечает на вопрос «можно ли выполнять действие автономно». Наличие permission не отменяет approval.

Первый профиль `ai_reader` получает только read permissions через OAuth scope `crm.read`. Для будущих service accounts JWT может содержать точный allowlist `permissions`; он проверяется по известному каталогу и имеет приоритет над широким scope. Пароли, API keys и банковские credentials в JWT/permission не передаются.

## Permission catalog

| Permission | Policy | Комментарий |
|---|---|---|
| `crm.customers.read` | SAFE | Персональные данные только для авторизованного бизнес-сценария |
| `crm.orders.read` | SAFE | Read-only |
| `crm.payments.read` | SAFE | Без банковских credentials |
| `crm.inventory.read` | SAFE | Read-only |
| `crm.production.read` | SAFE | Read-only |
| `crm.tasks.read` | SAFE | Read-only |
| `crm.communications.read` | SAFE | Общий read-доступ к нормализованному поиску переписки |
| `finance.read` | SAFE | Агрегаты, не банковский secret |
| `telegram.read` | SAFE | Требует retention/PII контроля |
| `supplier.read` | SAFE | Источник ещё не создан |
| `crm.orders.write` | APPROVAL | Точный diff и hash аргументов |
| `crm.production.write` | APPROVAL | С проверкой периода и количества |
| `crm.tasks.write` | APPROVAL | Первый кандидат на будущий write pilot |
| `finance.prepare_payment` | APPROVAL | Только черновик/preview |
| `telegram.send` | APPROVAL | Получатель и текст видны владельцу |
| `supplier.order` | APPROVAL | Лимит суммы и поставщик из справочника |
| `content.create` | APPROVAL | Черновик |
| `content.publish` | APPROVAL | Финальный preview и канал |
| `finance.execute_payment` | FORBIDDEN | Автономному агенту не выдаётся |
| удаление бизнес-данных | FORBIDDEN | Только отдельная ручная процедура |
| изменение прав | FORBIDDEN | Только владелец через admin flow |
| production deploy | FORBIDDEN | Только проверенный Git/CI процесс |
| изменение критической бизнес-логики | FORBIDDEN | Через review и pull request |
| налоги/подача отчетности | FORBIDDEN | Пока нет отдельного юридического и технического контура |

## Требования к будущему approval

Approval должен содержать `request_id`, agent/user, tool, hash точных аргументов, человекочитаемый preview, сумму/получателя при деньгах, TTL, одноразовый nonce и статус. После подтверждения сервер повторно проверяет permission, policy, TTL и hash. Изменение аргументов аннулирует approval.

## Profiles первого этапа

- `ai_reader`: только перечисленные read permissions.
- `human_owner`: не реализуется как всесильный AI token; владелец подтверждает действия отдельным каналом.
- `autonomous_agent`: пока не создаётся.

Ни один JWT с `crm.write` не открывает write tool: write tools в registry первого этапа отсутствуют.
