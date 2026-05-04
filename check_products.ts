import { initializeApp } from 'firebase/app';
import { getFirestore, collection, limit, getDocs } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkProducts() {
  try {
    const querySnapshot = await getDocs(collection(db, "products"));
    console.log("--- PRODUCTS ---");
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      console.log(`ID: ${doc.id}, Name: ${data.name}, Photos: ${JSON.stringify(data.photos)}`);
    });
  } catch (e) {
    console.error("Error reading products:", e);
  }
}

checkProducts();
