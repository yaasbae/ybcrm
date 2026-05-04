
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { readFileSync } from 'fs';

const config = JSON.parse(readFileSync('./firebase-applet-config.json', 'utf-8'));
const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);

async function checkLogs() {
  const q = query(collection(db, 'ai_logs'), orderBy('timestamp', 'desc'), limit(5));
  const querySnapshot = await getDocs(q);
  
  console.log('RECENT_LOGS:');
  querySnapshot.forEach((doc) => {
    console.log(JSON.stringify(doc.data(), null, 2));
  });
}

checkLogs().catch(console.error);
