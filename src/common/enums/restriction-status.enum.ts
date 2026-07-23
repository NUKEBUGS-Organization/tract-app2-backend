/** Score-driven access restriction — shared with App 1. App 2 may ignore. */
export enum RestrictionStatus {
  NORMAL = 'normal',
  DELAYED_ACCESS = 'delayed_access',
  BANNED = 'banned',
  REINSTATEMENT_REQUIRED = 'reinstatement_required',
}
