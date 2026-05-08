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

async function run() {
  const auth = new GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/firebase'],
  });

  const client = await auth.getClient();
  const { token } = await client.getAccessToken();

  // Step 1: Initialize Identity Platform with empty body
  console.log('Step 1: Initializing Identity Platform...');
  const initUrl = `https://identitytoolkit.googleapis.com/v2/projects/${projectId}/identityPlatform:initializeAuth`;
  const initRes = await fetch(initUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  const initData = await initRes.json();
  if (initRes.ok) {
    console.log('Identity Platform initialized.');
  } else if (initData.error?.code === 409 || initData.error?.status === 'ALREADY_EXISTS') {
    console.log('Identity Platform already initialized.');
  } else {
    console.log('Init response:', JSON.stringify(initData, null, 2));
    console.log('Continuing anyway...');
  }

  // Step 2: Enable Email/Password provider via the config endpoint
  console.log('Step 2: Enabling Email/Password sign-in...');
  const configUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired`;
  const configRes = await fetch(configUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      signIn: {
        email: {
          enabled: true,
          passwordRequired: true,
        },
      },
    }),
  });

  const configData = await configRes.json();
  if (configRes.ok) {
    console.log('Email/Password auth enabled successfully.');
  } else {
    console.error('Failed to enable email auth:', JSON.stringify(configData, null, 2));
    process.exit(1);
  }
}

run();
