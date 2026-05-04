
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, updateDoc, collection, getDocs } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function updateBomberProduct() {
  try {
    const qSnapshot = await getDocs(collection(db, 'products'));
    const bomberDocs = qSnapshot.docs.filter(doc => (doc.data().name || '').toLowerCase().includes('бомбер'));
    
    if (bomberDocs.length === 0) {
      console.log('Product with "Бомбер" in name not found');
      return;
    }

    for (const bomberDoc of bomberDocs) {
      await updateDoc(doc(db, 'products', bomberDoc.id), {
        postUrl: 'https://www.instagram.com/p/DWoT5TvjCyc/'
      });
      console.log(`Successfully updated "${bomberDoc.data().name}" with Instagram link`);
    }
  } catch (error) {
    console.error('Error updating product:', error);
  }
}

updateBomberProduct();
