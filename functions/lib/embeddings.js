'use strict';

/**
 * OpenAI Embedding Utility — text-embedding-3-small (1536 dims).
 *
 * Uses native fetch (Node 20+) — no extra npm dependency.
 * Shared by: seed script (batch) + Cloud Functions runtime (single).
 *
 * Requires OPENAI_API_KEY in environment.
 */

const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 1536;
const API_URL = 'https://api.openai.com/v1/embeddings';

function getApiKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  return key;
}

/**
 * Embed a single text string.
 * @param {string} text
 * @returns {Promise<number[]>} 1536-dim float array
 */
async function embedText(text) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({ input: text, model: MODEL, dimensions: DIMENSIONS }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI embeddings API error ${res.status}: ${body}`);
  }

  const json = await res.json();
  return json.data[0].embedding;
}

/**
 * Embed multiple texts in a single API call (max ~8K tokens per batch).
 * OpenAI supports up to 2048 inputs per request.
 *
 * @param {string[]} texts
 * @returns {Promise<number[][]>} Array of 1536-dim float arrays (same order as input)
 */
async function embedBatch(texts) {
  if (texts.length === 0) return [];

  // OpenAI batch limit is 2048; split if needed
  const BATCH_SIZE = 2048;
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify({ input: batch, model: MODEL, dimensions: DIMENSIONS }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI embeddings API error ${res.status}: ${body}`);
    }

    const json = await res.json();
    // API returns embeddings sorted by index
    const sorted = json.data.sort((a, b) => a.index - b.index);
    allEmbeddings.push(...sorted.map((d) => d.embedding));
  }

  return allEmbeddings;
}

module.exports = { embedText, embedBatch, MODEL, DIMENSIONS };
