// Isolated layout fixture: never authenticate, read contacts, or write to Firestore.
export const auth = { currentUser: null };
export const db = {};
export const collection = () => ({});
export const limit = () => ({});
export const orderBy = () => ({});
export const query = () => ({});
export const onSnapshot = (_query: unknown, callback: (snapshot: { docs: never[] }) => void) => {
  callback({ docs: [] });
  return () => {};
};
