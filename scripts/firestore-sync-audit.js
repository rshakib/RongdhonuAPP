const fs = require('fs');

function readEnv() {
  const env = {};
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
  return env;
}

function fieldValue(fields, key) {
  const value = fields?.[key];
  if (!value) return undefined;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return Number(value.doubleValue);
  if (value.timestampValue !== undefined) return value.timestampValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  return value;
}

function simplifyDocument(doc) {
  if (!doc) return null;
  const id = doc.name.split('/').pop();
  const fields = doc.fields || {};
  return {
    id,
    amount: fieldValue(fields, 'amount'),
    eja_amount: fieldValue(fields, 'eja_amount'),
    updated_at: fieldValue(fields, 'updated_at'),
    created_at: fieldValue(fields, 'created_at'),
  };
}

async function main() {
  const env = readEnv();
  const projectId = env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
  const apiKey = env.EXPO_PUBLIC_FIREBASE_API_KEY;
  if (!projectId || !apiKey) {
    throw new Error('Missing Firebase project id or API key in .env');
  }

  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const cutoffs = {
    latestManualPull: {
      expenses: '2026-05-31T20:35:47.307Z',
      eja_history: '2026-05-31T20:35:47.458Z',
    },
    latestObservedDevice: {
      expenses: '2026-05-31T20:38:57.721Z',
      eja_history: '2026-05-31T20:38:57.991Z',
    },
  };

  async function getDocument(collection, id) {
    const res = await fetch(`${base}/${collection}/${encodeURIComponent(id)}?key=${apiKey}`);
    const json = await res.json();
    return { status: res.status, doc: res.ok ? simplifyDocument(json) : json };
  }

  async function runIncrementalQuery(collection, lastSyncTime) {
    const query = {
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'updated_at' },
            op: 'GREATER_THAN',
            value: { stringValue: lastSyncTime },
          },
        },
      },
    };

    const res = await fetch(`${base}:runQuery?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    });
    const json = await res.json();
    const docs = Array.isArray(json)
      ? json.filter((item) => item.document).map((item) => simplifyDocument(item.document))
      : [];

    return {
      status: res.status,
      collection,
      lastSyncTime,
      updated_at_filter: `updated_at GREATER_THAN ${lastSyncTime}`,
      query,
      count: docs.length,
      ids: docs.map((doc) => doc.id),
      docs,
    };
  }

  async function fetchCollection(collection) {
    const res = await fetch(`${base}/${collection}?key=${apiKey}&pageSize=300`);
    const json = await res.json();
    const docs = (json.documents || []).map(simplifyDocument);
    return {
      status: res.status,
      collection,
      count: docs.length,
      ids: docs.map((doc) => doc.id),
      containsTargets: {
        expenseIjara: docs.some((doc) => doc.id === 'exp_2026-06-01_ijara'),
        eja: docs.some((doc) => doc.id === 'eja_2026-06-01'),
      },
    };
  }

  const expenseDoc = await getDocument('expenses', 'exp_2026-06-01_ijara');
  const ejaDoc = await getDocument('eja_history', 'eja_2026-06-01');
  const expenseIncremental = await runIncrementalQuery('expenses', cutoffs.latestManualPull.expenses);
  const ejaIncremental = await runIncrementalQuery('eja_history', cutoffs.latestManualPull.eja_history);
  const expenseIncrementalCurrent = await runIncrementalQuery('expenses', cutoffs.latestObservedDevice.expenses);
  const ejaIncrementalCurrent = await runIncrementalQuery('eja_history', cutoffs.latestObservedDevice.eja_history);
  const expenseFull = await fetchCollection('expenses');
  const ejaFull = await fetchCollection('eja_history');

  console.log(JSON.stringify({
    cutoffsFromMetroLog: cutoffs,
    targetDocuments: {
      expense: expenseDoc,
      eja: ejaDoc,
    },
    comparisons: {
      expense_updated_at_gt_latest_manual_pull_time:
        expenseDoc.doc?.updated_at > cutoffs.latestManualPull.expenses,
      eja_updated_at_gt_latest_manual_pull_time:
        ejaDoc.doc?.updated_at > cutoffs.latestManualPull.eja_history,
      expense_updated_at_gt_latest_observed_device_time:
        expenseDoc.doc?.updated_at > cutoffs.latestObservedDevice.expenses,
      eja_updated_at_gt_latest_observed_device_time:
        ejaDoc.doc?.updated_at > cutoffs.latestObservedDevice.eja_history,
    },
    incrementalQueries: {
      latestManualPull: {
        expenses: expenseIncremental,
        eja_history: ejaIncremental,
      },
      latestObservedDevice: {
        expenses: expenseIncrementalCurrent,
        eja_history: ejaIncrementalCurrent,
      },
    },
    freshInstallEquivalentFetchCollection: {
      expenses: expenseFull,
      eja_history: ejaFull,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
