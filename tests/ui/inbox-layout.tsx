import React from 'react';
import { createRoot } from 'react-dom/client';
import './inbox-layout.css';
import { UnifiedInboxPage } from '../../src/components/UnifiedInboxPage';

const rows = Array.from({ length: 80 }, (_, i) => ({
  id: `fixture-${i}`, name: `Тестовый диалог ${i + 1}`, accountPhone: '+70000000000', peerId: String(i),
  updatedAt: new Date(Date.UTC(2026, 7, 28, 12, 0, -i)).toISOString(),
  lastMessage: { id: String(i), text: `Сообщение-пример ${i + 1}`, createdAt: '2026-08-28T12:00:00Z', direction: 'incoming' },
}));
const messages = new Map<string, any[]>();
let reloads = 0;
let sent = 0;
const updateStatus = () => {
  const status = document.getElementById('fixture-status');
  if (status) status.textContent = `Обновлений: ${reloads}. Отправок: ${sent}. Только тестовые данные.`;
};
window.fetch = async (input, options = {}) => {
  const url = new URL(String(input), window.location.origin);
  let result: any;
  if (url.pathname === '/api/instagram/conversations') {
    result = { conversations: [], notice: 'Тестовое уведомление Instagram. Проверяем, что предупреждения не прячут поле ввода и не растягивают область сообщений.' };
  } else if (url.pathname === '/api/site-chat/conversations') {
    result = { conversations: [] };
  } else if (url.pathname === '/api/tg-inbox/conversations') {
    result = { conversations: rows };
  } else if (url.pathname === '/api/tg-inbox/messages') {
    const body = options.body ? JSON.parse(String(options.body)) : {};
    const peer = String(body.peerId ?? url.searchParams.get('peerId') ?? '0');
    if (!messages.has(peer)) messages.set(peer, Array.from({ length: peer === '2' ? 2 : 80 }, (_, i) => ({
      id: `${peer}-${i}`, text: `Диалог ${Number(peer) + 1}: сообщение ${i + 1}. ${i === 78 ? 'ОченьДлинныйТекстБезПробелов'.repeat(25) : 'Проверяем переписку и прокрутку.'}`,
      direction: i % 2 ? 'outgoing' : 'incoming', createdAt: '2026-08-28T12:00:00Z',
    })));
    if (options.method === 'POST') {
      sent++;
      const message = { id: `sent-${sent}`, text: body.text, direction: 'outgoing', createdAt: new Date().toISOString() };
      messages.get(peer)!.push(message);
      result = { message };
    } else {
      reloads++;
      result = { messages: [...messages.get(peer)!] };
      if (peer === '1') await new Promise(resolve => setTimeout(resolve, 1600));
    }
  } else throw new Error(`Fixture blocked unexpected network request: ${url.pathname}`);
  updateStatus();
  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

createRoot(document.getElementById('root')!).render(<div className="ybcrm-app">
  <header className="h-16 border-b bg-white p-4">YBCRM — проверка мессенджера</header>
  <main className="min-h-[calc(100vh-48px)]">
    <div className="mx-auto max-w-[1920px] p-4"><nav className="h-12 rounded-xl border bg-white p-3">Главная · Заказы · Клиенты · Соцсети</nav></div>
    <div className="mx-auto max-w-[1880px] px-3 pb-3 sm:px-5">
      <header className="py-5"><h1 className="text-2xl">Центр соцсетей</h1><p id="fixture-status">Только тестовые данные.</p></header>
      <nav className="mb-4 flex h-14 items-center rounded-xl border bg-white px-4">Входящие · Публикация · Подключения</nav>
      <UnifiedInboxPage />
    </div>
  </main>
</div>);
