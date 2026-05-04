
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';

const config = JSON.parse(readFileSync('./firebase-applet-config.json', 'utf-8'));
const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);

async function updateProduct() {
  const productId = '1775895309892';
  const docRef = doc(db, 'products', productId);
  
  // Direct image link provided by user
  await updateDoc(docRef, {
    photos: ['https://i.ibb.co/S4DP1Sk6/untitled-Gemini-3-1-Flash-Nano-Banana-2-2026-03-26-09-13-09.png']
  });
  
  console.log(`Product ${productId} updated with new photo link.`);
}

updateProduct().catch(console.error);
