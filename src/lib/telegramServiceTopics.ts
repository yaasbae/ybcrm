export const isReservedTelegramServiceTopic = (
  chatId: unknown,
  threadId: unknown,
  topics: Array<{ chatId: unknown; threadId: unknown }>,
) => topics.some(topic => (
  String(chatId ?? '') === String(topic.chatId ?? '')
  && Number(threadId || 0) === Number(topic.threadId || 0)
));
