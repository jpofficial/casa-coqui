'use strict';

// ---------------------------------------------------------------------------
// bridge-metrics — best-effort EMF emitter for the Firebase Cloud Function.
//
// Cloud Function logs land in GCP Stackdriver, NOT CloudWatch — so we cannot
// use a CloudWatch Logs MetricFilter. Instead we PutMetricData directly via
// the AWS SDK using the same BridgeIamUser access key already provisioned
// for StartExecution. The IAM policy constrains this user's PutMetricData
// to namespace 'CasaCoqui/Bridge' (spec "Bridge metrics" + IAM model).
//
// CRITICAL: failures are swallowed + logged. Metric emission must NEVER break
// the request path.
// ---------------------------------------------------------------------------

const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');

let _cw = null;
function getClient() {
  if (_cw) return _cw;
  _cw = new CloudWatchClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.BRIDGE_AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.BRIDGE_AWS_SECRET_ACCESS_KEY,
    },
  });
  return _cw;
}

async function emitBridgeMetric(name, value = 1) {
  try {
    const cw = getClient();
    await cw.send(new PutMetricDataCommand({
      Namespace: 'CasaCoqui/Bridge',
      MetricData: [{
        MetricName: name,
        Value: value,
        Unit: 'Count',
        Timestamp: new Date(),
      }],
    }));
  } catch (e) {
    // Swallow + log. Metric emission must never break the request path.
    console.warn('emitBridgeMetric failed', { name, value, error: e?.message });
  }
}

module.exports = { emitBridgeMetric };
