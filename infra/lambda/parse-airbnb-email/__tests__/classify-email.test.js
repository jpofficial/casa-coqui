'use strict';

const {
  classifyEmail,
  isAirbnbSender,
  extractGuestNameFromSubject,
  parseResolutionFields,
} = require('../index');

describe('classifyEmail', () => {
  describe('guest_message — modern threaded subjects from express@airbnb.com', () => {
    test('"RE: Reservation for {Listing}, {dates}"', () => {
      expect(
        classifyEmail('RE: Reservation for Casa Coqui #1 Next to everything, May 5 – 13')
      ).toBe('guest_message');
    });

    test('"RE: Inquiry for {Listing}, {dates}"', () => {
      expect(
        classifyEmail('RE: Inquiry for Cozy 4BR + Private Parking + 10 min to Beach & OSJ, Apr 30 – May 9')
      ).toBe('guest_message');
    });

    test('legacy: "New message from Jane Doe"', () => {
      expect(classifyEmail('New message from Jane Doe')).toBe('guest_message');
    });

    test('legacy: "Jane responded to your message"', () => {
      expect(classifyEmail('Jane Doe responded to your message')).toBe('guest_message');
    });
  });

  describe('guest_message — Gmail-forwarded variants', () => {
    test('"Fwd: Reservation for {Listing}, {dates}" (Gmail collapses RE: into Fwd:)', () => {
      expect(
        classifyEmail('Fwd: Reservation for Cozy 4BR + Private Parking + 10 min to Beach & OSJ, Apr 30 – May 9')
      ).toBe('guest_message');
    });

    test('"Fwd: Inquiry for {Listing}, {dates}"', () => {
      expect(
        classifyEmail('Fwd: Inquiry for Casa Coqui #2, May 12 – 18')
      ).toBe('guest_message');
    });

    test('"Fwd: RE: Reservation for ..." (Gmail keeps RE: in some cases)', () => {
      expect(
        classifyEmail('Fwd: RE: Reservation for Casa Coqui #1, May 5 – 13')
      ).toBe('guest_message');
    });

    test('"Fw: Reservation for ..." (alt Fw: prefix)', () => {
      expect(
        classifyEmail('Fw: Reservation for Casa Coqui #1, May 5 – 13')
      ).toBe('guest_message');
    });

    test('"Fwd: Fwd: Reservation for ..." (double-forwarded)', () => {
      expect(
        classifyEmail('Fwd: Fwd: Reservation for Casa Coqui #1, May 5 – 13')
      ).toBe('guest_message');
    });

    test('bare "Reservation for ..." with no prefix', () => {
      expect(
        classifyEmail('Reservation for Casa Coqui #1, May 5 – 13')
      ).toBe('guest_message');
    });
  });

  describe('reservation_confirmation', () => {
    test('"Reservation confirmed - Jane arrives May 15"', () => {
      expect(
        classifyEmail('Reservation confirmed - Yashira Zegarra arrives May 15')
      ).toBe('reservation_confirmation');
    });

    test('"Pending: Reservation Request at {Listing} for {dates}"', () => {
      expect(
        classifyEmail('Pending: Reservation Request at Casa Coqui #1 Next to everything for May 15 – 22, 2026')
      ).toBe('reservation_confirmation');
    });

    test('"Same-day inquiry for {Listing}"', () => {
      expect(
        classifyEmail('Same-day inquiry for Acogedora 4H + Parking + 10 min Playa y Viejo SJ for today through May 9, 2026')
      ).toBe('reservation_confirmation');
    });
  });

  describe('payout', () => {
    test('"We sent a payout of $X USD"', () => {
      expect(classifyEmail('We sent a payout of $952.93 USD')).toBe('payout');
    });
  });

  describe('review_request', () => {
    test('"Write a review for {Name}\'s group"', () => {
      expect(classifyEmail("Write a review for Leslie's group")).toBe('review_request');
    });

    test('"A recent guest left a 2-star review"', () => {
      expect(classifyEmail('A recent guest left a 2-star review')).toBe('review_request');
    });
  });

  describe('policy_update — admin/info', () => {
    test('"Action required: ..."', () => {
      expect(
        classifyEmail('Action required: We need information to review your reimbursement request [CLSF-05873844]')
      ).toBe('policy_update');
    });

    test('"Reservation reminder: Jane is coming soon!"', () => {
      expect(classifyEmail('Reservation reminder: Jaydon is coming soon!')).toBe('policy_update');
    });

    test('"Request declined: Jane declined to pay"', () => {
      expect(classifyEmail('Request declined: Akbar declined to pay')).toBe('policy_update');
    });

    test('"Co-Host Network application"', () => {
      expect(classifyEmail('Your Co-Host Network application')).toBe('policy_update');
    });
  });

  test('returns "unknown" for null/empty subject', () => {
    expect(classifyEmail('')).toBe('unknown');
    expect(classifyEmail(null)).toBe('unknown');
  });

  test('returns "unknown" for unrelated marketing subject', () => {
    expect(classifyEmail('Ends May 8: 25% off a ride')).toBe('unknown');
  });
});

