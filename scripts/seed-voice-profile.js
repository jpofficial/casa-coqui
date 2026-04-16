#!/usr/bin/env node
// scripts/seed-voice-profile.js
//
// Seeds the voice profile from historical sent messages.
// Usage: node scripts/seed-voice-profile.js [--apply]
//
// Without --apply, runs in dry-run mode (shows what would be saved).

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const Anthropic = require('@anthropic-ai/sdk');

const serviceAccount = require('../service-account-key.json');
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const client = new Anthropic();
const apply = process.argv.includes('--apply');

async function main() {
  console.log(`[seed-voice-profile] ${apply ? 'APPLY mode' : 'DRY-RUN mode'}\n`);

  // Load recent sent messages with edits
  const sentSnap = await db.collection('airbnb_messages')
    .where('draftStatus', '==', 'sent')
    .orderBy('sentAt', 'desc')
    .limit(20)
    .get();

  const withEdits = sentSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((m) => m.editedReply && m.draftReply && m.editedReply.trim() !== m.draftReply.trim());

  console.log(`Found ${sentSnap.size} sent messages, ${withEdits.length} with edits\n`);

  // Extract rules from diffs
  const allRules = [];
  const examples = [];

  for (const msg of withEdits.slice(0, 10)) {
    console.log(`Processing ${msg.id}...`);
    try {
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        system: 'You analyze differences between an AI draft and a human-edited version to extract voice/style rules. Return a JSON array of concise style rules. Focus on word choices, tone, length, patterns. 1-5 rules max.',
        tools: [{
          name: 'style_rules',
          description: 'Extract style rules from diff',
          input_schema: {
            type: 'object',
            properties: {
              rules: { type: 'array', items: { type: 'string' } },
              isDistinctExample: { type: 'boolean' },
            },
            required: ['rules', 'isDistinctExample'],
          },
        }],
        tool_choice: { type: 'tool', name: 'style_rules' },
        messages: [{
          role: 'user',
          content: JSON.stringify({
            aiDraft: msg.draftReply,
            humanEdited: msg.editedReply,
            context: msg.source === 'welcome_draft' ? 'welcome' : 'reply',
          }),
        }],
      });

      const toolUse = response.content.find((b) => b.type === 'tool_use');
      if (toolUse) {
        allRules.push(...(toolUse.input.rules || []));
        if (toolUse.input.isDistinctExample && msg.editedReply.length >= 20) {
          examples.push({
            text: msg.editedReply,
            context: msg.source === 'welcome_draft' ? 'welcome' : 'reply',
            language: msg.editedReply.match(/[áéíóúñ¿¡]/i) ? 'es' : 'en',
            addedAt: new Date().toISOString(),
          });
        }
        console.log(`  Rules: ${toolUse.input.rules.join('; ')}`);
      }
    } catch (err) {
      console.error(`  Error: ${err.message}`);
    }
  }

  // Also grab top examples from recent sent messages (even without edits)
  const topSent = sentSnap.docs
    .map((d) => d.data())
    .filter((m) => (m.editedReply || m.draftReply)?.length >= 20)
    .slice(0, 5);

  for (const msg of topSent) {
    const text = msg.editedReply || msg.draftReply;
    if (!examples.find((e) => e.text === text)) {
      examples.push({
        text,
        context: msg.source === 'welcome_draft' ? 'welcome' : 'reply',
        language: text.match(/[áéíóúñ¿¡]/i) ? 'es' : 'en',
        addedAt: new Date().toISOString(),
      });
    }
  }

  // Dedup rules
  const seen = new Set();
  const uniqueRules = allRules.filter((r) => {
    const key = r.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);

  const finalExamples = examples.slice(0, 10);

  console.log(`\n--- RESULTS ---`);
  console.log(`Rules (${uniqueRules.length}):`);
  uniqueRules.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
  console.log(`\nExamples (${finalExamples.length}):`);
  finalExamples.forEach((e, i) => console.log(`  ${i + 1}. [${e.context}/${e.language}] ${e.text.slice(0, 80)}...`));

  if (apply) {
    await db.collection('settings').doc('voice_profile').set({
      rules: uniqueRules,
      examples: finalExamples,
      updatedAt: new Date().toISOString(),
    });
    console.log('\nVoice profile saved to Firestore.');
  } else {
    console.log('\nDry-run complete. Use --apply to save.');
  }
}

main().catch(console.error);
