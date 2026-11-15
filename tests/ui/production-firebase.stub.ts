const entries = [
  { id: 'p1', productName: 'Худи Zip петля ISIDA мини', date: '2026-08-31', quantity: 2, cuttingCost: 450, sewingCost: 700 },
  { id: 'p2', productName: 'Бельё Base вискоза', date: '2026-08-31', quantity: 4, cuttingCost: 100, sewingCost: 300 },
  { id: 'p3', productName: 'Костюм петля ISIDA миди', date: '2026-08-15', quantity: 6, cuttingCost: 1000, sewingCost: 1400 },
  { id: 'p4', productName: 'Костюм лето FLAME90x', date: '2026-07-15', quantity: 3, cuttingCost: 800, sewingCost: 1600 },
];

const expenses = [
  { id: 'production-2026-08-h1', source: 'production', productionMonth: '2026-08', productionHalf: 1, amount: 14400, paymentDate: '2026-08-30', status: 'paid', paid: true },
  { id: 'production-2026-08-h2', source: 'production', productionMonth: '2026-08', productionHalf: 2, amount: 3900, paymentDate: '2026-09-15', status: 'paid', paid: true },
  { id: 'production-2026-10-h1', source: 'production', productionMonth: '2026-10', productionHalf: 1, amount: 58200, paymentDate: '2026-10-30', status: 'paid', paid: true },
  { id: 'production-2026-10-h2', source: 'production', productionMonth: '2026-10', productionHalf: 2, amount: 76400, paymentDate: '2026-11-15', status: 'planned', paid: false },
];

const orders = [
  { id: 'o-1042', orderId: '1042', orderNumber: '1042', clientName: 'Анна Смирнова', clientPhone: '+7 900 000-00-01', status: 'Оплачен', items: ['Худи Zip петля ISIDA мини'], itemColors: ['Молочный'], itemSizes: ['M'], date: '2026-11-12T10:00:00.000Z', deadlineDate: '2026-11-20' },
  { id: 'o-1041', orderId: '1041', orderNumber: '1041', clientName: 'Мария Орлова', clientPhone: '+7 900 000-00-02', status: 'Накроить', items: ['Костюм лето FLAME90x'], itemColors: ['Чёрный'], itemSizes: ['S'], date: '2026-11-11T12:00:00.000Z', deadlineDate: '2026-11-18' },
  { id: 'o-1040', orderId: '1040', orderNumber: '1040', clientName: 'Ирина Волкова', status: 'Пошив', items: ['Костюм BASE'], itemColors: ['Серый'], itemSizes: ['M'], date: '2026-11-10T12:00:00.000Z', deadlineDate: '2026-11-16' },
];

const products = ['Худи Zip петля ISIDA мини', 'Бельё Base вискоза', 'Костюм петля ISIDA миди', 'Костюм лето FLAME90x'];

export const auth = { currentUser: { getIdToken: async () => 'fixture-token' } };
export const db = {};
export const collection = (_db: unknown, name: string) => ({ name });
export const doc = (_db: unknown, name: string, id?: string) => ({ name, id });
export const query = (source: unknown) => source;
export const where = () => undefined;
export const serverTimestamp = () => new Date();
export const arrayUnion = (...values: unknown[]) => values;
export const addDoc = async () => ({ id: 'new-entry' });
export const setDoc = async () => undefined;
export const updateDoc = async () => undefined;
export const deleteDoc = async () => undefined;
export const getDocs = async () => ({ docs: [] });
export const writeBatch = () => ({ set: () => undefined, update: () => undefined, delete: () => undefined, commit: async () => undefined });
export const onSnapshot = (source: any, success: (snapshot: any) => void) => {
  if (source?.name === 'settings' && source?.id === 'handbook') {
    success({ exists: () => true, data: () => ({ productNames: products }) });
  } else {
    const rows = source?.name === 'orders_new' ? orders : source?.name === 'production_entries' ? entries : source?.name === 'expenses' ? expenses : [];
    success({ docs: rows.map((row) => ({ id: row.id, data: () => row })) });
  }
  return () => undefined;
};
