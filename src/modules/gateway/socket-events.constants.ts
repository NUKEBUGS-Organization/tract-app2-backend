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

  // Client → Server
  JOIN_LISTING_ROOM: 'listing:join',
  JOIN_DEAL_ROOM: 'deal:join',
  LEAVE_ROOM: 'room:leave',
} as const
