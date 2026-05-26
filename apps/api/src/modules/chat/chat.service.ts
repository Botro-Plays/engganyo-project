import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { ChatRole, ChatStatus } from '@prisma/client';
import type { ChatMessageDto, ChatResponseDto } from './dto/chat.dto';

interface GroqConfig {
  apiKey: string;
  model: string;
}

interface GroqMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface GroqResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private async getGroqConfig(): Promise<GroqConfig> {
    // Try to get from PlatformConfig first
    const apiKeyRow = await this.prisma.platformConfig.findUnique({
      where: { key: 'groq_api_key' },
    });
    const modelRow = await this.prisma.platformConfig.findUnique({
      where: { key: 'groq_model' },
    });

    const apiKey = apiKeyRow?.value as string || this.configService.get<string>('app.groq.apiKey') || '';
    const model = modelRow?.value as string || this.configService.get<string>('app.groq.model') || 'llama-3.3-70b-versatile';

    return { apiKey, model };
  }

  async sendMessage(
    userId: string | null,
    ipAddress: string | null,
    dto: ChatMessageDto,
  ): Promise<ChatResponseDto> {
    const { message, conversationId } = dto;

    // Get or create conversation
    let conversation;
    if (conversationId) {
      conversation = await this.prisma.chatConversation.findUnique({
        where: { id: conversationId },
        include: { messages: true },
      });

      if (!conversation) {
        throw new UnauthorizedException('Conversation not found');
      }

      // Auto-link anonymous conversation to authenticated user
      if (userId && !conversation.userId && conversation.ipAddress === ipAddress) {
        conversation = await this.prisma.chatConversation.update({
          where: { id: conversationId },
          data: { userId, ipAddress: null },
          include: { messages: true },
        });
      }

      // Verify user owns this conversation
      if (userId && conversation.userId !== userId) {
        throw new UnauthorizedException('Access denied');
      }

      // Check if conversation is closed
      if (conversation.status === ChatStatus.CLOSED) {
        throw new UnauthorizedException('Conversation is closed');
      }
    } else {
      // Create new conversation
      conversation = await this.prisma.chatConversation.create({
        data: {
          userId,
          ipAddress: userId ? null : ipAddress,
          status: ChatStatus.AI_HANDLING,
        },
        include: { messages: true },
      });
    }

    // Save user message
    await this.prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: ChatRole.USER,
        content: message,
        isHuman: false,
      },
    });

    // If conversation is handled by human, don't call AI
    if (conversation.status === ChatStatus.HUMAN_HANDLING) {
      return {
        message: 'Your message has been sent to our support team. They will respond shortly.',
        conversationId: conversation.id,
        isHuman: true,
        status: conversation.status,
      };
    }

    // Build message history for AI context
    const messages: GroqMessage[] = [
      {
        role: 'system',
        content: this.getSystemPrompt(userId),
      },
    ];

    // Add recent conversation history (last 10 messages)
    const recentMessages = conversation.messages.slice(-10);
    for (const msg of recentMessages) {
      messages.push({
        role: msg.role === ChatRole.USER ? 'user' : 'assistant',
        content: msg.content,
      });
    }

    // Add current message
    messages.push({
      role: 'user',
      content: message,
    });

    // Call Groq API
    let aiResponse: string;
    try {
      aiResponse = await this.callGroqAPI(messages);
    } catch (error) {
      this.logger.error('Groq API call failed', error);
      aiResponse = 'I apologize, but I am currently experiencing technical difficulties. Please try again later or contact support directly.';
    }

    // Save AI response
    await this.prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: ChatRole.ASSISTANT,
        content: aiResponse,
        isHuman: false,
      },
    });

    return {
      message: aiResponse,
      conversationId: conversation.id,
      isHuman: false,
      status: conversation.status,
    };
  }

  private async callGroqAPI(messages: GroqMessage[]): Promise<string> {
    const { apiKey, model } = await this.getGroqConfig();

    if (!apiKey) {
      throw new Error('GROQ_API_KEY not configured');
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as GroqResponse;
    return data.choices[0]?.message?.content || 'No response generated';
  }

  private getSystemPrompt(userId: string | null): string {
    const basePrompt = `You are a helpful customer support assistant for Engganyo, a creator growth platform where creators earn credits by completing engagement tasks and spend credits to promote their own content.

Key information about Engganyo:
- Platform: engganyo.com
- Credit-based economy: earn by completing tasks, spend to create campaigns
- Supported platforms: YouTube, TikTok, Instagram, Twitter, Twitch, Spotify, Telegram, Discord
- Task types: likes, follows, subscribes, comments, joins
- Trust score system: 0-100, affects access and privileges
- Anti-abuse: verification systems, trust scoring, manual review

Your role:
- Help users understand how the platform works
- Guide users through task completion and campaign creation
- Explain credit earning and spending
- Assist with account issues, trust score questions
- Be friendly, professional, and concise
- If you cannot answer, suggest contacting support

Important:
- Keep responses under 200 words when possible
- Be helpful but don't make promises about features that don't exist
- For account-specific issues, suggest the user contact support or check their dashboard
- Never share sensitive information or suggest workarounds for anti-abuse systems`;

    if (userId) {
      return basePrompt + '\n\nThe user is logged in. You can reference their dashboard, wallet, and account settings.';
    }

    return basePrompt + '\n\nThe user is not logged in. Focus on general platform information and encourage them to sign up or log in for personalized help.';
  }

  async getConversation(conversationId: string, _userId: string | null) {
    const conversation = await this.prisma.chatConversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            displayName: true,
          },
        },
      },
    });

    if (!conversation) {
      throw new UnauthorizedException('Conversation not found');
    }

    // Access is controlled by @Roles guard in controller
    // Admins can view any conversation, users can only view their own
    return conversation;
  }

  async listConversations(_adminUserId: string) {
    const conversations = await this.prisma.chatConversation.findMany({
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            displayName: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        agent: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return conversations;
  }

  async transferToHuman(conversationId: string, adminUserId: string) {
    const conversation = await this.prisma.chatConversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new UnauthorizedException('Conversation not found');
    }

    await this.prisma.chatConversation.update({
      where: { id: conversationId },
      data: {
        status: ChatStatus.HUMAN_HANDLING,
        assignedTo: adminUserId,
      },
    });

    return { success: true };
  }

  async sendAdminMessage(conversationId: string, adminUserId: string, message: string) {
    const conversation = await this.prisma.chatConversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new UnauthorizedException('Conversation not found');
    }

    // Save admin message
    await this.prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: ChatRole.ASSISTANT,
        content: message,
        isHuman: true,
      },
    });

    return { success: true };
  }
}
