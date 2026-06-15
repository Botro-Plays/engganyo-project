import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { ChannelsService } from './channels.service';

// Simple JWT verification for socket auth
function extractToken(client: Socket): string | null {
  const authToken = client.handshake.auth?.token as string | undefined;
  if (authToken) return authToken;
  const queryToken = client.handshake.query?.token as string | undefined;
  if (queryToken) return queryToken;
  const header = client.handshake.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.substring(7);
  return null;
}

@WebSocketGateway({
  namespace: 'channels',
  cors: {
    origin: ['http://localhost:3000', 'https://engganyo.com', 'https://www.engganyo.com'],
    credentials: true,
  },
})
export class ChannelsGateway {
  private readonly logger = new Logger(ChannelsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly channelsService: ChannelsService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = extractToken(client);
      if (!token) {
        client.disconnect(true);
        return;
      }
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('jwt.accessSecret'),
      });
      const userId = payload.sub as string;
      if (!userId) {
        client.disconnect(true);
        return;
      }
      client.data.userId = userId;
      this.logger.debug(`Channel socket connected: ${client.id} for user ${userId}`);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Channel socket disconnected: ${client.id}`);
  }

  @SubscribeMessage('channel:join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { channelId: string },
  ) {
    const userId = client.data.userId as string;
    if (!userId || !payload.channelId) return;

    try {
      await this.channelsService.joinChannel(userId, payload.channelId);
      await client.join(`channel:${payload.channelId}`);
      client.emit('channel:joined', { channelId: payload.channelId });
    } catch (err) {
      client.emit('channel:error', { message: (err as Error).message });
    }
  }

  @SubscribeMessage('channel:leave')
  async handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { channelId: string },
  ) {
    if (!payload.channelId) return;
    await client.leave(`channel:${payload.channelId}`);
    client.emit('channel:left', { channelId: payload.channelId });
  }

  @SubscribeMessage('chat:send')
  async handleSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { channelId: string; content: string },
  ) {
    const userId = client.data.userId as string;
    if (!userId || !payload.channelId || !payload.content) return;

    try {
      const message = await this.channelsService.sendMessage(userId, payload.channelId, payload.content);
      this.server.to(`channel:${payload.channelId}`).emit('chat:message', message);
    } catch (err) {
      client.emit('chat:error', { message: (err as Error).message });
    }
  }

  @SubscribeMessage('chat:typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { channelId: string; isTyping: boolean },
  ) {
    const userId = client.data.userId as string;
    if (!userId || !payload.channelId) return;

    client.to(`channel:${payload.channelId}`).emit('chat:typing', {
      userId,
      isTyping: payload.isTyping,
    });
  }
}
