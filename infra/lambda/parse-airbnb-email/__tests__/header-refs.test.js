'use strict';

const {
  extractHeaderRefs,
  findParentMessageDocId,
} = require('../index');

describe('extractHeaderRefs', () => {
  test('returns null inReplyTo and empty references when neither present', () => {
    expect(extractHeaderRefs({})).toEqual({
      inReplyTo: null,
      references: [],
    });
  });

  test('reads single inReplyTo string', () => {
    expect(extractHeaderRefs({
      inReplyTo: '<abc@example.com>',
    })).toEqual({
      inReplyTo: '<abc@example.com>',
      references: [],
    });
  });

  test('normalizes references string to array', () => {
    expect(extractHeaderRefs({
      references: '<a@x.com>',
    })).toEqual({
      inReplyTo: null,
      references: ['<a@x.com>'],
    });
  });

  test('preserves references array as-is', () => {
    expect(extractHeaderRefs({
      references: ['<a@x.com>', '<b@x.com>', '<c@x.com>'],
    })).toEqual({
      inReplyTo: null,
      references: ['<a@x.com>', '<b@x.com>', '<c@x.com>'],
    });
  });

  test('handles whitespace-separated references string (RFC 5322 style)', () => {
    // mailparser sometimes returns a single string with multiple ids separated by whitespace
    expect(extractHeaderRefs({
      references: '<a@x.com> <b@x.com>',
    })).toEqual({
      inReplyTo: null,
      references: ['<a@x.com>', '<b@x.com>'],
    });
  });

  test('reads both inReplyTo and references', () => {
    expect(extractHeaderRefs({
      inReplyTo: '<parent@x.com>',
      references: ['<grandparent@x.com>', '<parent@x.com>'],
    })).toEqual({
      inReplyTo: '<parent@x.com>',
      references: ['<grandparent@x.com>', '<parent@x.com>'],
    });
  });

  test('ignores empty/falsy values', () => {
    expect(extractHeaderRefs({
      inReplyTo: '',
      references: null,
    })).toEqual({
      inReplyTo: null,
      references: [],
    });
  });
});

// Minimal Firestore mock for lookup tests.
function mockFirestore({ messageIdLookup = {} } = {}) {
  return {
    collection(name) {
      if (name !== 'airbnb_messages') throw new Error(`unexpected collection: ${name}`);
      return {
        _filters: [],
        where(field, op, value) {
          if (op !== '==') throw new Error(`unsupported op: ${op}`);
          this._filters.push({ field, value });
          return this;
        },
        limit() { return this; },
        async get() {
          const filter = this._filters[0];
          if (!filter || filter.field !== 'messageId') return { empty: true, docs: [] };
          const docId = messageIdLookup[filter.value];
          if (!docId) return { empty: true, docs: [] };
          return {
            empty: false,
            docs: [{ id: docId, data: () => ({ messageId: filter.value }) }],
          };
        },
      };
    },
  };
}

describe('findParentMessageDocId', () => {
  test('returns null when inReplyTo is null', async () => {
    const fs = mockFirestore({});
    expect(await findParentMessageDocId(fs, null)).toBeNull();
  });

  test('returns null when no parent exists in DB', async () => {
    const fs = mockFirestore({ messageIdLookup: {} });
    expect(await findParentMessageDocId(fs, '<missing@x.com>')).toBeNull();
  });

  test('returns parent doc id when found', async () => {
    const fs = mockFirestore({
      messageIdLookup: { '<parent@x.com>': 'firestore-doc-abc123' },
    });
    expect(await findParentMessageDocId(fs, '<parent@x.com>')).toBe('firestore-doc-abc123');
  });
});
