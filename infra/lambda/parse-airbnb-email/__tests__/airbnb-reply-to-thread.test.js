'use strict';

const crypto = require('crypto');
const {
  extractAirbnbReplyToToken,
  airbnbThreadKeyFromReplyTo,
} = require('../index');

describe('extractAirbnbReplyToToken', () => {
  test('returns lowercased local-part for @reply.airbnb.com address', () => {
    const parsed = {
      replyTo: { value: [{ address: '4ra7dyro49skyxzt9vo891krds8l904yp993@reply.airbnb.com', name: '' }] },
    };
    expect(extractAirbnbReplyToToken(parsed)).toBe('4ra7dyro49skyxzt9vo891krds8l904yp993');
  });

  test('returns null for non-airbnb reply-to (gmail.com)', () => {
    const parsed = {
      replyTo: { value: [{ address: 'someone@gmail.com', name: '' }] },
    };
    expect(extractAirbnbReplyToToken(parsed)).toBeNull();
  });

  test('returns null when replyTo missing', () => {
    expect(extractAirbnbReplyToToken({})).toBeNull();
    expect(extractAirbnbReplyToToken({ replyTo: null })).toBeNull();
    expect(extractAirbnbReplyToToken({ replyTo: { value: [] } })).toBeNull();
  });

  test("handles Reply-To with display name like '\"Jaydon\" <token@reply.airbnb.com>'", () => {
    const parsed = {
      replyTo: { value: [{ address: 'token123abc@reply.airbnb.com', name: 'Jaydon' }] },
    };
    expect(extractAirbnbReplyToToken(parsed)).toBe('token123abc');
  });

  test('lowercases mixed-case tokens before output', () => {
    const parsed = {
      replyTo: { value: [{ address: 'ABCdef123XYZ@reply.airbnb.com', name: '' }] },
    };
    expect(extractAirbnbReplyToToken(parsed)).toBe('abcdef123xyz');
  });
});

describe('airbnbThreadKeyFromReplyTo', () => {
  test('returns "airbnb:" + first 32 chars of sha256 hex', () => {
    const parsed = {
      replyTo: { value: [{ address: 'tokenabc@reply.airbnb.com', name: '' }] },
    };
    const expectedHash = crypto
      .createHash('sha256')
      .update('tokenabc')
      .digest('hex')
      .slice(0, 32);
    expect(airbnbThreadKeyFromReplyTo(parsed)).toBe('airbnb:' + expectedHash);
  });

  test('returns null when reply-to is non-airbnb', () => {
    expect(
      airbnbThreadKeyFromReplyTo({ replyTo: { value: [{ address: 'a@b.com' }] } })
    ).toBeNull();
  });

  test('two messages with same reply-to token produce identical threadKey', () => {
    const parsed1 = {
      replyTo: { value: [{ address: 'sametoken@reply.airbnb.com', name: '' }] },
    };
    const parsed2 = {
      replyTo: { value: [{ address: 'SAMETOKEN@reply.airbnb.com', name: 'Jaydon' }] },
    };
    expect(airbnbThreadKeyFromReplyTo(parsed1)).toBe(airbnbThreadKeyFromReplyTo(parsed2));
  });

  test('two messages with different reply-to tokens produce different threadKeys', () => {
    const parsed1 = {
      replyTo: { value: [{ address: 'tokenA@reply.airbnb.com' }] },
    };
    const parsed2 = {
      replyTo: { value: [{ address: 'tokenB@reply.airbnb.com' }] },
    };
    expect(airbnbThreadKeyFromReplyTo(parsed1)).not.toBe(
      airbnbThreadKeyFromReplyTo(parsed2)
    );
  });
});
