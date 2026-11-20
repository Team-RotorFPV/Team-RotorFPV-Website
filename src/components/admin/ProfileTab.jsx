import React, { useState, useEffect, useRef } from 'react';
import { doc, onSnapshot, updateDoc, setDoc, collection, query, orderBy, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { logAdminAction, uploadFile, fetchAdmins, syncUserPermissions, permissionsFromTags, apiPost } from '../../lib/adminApi';
import { expandTagIds, getGrantedTagIds, buildReadableMirrors } from '../../lib/tagGrants';

const ProfileTab = ({ user }) => {
  const [loading, setLoading] = useState(true);
  const [profileData, setProfileData] = useState(null);
  const [formData, setFormData] = useState({});
  const [customFields, setCustomFields] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  
  // Migration State
  const [showMigrate, setShowMigrate] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [migrateMsg, setMigrateMsg] = useState('');
  
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!user || !user.email) return;
    const userEmail = user.email.toLowerCase();
    
    const unsubFields = onSnapshot(query(collection(db, 'custom_fields'), orderBy('name', 'asc')), (snap) => {
      setCustomFields(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Error fetching custom fields:", error);
    });

    const unsubTags = onSnapshot(collection(db, 'tags'), (snap) => {
      setAllTags(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Error fetching tags:", error);
    });

    if (user.isSuperAdmin) {
      fetchAdmins().then(setAdmins).catch(console.error);
    }

    const docRef = doc(db, 'users', userEmail);
    const unsubProfile = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setProfileData(data);
        // Only set form data if we don't have unsaved edits
        setFormData((prev) => {
            const hasEdits = prev.name !== undefined;
            if (!hasEdits) {
                return {
                    name: data.name || '',
                    roomNumber: data.roomNumber || '',
                    jobTitle: data.jobTitle || '',
                    linkedin: data.linkedin || '',
                    github: data.github || '',
                    image: data.image || '',
                    tags: data.tags || [],
                    customFields: data.customFields || {},
                };
            }
            return prev;
        });
      } else {
        setProfileData({});
        setFormData({
          name: '',
          roomNumber: '',
          jobTitle: '',
          linkedin: '',
          github: '',
          image: '',
          tags: [],
          customFields: {}
        });
      }
      setLoading(false);
    }, (error) => {
      console.error("Error fetching profile:", error);
      setErrorMsg("Failed to load profile. Please check your permissions.");
      setLoading(false);
    });

    return () => {
      unsubFields();
      unsubTags();
      unsubProfile();
    };
  }, [user]);

  const isDirty = profileData && (
    formData.name !== (profileData.name || '') ||
    formData.roomNumber !== (profileData.roomNumber || '') ||
    formData.jobTitle !== (profileData.jobTitle || '') ||
    formData.linkedin !== (profileData.linkedin || '') ||
    formData.github !== (profileData.github || '') ||
    formData.image !== (profileData.image || '') ||
    (user.isSuperAdmin && JSON.stringify(formData.tags || []) !== JSON.stringify(profileData.tags || [])) ||
    JSON.stringify(formData.customFields || {}) !== JSON.stringify(profileData.customFields || {})
  );

  const handleCustomFieldChange = (fieldId, value) => {
    setFormData(prev => ({
      ...prev,
      customFields: {
        ...(prev.customFields || {}),
        [fieldId]: value
      }
    }));
  };

  const handleTagToggle = (tagId) => {
    setFormData(prev => {
      const current = prev.tags || [];
      if (current.includes(tagId)) {
        return { ...prev, tags: current.filter(id => id !== tagId) };
      } else {
        const tag = allTags.find(t => t.id === tagId);
        const granted = getGrantedTagIds(tag, allTags);
        const toAdd = [tagId, ...granted].filter(id => !current.includes(id));
        return { ...prev, tags: [...current, ...toAdd] };
      }
    });
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const folder = `users/${user.email}`;
      const { ok, data: uploadedImage } = await uploadFile(file, folder);
      if (ok && uploadedImage.secure_url) {
        setFormData(prev => ({ ...prev, image: uploadedImage.secure_url }));
      } else {
        alert(uploadedImage.error || "Upload failed.");
      }
    } catch (error) {
      console.error("Upload error:", error);
      alert("Error uploading image.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleMigrateRequest = async () => {
    if (!newEmail.trim()) {
      setMigrateMsg("Please enter a new email.");
      return;
    }
    if (newEmail.trim().toLowerCase() === user.email.toLowerCase()) {
      setMigrateMsg("Please enter a different email.");
      return;
    }
    setMigrateMsg("Sending request...");
    try {
      const res = await apiPost('/api/migrate/request', { newEmail: newEmail.trim() });
      if (!res.ok) {
        setMigrateMsg(res.data?.error || "Failed to send migration request.");
      } else {
        setMigrateMsg(`Verification email sent to ${newEmail.trim()}.`);
        setNewEmail('');
        setTimeout(() => setShowMigrate(false), 3000);
      }
    } catch {
      setMigrateMsg("An error occurred.");
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!isDirty) return;

    setIsSaving(true);
    try {
      const userEmail = user.email.toLowerCase();
      const payload = {
        name: formData.name.trim(),
        roomNumber: formData.roomNumber.trim(),
        jobTitle: formData.jobTitle.trim(),
        linkedin: formData.linkedin.trim(),
        github: formData.github.trim(),
        image: formData.image.trim(),
        customFields: formData.customFields,
        customFieldsReadable: buildReadableMirrors([], allTags, formData.customFields, customFields).customFieldsReadable,
        email: userEmail,
        updatedAt: new Date().toISOString(),
      };

      if (user.isSuperAdmin) {
        payload.tags = expandTagIds(formData.tags || [], allTags);
        payload.tagNames = buildReadableMirrors(payload.tags, allTags, {}, customFields).tagNames;
        // The server refuses self-demotion, so saving these tags would leave
        // the doc saying "not super admin" while the claims still say it is.
        if (!permissionsFromTags(payload.tags, allTags).superAdmin && !admins.find(a => a.email === userEmail)?.isRoot) {
          alert("You can't remove your own Super Admin access. Ask another Super Admin to do it.");
          return;
        }
      }

      const docRef = doc(db, 'users', userEmail);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        await updateDoc(docRef, payload);
      } else {
        await setDoc(docRef, payload);
      }
      
      if (user.isSuperAdmin) {
        await syncUserPermissions(userEmail, payload.tags, allTags, admins);
      }
      
      await logAdminAction('user_profile_updated', userEmail, `Updated own profile`, {
        target: userEmail
      });

      setToast('✓ Profile updated successfully.');
      setTimeout(() => setToast(''), 3000);
      setProfileData(payload); // reset dirty state immediately
    } catch (error) {
      console.error("Error saving profile:", error);
      alert(error.message?.startsWith('Saved, but') ? error.message : "Failed to save profile. Make sure you're authorized.");
    } finally {
      setIsSaving(false);
    }
  };

  // Auto-save protection hook
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  if (loading) {
    return (
      <div className="admin-glass-panel form-panel">
        <h2 style={{ marginBottom: '20px' }}>My Profile</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} className="skeleton" />
          <div style={{ width: '100%', height: '40px', background: 'rgba(255,255,255,0.1)', borderRadius: '8px' }} className="skeleton" />
          <div style={{ width: '100%', height: '40px', background: 'rgba(255,255,255,0.1)', borderRadius: '8px' }} className="skeleton" />
        </div>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="admin-glass-panel form-panel">
        <h2 style={{ marginBottom: '20px' }}>Access Error</h2>
        <p style={{ color: '#ff4d4f' }}>{errorMsg}</p>
        <p style={{ marginTop: '10px' }}>If you just signed in, you may need to reload the page or contact a Super Admin.</p>
      </div>
    );
  }

  return (
    <div className="admin-grid">
      <div className="admin-left-column">
        <div className="admin-glass-panel form-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2>My Profile</h2>
            {toast && <span style={{ color: '#64ffda', fontSize: '0.9rem' }}>{toast}</span>}
          </div>
          
          <form onSubmit={handleSave} className="admin-form">
            <div className="form-group" style={{ position: 'relative' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label>Email (Read-only)</label>
                {!showMigrate && (
                  <button type="button" onClick={() => setShowMigrate(true)} className="admin-btn secondary" style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
                    Migrate Account
                  </button>
                )}
              </div>
              <input
                type="email"
                value={user.email}
                disabled
                style={{ opacity: 0.7, cursor: 'not-allowed', marginTop: '5px' }}
              />
              {showMigrate && (
                <div style={{ marginTop: '10px', padding: '15px', background: 'rgba(100, 255, 218, 0.05)', border: '1px solid rgba(100, 255, 218, 0.2)', borderRadius: '8px' }}>
                  <label style={{ fontSize: '0.85rem', marginBottom: '5px' }}>New Email Address</label>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="Enter new email..."
                      style={{ flex: 1 }}
                    />
                    <button type="button" onClick={handleMigrateRequest} className="admin-btn primary">Verify</button>
                    <button type="button" onClick={() => { setShowMigrate(false); setMigrateMsg(''); }} className="admin-btn secondary">Cancel</button>
                  </div>
                  {migrateMsg && <p style={{ color: '#64ffda', fontSize: '0.8rem', marginTop: '8px' }}>{migrateMsg}</p>}
                </div>
              )}
            </div>
            
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={formData.name || ''}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                required
              />
            </div>

            <div className="form-group">
              <label>Room Number</label>
              <input
                type="text"
                value={formData.roomNumber || ''}
                onChange={(e) => setFormData({...formData, roomNumber: e.target.value})}
                placeholder="e.g. A-102"
              />
            </div>

            <div className="form-group">
              <label>Job Title / Current Status</label>
              <input
                type="text"
                value={formData.jobTitle || ''}
                onChange={(e) => setFormData({...formData, jobTitle: e.target.value})}
                placeholder="e.g. Software Engineer at Google"
              />
            </div>

            <div className="form-row" style={{ display: 'flex', gap: '10px' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>LinkedIn URL</label>
                <input
                  type="url"
                  value={formData.linkedin || ''}
                  onChange={(e) => setFormData({...formData, linkedin: e.target.value})}
                  placeholder="https://linkedin.com/in/..."
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>GitHub URL</label>
                <input
                  type="url"
                  value={formData.github || ''}
                  onChange={(e) => setFormData({...formData, github: e.target.value})}
                  placeholder="https://github.com/..."
                />
              </div>
            </div>

            <div className="form-group">
              <label>Profile Image</label>
              <div className="file-upload">
                <input
                  type="file"
                  accept="image/*,.heic,.heif"
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                  disabled={isUploading}
                />
                {isUploading && <span className="upload-status">Uploading…</span>}
              </div>
              <div className="input-divider">or</div>
              <input
                type="url"
                value={formData.image || ''}
                onChange={(e) => setFormData({...formData, image: e.target.value})}
                placeholder="Paste an image URL directly"
              />
              {formData.image && (
                <div className="image-preview achievement" style={{ marginTop: '10px' }}>
                  <img src={formData.image} alt="Profile Preview" style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover' }} />
                </div>
              )}
            </div>

            {customFields.length > 0 && (
              <>
                {customFields.map(field => (
                  <div className="form-group" key={field.id}>
                    <label>{field.name}</label>
                    <input
                      type="text"
                      value={formData.customFields?.[field.id] || ''}
                      onChange={(e) => handleCustomFieldChange(field.id, e.target.value)}
                    />
                  </div>
                ))}
              </>
            )}

            <div className="form-actions" style={{ marginTop: '30px' }}>
              <button 
                type="submit" 
                className="admin-btn primary" 
                disabled={!isDirty || isSaving || isUploading}
                style={{ opacity: (!isDirty || isSaving || isUploading) ? 0.5 : 1 }}
              >
                {isSaving ? 'Saving...' : 'Save Profile'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="admin-right-column">
        <div className="admin-glass-panel">
          <h2>Your Permissions</h2>
          <p className="panel-desc">These are managed by the Super Admin.</p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px' }}>
            <div className="form-group">
              <label>Tags</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '5px' }}>
                {user.isSuperAdmin ? (
                  allTags.length > 0 ? (
                    allTags.map(tag => (
                      <label key={tag.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.05)', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.9rem' }}>
                        <input
                          type="checkbox"
                          checked={(formData.tags || []).includes(tag.id)}
                          onChange={() => handleTagToggle(tag.id)}
                        />
                        {tag.name}
                      </label>
                    ))
                  ) : (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>No tags have been created yet.</span>
                  )
                ) : (
                  profileData?.tags && profileData.tags.length > 0 ? (
                    profileData.tags.map(tid => {
                      const tagObj = allTags.find(t => t.id === tid);
                      return (
                        <span key={tid} className="role-badge" style={{ background: 'rgba(255,255,255,0.1)' }}>
                          {tagObj ? tagObj.name : tid}
                        </span>
                      );
                    })
                  ) : (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>No tags assigned.</span>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileTab;
