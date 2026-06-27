const fetch = require('node-fetch');
const fs = require('fs');

function readEnv() {
  const env = {};
  try {
    const text = fs.readFileSync('.env', 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const index = trimmed.indexOf('=');
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      value = value.replace(/^['"]|['"]$/g, '');
      env[key] = value;
    }
  } catch (err) {
    console.error("Could not read .env file:", err.message);
  }
  return env;
}

const env = readEnv();
const PROJECT_ID = env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
const API_KEY = env.EXPO_PUBLIC_FIREBASE_API_KEY;

const collections = [
  'users',
  'restaurant_tables',
  'menu_categories',
  'menu_items',
  'orders',
  'order_items',
  'payments',
  'expenses',
  'deliveries',
  'daily_summary',
  'due_payments',
  'weather_data',
  'off_days'
];

async function countAll() {
  console.log('--- FIRESTORE COLLECTION COUNTS ---');
  for (const coll of collections) {
    let count = 0;
    let nextPageToken = '';
    try {
      do {
        const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${coll}?key=${API_KEY}&pageSize=300${nextPageToken ? `&pageToken=${nextPageToken}` : ''}&mask.fieldPaths=id`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (data.documents) count += data.documents.length;
          nextPageToken = data.nextPageToken || '';
        } else {
          nextPageToken = '';
        }
      } while (nextPageToken);
      console.log(`${coll.padEnd(20)}: ${count}`);
    } catch (err) {
      console.log(`${coll.padEnd(20)}: Error`);
    }
  }
}

countAll();