
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, updateDoc, collection, getDocs, query, where } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function updateHopeProduct() {
  try {
    const qSnapshot = await getDocs(collection(db, 'products'));
    const hopeDocs = qSnapshot.docs.filter(doc => (doc.data().name || '').toLowerCase().includes('hope'));
    
    if (hopeDocs.length === 0) {
      console.log('Product with "Hope" in name not found');
      return;
    }

    for (const hopeDoc of hopeDocs) {
      await updateDoc(doc(db, 'products', hopeDoc.id), {
        postUrl: 'https://www.instagram.com/p/DWoT5TvjCyc/'
      });
      console.log(`Successfully updated product "${hopeDoc.data().name}" with postUrl`);
    }
  } catch (error) {
    console.error('Error updating product:', error);
  }
}

updateHopeProduct();
