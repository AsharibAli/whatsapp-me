/**
 * Webhook Security - Signature verification for Meta WhatsApp
 *
 * Prevents unauthorized requests to webhook endpoints by validating
 * cryptographic signatures from WhatsApp providers.
 */

import { createHmac } from 'crypto';

/**
 * Validate Meta WhatsApp webhook signature
 *
 * Meta uses HMAC-SHA256 to sign webhook payloads.
 * The signature is sent in the x-hub-signature-256 header as: sha256=<signature>
 *
 * Algorithm:
 * 1. Take the raw request body (JSON string)
 * 2. HMAC-SHA256 hash with app secret
 * 3. Prepend "sha256=" to the hex digest
 * 4. Compare with the signature header
 *
 * @see https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
 */
export function validateMetaWhatsAppSignature(
  appSecret: string,
  signature: string | undefined,
  body: string
): boolean {
  if (!signature) {
    console.error('[Security] Missing x-hub-signature-256 header');
    return false;
  }

  // Signature should start with "sha256="
  if (!signature.startsWith('sha256=')) {
    console.error('[Security] Invalid signature format (missing sha256= prefix)');
    return false;
  }

  // Remove "sha256=" prefix
  const receivedSignature = signature.substring(7);

  // Calculate expected signature
  const expectedSignature = createHmac('sha256', appSecret)
    .update(body)
    .digest('hex');

  // Timing-safe comparison to prevent timing attacks
  const valid = timingSafeEqual(
    Buffer.from(receivedSignature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );

  if (!valid) {
    console.error('[Security] Meta WhatsApp signature mismatch');
    console.error(`[Security] Expected: sha256=${expectedSignature}`);
    console.error(`[Security] Received: ${signature}`);
  }

  return valid;
}

/**
 * Timing-safe string comparison
 * Prevents timing attacks by ensuring comparison always takes the same time
 */
function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }

  return result === 0;
}

/**
 * Verify Meta webhook verification token
 *
 * When setting up webhooks, Meta sends a verification request with:
 * - hub.mode=subscribe
 * - hub.verify_token=<your_token>
 * - hub.challenge=<random_string>
 *
 * You must respond with the hub.challenge value if verify_token matches.
 *
 * @see https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
 */
export function verifyWebhookToken(
  expectedToken: string,
  receivedToken: string | undefined
): boolean {
  if (!receivedToken) {
    console.error('[Security] Missing webhook verify token');
    return false;
  }

  // Timing-safe comparison
  if (expectedToken.length !== receivedToken.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < expectedToken.length; i++) {
    result |= expectedToken.charCodeAt(i) ^ receivedToken.charCodeAt(i);
  }

  const valid = result === 0;

  if (!valid) {
    console.error('[Security] Webhook verify token mismatch');
  }

  return valid;
}
