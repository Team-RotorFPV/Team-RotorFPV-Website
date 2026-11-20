import { db } from '../firebase';
import { auth } from '../firebaseAuth';
import { collection, addDoc } from 'firebase/firestore';
import { API_URL } from './apiUrl';

export { API_URL };

const getIdToken = () => {
  if (!auth.currentUser) {
    throw new Error('Not authenticated. Please sign in again.');
  }
  return auth.currentUser.getIdToken();
};

// POST JSON to the admin backend with the caller's Firebase ID token.
// Returns { ok, data }. Never throws on HTTP status — only on network failure.
export async function apiPost(path, body) {
  const idToken = await getIdToken();
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

// Upload a single file (image/video/pdf) to Cloudinary via the backend.
// Returns { ok, data } where data is the parsed server response.
export async function uploadFile(file, folder) {
  const idToken = await getIdToken();
  const form = new FormData();
  form.append('image', file);
  if (folder) form.append('folder', folder);
  const res = await fetch(`${API_URL}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

// Upload a 3D model (.glb/.gltf) to Supabase Storage via the backend.
// Returns { ok, data } where data is { url, path }.
export async function uploadModel(file, folder) {
  const idToken = await getIdToken();
  const form = new FormData();
  form.append('model', file);
  if (folder) form.append('folder', folder);
  const res = await fetch(`${API_URL}/api/upload-model`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

// Best-effort removal of a 3D model from Supabase Storage by its object path.
// Never throws.
export async function deleteModel(path) {
  if (!path) return;
  try {
    const { ok, data } = await apiPost('/api/delete-model', { path });
    if (!ok) throw new Error(data.error || 'Model delete failed');
  } catch (error) {
    console.error({
      action: 'model_delete_failed',
      path,
      error: error.message || error,
      timestamp: new Date().toISOString(),
    });
  }
}

// Best-effort removal of an uploaded asset from Cloudinary.
// No-ops for externally pasted (non-Cloudinary) URLs; never throws.
export async function deleteCloudinaryImage(url) {
  if (!url || !url.includes('res.cloudinary.com')) return;
  try {
    const { ok, data } = await apiPost('/api/delete-asset', { url });
    if (!ok) {
      throw new Error(data.error || 'Cloudinary delete failed');
    }
  } catch (error) {
    console.error({
      action: 'cloudinary_delete_failed',
      url,
      error: error.message || error,
      timestamp: new Date().toISOString(),
    });
  }
}

// Move a Cloudinary asset into a different folder (e.g. when switching an event
// between Upcoming/Past). Returns the new optimized URL, or the original URL
// unchanged for non-Cloudinary links or on failure (best-effort, never throws).
export async function moveCloudinaryImage(url, toFolder) {
  if (!url || !url.includes('res.cloudinary.com')) return url;
  try {
    const { ok, data } = await apiPost('/api/move-asset', { url, toFolder });
    if (ok && data.secure_url) return data.secure_url;
    return url;
  } catch (error) {
    console.error({
      action: 'cloudinary_move_failed',
      url,
      toFolder,
      error: error.message || error,
      timestamp: new Date().toISOString(),
    });
    return url;
  }
}

// GET JSON from the admin backend with the caller's Firebase ID token.
// Returns { ok, data }. Never throws on HTTP status — only on network failure.
export async function apiGet(path) {
  const idToken = await getIdToken();
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

// Fetch the visitor-analytics summary for the Traffic tab.
export async function fetchAnalytics() {
  const { ok, data } = await apiGet('/api/analytics');
  if (!ok) throw new Error(data.error || 'Failed to load analytics');
  return data;
}

// Fetch the list of admins. Returns an array (empty on failure).
export async function fetchAdmins() {
  const idToken = await getIdToken();
  const res = await fetch(`${API_URL}/api/admins`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.admins || [];
}

// Log an action to activity_logs collection for the LogsTab feed.
// Details string is a brief summary of what happened.
export async function logAdminAction(actionType, targetType, details) {
  try {
    if (!auth.currentUser) return;
    await addDoc(collection(db, 'activity_logs'), {
      userEmail: auth.currentUser.email,
      actionType,
      targetType,
      details,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to log admin action:', error);
  }
}

// Fetch unified logs
export async function fetchLogs() {
  const { ok, data } = await apiGet('/api/logs');
  if (!ok) throw new Error(data.error || 'Failed to fetch logs');
  return data.logs || [];
}

// The admin / super-admin rights a set of tag IDs grants.
export function permissionsFromTags(selectedTagIds, allTags) {
  let admin = false;
  let superAdmin = false;
  for (const tagId of selectedTagIds || []) {
    const tag = allTags.find(t => t.id === tagId);
    if (tag?.grantsAdmin) admin = true;
    if (tag?.grantsSuperAdmin) {
      admin = true; // Super admin implies admin
      superAdmin = true;
    }
  }
  return { admin, superAdmin };
}

// Synchronize a user's admin/super-admin claims with their tags.
// email: The user's email
// selectedTagIds: Array of tag IDs the user currently has
// allTags: Array of all tag objects from Firestore
// currentAdmins: Array of all admin objects from /api/admins
//
// Throws if any server call fails, with the server's reason. Before, every
// result was ignored, so the tags in Firestore and the real claims could
// drift apart with nobody told.
export async function syncUserPermissions(email, selectedTagIds, allTags, currentAdmins) {
  const target = permissionsFromTags(selectedTagIds, allTags);
  const currentAdminRec = currentAdmins.find(a => a.email === email);

  // Safety check: Never demote root through this UI
  if (currentAdminRec?.isRoot) {
    return;
  }

  const currentIsAdmin = !!currentAdminRec;
  const currentIsSuperAdmin = currentAdminRec?.isSuperAdmin || false;

  const steps = [];
  if (target.admin && !currentIsAdmin) steps.push('/api/setAdmin');
  else if (!target.admin && currentIsAdmin) steps.push('/api/removeAdmin');
  if (target.superAdmin && !currentIsSuperAdmin) steps.push('/api/setSuperAdmin');
  // removeAdmin already clears the super-admin claim.
  else if (!target.superAdmin && currentIsSuperAdmin && target.admin) steps.push('/api/removeSuperAdmin');

  for (const path of steps) {
    const { ok, data } = await apiPost(path, { email });
    if (!ok) {
      throw new Error(`Saved, but permissions for ${email} were not updated: ${data.error || 'server error'}. Their tags and access now differ; fix the tags and save again.`);
    }
  }
}
