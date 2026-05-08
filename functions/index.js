'use strict';

// ---------------------------------------------------------------------------
// index.js
//
// Main Cloud Functions entry point.
// Registers and exports all functions for Firebase deployment.
//
// Function summary:
//   parseReceipt  — HTTP trigger: inbound-email webhook → parse → Storage + Firestore
//   reorderCheck  — Scheduled: daily 9 AM PR time → check supply levels → notify admin
//   expireLinks   — Scheduled: daily 2 AM PR time → expire past-checkout bookings
//
// Deployment:
//   firebase deploy --only functions
//
// Local emulation:
//   firebase emulators:start --only functions
// ---------------------------------------------------------------------------

const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');

const { parseReceiptHandler } = require('./parseReceipt');
const { reorderCheckHandler } = require('./reorderCheck');
const { expireLinksHandler } = require('./expireLinks');
const { cleaningReminderHandler } = require('./cleaningReminder');
const { icsSyncHandler } = require('./icsSync');

// ---------------------------------------------------------------------------
// Global defaults
// Set the default region to us-east1 (closest to Puerto Rico) and pin memory.
// Individual functions can override these options.
// ---------------------------------------------------------------------------
setGlobalOptions({
  region: 'us-east1',
  memory: '256MiB',
  timeoutSeconds: 60,
});

