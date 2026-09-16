# Безопасный ввод изменений в production

Чек-лист выполнен 16 сентября 2026 года в рамках безопасного canary-внедрения. Пункты, требующие доступа к кабинетам внешних поставщиков, остаются операционными проверками.

1. Сделать backup Firestore и экспортировать список `crm_access_profiles` без секретов.
2. Для каждого действующего сотрудника задать `active: true`, `orderActionsConfigured: true` и точный `allowedOrderActions`. Проверить владельца и минимум одного тестового сотрудника.
3. Создать/проверить Secret Manager entries для MCP JWT secret, MCP PIN, Telegram, Gemini, Anthropic и integration credentials. Старые раскрытые значения отозвать и выпустить заново.
4. Перенести действующие `geminiKey`/`claudeKey` из `settings/ai_config` в Secret Manager, проверить server env, затем удалить эти два поля отдельной подтверждённой миграцией.
5. Убедиться, что ManyChat и Chatwoot больше не отправляют webhooks на CRM; связанные внешние подключения можно удалить в их кабинетах вручную.
6. Сначала развернуть backend revision без трафика и выполнить smoke tests авторизации, банка, Telegram, Instagram и CDEK.
7. Firestore Rules применены и удалённо скомпилированы. `npm run test:rules` остаётся повторить в CI/среде с Java 21+ и Firestore Emulator.
8. Развернуть MCP отдельно, проверить 12 read-only tools, permissions и `ai_agent_audit_logs`.
9. Переключать трафик canary-этапом. При 401/403 у легитимных сотрудников откатить Rules и исправить профиль, не открывать wildcard-доступ.
10. Не включать write tools, автономных агентов, платежи или публикацию контента до отдельного approval-этапа.
