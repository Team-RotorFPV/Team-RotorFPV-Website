// Validation for the super-admin endpoints that provision team members
// (/api/admin/requests/approve and /api/admin/users/create).
//
// Both used to read req.body straight into Firestore: a missing email crashed
// with a TypeError (after approve had already marked the request approved),
// and tags/customFields were stored with whatever shape the client sent.

const EMAIL_RE = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;
const DOC_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_TAGS = 50;
const MAX_CUSTOM_FIELDS = 50;
const MAX_FIELD_VALUE = 1000;

export class InputError extends Error {}

// Lowercased, trimmed email suitable as a users/{email} doc ID.
export function parseEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    throw new InputError('A valid email address is required');
  }
  return email;
}

function parseTags(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_TAGS || !value.every((id) => typeof id === 'string' && DOC_ID_RE.test(id))) {
    throw new InputError('tags must be a list of tag IDs');
  }
  return [...new Set(value)];
}

function parseCustomFields(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new InputError('customFields must be an object');
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_CUSTOM_FIELDS) throw new InputError('Too many custom fields');
  for (const [key, field] of entries) {
    const okValue = field === null || typeof field === 'boolean' || typeof field === 'number'
      || (typeof field === 'string' && field.length <= MAX_FIELD_VALUE);
    if (!DOC_ID_RE.test(key) || !okValue) {
      throw new InputError('customFields must map field IDs to short text, number or yes/no values');
    }
  }
  return Object.fromEntries(entries);
}

function parseName(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > 100) throw new InputError('name must be text of at most 100 characters');
  return value.trim();
}

// Body of POST /api/admin/users/create.
export function parseCreateMember(body = {}) {
  return {
    email: parseEmail(body.email),
    tags: parseTags(body.tags),
    customFields: parseCustomFields(body.customFields),
  };
}

// Body of POST /api/admin/requests/approve.
export function parseApproveRequest(body = {}) {
  if (typeof body.requestId !== 'string' || !DOC_ID_RE.test(body.requestId)) {
    throw new InputError('A valid requestId is required');
  }
  return {
    requestId: body.requestId,
    name: parseName(body.name),
    ...parseCreateMember(body),
  };
}
