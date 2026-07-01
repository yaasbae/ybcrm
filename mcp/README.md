# YBCRM MCP Server

Отдельный production-ready MCP сервер для подключения ChatGPT к CRM.

## Что умеет

- `orders.list` — список заказов с фильтрами.
- `orders.get` — заказ по ID или номеру.
- `orders.update` — изменение статуса заказа.
- `clients.search` — поиск клиента по телефону, имени, Instagram или заказу.
- `analytics.sales` — продажи сегодня, вчера, неделя, месяц, средний чек, заказы, конверсия.
- `instagram.stats` — базовая статистика Instagram через Meta Graph API.
- `content.analytics` — связка контента Meta с заказами CRM.
- `finance.summary` — выручка, прибыль, расходы, зарплаты, аренда, остаток.
- `tasks.create` — задача менеджеру.
- `dashboard` — полная сводка компании.

## Локальный запуск

```bash
cd mcp
cp .env.example .env
npm install
npm run dev
```

Swagger будет доступен по адресу:

```text
http://localhost:3100/docs
```

MCP endpoint:

```text
http://localhost:3100/mcp
```

## Переменные окружения

```text
PORT=3100
CRM_JWT_SECRET=минимум-16-символов
FIREBASE_PROJECT_ID=...
FIREBASE_DATABASE_ID=production
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
META_ACCESS_TOKEN=...
META_IG_USER_ID=...
```

Для Firebase можно использовать либо `FIREBASE_SERVICE_ACCOUNT_JSON`, либо стандартный `GOOGLE_APPLICATION_CREDENTIALS`.

## Docker

```bash
cd mcp
docker compose up --build
```

## Подключение к ChatGPT

После деплоя укажи в ChatGPT MCP endpoint:

```text
https://твой-домен/mcp
```

Авторизация идет через `Authorization: Bearer <JWT>`.

## Проверка

```bash
npm run build
npm test
```
