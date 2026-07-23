/**
 * Idempotent migration: align `users` collection to the canonical shared schema.
 *
 * Usage:
 *   DRY_RUN=1 MONGODB_URI=mongodb://... node scripts/migrate-users-canonical.js
 *   MONGODB_URI=mongodb://... node scripts/migrate-users-canonical.js
 *
 * Safe to re-run. Does not delete unknown fields.
 */
/* eslint-disable no-console */

const { MongoClient } = require('mongodb');

const URI =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  'mongodb://localhost:27017/tract';
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

function pickFirst(doc, keys) {
  for (const k of keys) {
    if (doc[k] !== undefined && doc[k] !== null) return doc[k];
  }
  return undefined;
}

function mapKyc(value) {
  if (value === 'verified') return 'approved';
  if (value === 'manual_review') return 'in_progress';
  if (
    value === 'pending' ||
    value === 'in_progress' ||
    value === 'approved' ||
    value === 'rejected'
  ) {
    return value;
  }
  return 'pending';
}

function buildUpdate(doc) {
  const $set = {};
  const $unset = {};

  const rename = (from, to, transform) => {
    if (doc[from] !== undefined && doc[to] === undefined) {
      $set[to] = transform ? transform(doc[from]) : doc[from];
      $unset[from] = '';
    } else if (doc[from] !== undefined && doc[to] !== undefined) {
      // Prefer canonical; drop legacy
      $unset[from] = '';
    }
  };

  rename('full_name', 'fullName');
  rename('state_code', 'stateCode', (v) =>
    typeof v === 'string' ? v.toUpperCase() : v,
  );
  rename('password_hash', 'passwordHash');
  rename('password', 'passwordHash');
  rename('kyc_status', 'kycStatus', mapKyc);
  rename('bank_verified', 'bankVerified');
  rename('reliability_score', 'reliabilityScore');
  rename('professional_score', 'professionalScore');
  rename('is_banned', 'isBanned');
  rename('ban_reason', 'banReason');
  rename('last_active_at', 'lastActiveAt');
  rename('deleted_at', 'deletedAt');
  rename('current_session_id', 'currentSessionId');
  rename('restriction_status', 'restrictionStatus');
  rename('restricted_until', 'scoreRestrictedUntil');
  rename('deal_count', 'app1_totalDealsClosed');

  // Normalize existing camelCase KYC if legacy value slipped in
  if (doc.kycStatus === 'verified') {
    $set.kycStatus = 'approved';
  }
  if (doc.kyc_status !== undefined && doc.kycStatus === undefined) {
    $set.kycStatus = mapKyc(doc.kyc_status);
    $unset.kyc_status = '';
  }

  // Drop OTP fields stored on user (now Redis)
  for (const k of ['otp_code', 'otp_expires_at', 'otp_purpose']) {
    if (doc[k] !== undefined) $unset[k] = '';
  }

  // Ensure defaults
  if (pickFirst(doc, ['fullName', 'full_name']) === undefined) {
    // leave as-is; required field handled by app validation
  }
  if (
    doc.restrictionStatus === undefined &&
    doc.restriction_status === undefined &&
    !$set.restrictionStatus
  ) {
    $set.restrictionStatus = 'normal';
  }
  if (
    doc.isBanned === undefined &&
    doc.is_banned === undefined &&
    !$set.isBanned
  ) {
    $set.isBanned = false;
  }

  const update = {};
  if (Object.keys($set).length) update.$set = $set;
  if (Object.keys($unset).length) update.$unset = $unset;
  return update;
}

async function main() {
  console.log(`Connecting to ${URI}`);
  console.log(DRY_RUN ? 'DRY RUN — no writes' : 'LIVE — applying updates');

  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db();
  const users = db.collection('users');

  const cursor = users.find({});
  let scanned = 0;
  let wouldUpdate = 0;
  let updated = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    scanned += 1;
    const update = buildUpdate(doc);
    if (!update.$set && !update.$unset) continue;
    wouldUpdate += 1;
    console.log(
      `${DRY_RUN ? '[dry]' : '[write]'} ${doc._id} ${JSON.stringify(update)}`,
    );
    if (!DRY_RUN) {
      await users.updateOne({ _id: doc._id }, update);
      updated += 1;
    }
  }

  console.log(
    JSON.stringify({ scanned, wouldUpdate, updated, dryRun: DRY_RUN }, null, 2),
  );
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
