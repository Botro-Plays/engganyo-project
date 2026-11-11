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
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { authenticateSocket } from './socket-auth.util';

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
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
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
    const auth = await authenticateSocket(client, {
      jwtService: this.jwtService,
      configService: this.configService,
      prisma: this.prisma,
      redisService: this.redisService,
      logRejection: (msg) => this.logger.warn(`Socket connection rejected: ${msg}`),
    });
    if (!auth) return;

    // Join admin room for real-time admin alerts — uses the CURRENT database
    // role, not the handshake token's claim.
    const adminRoles = ['ADMIN', 'SUPER_ADMIN', 'MODERATOR'];
    if (adminRoles.includes(auth.role)) {
      await client.join('admin');
      this.logger.debug(`Socket connected: ${client.id} for user ${auth.userId} (admin room joined)`);
    } else {
      this.logger.debug(`Socket connected: ${client.id} for user ${auth.userId}`);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Socket disconnected: ${client.id}`);
  }
}
