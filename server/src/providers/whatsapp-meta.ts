/**
 * Meta WhatsApp Cloud API Provider
 *
 * Implements WhatsApp messaging using Meta's official Cloud API.
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/
 */

import type { WhatsAppProvider, WhatsAppConfig } from './types.js';

export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'meta-whatsapp';
  private config: WhatsAppConfig | null = null;

  initialize(config: WhatsAppConfig): void {
    this.config = config;
    console.error(`[${this.name}] Initialized with phone number ID: ${config.phoneNumberId}`);
  }

  /**
   * Send a text message to a WhatsApp number
   */
  async sendMessage(to: string, message: string): Promise<string> {
    if (!this.config) {
      throw new Error('Provider not initialized');
    }

    console.error(`[${this.name}] Sending message to ${to}: ${message.substring(0, 50)}...`);

    const url = `https://graph.facebook.com/v18.0/${this.config.phoneNumberId}/messages`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: to.replace(/[^0-9]/g, ''), // Remove any formatting (e.g., +1-555-123-4567 → 15551234567)
          type: 'text',
          text: {
            preview_url: false,
            body: message,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error(`[${this.name}] Meta API error:`, errorData);
        throw new Error(`Meta API error: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const messageId = data.messages?.[0]?.id;

      if (!messageId) {
        throw new Error('No message ID returned from Meta API');
      }

      console.error(`[${this.name}] Message sent successfully. ID: ${messageId}`);
      return messageId;

    } catch (error) {
      console.error(`[${this.name}] Failed to send message:`, error);
      throw error;
    }
  }

  /**
   * Mark a message as read
   */
  async markAsRead(messageId: string): Promise<void> {
    if (!this.config) {
      throw new Error('Provider not initialized');
    }

    const url = `https://graph.facebook.com/v18.0/${this.config.phoneNumberId}/messages`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error(`[${this.name}] Failed to mark as read:`, errorData);
      }
    } catch (error) {
      console.error(`[${this.name}] Error marking message as read:`, error);
      // Don't throw - marking as read is not critical
    }
  }

  /**
   * Send a typing indicator (optional - shows "typing..." to user)
   */
  async sendTypingIndicator(to: string, duration: number = 5000): Promise<void> {
    if (!this.config) {
      throw new Error('Provider not initialized');
    }

    // Note: Meta API doesn't have a direct typing indicator endpoint
    // We can simulate this by adding a small delay before sending the actual message
    // This is a placeholder for future implementation if Meta adds this feature
    await new Promise(resolve => setTimeout(resolve, Math.min(duration, 1000)));
  }

  /**
   * Get information about a phone number (for debugging/validation)
   */
  async getPhoneNumberInfo(): Promise<any> {
    if (!this.config) {
      throw new Error('Provider not initialized');
    }

    const url = `https://graph.facebook.com/v18.0/${this.config.phoneNumberId}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get phone number info: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`[${this.name}] Failed to get phone number info:`, error);
      throw error;
    }
  }
}
