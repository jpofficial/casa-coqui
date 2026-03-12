import twilio from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export async function sendSMS(to, body) {
  const message = await client.messages.create({
    body,
    from: process.env.TWILIO_PHONE_NUMBER,
    to,
  });
  return message;
}

/**
 * Generates a random 6-digit numeric OTP code as a string.
 */
export function generateOTP() {
  const code = Math.floor(100000 + Math.random() * 900000);
  return String(code);
}

/**
 * Generates an OTP, sends it to the given phone number via SMS,
 * and returns the code along with its expiration timestamp.
 *
 * @param {string} phoneNumber - E.164 formatted phone number (e.g. +17875551234)
 * @returns {{ otp: string, expiresAt: Date }}
 */
export async function sendOTP(phoneNumber) {
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now

  await sendSMS(
    phoneNumber,
    `Your Casa Coqui verification code is: ${otp}. It expires in 5 minutes.`
  );

  return { otp, expiresAt };
}

/**
 * Validates an OTP against the stored code and checks that it has not expired.
 *
 * @param {string} inputCode  - The code submitted by the user
 * @param {string} storedCode - The code that was originally generated
 * @param {Date|string} expiresAt - The expiration timestamp (Date object or ISO string)
 * @returns {{ valid: boolean, reason?: string }}
 */
export function verifyOTP(inputCode, storedCode, expiresAt) {
  const now = new Date();
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);

  if (now > expiry) {
    return { valid: false, reason: 'OTP has expired' };
  }

  if (inputCode !== storedCode) {
    return { valid: false, reason: 'Invalid OTP code' };
  }

  return { valid: true };
}

export default client;
