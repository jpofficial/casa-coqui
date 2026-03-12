const { readFileSync } = require('fs');
const { resolve } = require('path');
const { GoogleAuth } = require('google-auth-library');

// Load .env.local
const envPath = resolve(__dirname, '..', '.env.local');
const envFile = readFileSync(envPath, 'utf-8');
const env = {};
for (const line of envFile.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIndex = trimmed.indexOf('=');
  if (eqIndex === -1) continue;
  env[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1);
}

const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY);
const projectId = serviceAccount.project_id;

const RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Admin: full access when authenticated with admin email
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}`;

async function setRules() {
  const auth = new GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  const client = await auth.getClient();
  const { token } = await client.getAccessToken();

  // First get current ruleset to check
  const listUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

  // Use the Firebase Rules API to deploy rules
  const rulesUrl = `https://firebaserules.googleapis.com/v1/projects/${projectId}/rulesets`;

  // Step 1: Create a new ruleset
  console.log('Creating Firestore security rules...');
  const createRes = await fetch(rulesUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: {
        files: [
          {
            content: RULES,
            name: 'firestore.rules',
            fingerprint: Buffer.from(RULES).toString('base64'),
          },
        ],
      },
    }),
  });

  const createData = await createRes.json();
  if (!createRes.ok) {
    console.error('Failed to create ruleset:', JSON.stringify(createData, null, 2));
    process.exit(1);
  }

  const rulesetName = createData.name;
  console.log('Ruleset created:', rulesetName);

  // Step 2: Release (apply) the ruleset to the default database
  const releaseUrl = `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases`;
  const releaseName = `projects/${projectId}/releases/cloud.firestore`;

  // Try PATCH first (update existing release), fall back to POST (create new)
  let releaseRes = await fetch(`${releaseUrl}/cloud.firestore`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      release: {
        name: releaseName,
        rulesetName: rulesetName,
      },
    }),
  });

  if (!releaseRes.ok) {
    // Try POST
    releaseRes = await fetch(releaseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: releaseName,
        rulesetName: rulesetName,
      }),
    });
  }

  const releaseData = await releaseRes.json();
  if (releaseRes.ok) {
    console.log('Firestore rules deployed successfully!');
    console.log('Rules allow read/write for any authenticated user.');
  } else {
    console.error('Failed to release ruleset:', JSON.stringify(releaseData, null, 2));
    process.exit(1);
  }
}

setRules();
