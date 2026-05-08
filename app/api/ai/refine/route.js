import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { loadVoiceProfile, buildVoiceProfilePrompt, addRulesToProfile, addExampleToProfile } from '@/lib/voice-profile';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
const MODEL = 'claude-haiku-4-5-20251001';

export async function POST(request) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json();
    const { draft, feedback, context, history } = body;

    if (!draft || !feedback) {
      return NextResponse.json(
        { success: false, error: 'draft and feedback are required.' },
        { status: 400 }
      );
    }

    const profile = await loadVoiceProfile();
    const voiceFragment = buildVoiceProfilePrompt(profile);

    const systemPrompt = `You are helping Julio refine an AI-drafted message for an Airbnb guest. Julio will give you feedback on the current draft. Rewrite the draft incorporating his feedback while keeping the core information intact.
${voiceFragment}

RULES:
1. Apply the feedback precisely — if Julio says "more casual", make it casual. If he says "misspell alright as aight", do it.
2. Keep the same core content (guest name, check-in info, portal link, etc.)
3. Return ONLY the revised message text, no explanation.
4. Match Julio's natural voice — short, warm, not corporate.`;

    const messages = [];

    if (history?.length) {
      for (const turn of history) {
        messages.push({ role: turn.role, content: turn.content });
      }
    }

    const userContent = `Current draft:\n---\n${draft}\n---\n\nContext: ${context?.type || 'message'} for guest "${context?.guestName || 'Guest'}"${context?.inboundMessage ? `\n\nGuest's original message:\n${context.inboundMessage}` : ''}\n\nMy feedback: ${feedback}`;
    messages.push({ role: 'user', content: userContent });

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: systemPrompt,
      messages,
    });

    const revisedDraft = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    return NextResponse.json({
      success: true,
      data: {
        revisedDraft,
        usage: {
          inputTokens: response.usage?.input_tokens || 0,
          outputTokens: response.usage?.output_tokens || 0,
        },
      },
    });
  } catch (error) {
    console.error('[POST /api/ai/refine]', error);
    const detail = error?.message || String(error);
    return NextResponse.json(
      { success: false, error: 'Failed to refine draft.', detail },
      { status: 500 }
    );
  }
}

export async function PATCH(request) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json();
    const { feedbackMessages, acceptedDraft, context } = body;

    if (!feedbackMessages?.length || !acceptedDraft) {
      return NextResponse.json(
        { success: false, error: 'feedbackMessages and acceptedDraft are required.' },
        { status: 400 }
      );
    }

    const extractResponse = await client.messages.create({
      model: MODEL,
      max_tokens: 256,
      system: 'You extract reusable voice/style rules from a host\'s feedback about AI-drafted messages. Return a JSON array of concise, actionable rules. Focus on patterns, not one-off changes. 1-5 rules max.',
      tools: [{
        name: 'extract_rules',
        description: 'Extract reusable voice rules from feedback',
        input_schema: {
          type: 'object',
          properties: {
            rules: {
              type: 'array',
              items: { type: 'string' },
              description: 'Concise style rules extracted from feedback',
            },
          },
          required: ['rules'],
        },
      }],
      tool_choice: { type: 'tool', name: 'extract_rules' },
      messages: [{
        role: 'user',
        content: JSON.stringify({
          feedbackMessages,
          context: context?.type || 'general',
        }),
      }],
    });

    const toolUse = extractResponse.content.find((b) => b.type === 'tool_use');
    const rules = toolUse?.input?.rules || [];

    if (rules.length > 0) {
      await addRulesToProfile(rules);
    }

    await addExampleToProfile({
      text: acceptedDraft,
      context: context?.type || 'general',
      language: acceptedDraft.match(/[áéíóúñ¿¡]/i) ? 'es' : 'en',
    });

    return NextResponse.json({
      success: true,
      data: { rulesAdded: rules.length, rules },
    });
  } catch (error) {
    console.error('[PATCH /api/ai/refine]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save voice corrections.' },
      { status: 500 }
    );
  }
}
