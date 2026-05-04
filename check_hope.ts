
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';

const config = JSON.parse(readFileSync('./firebase-applet-config.json', 'utf-8'));
const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);

async function checkProduct() {
  const productId = '1775895309892';
  const docRef = doc(db, 'products', productId);
  const docSnap = await getDoc(docRef);
  
  if (docSnap.exists()) {
    console.log('PRODUCT_DATA:', JSON.stringify(docSnap.data(), null, 2));
  } else {
    console.log('Product not found');
  }
}

checkProduct().catch(console.error);
