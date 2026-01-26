/**
 * Message Manager - Core WhatsApp messaging logic
 *
 * Handles:
 * - Sending messages to user via WhatsApp
 * - Receiving messages from webhook
 * - Managing conversation state
 * - HTTP server for webhooks
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import {
  loadProviderConfig,
  createProviders,
  validateProviderConfig,
  type ProviderRegistry,
  type ProviderConfig,
} from './providers/index.js';
import {
  validateMetaWhatsAppSignature,
  verifyWebhookToken,
} from './webhook-security.js';

interface ConversationState {
  conversationId: string;
  userPhoneNumber: string;
  messageHistory: Array<{ role: 'claude' | 'user'; text: string; timestamp: number }>;
  startTime: number;
  lastMessageAt: number;
  active: boolean;
}

export interface ServerConfig {
  publicUrl: string;
  port: number;
  userPhoneNumber: string;
  providers: ProviderRegistry;
  providerConfig: ProviderConfig;
}

export function loadServerConfig(publicUrl: string): ServerConfig {
  const providerConfig = loadProviderConfig();
  const errors = validateProviderConfig(providerConfig);

  if (errors.length > 0) {
    throw new Error(`Missing required configuration:\n  - ${errors.join('\n  - ')}`);
  }

  const providers = createProviders(providerConfig);

  return {
    publicUrl,
    port: parseInt(process.env.WHATSAPPME_PORT || '3333', 10),
    userPhoneNumber: providerConfig.userPhoneNumber,
    providers,
    providerConfig,
  };
}

export class MessageManager {
  private activeConversations = new Map<string, ConversationState>();
  private phoneToConversationId = new Map<string, string>();
  private httpServer: ReturnType<typeof createServer> | null = null;
  private config: ServerConfig;
  private currentConversationId = 0;

  // Callback for when messages are received (MCP will subscribe to this)
  private onMessageReceivedCallback: ((from: string, text: string, conversationId: string) => void) | null = null;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  /**
   * Start HTTP server for webhooks
   */
  startServer(): void {
    this.httpServer = createServer((req, res) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);

      // Root endpoint with project info
      if (url.pathname === '/' || url.pathname === '') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          title: 'WhatsApp-Me',
          description: 'A Claude Code plugin that lets Claude message you on WhatsApp. Get notified on your phone when Claude finishes tasks, runs into errors, or needs your input.',
          setup_details: 'https://github.com/asharibali/whatsapp-me'
        }, null, 2));
        return;
      }

      // Webhook endpoint for Meta WhatsApp
      if (url.pathname === '/webhook') {
        this.handleWhatsAppWebhook(req, res);
        return;
      }

      // Health check endpoint
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          activeConversations: this.activeConversations.size,
          uptime: process.uptime(),
        }));
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    this.httpServer.listen(this.config.port, () => {
      console.error(`HTTP server listening on port ${this.config.port}`);
      console.error(`Webhook URL: ${this.config.publicUrl}/webhook`);
    });
  }

  /**
   * Send a message to the user via WhatsApp
   */
  async sendMessage(message: string): Promise<{ conversationId: string; messageId: string }> {
    const conversationId = this.getOrCreateConversation(this.config.userPhoneNumber);
    const state = this.activeConversations.get(conversationId)!;

    console.error(`[${conversationId}] Sending message: ${message.substring(0, 50)}...`);

    try {
      // Send via WhatsApp provider
      const messageId = await this.config.providers.whatsapp.sendMessage(
        this.config.userPhoneNumber,
        message
      );

      // Update conversation state
      state.messageHistory.push({
        role: 'claude',
        text: message,
        timestamp: Date.now(),
      });
      state.lastMessageAt = Date.now();

      console.error(`[${conversationId}] Message sent successfully. WhatsApp ID: ${messageId}`);

      return { conversationId, messageId };

    } catch (error) {
      console.error(`[${conversationId}] Failed to send message:`, error);
      throw error;
    }
  }

  /**
   * Set callback for when messages are received
   */
  onMessageReceived(callback: (from: string, text: string, conversationId: string) => void): void {
    this.onMessageReceivedCallback = callback;
  }

  /**
   * Get or create a conversation for a phone number
   */
  private getOrCreateConversation(phoneNumber: string): string {
    // Check if conversation already exists
    let conversationId = this.phoneToConversationId.get(phoneNumber);

    if (conversationId) {
      const state = this.activeConversations.get(conversationId);
      if (state && state.active) {
        return conversationId;
      }
    }

    // Create new conversation
    conversationId = `conv-${++this.currentConversationId}-${Date.now()}`;

    const state: ConversationState = {
      conversationId,
      userPhoneNumber: phoneNumber,
      messageHistory: [],
      startTime: Date.now(),
      lastMessageAt: Date.now(),
      active: true,
    };

    this.activeConversations.set(conversationId, state);
    this.phoneToConversationId.set(phoneNumber, conversationId);

    console.error(`[${conversationId}] Created new conversation for ${phoneNumber}`);

    return conversationId;
  }

  /**
   * Handle incoming webhook from Meta WhatsApp
   */
  private handleWhatsAppWebhook(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url!, `http://${req.headers.host}`);

    // Handle webhook verification (GET request from Meta)
    if (req.method === 'GET') {
      this.handleWebhookVerification(url, res);
      return;
    }

    // Handle webhook events (POST request from Meta)
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          // Validate signature
          const signature = req.headers['x-hub-signature-256'] as string | undefined;
          const appSecret = this.config.providerConfig.whatsappAppSecret;

          if (!validateMetaWhatsAppSignature(appSecret, signature, body)) {
            console.error('[Security] Rejecting webhook: invalid signature');
            res.writeHead(401);
            res.end('Invalid signature');
            return;
          }

          // Parse and process webhook
          const event = JSON.parse(body);
          await this.processWhatsAppEvent(event);

          // Acknowledge immediately (Meta requires 200 within 20 seconds)
          res.writeHead(200);
          res.end('OK');

        } catch (error) {
          console.error('Error processing webhook:', error);
          res.writeHead(400);
          res.end('Invalid request');
        }
      });
      return;
    }

    res.writeHead(405);
    res.end('Method Not Allowed');
  }

  /**
   * Handle webhook verification from Meta
   *
   * Meta sends: GET /webhook?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<challenge>
   * We must respond with hub.challenge if token matches
   */
  private handleWebhookVerification(url: URL, res: ServerResponse): void {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    console.error('[Webhook] Verification request received');
    console.error(`[Webhook] Mode: ${mode}, Token: ${token?.substring(0, 10)}..., Challenge: ${challenge?.substring(0, 10)}...`);

    if (mode === 'subscribe' && verifyWebhookToken(this.config.providerConfig.whatsappVerifyToken, token || '')) {
      console.error('[Webhook] Verification successful');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge);
    } else {
      console.error('[Webhook] Verification failed');
      res.writeHead(403);
      res.end('Forbidden');
    }
  }

  /**
   * Process WhatsApp webhook event
   *
   * Meta webhook format:
   * {
   *   "object": "whatsapp_business_account",
   *   "entry": [{
   *     "changes": [{
   *       "value": {
   *         "messages": [{ from, id, timestamp, text: { body } }],
   *         "statuses": [{ id, status, timestamp }]
   *       }
   *     }]
   *   }]
   * }
   */
  private async processWhatsAppEvent(event: any): Promise<void> {
    console.error('[Webhook] Processing event:', JSON.stringify(event, null, 2));

    if (event.object !== 'whatsapp_business_account') {
      console.error('[Webhook] Ignoring non-WhatsApp event');
      return;
    }

    for (const entry of event.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;

        // Handle incoming messages
        if (value.messages) {
          for (const message of value.messages) {
            await this.handleIncomingMessage(message);
          }
        }

        // Handle message status updates
        if (value.statuses) {
          for (const status of value.statuses) {
            this.handleMessageStatus(status);
          }
        }
      }
    }
  }

  /**
   * Handle incoming message from user
   */
  private async handleIncomingMessage(message: any): Promise<void> {
    const from = message.from;
    const messageId = message.id;
    const timestamp = parseInt(message.timestamp, 10) * 1000;

    // DEBUG: Log the exact message object
    console.error(`[DEBUG] Full message object:`, JSON.stringify(message, null, 2));
    console.error(`[DEBUG] From field: "${from}" (type: ${typeof from})`);

    // Extract text from message
    let text = '';
    if (message.type === 'text' && message.text?.body) {
      text = message.text.body;
    } else if (message.type === 'button' && message.button?.text) {
      text = message.button.text;
    } else {
      console.error(`[Webhook] Unsupported message type: ${message.type}`);
      return;
    }

    console.error(`[Webhook] Received message from ${from}: ${text.substring(0, 50)}...`);

    // Get or create conversation
    const conversationId = this.getOrCreateConversation(from);
    const state = this.activeConversations.get(conversationId)!;

    // Mark message as read
    try {
      await this.config.providers.whatsapp.markAsRead(messageId);
    } catch (error) {
      console.error('[Webhook] Failed to mark message as read:', error);
    }

    // Store in conversation history
    state.messageHistory.push({
      role: 'user',
      text,
      timestamp,
    });
    state.lastMessageAt = timestamp;

    // Notify MCP (if callback is set)
    if (this.onMessageReceivedCallback) {
      this.onMessageReceivedCallback(from, text, conversationId);
    }
  }

  /**
   * Handle message status update
   */
  private handleMessageStatus(status: any): void {
    const messageId = status.id;
    const statusValue = status.status; // sent, delivered, read, failed
    const timestamp = status.timestamp;

    console.error(`[Webhook] Message ${messageId} status: ${statusValue} at ${timestamp}`);

    // Could update database here if we were tracking delivery status
  }

  /**
   * Get conversation history
   */
  getConversationHistory(conversationId: string): Array<{ role: 'claude' | 'user'; text: string; timestamp: number }> {
    const state = this.activeConversations.get(conversationId);
    return state?.messageHistory || [];
  }

  /**
   * Get all active conversations
   */
  getActiveConversations(): string[] {
    return Array.from(this.activeConversations.keys());
  }

  /**
   * Shutdown server
   */
  shutdown(): void {
    if (this.httpServer) {
      this.httpServer.close();
      console.error('HTTP server shut down');
    }
  }
}
