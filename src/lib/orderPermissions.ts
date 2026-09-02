import { useEffect, useMemo, useState } from 'react';

import { auth } from '../firebase';
import { ALL_ORDER_ACTIONS, normalizeOrderActions, type OrderAction } from './orderPermissionConfig';

export { ALL_ORDER_ACTIONS, getOrderActionForField, ORDER_ACTION_OPTIONS, type OrderAction } from './orderPermissionConfig';

export const useOrderPermissions = () => {
  const [actions, setActions] = useState<OrderAction[]>([...ALL_ORDER_ACTIONS]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        await auth.authStateReady();
        const user = auth.currentUser;
        if (!user) return;
        if (String(user.email || '').trim().toLowerCase() === 'ndtiger86@gmail.com') {
          if (active) setActions([...ALL_ORDER_ACTIONS]);
          return;
        }
        const token = await user.getIdToken();
        const response = await fetch('/api/access/me', { headers: { Authorization: `Bearer ${token}` } });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Не удалось загрузить права');
        if (active) setActions(normalizeOrderActions(payload.allowedOrderActions));
      } catch (error) {
        console.warn('[access] Не удалось загрузить права действий заказов:', error);
        // Совместимость со старыми аккаунтами: недоступность сервиса прав не должна
        // внезапно остановить работу менеджеров.
        if (active) setActions([...ALL_ORDER_ACTIONS]);
      } finally {
        if (active) setLoaded(true);
      }
    };
    void load();
    return () => { active = false; };
  }, [auth.currentUser?.uid]);

  const allowedSet = useMemo(() => new Set(actions), [actions]);
  return {
    actions,
    loaded,
    canOrderAction: (action: OrderAction) => allowedSet.has(action),
  };
};
