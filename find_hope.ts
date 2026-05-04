
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';
import { readFileSync } from 'fs';

const config = JSON.parse(readFileSync('./firebase-applet-config.json', 'utf-8'));
const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);

async function findProduct() {
  const q = query(collection(db, 'products'));
  const querySnapshot = await getDocs(q);
  querySnapshot.forEach((doc) => {
    const data = doc.data();
    if (data.name && data.name.toLowerCase().includes('hope')) {
      console.log(`FOUND_PRODUCT_ID: ${doc.id}`);
      console.log(`PRODUCT_NAME: ${data.name}`);
    }
  });
}

findProduct().catch(console.error);
