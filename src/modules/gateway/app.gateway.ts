import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
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
import { UserRole } from '../../common/enums/user-role.enum'
import { ListingStatus } from '../../common/enums/listing-status.enum'
import { Deal, DealDocument } from '../deals/schemas/deal.schema'
import { Listing, ListingDocument } from '../listings/schemas/listing.schema'
import { Session, SessionDocument } from '../sessions/schemas/session.schema'
import { SOCKET_EVENTS } from './socket-events.constants'
import { parseCorsOrigins } from '../../common/utils/cors-origins'

type AuthedSocket = Socket & { userId?: string; role?: string }

function refId(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'object' && '_id' in (value as object)) {
    return String((value as { _id: unknown })._id)
  }
  return String(value)
}

@Public()
@WebSocketGateway({
  cors: {
    origin: parseCorsOrigins(process.env.CORS_ORIGIN, 'CORS_ORIGIN'),
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
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
    @InjectModel(Listing.name) private readonly listingModel: Model<ListingDocument>,
    @InjectModel(Session.name) private readonly sessionModel: Model<SessionDocument>,
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

      const payload = await this.jwtService.verifyAsync<{
        sub: string
        role: string
        sessionId?: string
      }>(token, {
        secret: this.configService.getOrThrow<string>('jwt.accessSecret'),
      })

      if (!payload.sessionId) {
        client.disconnect()
        return
      }

      const session = await this.sessionModel.findOne({
        sessionId: payload.sessionId,
        isBlacklisted: false,
      })
      if (!session) {
        client.disconnect()
        return
      }

      const authed = client as AuthedSocket
      authed.userId = payload.sub
      authed.role = payload.role

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
  async handleJoinListing(
    @MessageBody() data: { listingId: string },
    @ConnectedSocket() client: AuthedSocket,
  ) {
    if (!client.userId) return { error: 'unauthorized' }

    const listing = await this.listingModel.findById(data.listingId).lean()
    if (!listing) return { error: 'not_found' }

    const isOwner = listing.wholesalerId.toString() === client.userId
    const isAdmin = client.role === UserRole.ADMIN
    const isLive = listing.status === ListingStatus.LIVE

    if (!isOwner && !isAdmin && !isLive) {
      return { error: 'forbidden' }
    }

    const room = `listing:${data.listingId}`
    void Promise.resolve(client.join(room)).catch((err) => {
      this.logger.warn(`join ${room} failed: ${err instanceof Error ? err.message : err}`)
    })
    this.logger.log(`${client.id} joined ${room}`)
    return { event: 'joined', room }
  }

  @SubscribeMessage(SOCKET_EVENTS.JOIN_DEAL_ROOM)
  async handleJoinDeal(
    @MessageBody() data: { dealId: string },
    @ConnectedSocket() client: AuthedSocket,
  ) {
    try {
      if (!client.userId) return { error: 'unauthorized' }

      const deal = await this.dealModel.findById(data.dealId).lean()
      if (!deal) return { error: 'not_found' }

      const isParty =
        client.role === UserRole.ADMIN ||
        refId(deal.primaryBuyerId) === client.userId ||
        refId(deal.wholesalerId) === client.userId ||
        refId(deal.titleRepId) === client.userId

      if (!isParty) return { error: 'forbidden' }

      const room = `deal:${data.dealId}`
      void Promise.resolve(client.join(room)).catch((err) => {
        this.logger.warn(`join ${room} failed: ${err instanceof Error ? err.message : err}`)
      })
      this.logger.log(`${client.id} joined ${room}`)
      return { event: 'joined', room }
    } catch (err) {
      this.logger.error(
        `handleJoinDeal failed: ${err instanceof Error ? err.message : err}`,
      )
      return { error: 'server_error' }
    }
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
