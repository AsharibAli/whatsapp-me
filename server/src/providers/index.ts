/**
 * Provider Factory
 *
 * Creates and configures providers based on environment variables.
 * Uses Meta WhatsApp Cloud API for messaging.
 */

import type { WhatsAppProvider, ProviderRegistry } from './types.js';
import { MetaWhatsAppProvider } from './whatsapp-meta.js';

export * from './types.js';

export interface ProviderConfig {
  // Meta WhatsApp Cloud API credentials
  whatsappPhoneNumberId: string;
  whatsappAccessToken: string;
  whatsappAppSecret: string;
  whatsappVerifyToken: string;

  // User's phone number (where to send messages)
  userPhoneNumber: string;
}

export function loadProviderConfig(): ProviderConfig {
  return {
    whatsappPhoneNumberId: process.env.WHATSAPPME_PHONE_NUMBER_ID || '',
    whatsappAccessToken: process.env.WHATSAPPME_ACCESS_TOKEN || '',
    whatsappAppSecret: process.env.WHATSAPPME_APP_SECRET || '',
    whatsappVerifyToken: process.env.WHATSAPPME_VERIFY_TOKEN || '',
    userPhoneNumber: process.env.WHATSAPPME_USER_PHONE_NUMBER || '',
  };
}

export function createWhatsAppProvider(config: ProviderConfig): WhatsAppProvider {
  const provider = new MetaWhatsAppProvider();

  provider.initialize({
    phoneNumberId: config.whatsappPhoneNumberId,
    accessToken: config.whatsappAccessToken,
    appSecret: config.whatsappAppSecret,
    webhookVerifyToken: config.whatsappVerifyToken,
  });

  return provider;
}

export function createProviders(config: ProviderConfig): ProviderRegistry {
  return {
    whatsapp: createWhatsAppProvider(config),
  };
}

/**
 * Validate that required config is present
 */
export function validateProviderConfig(config: ProviderConfig): string[] {
  const errors: string[] = [];

  if (!config.whatsappPhoneNumberId) {
    errors.push('Missing WHATSAPPME_PHONE_NUMBER_ID (WhatsApp Phone Number ID from Meta dashboard)');
  }
  if (!config.whatsappAccessToken) {
    errors.push('Missing WHATSAPPME_ACCESS_TOKEN (Access token from Meta app)');
  }
  if (!config.whatsappAppSecret) {
    errors.push('Missing WHATSAPPME_APP_SECRET (App secret for webhook verification)');
  }
  if (!config.whatsappVerifyToken) {
    errors.push('Missing WHATSAPPME_VERIFY_TOKEN (Custom token for webhook verification)');
  }
  if (!config.userPhoneNumber) {
    errors.push('Missing WHATSAPPME_USER_PHONE_NUMBER (Your phone number to receive messages)');
  }

  return errors;
}
