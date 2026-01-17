#!/usr/bin/env bun

/**
 * WhatsApp-Me MCP Server
 *
 * Model Context Protocol server that enables Claude Code to send/receive
 * WhatsApp messages to communicate with users.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { startNgrok, stopNgrok } from './ngrok.js';
import { MessageManager, loadServerConfig, type ServerConfig } from './message-manager.js';
import { appendFileSync } from 'fs';
import { join } from 'path';

// Optional: Write logs to a file for debugging
const LOG_FILE = join(process.cwd(), 'whatsappme-debug.log');
const originalConsoleError = console.error;
console.error = (...args: any[]) => {
  originalConsoleError(...args);
  try {
    const timestamp = new Date().toISOString();
    const message = args.map(arg =>
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`);
  } catch (e) {
    // Ignore file write errors
  }
};

let publicUrl: string | null = null;
let serverConfig: ServerConfig | null = null;
let messageManager: MessageManager | null = null;

// Helper function to normalize phone numbers (remove all non-digits)
function normalizePhoneNumber(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

// Store pending responses (when waiting for user reply)
// Key is normalized phone number (digits only)
const pendingResponses = new Map<string, {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}>();

async function main() {
  const port = parseInt(process.env.WHATSAPPME_PORT || '3333', 10);

  try {
    const envPublicUrl = process.env.WHATSAPPME_PUBLIC_URL;

    if (envPublicUrl) {
      console.error(`Using provided public URL: ${envPublicUrl}`);
      publicUrl = envPublicUrl;
    } else {
      // Start ngrok tunnel as fallback
      console.error('Starting ngrok tunnel...');
      publicUrl = await startNgrok(port);
      console.error(`Public URL: ${publicUrl}`);
    }

    if (!publicUrl) {
      throw new Error('Failed to determine public URL');
    }

    // Load configuration and create message manager
    serverConfig = loadServerConfig(publicUrl);
    messageManager = new MessageManager(serverConfig);

    // Set up message received callback
    messageManager.onMessageReceived((from, text, conversationId) => {
      console.error(`[MCP] Message received from ${from}: ${text.substring(0, 50)}...`);

      // Normalize the incoming phone number
      const normalizedFrom = normalizePhoneNumber(from);
      console.error(`[MCP] Normalized from: ${normalizedFrom}`);

      // Check if we're waiting for a response from this user (using normalized number)
      const pending = pendingResponses.get(normalizedFrom);

      if (pending) {
        clearTimeout(pending.timeout);
        pendingResponses.delete(normalizedFrom);
        pending.resolve(text);
        console.error(`[MCP] ✓ Resolved pending response for ${normalizedFrom}`);
      } else {
        console.error(`[MCP] ✗ No pending response found for ${normalizedFrom}`);
        console.error(`[MCP] Pending responses keys: [${Array.from(pendingResponses.keys()).join(', ')}]`);
      }
    });

    // Start HTTP server for webhooks
    messageManager.startServer();

    console.error('WhatsApp-Me server ready!');
    console.error(`Configure Meta webhook URL: ${publicUrl}/webhook`);

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }

  // Create MCP server
  const mcpServer = new Server(
    {
      name: 'whatsappme',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register MCP tools
  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'get_setup_info',
          description: 'Get the current webhook URL and setup status. Use this if the user needs to configure their Meta Developer Portal or check if the tunnel is active.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'send_message',
          description: 'Send a WhatsApp message to the user. Use this to notify the user about task completion, ask for input, or report progress.',
          inputSchema: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description: 'The message to send to the user via WhatsApp',
              },
              wait_for_reply: {
                type: 'boolean',
                description: 'Whether to wait for user reply (default: false). Set to true if you need input from the user.',
                default: false,
              },
              timeout_ms: {
                type: 'number',
                description: 'Timeout in milliseconds when waiting for reply (default: 3600000 = 1 hour)',
                default: 3600000,
              },
            },
            required: ['message'],
          },
        },
        {
          name: 'get_conversation_history',
          description: 'Get the message history of the current conversation. Useful for understanding context.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maximum number of recent messages to return (default: 20)',
                default: 20,
              },
            },
          },
        },
      ],
    };
  });

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'get_setup_info': {
          if (!publicUrl) {
            throw new Error('Public URL not initialized');
          }
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'active',
                  webhook_url: `${publicUrl}/webhook`,
                  verify_token: process.env.WHATSAPPME_VERIFY_TOKEN || 'Not set',
                  phone_number_id: process.env.WHATSAPPME_PHONE_NUMBER_ID || 'Not set',
                  instructions: [
                    "1. Go to Meta Developer Console > WhatsApp > Configuration",
                    "2. Click 'Edit' and paste the 'webhook_url' and 'verify_token'",
                    "3. In 'Webhook fields', select 'messages'",
                    "4. Send a test message to verify the connection"
                  ]
                }, null, 2),
              },
            ],
          };
        }

        case 'send_message': {
          if (!serverConfig) {
            throw new Error('Server configuration not loaded');
          }
          if (!messageManager) {
            throw new Error('Message manager not initialized');
          }

          const message = args?.message as string;
          const waitForReply = args?.wait_for_reply as boolean || false;
          const timeoutMs = args?.timeout_ms as number || 3600000;

          if (!message) {
            throw new Error('Message is required');
          }

          // Send the message
          const { conversationId, messageId } = await messageManager!.sendMessage(message);

          // If not waiting for reply, return immediately
          if (!waitForReply) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    conversationId,
                    messageId,
                    status: 'Message sent via WhatsApp',
                  }, null, 2),
                },
              ],
            };
          }

          // Wait for user reply
          try {
            // Normalize the user's phone number for consistent matching
            const normalizedUserPhone = normalizePhoneNumber(serverConfig!.userPhoneNumber);
            console.error(`[MCP] Waiting for reply from: ${serverConfig!.userPhoneNumber} (normalized: ${normalizedUserPhone})`);

            const userReply = await new Promise<string>((resolve, reject) => {
              const timeout = setTimeout(() => {
                pendingResponses.delete(normalizedUserPhone);
                reject(new Error('Timeout waiting for user reply'));
              }, timeoutMs);

              // Store with normalized phone number as key
              pendingResponses.set(normalizedUserPhone, {
                resolve,
                reject,
                timeout,
              });
            });

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    conversationId,
                    messageId,
                    userReply,
                    status: 'Message sent and reply received',
                  }, null, 2),
                },
              ],
            };

          } catch (error) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    conversationId,
                    messageId,
                    status: 'Message sent but no reply received',
                    error: (error as Error).message,
                  }, null, 2),
                },
              ],
            };
          }
        }

        case 'get_conversation_history': {
          const limit = args.limit as number || 20;
          const conversations = messageManager!.getActiveConversations();

          if (conversations.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'No active conversations',
                },
              ],
            };
          }

          // Get history from most recent conversation
          const conversationId = conversations[conversations.length - 1];
          const history = messageManager!.getConversationHistory(conversationId);
          const recentHistory = history.slice(-limit);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  conversationId,
                  messageCount: recentHistory.length,
                  messages: recentHistory.map(msg => ({
                    role: msg.role,
                    text: msg.text,
                    timestamp: new Date(msg.timestamp).toISOString(),
                  })),
                }, null, 2),
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  console.error('MCP server connected and ready');
  console.error(`User phone: ${serverConfig.userPhoneNumber}`);
  console.error('');
}

// Cleanup on exit
const shutdown = async () => {
  console.error('\nShutting down...');
  if (messageManager) {
    messageManager.shutdown();
  }
  await stopNgrok();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Also shutdown when stdin is closed (reliable way to detect Claude Code exit)
process.stdin.on('end', shutdown);

// Start server
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
