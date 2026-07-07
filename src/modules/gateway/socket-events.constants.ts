export const SOCKET_EVENTS = {
  // Server → Client
  BID_PLACED: 'bid:placed',
  BID_COUNT_UPDATED: 'bid:count_updated',
  DEAL_STEP_ADVANCED: 'deal:step_advanced',
  CHAT_MESSAGE: 'chat:message',
  KILL_SWITCH_ALERT: 'kill_switch:alert',
  LISTING_CLOSED: 'listing:closed',
  DEAL_FROZEN: 'deal:frozen',
  BACKUP_PROMOTED: 'deal:backup_promoted',

  // Notification events
  NOTIFICATION_NEW: 'notification:new',
  NOTIFICATION_READ: 'notification:read',
  NOTIFICATION_COUNT: 'notification:count',

  // Client → Server
  JOIN_LISTING_ROOM: 'listing:join',
  JOIN_DEAL_ROOM: 'deal:join',
  LEAVE_ROOM: 'room:leave',
} as const

export const NOTIFICATION_NEW = SOCKET_EVENTS.NOTIFICATION_NEW
export const NOTIFICATION_READ = SOCKET_EVENTS.NOTIFICATION_READ
export const NOTIFICATION_COUNT = SOCKET_EVENTS.NOTIFICATION_COUNT
