import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { Public } from '../../common/decorators/public.decorator'
import { SOCKET_EVENTS } from './socket-events.constants'

@Public()
@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  },
  namespace: '/',
})
export class AppGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server

  private readonly logger = new Logger(AppGateway.name)

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  afterInit() {
    this.logger.log('WebSocket server started')
  }

  // ── Connection / Disconnection ────────────────────────────────
  async handleConnection(client: Socket) {
    try {
      const auth = client.handshake.auth as { token?: string } | undefined
      const rawHeader = client.handshake.headers.authorization
      const bearer =
        typeof rawHeader === 'string' ? rawHeader.replace(/^Bearer\s+/i, '') : undefined
      const token = auth?.token ?? bearer

      if (!token) {
        client.disconnect()
        return
      }

      const payload = await this.jwtService.verifyAsync<{ sub: string; role: string }>(token, {
        secret: this.configService.get<string>('jwt.accessSecret') ?? 'dev_access_secret_not_for_production',
      })

      ;(client as Socket & { userId?: string; role?: string }).userId = payload.sub
      ;(client as Socket & { userId?: string; role?: string }).role = payload.role

      void client.join(`user:${payload.sub}`)

      this.logger.log(`Client connected: ${client.id} (user: ${payload.sub})`)
    } catch {
      this.logger.warn(`Rejected unauthenticated socket: ${client.id}`)
      client.disconnect()
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`)
  }

  // ── Room management ───────────────────────────────────────────
  @SubscribeMessage(SOCKET_EVENTS.JOIN_LISTING_ROOM)
  handleJoinListing(@MessageBody() data: { listingId: string }, @ConnectedSocket() client: Socket) {
    const room = `listing:${data.listingId}`
    void client.join(room)
    this.logger.log(`${client.id} joined ${room}`)
    return { event: 'joined', room }
  }

  @SubscribeMessage(SOCKET_EVENTS.JOIN_DEAL_ROOM)
  handleJoinDeal(@MessageBody() data: { dealId: string }, @ConnectedSocket() client: Socket) {
    const room = `deal:${data.dealId}`
    void client.join(room)
    this.logger.log(`${client.id} joined ${room}`)
    return { event: 'joined', room }
  }

  @SubscribeMessage(SOCKET_EVENTS.LEAVE_ROOM)
  handleLeave(@MessageBody() data: { room: string }, @ConnectedSocket() client: Socket) {
    void client.leave(data.room)
    return { event: 'left', room: data.room }
  }

  // ── Emit helpers (called from services) ──────────────────────
  emitToListing(listingId: string, event: string, data: unknown) {
    this.server.to(`listing:${listingId}`).emit(event, data)
  }

  emitToDeal(dealId: string, event: string, data: unknown) {
    this.server.to(`deal:${dealId}`).emit(event, data)
  }

  emitToUser(userId: string, event: string, data: unknown) {
    this.server.to(`user:${userId}`).emit(event, data)
  }

  /**
   * Push a real-time event to a specific user.
   * Called by NotificationsService after creating a new notification.
   */
  pushToUser(userId: string, event: string, payload: unknown): void {
    const room = `user:${userId}`
    this.server.to(room).emit(event, payload)
  }
}
