import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger, UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';

import { ChannelsService } from './channels.service';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { authenticateSocket } from '../events/socket-auth.util';

@WebSocketGateway({
  namespace: 'channels',
  cors: {
    origin: ['http://localhost:3000', 'https://engganyo.com', 'https://www.engganyo.com'],
    credentials: true,
  },
})
export class ChannelsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ChannelsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly channelsService: ChannelsService,
    private readonly eventsService: EventsService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  afterInit(server: Server) {
    this.eventsService.setChannelsServer(server);
    this.logger.log('ChannelsGateway initialized');
  }

  async handleConnection(client: Socket) {
    const auth = await authenticateSocket(client, {
      jwtService: this.jwtService,
      configService: this.configService,
      prisma: this.prisma,
      redisService: this.redisService,
      logRejection: (msg) => this.logger.warn(`Channel socket rejected: ${msg}`),
    });
    if (!auth) return;
    this.logger.debug(`Channel socket connected: ${client.id} for user ${auth.userId}`);
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
    const role = client.data.role as string | undefined;
    if (!userId || !payload.channelId) return;

    try {
      await this.channelsService.joinChannel(userId, payload.channelId, role as UserRole);
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
    const role = client.data.role as string | undefined;
    if (!userId || !payload.channelId || !payload.content) return;

    try {
      const message = await this.channelsService.sendMessage(userId, payload.channelId, payload.content, role as UserRole);
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
