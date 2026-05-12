export const QUEUES = {
  KILL_SWITCH: 'kill-switch',
  ACTIVITY: 'activity',
} as const

export const KILL_SWITCH_JOBS = {
  CHECK_72HR_DEADLINE: 'check-72hr-deadline',
  CHECK_7DAY_REALTOR: 'check-7day-realtor',
  CHECK_BACKUP_ACTIVATION: 'check-backup-activation',
} as const

export const ACTIVITY_JOBS = {
  CHECK_30DAY_INACTIVITY: 'check-30day-inactivity',
} as const
