// Pure helpers for working with Cloudinary delivery URLs and folders.
// Kept free of the Cloudinary SDK so they can be unit-tested.

// Cloudinary folder segments are restricted, so caller-supplied folders are
// stripped down to [a-zA-Z0-9/_-]. Anything deriving a folder from user data
// MUST go through this, on both the client and the server, or the ownership
// check in /api/upload compares two differently-normalised strings.
//
// Keep in sync with sanitizeFolder()/ownProfileFolder() in the mobile app
// (App/src/lib/mediaUpload.js).
export const sanitizeFolder = (folder) =>
  (typeof folder === 'string' ? folder : '').replace(/[^a-zA-Z0-9/_-]/g, '');

// A move target: sanitised, with empty segments ("a//b", leading or trailing
// "/") collapsed, so it always lands inside team-rotor/. Null if nothing is left.
export function normalizeMoveFolder(folder) {
  const cleaned = sanitizeFolder(folder).split('/').filter(Boolean).join('/');
  return cleaned || null;
}

// Parse a Cloudinary delivery URL into the resource type and public ID that
// the Admin API expects. Null for anything that isn't a Cloudinary upload URL.
//
// Images and videos have public IDs without the file extension; raw files
// (PDFs, models) keep it, so it is only stripped for image/video.
export function parseCloudinaryUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname !== 'res.cloudinary.com') return null;
  const match = u.pathname.match(/^\/[^/]+\/(image|video|raw)\/upload\/(.+)$/);
  if (!match) return null;
  const [, resourceType, rest] = match;

  // The public ID follows the version ("vNNN/"), after any transformation
  // segments. Every URL this app stores has a version, because they all come
  // from Cloudinary's secure_url; an unversioned path is taken as-is.
  const versioned = rest.match(/(?:^|\/)v\d+\/(.+)$/);
  let path = versioned ? versioned[1] : rest;
  if (resourceType !== 'raw') path = path.replace(/\.[^/.]+$/, '');
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  return path ? { resourceType, publicId: path } : null;
}

// The delivery URL the app stores for an uploaded or moved asset: images are
// resized and auto-formatted, videos get bandwidth-saving quality.
export function optimizedDeliveryUrl({ secure_url: url, resource_type: type }) {
  const transform = { image: 'c_limit,w_1200,f_auto,q_auto', video: 'f_auto,q_auto:eco' }[type];
  if (!transform || !url?.includes('/upload/')) return url;
  const [head, tail] = url.split('/upload/');
  return `${head}/upload/${transform}/${tail}`;
}
