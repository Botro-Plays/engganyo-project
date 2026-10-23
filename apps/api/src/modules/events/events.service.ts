import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';
import { RedisService } from '../../database/redis.service';

@Injectable()
export class EventsService {
  private server!: Server;
  private channelsServer!: Server;

  constructor(private readonly redisService: RedisService) {}

  setServer(server: Server) {
    this.server = server;
  }

  setChannelsServer(server: Server) {
    this.channelsServer = server;
  }

  /**
   * Forcibly disconnect every socket the user holds on both namespaces.
   * Called when privileges are revoked (ban/suspend/deactivate) or the role
   * changes — the client must re-handshake and re-verify against current
   * account state rather than ride a token issued before the change.
   */
  async disconnectUser(userId: string, reason = 'auth:revoked') {
    // Tombstone FIRST: a reconnect racing the disconnect must see it, and a
    // handshake that slipped between the DB check and disconnectSockets is
    // caught by the post-join tombstone re-check in the gateways.
    await this.redisService.revokeSocketAuth(userId);
    for (const server of [this.server, this.channelsServer]) {
      if (!server) continue;
      server.to(`user:${userId}`).emit('auth:revoked', { reason });
      await server.in(`user:${userId}`).disconnectSockets(true);
    }
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    if (!this.server) return;
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  emitToRoom(room: string, event: string, payload: unknown) {
    if (!this.server) return;
    this.server.to(room).emit(event, payload);
  }

  emitBroadcast(event: string, payload: unknown) {
    if (!this.server) return;
    this.server.emit(event, payload);
  }

  emitToAdmins(event: string, payload: unknown) {
    if (!this.server) return;
    this.server.to('admin').emit(event, payload);
  }
}
