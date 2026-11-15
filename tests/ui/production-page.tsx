import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './finance-dashboard.css';
import { ProductionPage } from '../../src/components/ProductionPage';

const Fixture = () => {
  const [month, setMonth] = useState('2026-08');
  useEffect(() => {
    const view = new URLSearchParams(window.location.search).get('view');
    if (!view) return;
    const timeout = window.setTimeout(() => {
      const expected = view === 'payments' ? 'Оплата за пошив' : 'План производства';
      Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes(expected))?.click();
    }, 50);
    return () => window.clearTimeout(timeout);
  }, []);
  return <ProductionPage selectedMonth={month} setSelectedMonth={setMonth} onOpenOrders={() => undefined} />;
};

createRoot(document.getElementById('root')!).render(<Fixture />);
