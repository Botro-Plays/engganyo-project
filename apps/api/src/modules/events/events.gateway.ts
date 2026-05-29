import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { EventsService } from './events.service';

@WebSocketGateway({
  namespace: 'notifications',
  cors: {
    origin: [
      'http://localhost:3000',
      'https://engganyo.com',
      'https://www.engganyo.com',
    ],
    credentials: true,
  },
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly eventsService: EventsService,
  ) {}

  afterInit(server: Server) {
    this.eventsService.setServer(server);

    // Set up Redis adapter for multi-instance scaling
    const host = this.configService.get<string>('redis.host', 'localhost');
    const port = this.configService.get<number>('redis.port', 6379);
    const password = this.configService.get<string>('redis.password') || undefined;

    const pubClient = new Redis({ host, port, password, lazyConnect: true });
    const subClient = pubClient.duplicate();

    Promise.all([pubClient.connect(), subClient.connect()])
      .then(() => {
        server.adapter(createAdapter(pubClient, subClient));
        this.logger.log('Redis adapter attached');
      })
      .catch((err) => {
        this.logger.error(`Redis adapter failed: ${(err as Error).message}`);
      });

    this.logger.log('EventsGateway initialized');
  }

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      if (!token) {
        this.logger.warn('Socket connection rejected: no token');
        client.disconnect(true);
        return;
      }

      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('jwt.accessSecret'),
      });

      const userId = payload.sub as string;
      if (!userId) {
        this.logger.warn('Socket connection rejected: no userId in token');
        client.disconnect(true);
        return;
      }

      client.data.userId = userId;
      await client.join(`user:${userId}`);
      this.logger.debug(`Socket connected: ${client.id} for user ${userId}`);
    } catch (err) {
      this.logger.warn(`Socket connection rejected: ${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Socket disconnected: ${client.id}`);
  }

  private extractToken(client: Socket): string | null {
    // Try auth object first (recommended)
    const authToken = client.handshake.auth?.token as string | undefined;
    if (authToken) return authToken;

    // Fallback to query param
    const queryToken = client.handshake.query?.token as string | undefined;
    if (queryToken) return queryToken;

    // Fallback to Authorization header
    const header = client.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      return header.substring(7);
    }

    return null;
  }
}
