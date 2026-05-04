
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';

const config = JSON.parse(readFileSync('./firebase-applet-config.json', 'utf-8'));
const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);

async function checkConfig() {
  const settingsDoc = await getDoc(doc(db, "settings", "ai_config"));
  if (settingsDoc.exists()) {
    console.log('AI_CONFIG:', JSON.stringify(settingsDoc.data(), null, 2));
  } else {
    console.log('AI_CONFIG not found');
  }
}

checkConfig().catch(console.error);
