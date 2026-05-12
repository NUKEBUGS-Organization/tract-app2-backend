export enum BidStatus {
  ACTIVE = 'active', // bid placed, not yet selected
  PRIMARY = 'primary', // selected as #1 — under contract
  BACKUP_2 = 'backup_2', // selected as backup position 2
  BACKUP_3 = 'backup_3', // selected as backup position 3
  WORKING = 'working', // not selected — visible to bidder only
  REJECTED = 'rejected', // explicitly rejected by wholesaler
}
