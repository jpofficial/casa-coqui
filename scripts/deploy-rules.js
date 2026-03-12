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

// Read rules file
const rulesContent = readFileSync(resolve(__dirname, '..', 'firestore.rules'), 'utf-8');

async function deploy() {
  const auth = new GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/firebase'],
  });

  const client = await auth.getClient();
  const { token } = await client.getAccessToken();

  // Step 1: Create ruleset
  console.log('Creating Firestore ruleset...');
  const createRes = await fetch(
    `https://firebaserules.googleapis.com/v1/projects/${projectId}/rulesets`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: {
          files: [{ content: rulesContent, name: 'firestore.rules' }],
        },
      }),
    }
  );

  const createData = await createRes.json();
  if (!createRes.ok) {
    console.error('Failed to create ruleset:', JSON.stringify(createData, null, 2));
    process.exit(1);
  }

  const rulesetName = createData.name;
  console.log('Ruleset created:', rulesetName);

  // Step 2: Release it
  console.log('Deploying ruleset...');
  const releaseName = `projects/${projectId}/releases/cloud.firestore`;

  // Try PATCH (update) first
  let releaseRes = await fetch(
    `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/cloud.firestore`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        release: { name: releaseName, rulesetName },
      }),
    }
  );

  if (!releaseRes.ok) {
    // Try POST (create new release)
    releaseRes = await fetch(
      `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: releaseName, rulesetName }),
      }
    );
  }

  const releaseData = await releaseRes.json();
  if (releaseRes.ok) {
    console.log('Firestore rules deployed successfully!');
  } else {
    console.error('Failed to deploy rules:', JSON.stringify(releaseData, null, 2));
    console.log('\nFallback: Copy the rules from firestore.rules to the Firebase Console manually:');
    console.log('  https://console.firebase.google.com/project/' + projectId + '/firestore/rules');
    process.exit(1);
  }
}

deploy();
