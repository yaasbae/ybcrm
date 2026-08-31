# Messenger layout regression fixture

Run `./node_modules/.bin/vite --config tests/ui/inbox-layout.config.ts` and open
`http://127.0.0.1:4178/inbox-layout.html`.

The fixture mounts the real `UnifiedInboxPage` and its production styles. It
replaces Firebase and API calls with synthetic data (80 conversations, up to 80
messages). It does not load CRM credentials or send messages to Telegram.

Regression checks:

- At 1440×900 and 1024×768, the input and Send button fit inside the viewport.
  Both the message pane and conversation list scroll independently.
- Scroll up in the message pane. After the 10-second polling interval, its
  position and the document scroll position should remain unchanged.
- Switch quickly from conversation 2 (delayed response) to conversation 3.
  Only conversation 3's two messages should remain after the delayed response.
- At 375×667, select a conversation. It opens full-screen; Back restores the
  list. Input remains visible and there is no horizontal document overflow.
- Reduce the open mobile chat to 375×360 and rotate to 812×375. The composer
  remains visible. When previously at the bottom, the latest message stays
  above it. Resizing a desktop browser approximates reduced available height;
  it does not replace a real iOS/Android keyboard test.
- A long unbroken message must wrap without widening the page.
- Send a synthetic message and verify it appears once and clears the composer.
  Enter on mobile adds a newline; on desktop Enter sends and Shift+Enter adds
  a newline. Do not use this check against real customer conversations.

Runtime geometry can be inspected from the labeled DOM elements:
`Общий мессенджер`, `Список диалогов`, `Сообщения`, `Текст сообщения`.
