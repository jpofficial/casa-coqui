'use strict';

const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const sns = new SNSClient({});
const TOPIC_ARN = process.env.SNS_TOPIC_ARN;

exports.handler = async (event) => {
  for (const record of event.Records || []) {
    let body;
    try { body = JSON.parse(record.body); } catch { body = { raw: record.body }; }
    const msgId = body.messageId || 'unknown';
    const exec = body.executionArn || 'unknown';
    const threadKey = body.threadKey || 'unknown';
    const error = body.error?.Cause || body.error?.Error || JSON.stringify(body.error);

    await sns.send(new PublishCommand({
      TopicArn: TOPIC_ARN,
      Subject: `[casa-coqui] reply-draft DLQ: ${msgId}`,
      Message: `Reply draft execution failed.\n\nmessageId: ${msgId}\nthreadKey: ${threadKey}\nexecutionArn: ${exec}\n\nerror:\n${error}\n\nRetry from /admin/messages.`,
    }));
  }
  return { processed: (event.Records || []).length };
};
