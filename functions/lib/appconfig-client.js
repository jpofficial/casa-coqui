'use strict';

// ---------------------------------------------------------------------------
// appconfig-client — Cloud Function side AppConfig Data API client.
//
// Why this exists:
//   The Firebase Cloud Function isn't a Lambda, so it cannot use the AWS
//   AppConfig Lambda Extension sidecar. It must call the Data API directly
//   (StartConfigurationSession + GetLatestConfiguration). Spec Decision 2.
//
// IAM service prefix: appconfigdata:* (NOT appconfig:*) — Decision 2.
//
// Fail-closed contract (Decision 13):
//   On ANY error — IAM denied, 5xx, network timeout, malformed payload, env
//   vars missing — return { mode: 'firebase', rollout_pct: 0 } and emit a
//   BridgeRouteFailures metric. The bridge is never blocked on AppConfig.
//
// Cache TTL: 60 seconds (matches the Lambda Extension default).
//
// v3.1: returns `version` (opaque AppConfig VersionLabel) so the bridge can
// stamp it on the SFN input as `appConfigVersion`. This is the AppConfig
// flag version, distinct from the drafter's prompt-side appConfigVersion.
// ---------------------------------------------------------------------------

const {
  AppConfigDataClient,
  StartConfigurationSessionCommand,
  GetLatestConfigurationCommand,
} = require('@aws-sdk/client-appconfigdata');
const { emitBridgeMetric } = require('./bridge-metrics');

const LEGACY_DEFAULT = Object.freeze({ mode: 'firebase', rollout_pct: 0, version: 'unknown' });
const CACHE_TTL_MS = 60_000;

let _client = null;
let _sessionToken = null;
let _cache = null; // { value: { mode, rollout_pct, version }, expiresAt: number }

function getClient() {
  if (_client) return _client;
  _client = new AppConfigDataClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  return _client;
}

async function fetchSession() {
  const app = process.env.APPCONFIG_APPLICATION;
  const env = process.env.APPCONFIG_ENVIRONMENT;
  const profile = process.env.APPCONFIG_FLAGS_PROFILE;
  if (!app || !env || !profile) {
    throw new Error(
      `appconfig-client: missing env: APPCONFIG_APPLICATION=${app}, APPCONFIG_ENVIRONMENT=${env}, APPCONFIG_FLAGS_PROFILE=${profile}`
    );
  }
  const cw = getClient();
  const out = await cw.send(new StartConfigurationSessionCommand({
    ApplicationIdentifier: app,
    EnvironmentIdentifier: env,
    ConfigurationProfileIdentifier: profile,
  }));
  return out.InitialConfigurationToken;
}

async function fetchReplyEngineFlag() {
  const now = Date.now();
  if (_cache && _cache.expiresAt > now) return _cache.value;

  try {
    if (!_sessionToken) _sessionToken = await fetchSession();
    const cw = getClient();
    const out = await cw.send(new GetLatestConfigurationCommand({
      ConfigurationToken: _sessionToken,
    }));
    if (out.NextPollConfigurationToken) _sessionToken = out.NextPollConfigurationToken;

    const text = new TextDecoder().decode(out.Configuration);
    const parsed = JSON.parse(text);
    const v = parsed?.values?.reply_engine || {};
    const flag = {
      mode: typeof v.mode === 'string' ? v.mode : 'firebase',
      rollout_pct: Number.isFinite(v.rollout_pct) ? v.rollout_pct : 0,
      version: out.VersionLabel || 'unknown',
    };
    _cache = { value: flag, expiresAt: now + CACHE_TTL_MS };
    return flag;
  } catch (e) {
    console.warn('appconfig-client: fail-closed', { error: e?.message });
    await emitBridgeMetric('BridgeRouteFailures');
    return LEGACY_DEFAULT;
  }
}

function _resetCacheForTests() {
  _cache = null;
  _sessionToken = null;
  _client = null;
}

module.exports = { fetchReplyEngineFlag, _resetCacheForTests };
