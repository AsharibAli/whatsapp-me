/**
 * Provider Interfaces
 *
 * Abstractions for WhatsApp messaging services.
 */

/**
 * WhatsApp Provider - handles sending/receiving messages via WhatsApp Business API
 */
export interface WhatsAppProvider {
  readonly name: string;

  /**
   * Initialize the provider with credentials
   */
  initialize(config: WhatsAppConfig): void;

  /**
   * Send a text message to a WhatsApp number
   * @param to - Phone number in E.164 format (e.g., +15551234567)
   * @param message - Text message to send
   * @returns Message ID from WhatsApp
   */
  sendMessage(to: string, message: string): Promise<string>;

  /**
   * Mark a message as read
   * @param messageId - WhatsApp message ID
   */
  markAsRead(messageId: string): Promise<void>;

  /**
   * Send typing indicator (optional)
   * @param to - Phone number in E.164 format
   * @param duration - How long to show typing indicator (ms)
   */
  sendTypingIndicator(to: string, duration?: number): Promise<void>;
}

/**
 * WhatsApp Configuration
 *
 * For Meta Cloud API:
 * - phoneNumberId: WhatsApp phone number ID from Meta dashboard
 * - accessToken: Access token from Meta app
 * - appSecret: App secret for webhook verification
 * - webhookVerifyToken: Custom token for webhook verification
 */
export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  webhookVerifyToken: string;
}

/**
 * Provider registry for dependency injection
 */
export interface ProviderRegistry {
  whatsapp: WhatsAppProvider;
}
