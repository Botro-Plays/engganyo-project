import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class EventsService {
  private server!: Server;

  setServer(server: Server) {
    this.server = server;
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
}