// ---------------------------------------------------------------------------
// parseReceipt
//
// HTTP trigger. Receives multipart/form-data from SendGrid Inbound Parse or
// Mailgun Routes. Processes attachments → Cloud Storage → Firestore.
//
// Webhook URL after deployment:
//   https://us-east1-{project-id}.cloudfunctions.net/parseReceipt
//
// Register this URL in your email service's inbound routing settings.
// ---------------------------------------------------------------------------
exports.parseReceipt = onRequest(
  {
    // Allow larger request bodies for email attachments (default is 10 MB).
    maxInstances: 5,
    memory: '512MiB',
    timeoutSeconds: 120,
    // Disable CORS — this is only called by the email service, not the browser.
    cors: false,
    // Allow unauthenticated requests: the email service cannot pass Firebase tokens.
    // Protect this endpoint by validating a shared secret in the webhook settings
    // or via SendGrid's signed webhooks.
    invoker: 'public',
  },
  async (req, res) => {
    try {
      await parseReceiptHandler(req, res);
    } catch (err) {
      logger.error('[parseReceipt] Unhandled error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

// ---------------------------------------------------------------------------
// reorderCheck
//
// Scheduled function: runs daily at 9:00 AM in the property timezone.
// America/Puerto_Rico is UTC-4 (no DST), so 9 AM PR = 13:00 UTC.
//
// To also trigger manually via the Firebase Console or gcloud CLI:
//   gcloud scheduler jobs run reorderCheck --location us-east1
// ---------------------------------------------------------------------------
exports.reorderCheck = onSchedule(
  {
    schedule: '0 13 * * *', // 09:00 America/Puerto_Rico (UTC-4)
    timeZone: 'America/Puerto_Rico',
    retryCount: 2,
    memory: '256MiB',
  },
  async (event) => {
    logger.info('[reorderCheck] Scheduled trigger fired', { eventId: event.jobName });
    try {
      const result = await reorderCheckHandler();
      logger.info('[reorderCheck] Completed', result);
    } catch (err) {
      logger.error('[reorderCheck] Unhandled error:', err);
      // Re-throw so Firebase retries the invocation (up to retryCount times).
      throw err;
    }
  }
);

// ---------------------------------------------------------------------------
// expireLinks
//
// Scheduled function: runs daily at 2:00 AM in the property timezone.
// America/Puerto_Rico UTC-4 → 2 AM PR = 06:00 UTC.
//
// Runs at 2 AM so that guests have the full checkout day (typically 11 AM)
// before the link is marked expired on the *following* run.
// ---------------------------------------------------------------------------
exports.expireLinks = onSchedule(
  {
    schedule: '0 6 * * *', // 02:00 America/Puerto_Rico (UTC-4)
    timeZone: 'America/Puerto_Rico',
    retryCount: 2,
    memory: '256MiB',
  },
  async (event) => {
    logger.info('[expireLinks] Scheduled trigger fired', { eventId: event.jobName });
    try {
      const result = await expireLinksHandler();
      logger.info('[expireLinks] Completed', result);
    } catch (err) {
      logger.error('[expireLinks] Unhandled error:', err);
      throw err;
    }
  }
);

// ---------------------------------------------------------------------------
// cleaningReminder
//
// Scheduled function: runs daily at 6:00 PM in the property timezone.
// Sends a reminder push to cleaners with jobs scheduled for the next day.
//
// 6 PM PR = 22:00 UTC (UTC-4).
// ---------------------------------------------------------------------------
exports.cleaningReminder = onSchedule(
  {
    schedule: '0 22 * * *', // 18:00 America/Puerto_Rico (UTC-4)
    timeZone: 'America/Puerto_Rico',
    retryCount: 2,
    memory: '256MiB',
  },
  async (event) => {
    logger.info('[cleaningReminder] Scheduled trigger fired', { eventId: event.jobName });
    try {
      const result = await cleaningReminderHandler();
      logger.info('[cleaningReminder] Completed', result);
    } catch (err) {
      logger.error('[cleaningReminder] Unhandled error:', err);
      throw err;
    }
  }
);

// ---------------------------------------------------------------------------
// icsSync
//
// Scheduled function: runs every 5 minutes.
// Fetches Airbnb ICS calendar feeds, diffs against internal bookings,
// and creates/updates/cancels bookings + cascades to cleaning jobs.
//
// Frequency raised from 30→5 min (2026-04-18) to preserve near-real-time
// UX after Lambda stopped creating bookings. See
// docs/superpowers/specs/2026-04-18-parse-airbnb-email-correctness-design.md.
//
// To trigger manually via gcloud CLI:
//   gcloud scheduler jobs run icsSync --location us-east1
// ---------------------------------------------------------------------------
exports.icsSync = onSchedule(
  {
    schedule: '*/5 * * * *', // every 5 minutes
    timeZone: 'America/Puerto_Rico',
    retryCount: 1,
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (event) => {
    logger.info('[icsSync] Scheduled trigger fired', { eventId: event.jobName });
    try {
      const result = await icsSyncHandler();
      logger.info('[icsSync] Completed', result);
    } catch (err) {
      logger.error('[icsSync] Unhandled error:', err);
      throw err;
    }
  }
);

// Scheduled sweepers
exports.welcomeSweeper = require('./scheduled').welcomeSweeper;
exports.lockSweeper = require('./scheduled').lockSweeper;

// ---------------------------------------------------------------------------
// onAirbnbMessageCreated
//
// Firestore trigger: fires when a new doc is created in airbnb_messages.
// Generates an AI reply draft for inbound guest messages.
// Decoupled from the Lambda parser — if AI fails, the inbound message is
// already safely stored.
// ---------------------------------------------------------------------------
const { generateReply, buildReplyInput, SYSTEM_PROMPT } = require('./lib/reply-ai');
const { generateReplyChain } = require('./lib/reply-agent-chain');
const { embedText } = require('./lib/embeddings');
const { db } = require('./firebaseInit');
const { FieldValue } = require('firebase-admin/firestore');

exports.onAirbnbMessageCreated = onDocumentCreated(
  {
    document: 'airbnb_messages/{messageId}',
    memory: '512MiB',
    timeoutSeconds: 120,
    secrets: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const message = snap.data();
    const messageId = event.params.messageId;

    // Only draft replies for inbound messages that haven't been processed
    if (message.direction !== 'inbound' || message.draftStatus !== 'pending') {
      logger.info(`[onAirbnbMessageCreated] Skipping ${messageId}: direction=${message.direction}, status=${message.draftStatus}`);
      return;
    }

    logger.info(`[onAirbnbMessageCreated] Generating reply for ${messageId}`);

    try {
      // Load booking context
      let booking = null;
      if (message.bookingId) {
        const bookingDoc = await db.collection('bookings').doc(message.bookingId).get();
        if (bookingDoc.exists) booking = { id: bookingDoc.id, ...bookingDoc.data() };
      }

      // Load conversation thread using threadKey so unmatched senders get their
      // own per-sender thread context instead of lumping with other unknowns.
      const { buildThreadKey } = require('./lib/thread-key');
      const threadKey =
        message.threadKey ||
        buildThreadKey({
          bookingCode: message.bookingCode || null,
          senderEmail: message.senderEmail || message.fromAddress || null,
          senderName: message.guestName || message.fromName || null,
          receivedAt: message.receivedAt?.toDate?.() || message.receivedAt || null,
        });

      let thread = [];
      if (threadKey && threadKey !== 'unknown') {
        const threadSnap = await db
          .collection('airbnb_messages')
          .where('threadKey', '==', threadKey)
          .orderBy('receivedAt', 'asc')
          .limit(21) // Item 5: 20 prior messages + 1 to allow filtering out the current message
          .get();
        thread = threadSnap.docs
          .filter((d) => d.id !== messageId) // exclude current message
          .map((d) => d.data());
      }

      // Load voice corpus (sent replies for tone matching)
      const voiceSnap = await db
        .collection('airbnb_messages')
        .where('direction', '==', 'outbound_draft')
        .where('draftStatus', '==', 'sent')
        .orderBy('sentAt', 'desc')
        .limit(50)
        .get();
      const voiceSamples = voiceSnap.docs.map((d) => d.data());

      // Load property settings
      const settingsDoc = await db.collection('settings').doc('property').get();
      const settings = settingsDoc.exists ? settingsDoc.data() : {};

      // Load voice profile for style injection
      const voiceProfileDoc = await db.collection('settings').doc('voice_profile').get();
      const voiceProfile = voiceProfileDoc.exists ? voiceProfileDoc.data() : { rules: [], examples: [] };

      let voiceProfilePrompt = '';
      if (voiceProfile.rules?.length || voiceProfile.examples?.length) {
        voiceProfilePrompt = '\n\n## VOICE PROFILE — Learned from host corrections\n';
        if (voiceProfile.rules?.length) {
          voiceProfilePrompt += '\nSTYLE RULES (follow these exactly):\n';
          voiceProfile.rules.forEach((rule, i) => {
            voiceProfilePrompt += `${i + 1}. ${rule}\n`;
          });
        }
        if (voiceProfile.examples?.length) {
          voiceProfilePrompt += '\nEXAMPLE MESSAGES (match this tone and style):\n';
          voiceProfile.examples.forEach((ex, i) => {
            voiceProfilePrompt += `\n--- Example ${i + 1} (${ex.context || 'general'}, ${ex.language || 'en'}) ---\n${ex.text}\n`;
          });
        }
      }

      // RAG retrieval — find relevant past conversations (non-blocking on failure)
      let relevantConversations = [];
      try {
        const queryEmbedding = await embedText(message.body);
        const ragSnap = await db
          .collection('voice_conversations')
          .findNearest({
            vectorField: 'embedding',
            queryVector: FieldValue.vector(queryEmbedding),
            limit: 3,
            distanceMeasure: 'COSINE',
            distanceResultField: 'distance',
          })
          .get();
        relevantConversations = ragSnap.docs.map((d) => ({
          ...d.data(),
          distance: d.get('distance'),
        }));
        logger.info(`[onAirbnbMessageCreated] RAG: found ${relevantConversations.length} relevant conversations`);
      } catch (ragErr) {
        logger.warn('[onAirbnbMessageCreated] RAG retrieval failed (non-fatal):', ragErr.message);
      }

      // Generate reply via chain strategy (reason → draft → evaluate → revise)
      // Falls back to single-shot if chain fails
      const messageWithId = { id: messageId, ...message };
      const contextJson = buildReplyInput({
        message: messageWithId, thread, booking, settings, voiceSamples, relevantConversations,
      });

      let result;
      try {
        result = await generateReplyChain({
          message: messageWithId,
          contextJson,
          voicePrompt: SYSTEM_PROMPT,
          relevantConversations,
          voiceProfilePrompt,
        });
        logger.info(`[onAirbnbMessageCreated] Chain: voice=${result._agentRun?.voiceScore}/10, steps=${result._agentRun?.steps?.map(s => s.step).join('→')}`);
      } catch (chainErr) {
        logger.warn('[onAirbnbMessageCreated] Chain strategy failed, falling back to single-shot:', chainErr.message);
        result = await generateReply({
          message: messageWithId, thread, booking, settings, voiceSamples, relevantConversations, voiceProfilePrompt,
        });
      }

      // Update the message doc with the draft
      const now = new Date().toISOString();
      await snap.ref.update({
        draftReply: result.reply,
        draftStatus: result.shouldEscalate ? 'escalated' : 'ready',
        draftedAt: now,
      });

      // Log agent run
      if (result._agentRun) {
        result._agentRun.refId = messageId;
        await db.collection('agent_runs').add(result._agentRun);
      }

      // Notify admin of new message + draft
      try {
        const usersSnap = await db
          .collection('users')
          .where('role', 'in', ['admin', 'cohost'])
          .where('status', '==', 'active')
          .get();

        const staffIds = usersSnap.docs.map((d) => d.id);
        if (staffIds.length > 0) {
          const { messaging } = require('./firebaseInit');
          const notifTitle = result.shouldEscalate
            ? `Escalation: ${message.guestName || 'Guest'}`
            : `New message from ${message.guestName || 'Guest'}`;
          const notifBody = result.shouldEscalate
            ? result.escalateReason || 'Needs human review'
            : 'Reply draft ready for review';

          await Promise.all(
            staffIds.map(async (uid) => {
              await db.collection('staff_notifications').add({
                recipientId: uid,
                title: notifTitle,
                body: notifBody,
                type: 'airbnb_message',
                data: { messageId, targetPath: '/admin/messages' },
                read: false,
                createdAt: now,
              });
            })
          );
        }
      } catch (notifyErr) {
        logger.error('[onAirbnbMessageCreated] Notify error:', notifyErr);
      }

      logger.info(`[onAirbnbMessageCreated] Reply drafted for ${messageId}`, {
        escalated: result.shouldEscalate,
      });
    } catch (err) {
      logger.error(`[onAirbnbMessageCreated] Failed to generate reply for ${messageId}:`, err);
      // Mark as failed but don't throw — the inbound message is safe
      await snap.ref.update({ draftStatus: 'error' }).catch(() => {});
    }
  }
);

// ---------------------------------------------------------------------------
// onAirbnbMessageSent
//
// Firestore update trigger on airbnb_messages/{messageId}.
// Fires when draftStatus transitions to 'sent'. Compares the AI draft
// (draftReply) against the human-edited version (editedReply) to extract
// voice/style rules, then persists them to settings/voice_profile.
// ---------------------------------------------------------------------------
exports.onAirbnbMessageSent = onDocumentUpdated(
  {
    document: 'airbnb_messages/{messageId}',
    memory: '256MiB',
    timeoutSeconds: 60,
    secrets: ['ANTHROPIC_API_KEY'],
  },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();

    // Only trigger when draftStatus transitions to 'sent' and there's an edit
    if (before.draftStatus === 'sent' || after.draftStatus !== 'sent') return;
    if (!after.editedReply || !after.draftReply) return;

    const draft = after.draftReply.trim();
    const edited = after.editedReply.trim();

    // Skip trivial edits
    if (draft === edited) return;
    const draftWords = draft.split(/\s+/);
    const editedWords = edited.split(/\s+/);
    const diffCount = Math.abs(draftWords.length - editedWords.length) +
      draftWords.filter((w, i) => editedWords[i] !== w).length;
    if (diffCount < 3) return;
    if (edited.length < 10) return;

    const db = require('firebase-admin').firestore();
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic();

    // Extract style rules from the diff
    const extractionResponse = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: `You analyze differences between an AI draft and a human-edited version to extract voice/style rules. Return a JSON array of concise style rules (strings). Each rule should be specific and actionable. Focus on: word choices, tone, length, punctuation, greeting/sign-off patterns, slang, formality level. Return 1-5 rules max. Only return rules that represent PATTERNS, not one-off edits.`,
      tools: [{
        name: 'style_rules',
        description: 'Extract style rules from the diff between AI draft and human edit',
        input_schema: {
          type: 'object',
          properties: {
            rules: {
              type: 'array',
              items: { type: 'string' },
              description: 'Concise style rules extracted from the diff',
            },
            isDistinctExample: {
              type: 'boolean',
              description: 'True if the edited version is high quality and distinct enough to be a voice example',
            },
          },
          required: ['rules', 'isDistinctExample'],
        },
      }],
      tool_choice: { type: 'tool', name: 'style_rules' },
      messages: [{
        role: 'user',
        content: JSON.stringify({
          aiDraft: draft,
          humanEdited: edited,
          context: after.source === 'welcome_draft' ? 'welcome' : 'reply',
        }),
      }],
    });

    const toolUse = extractionResponse.content.find((b) => b.type === 'tool_use');
    if (!toolUse) return;

    const { rules, isDistinctExample } = toolUse.input;

    // Load current profile
    const profileDoc = await db.collection('settings').doc('voice_profile').get();
    const profile = profileDoc.exists ? profileDoc.data() : { rules: [], examples: [] };

    // Deduplicate and merge rules
    const existingLower = new Set((profile.rules || []).map((r) => r.toLowerCase().trim()));
    const uniqueRules = (rules || []).filter((r) => !existingLower.has(r.toLowerCase().trim()));

    const updates = { updatedAt: new Date().toISOString() };

    if (uniqueRules.length > 0) {
      const merged = [...(profile.rules || []), ...uniqueRules];
      updates.rules = merged.length > 30 ? merged.slice(merged.length - 30) : merged;
    }

    if (isDistinctExample && edited.length >= 20) {
      const newExample = {
        text: edited,
        context: after.source === 'welcome_draft' ? 'welcome' : 'reply',
        language: edited.match(/[áéíóúñ¿¡]/i) ? 'es' : 'en',
        addedAt: new Date().toISOString(),
      };
      const examples = [...(profile.examples || []), newExample];
      updates.examples = examples.length > 10 ? examples.slice(examples.length - 10) : examples;
    }

    if (uniqueRules.length > 0 || isDistinctExample) {
      await db.collection('settings').doc('voice_profile').set(updates, { merge: true });
      logger.info(`[onAirbnbMessageSent] Voice profile updated: +${uniqueRules.length} rules, example=${isDistinctExample}`);
    }
  }
);
