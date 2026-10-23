import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class EventsService {
  private server!: Server;
  private channelsServer!: Server;

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
  disconnectUser(userId: string, reason = 'auth:revoked') {
    for (const server of [this.server, this.channelsServer]) {
      if (!server) continue;
      server.to(`user:${userId}`).emit('auth:revoked', { reason });
      void server.in(`user:${userId}`).disconnectSockets(true);
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
