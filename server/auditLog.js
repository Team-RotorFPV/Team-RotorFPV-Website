// One shape for every server-written audit_logs entry, and one reader that
// understands it plus the older shapes still stored in Firestore.
//
// Server shape (write it only through buildAuditEntry):
//   { category, action, userEmail, targetEmail, timestamp: Date }
//     category    'role_change' | 'onboarding' | 'account'
//     userEmail   who did it
//     targetEmail who it was done to (null if nobody)
//
// Shapes already in the collection that the reader still handles:
//   legacy role change   { action, userEmail, targetEmail, timestamp: Date }
//   legacy server event  { action, actor, target, timestamp: ISO string }
//   inventory (clients)  { action, userEmail, previousValue?, newValue?, timestamp }

const CATEGORIES = new Set(['role_change', 'onboarding', 'account']);

// How each server action reads in the Logs tab: "<user> <verb> <target>".
const VERBS = {
  join_request_approved: 'approved the join request from',
  team_member_created: 'created team member',
  email_verified: 'verified their email',
  email_migrated: 'moved their account to',
};

export function buildAuditEntry({ category, action, actor, target = null }) {
  if (!CATEGORIES.has(category)) throw new Error(`Unknown audit category: ${category}`);
  if (!action || !actor) throw new Error('Audit entries need an action and an actor');
  return {
    category,
    action,
    userEmail: actor,
    targetEmail: target,
    // A real Date (stored as a Firestore Timestamp), never a string: mixing
    // the two breaks ordering, because Firestore sorts values by type first.
    timestamp: new Date(),
  };
}

// Firestore Timestamp, Date or ISO string -> ISO string (null if unreadable).
export function toIso(value) {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Turn any stored audit_logs document into the row the Logs tab shows.
export function formatAuditLog(id, data) {
  const timestamp = toIso(data.timestamp);
  const base = { id, type: 'audit', timestamp };

  // Account and onboarding events: the current shape, and the old
  // { actor, target } shape that the same events used to be written in.
  if (data.category === 'onboarding' || data.category === 'account' || data.actor) {
    const user = data.userEmail || data.actor || 'unknown';
    const target = data.targetEmail || data.target || null;
    const verb = VERBS[data.action] || data.action;
    return {
      ...base,
      user,
      action: String(data.action || 'event').toUpperCase(),
      target: target || user,
      details: target && target !== user ? `${verb} ${target}` : verb,
    };
  }

  // Role changes: the current shape, and the old one (targetEmail, no category).
  if (data.category === 'role_change' || data.targetEmail) {
    return {
      ...base,
      user: data.userEmail || 'unknown',
      action: 'ROLE_CHANGE',
      target: data.targetEmail,
      details: `${data.action} ${data.targetEmail}`,
    };
  }

  // Everything else comes from the inventory apps' logInventoryAction().
  return {
    ...base,
    user: data.userEmail || 'unknown',
    action: 'INVENTORY_UPDATE',
    target: 'Inventory',
    details: `${data.action}${data.newValue ? ` to ${data.newValue}` : ''}`,
  };
}

// Newest audit entries, correctly ordered across old and new timestamp types.
// A single orderBy('timestamp') would put every string-timestamp entry above
// every Timestamp entry (type order beats value order), so the two types are
// queried separately and merged by real time.
export async function fetchAuditLogs(db, limit) {
  const col = db.collection('audit_logs');
  const [timestamped, legacyStrings] = await Promise.all([
    col.where('timestamp', '>', new Date(0)).orderBy('timestamp', 'desc').limit(limit).get(),
    col.where('timestamp', '>=', '').orderBy('timestamp', 'desc').limit(limit).get(),
  ]);
  return [...timestamped.docs, ...legacyStrings.docs]
    .map((doc) => formatAuditLog(doc.id, doc.data()))
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
    .slice(0, limit);
}
