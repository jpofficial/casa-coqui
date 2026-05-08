import { adminDb } from '@/lib/firebase-admin';

const MAX_RULES = 30;
const MAX_EXAMPLES = 10;
const PROFILE_PATH = 'settings/voice_profile';

/**
 * Load the voice profile from Firestore.
 * Returns { rules: string[], examples: { text, context, language, addedAt }[] }
 */
export async function loadVoiceProfile() {
  const doc = await adminDb.collection('settings').doc('voice_profile').get();
  if (!doc.exists) return { rules: [], examples: [] };
  const data = doc.data();
  return {
    rules: data.rules || [],
    examples: data.examples || [],
  };
}

/**
 * Build a prompt fragment from the voice profile to inject into system prompts.
 */
export function buildVoiceProfilePrompt(profile) {
  if (!profile || (!profile.rules?.length && !profile.examples?.length)) {
    return '';
  }

  let prompt = '\n\n## VOICE PROFILE — Learned from host corrections\n';

  if (profile.rules.length > 0) {
    prompt += '\nSTYLE RULES (follow these exactly):\n';
    profile.rules.forEach((rule, i) => {
      prompt += `${i + 1}. ${rule}\n`;
    });
  }

  if (profile.examples.length > 0) {
    prompt += '\nEXAMPLE MESSAGES (match this tone and style):\n';
    profile.examples.forEach((ex, i) => {
      prompt += `\n--- Example ${i + 1} (${ex.context || 'general'}, ${ex.language || 'en'}) ---\n${ex.text}\n`;
    });
  }

  return prompt;
}

/**
 * Add new rules to the voice profile, deduplicating against existing.
 * Prunes oldest rules if over MAX_RULES.
 */
export async function addRulesToProfile(newRules) {
  const profile = await loadVoiceProfile();
  const existingLower = new Set(profile.rules.map((r) => r.toLowerCase().trim()));
  const unique = newRules.filter((r) => !existingLower.has(r.toLowerCase().trim()));
  if (unique.length === 0) return;

  const merged = [...profile.rules, ...unique];
  const pruned = merged.length > MAX_RULES ? merged.slice(merged.length - MAX_RULES) : merged;

  await adminDb.collection('settings').doc('voice_profile').set(
    { rules: pruned, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

/**
 * Add a new example to the voice profile.
 * Prunes oldest examples if over MAX_EXAMPLES.
 */
export async function addExampleToProfile({ text, context, language }) {
  const profile = await loadVoiceProfile();
  const newExample = { text, context, language, addedAt: new Date().toISOString() };
  const merged = [...profile.examples, newExample];
  const pruned = merged.length > MAX_EXAMPLES ? merged.slice(merged.length - MAX_EXAMPLES) : merged;

  await adminDb.collection('settings').doc('voice_profile').set(
    { examples: pruned, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}