describe('isAirbnbSender', () => {
  test('accepts @airbnb.com addresses', () => {
    expect(isAirbnbSender('express@airbnb.com')).toBe(true);
    expect(isAirbnbSender('automated@airbnb.com')).toBe(true);
    expect(isAirbnbSender('discover@airbnb.com')).toBe(true);
    expect(isAirbnbSender('Express@Airbnb.com')).toBe(true);
    expect(isAirbnbSender('  noreply@airbnb.com  ')).toBe(true);
  });

  test('accepts subdomains of airbnb.com (e.g. e.airbnb.com)', () => {
    expect(isAirbnbSender('promo@e.airbnb.com')).toBe(true);
  });

  test('rejects non-Airbnb senders', () => {
    expect(isAirbnbSender('noreply@redditmail.com')).toBe(false);
    expect(isAirbnbSender('member@from.k1speed.com')).toBe(false);
    expect(isAirbnbSender('no-reply@marketing.lyftmail.com')).toBe(false);
    expect(isAirbnbSender('campaign@e.jamestalarico.com')).toBe(false);
  });

  test('rejects spoof attempts', () => {
    expect(isAirbnbSender('phishing@airbnb.com.evil.example')).toBe(false);
    expect(isAirbnbSender('phishing@notairbnb.com')).toBe(false);
  });

  test('rejects null/empty', () => {
    expect(isAirbnbSender(null)).toBe(false);
    expect(isAirbnbSender('')).toBe(false);
    expect(isAirbnbSender(undefined)).toBe(false);
  });
});

describe('extractGuestNameFromSubject — new patterns', () => {
  test('"Reservation confirmed - Jane Doe arrives May 15"', () => {
    expect(
      extractGuestNameFromSubject('Reservation confirmed - Yashira Zegarra arrives May 15')
    ).toBe('Yashira Zegarra');
  });

  test('"Request declined: Jane declined to pay"', () => {
    expect(
      extractGuestNameFromSubject('Request declined: Akbar declined to pay')
    ).toBe('Akbar');
  });

  test('"Reservation reminder: Jane is coming soon!"', () => {
    expect(
      extractGuestNameFromSubject('Reservation reminder: Jaydon is coming soon!')
    ).toBe('Jaydon');
  });

  test('"RE: Reservation for ..." returns null (guest name not in subject)', () => {
    expect(
      extractGuestNameFromSubject('RE: Reservation for Casa Coqui #1, May 5 – 13')
    ).toBeNull();
  });
});

describe('classifyEmail — resolution_request', () => {
  test('"Airbnb Reimbursement Request [CLSF-...] [HM...]"', () => {
    expect(
      classifyEmail('Airbnb Reimbursement Request [CLSF-05873844] [HMRJNRRYF5]')
    ).toBe('resolution_request');
  });

  test('"Fwd: Airbnb Reimbursement Request ..." (Gmail-forwarded)', () => {
    expect(
      classifyEmail('Fwd: Airbnb Reimbursement Request [CLSF-05873844] [HMRJNRRYF5]')
    ).toBe('resolution_request');
  });

  test('"Host damage protection update [CLSF-...]"', () => {
    expect(
      classifyEmail('Host damage protection update [CLSF-12345678]')
    ).toBe('resolution_request');
  });

  test('any subject with a CLSF claim ID alone', () => {
    expect(
      classifyEmail('Update on case CLSF-99999999')
    ).toBe('resolution_request');
  });

  test('AirCover and Resolution Center wording', () => {
    expect(classifyEmail('Your AirCover claim has been updated')).toBe('resolution_request');
    expect(classifyEmail('Resolution Center: documentation requested')).toBe('resolution_request');
  });
});

describe('parseResolutionFields', () => {
  test('extracts claimId, confirmationCode, and resolutionUrl from a real email', () => {
    const subject = 'Fwd: Airbnb Reimbursement Request [CLSF-05873844] [HMRJNRRYF5]';
    const bodyText = `Hi Julio,
I'm Tiara K from Airbnb's AirCover team.
You can get to your request for reimbursement at:
https://airbnb.com/mediation/host_guarantee_host_summary?referenceId=CLSF-05873844
Thanks.`;

    expect(parseResolutionFields({ subject, bodyText })).toEqual({
      claimId: 'CLSF-05873844',
      confirmationCode: 'HMRJNRRYF5',
      resolutionUrl:
        'https://airbnb.com/mediation/host_guarantee_host_summary?referenceId=CLSF-05873844',
    });
  });

  test('returns nulls when nothing matches', () => {
    expect(parseResolutionFields({ subject: 'Some unrelated subject', bodyText: '' })).toEqual({
      claimId: null,
      confirmationCode: null,
      resolutionUrl: null,
    });
  });

  test('handles claimId in body when subject is a generic Fwd line', () => {
    const result = parseResolutionFields({
      subject: 'Fwd: Important',
      bodyText: 'Reference: CLSF-77777777 — please reply with documentation.',
    });
    expect(result.claimId).toBe('CLSF-77777777');
  });
});
