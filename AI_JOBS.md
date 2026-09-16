# Безопасные фоновые AI-задания

## Назначение

`ai_jobs` — серверная очередь для будущих AI-действий. Браузер и MCP не имеют прямого доступа к коллекции. Основная CRM не зависит от работы очереди.

## Состояния

`awaiting_approval → queued → running → succeeded`

При временной ошибке: `running → retry_wait → running`. После исчерпания попыток: `dead_letter`. Владелец может перевести задание в `cancelled`.

## Гарантии первого этапа

- обязательный `idempotencyKey`: повторный запрос возвращает существующее задание;
- policy registry запрещает неизвестные типы заданий;
- `APPROVAL` не попадает в исполнение без подтверждения владельца;
- kill switch по умолчанию выключен, если серверная настройка отсутствует;
- Firestore transaction выдаёт lease только одному worker;
- timeout ограничивает зависшие действия;
- exponential backoff ограничен 15 минутами;
- после `maxAttempts` задание попадает в DLQ (`dead_letter`);
- payload ограничен 32 KB;
- в первом релизе существует только безопасный executor `system.health_check`.

## Защищённые API

Все маршруты owner-only и требуют Firebase ID token:

- `GET /api/ai-jobs`;
- `POST /api/ai-jobs`;
- `GET|POST /api/ai-jobs/runtime`;
- `POST /api/ai-jobs/:id/approve`;
- `POST /api/ai-jobs/:id/cancel`;
- `POST /api/ai-jobs/run`.

Автоматический scheduler, Telegram notifications и UI подтверждений добавляются следующим изменением. До этого очередь остаётся выключенной и не выполняет бизнес-действия.
