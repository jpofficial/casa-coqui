'use strict';

/**
 * S3 access for the raw MIME email SES stored.
 */

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

// Module-level — reused across warm invocations.
const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

// ---------------------------------------------------------------------------
// S3 helper: stream → Buffer
// ---------------------------------------------------------------------------

/**
 * Read an S3 object body stream into a Buffer.
 *
 * @param {import('@aws-sdk/client-s3').GetObjectCommandOutput} s3Response
 * @returns {Promise<Buffer>}
 */
async function streamToBuffer(s3Response) {
  const chunks = [];
  for await (const chunk of s3Response.Body) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = { s3, GetObjectCommand, streamToBuffer };
