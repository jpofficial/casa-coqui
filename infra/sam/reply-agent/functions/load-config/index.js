'use strict';

// ---------------------------------------------------------------------------
// load-config — Step 1 of the workflow.
//
// Fetches model + temperature from SSM Parameter Store at workflow start.
// Result threads through SFN state via ResultPath: $.config and is read by
// every chain Lambda via event.config.{model, temperature}.
//
// Contract:
//   Input:  any (passed through from StartExecution input)
//   Output: { model: string, temperature: number, loadedAt: string }
//   Errors: throws if SSM fetch fails or parameters are missing
//
// Parameters expected:
//   /casa-coqui/reply-agent/model        e.g. claude-haiku-4-5-20251001
//   /casa-coqui/reply-agent/temperature  e.g. "1.0"
// ---------------------------------------------------------------------------

const { SSMClient, GetParametersCommand } = require('@aws-sdk/client-ssm');

const ssm = new SSMClient({});

const PARAM_MODEL = '/casa-coqui/reply-agent/model';
const PARAM_TEMPERATURE = '/casa-coqui/reply-agent/temperature';

exports.handler = async (event) => {
  console.log('[load-config] event keys:', Object.keys(event || {}));

  const out = await ssm.send(new GetParametersCommand({
    Names: [PARAM_MODEL, PARAM_TEMPERATURE],
  }));

  if (out.InvalidParameters && out.InvalidParameters.length > 0) {
    throw new Error('load-config: missing SSM parameters: ' + out.InvalidParameters.join(', '));
  }

  const params = Object.fromEntries(out.Parameters.map((p) => [p.Name, p.Value]));

  const model = params[PARAM_MODEL];
  const temperatureRaw = params[PARAM_TEMPERATURE];
  if (!model) throw new Error('load-config: model parameter missing');
  if (!temperatureRaw) throw new Error('load-config: temperature parameter missing');

  const temperature = parseFloat(temperatureRaw);
  if (isNaN(temperature)) throw new Error('load-config: temperature is not a number: ' + temperatureRaw);

  return {
    model,
    temperature,
    loadedAt: new Date().toISOString(),
  };
};

module.exports.handler = exports.handler;
