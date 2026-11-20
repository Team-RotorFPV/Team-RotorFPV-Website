import React, { useState, useEffect } from 'react';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, orderBy, getDocs, updateDoc, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { logAdminAction, fetchAdmins, apiPost, syncUserPermissions } from '../../lib/adminApi';
import { expandTagIds, getGrantedTagIds, buildReadableMirrors } from '../../lib/tagGrants';
import TagsTab from './TagsTab';
import CustomFieldsTab from './CustomFieldsTab';

const TeamMembersTab = ({ user }) => {
  const [subTab, setSubTab] = useState('members');
  const [selectedTagFilter, setSelectedTagFilter] = useState('all');
  const [users, setUsers] = useState([]);
  const [tags, setTags] = useState([]);
  const [customFields, setCustomFields] = useState([]);
  const [admins, setAdmins] = useState([]); 
  const [joinRequests, setJoinRequests] = useState([]);
  
  const [editingEmail, setEditingEmail] = useState(null);
  
  const [formData, setFormData] = useState({
    email: '',
    tags: [],
    customFields: {}
  });

  const refreshAdmins = async () => {
    try {
      setAdmins(await fetchAdmins());
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    const unsubFields = onSnapshot(query(collection(db, 'custom_fields'), orderBy('name', 'asc')), (snap) => {
      setCustomFields(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    
    const unsubTags = onSnapshot(query(collection(db, 'tags'), orderBy('name', 'asc')), (snap) => {
      setTags(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const unsubRequests = onSnapshot(query(collection(db, 'join_requests'), where('status', '==', 'pending')), (snap) => {
      setJoinRequests(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    fetchAdmins().then(setAdmins).catch((error) => console.error(error));

    return () => {
      unsubFields();
      unsubTags();
      unsubUsers();
      unsubRequests();
    };
  }, []);

  const handleStartAdd = () => {
    setEditingEmail('__new__');
    setFormData({ email: '', tags: [], customFields: {} });
  };

  const handleStartEdit = (usr) => {
    setEditingEmail(usr.email);
    setFormData({
      email: usr.email || '',
      tags: usr.tags || [],
      customFields: usr.customFields || {}
    });
  };

  const handleCancelEdit = () => {
    setEditingEmail(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formData.email.trim()) return;

    try {
      const email = formData.email.trim().toLowerCase();

      const expandedTags = expandTagIds(formData.tags, tags);
      const { tagNames, customFieldsReadable } = buildReadableMirrors(expandedTags, tags, formData.customFields, customFields);
      const payload = {
        email,
        tags: expandedTags,
        tagNames,
        customFields: formData.customFields,
        customFieldsReadable,
      };

      const isNew = editingEmail === '__new__';
      const isEmailChanged = !isNew && email !== editingEmail;
      
      if (isNew) {
        const res = await apiPost('/api/admin/users/create', payload);
        if (!res.ok) throw new Error(res.data?.error || "Failed to create user");
        alert(`User created. A verification email has been sent to ${email}.`);
      } else {
        await setDoc(doc(db, 'users', email), payload, { merge: true });
      }

      await syncUserPermissions(email, payload.tags, tags, admins);
      
      if (isEmailChanged) {
        // Remove old permissions for the previous email
        await syncUserPermissions(editingEmail, [], tags, admins);
        
        // Delete the old user document
        await deleteDoc(doc(db, 'users', editingEmail));
        
        // Update all related team_member records to the new email/userId
        const qTeamMembers = query(collection(db, 'team_members'), where('userId', '==', editingEmail));
        const tmSnap = await getDocs(qTeamMembers);
        for (const tmDoc of tmSnap.docs) {
          await updateDoc(doc(db, 'team_members', tmDoc.id), { userId: email });
        }
      }

      await refreshAdmins();
      
      if (!isNew && isEmailChanged) {
        await logAdminAction('team_member_updated', 'system', `Changed team member email from ${editingEmail} to ${email}`);
      } else if (!isNew) {
        await logAdminAction('team_member_updated', 'system', `Updated team member: ${email}`);
      }

      setEditingEmail(null);
    } catch (error) {
      console.error("Error saving user:", error);
      alert(error.message || "Failed to save user");
    }
  };

  const handleDelete = async (email) => {
    if (email === user.email) {
      alert("You cannot delete your own profile.");
      return;
    }
    const currentAdminRec = admins.find(a => a.email === email);
    if (currentAdminRec?.isRoot) {
      alert("You cannot delete the Root Super Admin.");
      return;
    }

    // Check if member is already archived — if so, permanently delete
    const targetUser = users.find(u => u.email === email);
    const isAlreadyArchived = targetUser?.isArchived === true;

    if (isAlreadyArchived) {
      if (!window.confirm(`Permanently delete ${email}? This cannot be undone.`)) return;
      try {
        await deleteDoc(doc(db, 'users', email));
        await syncUserPermissions(email, [], tags, admins);
        await logAdminAction('team_member_deleted', 'system', `Permanently deleted archived member: ${email}`);
      } catch (error) {
        console.error("Error permanently deleting user:", error);
        alert("Failed to permanently delete user");
      }
    } else {
      if (!window.confirm(`Archive ${email}? This will remove their permissions. You can permanently delete them afterwards.`)) return;
      try {
        await syncUserPermissions(email, [], tags, admins);
        await setDoc(doc(db, 'users', email), { isActive: false, isArchived: true, tags: [] }, { merge: true });
        await logAdminAction('team_member_archived', 'system', `Archived team member: ${email}`);
      } catch (error) {
        console.error("Error archiving user:", error);
        alert("Failed to archive user");
      }
    }
  };

  const handleRestore = async (email) => {
    if (!window.confirm(`Restore profile for ${email}?`)) return;
    try {
      await setDoc(doc(db, 'users', email), { isActive: true, isArchived: false }, { merge: true });
      await logAdminAction('team_member_restored', 'system', `Restored team member: ${email}`);
    } catch (error) {
      console.error("Error restoring user:", error);
      alert("Failed to restore user");
    }
  };

  const handleAcceptRequest = async (req) => {
    if (!window.confirm(`Accept request for ${req.name} (${req.email})?`)) return;
    try {
      const payload = {
        requestId: req.id,
        email: req.email,
        name: req.name || '',
        tags: [],
        customFields: req.customFields || {}
      };
      
      const res = await apiPost('/api/admin/requests/approve', payload);
      if (!res.ok) throw new Error(res.data?.error || "Failed to accept request");
      
      alert("Request accepted. A verification email has been sent to the user.");
    } catch (err) {
      console.error("Error accepting request:", err);
      alert("Failed to accept request.");
    }
  };

  const handleRejectRequest = async (reqId) => {
    if (!window.confirm("Reject and delete this request?")) return;
    try {
      await updateDoc(doc(db, 'join_requests', reqId), { status: 'rejected' });
    } catch (err) {
      console.error("Error rejecting request:", err);
      alert("Failed to reject request.");
    }
  };



  const handleTagToggle = (tagId) => {
    setFormData(prev => {
      const current = prev.tags || [];
      if (current.includes(tagId)) {
        return { ...prev, tags: current.filter(id => id !== tagId) };
      } else {
        const tag = tags.find(t => t.id === tagId);
        const granted = getGrantedTagIds(tag, tags);
        const toAdd = [tagId, ...granted].filter(id => !current.includes(id));
        return { ...prev, tags: [...current, ...toAdd] };
      }
    });
  };

  const handleCustomFieldChange = (fieldId, value) => {
    setFormData(prev => ({
      ...prev,
      customFields: {
        ...(prev.customFields || {}),
        [fieldId]: value
      }
    }));
  };

  // Check roles from adminApi
  const getRoleBadges = (email) => {
    const adminRec = admins.find(a => a.email === email);
    if (!adminRec) return null;
    return (
      <>
        {adminRec.isRoot && <span className="role-badge root">Root</span>}
      </>
    );
  };

  if (subTab === 'tags') {
    return (
      <div style={{ marginTop: '-1rem' }}>
        <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem' }}>
          <button className={`admin-btn ${subTab === 'members' ? 'primary' : 'secondary'}`} onClick={() => setSubTab('members')}>Back to Members</button>
        </div>
        <TagsTab />
      </div>
    );
  }

  if (subTab === 'fields') {
    return (
      <div style={{ marginTop: '-1rem' }}>
        <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem' }}>
          <button className={`admin-btn ${subTab === 'members' ? 'primary' : 'secondary'}`} onClick={() => setSubTab('members')}>Back to Members</button>
        </div>
        <CustomFieldsTab />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', gap: '1rem' }}>
        <button className={`admin-btn ${subTab === 'tags' ? 'primary' : 'secondary'}`} onClick={() => setSubTab('tags')}>Manage Tags & Permissions</button>
        <button className={`admin-btn ${subTab === 'fields' ? 'primary' : 'secondary'}`} onClick={() => setSubTab('fields')}>Manage Dynamic Fields</button>
      </div>
      
      <div className="admin-grid">
        <div className="admin-left-column">
        {editingEmail ? (
          <div className="admin-glass-panel form-panel">
            <h2>{editingEmail === '__new__' ? 'Create Team Member' : `Edit Member: ${editingEmail}`}</h2>
            <form onSubmit={handleSave} className="admin-form">
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                  required
                  disabled={editingEmail !== '__new__'}
                  style={editingEmail !== '__new__' ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
                />
              </div>

              {editingEmail === '__new__' && customFields.length > 0 && (
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

              {tags.length > 0 ? (
                <>
                  <h3 style={{ fontSize: '0.95rem', margin: '20px 0 10px' }}>Tags & Permissions</h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {tags.map(tag => (
                      <label key={tag.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.05)', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={(formData.tags || []).includes(tag.id)}
                          onChange={() => handleTagToggle(tag.id)}
                        />
                        {tag.name}
                      </label>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <h3 style={{ fontSize: '0.95rem', margin: '20px 0 10px' }}>Tags & Permissions</h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>No tags have been created yet. Click "Manage Tags & Permissions" at the top to create tags.</p>
                </>
              )}

              <div className="form-actions">
                <button type="submit" className="admin-btn primary">Save Member</button>
                <button type="button" onClick={handleCancelEdit} className="admin-btn secondary">Cancel</button>
              </div>
            </form>
          </div>
        ) : (
          <>
            <div className="admin-glass-panel">
              <h2>Team Members</h2>
              <p className="panel-desc">Manage your entire team, their tags, and permissions. Assigning Admin/Super Admin tags will automatically sync their backend privileges.</p>
              <button onClick={handleStartAdd} className="admin-btn primary">Add New Team Member</button>
            </div>

            <div className="admin-glass-panel list-panel" style={{ marginTop: '24px', border: '1px solid rgba(100, 255, 218, 0.4)' }}>
              <h2 style={{ color: 'var(--accent)' }}>Pending Join Requests ({joinRequests.length})</h2>
              
              {joinRequests.length === 0 ? (
                <p className="empty-state" style={{ padding: '20px' }}>No pending requests.</p>
              ) : (
                <div className="achievements-list" style={{ maxHeight: '40vh' }}>
                  {joinRequests.map(req => (
                    <div key={req.id} className="admin-achievement-card admin-user-card" style={{ flexDirection: 'column', alignItems: 'flex-start', margin: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                        <div>
                          <h3 style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>{req.name}</h3>
                          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>{req.email}</div>
                          {req.customFields && Object.entries(req.customFields).map(([fieldId, value]) => {
                            const fieldName = customFields.find(f => f.id === fieldId)?.name || fieldId;
                            return (
                              <div key={fieldId} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                {fieldName}: {value}
                              </div>
                            );
                          })}
                        </div>
                        <div className="card-actions">
                          <button onClick={() => handleAcceptRequest(req)} className="admin-btn primary small">Accept</button>
                          <button onClick={() => handleRejectRequest(req.id)} className="admin-btn cancel small">Reject</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="admin-right-column">
        <div className="admin-glass-panel list-panel">
          <div style={{ width: '100%', marginBottom: '20px', display: 'flex', gap: '15px', alignItems: 'center' }}>
            <label style={{ color: '#64ffda', fontWeight: 'bold' }}>Filter by Group:</label>
            <select 
              value={selectedTagFilter} 
              onChange={(e) => setSelectedTagFilter(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid rgba(100, 255, 218, 0.3)',
                background: 'rgba(10, 25, 47, 0.8)',
                color: '#e6f1ff',
                outline: 'none',
                minWidth: '200px',
                cursor: 'pointer'
              }}
            >
              <option value="all">All Members</option>
              <option value="untagged">Untagged Members</option>
              <option value="archived">Archived Members</option>
              {tags.filter(t => t.isGroup !== false).map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="achievements-list">
            {(() => {
              // Merge users and admins so that existing admins without profiles are visible
              // We now include ALL users (not just active ones) so unverified and archived members can be managed.
              const mergedMembers = [...users];
              admins.forEach(admin => {
                if (!mergedMembers.find(u => u.email === admin.email)) {
                  mergedMembers.push({ email: admin.email, name: 'Incomplete Profile', isOrphanedAdmin: true, tags: [] });
                }
              });

              if (mergedMembers.length === 0) {
                return <p className="empty-state">No team members found.</p>;
              }

              const renderMemberCard = (usr) => (
                <div key={usr.email} className="admin-achievement-card admin-user-card" style={{ flexDirection: 'column', alignItems: 'flex-start', margin: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <div>
                      <h3 style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {usr.image && <img src={usr.image} style={{ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover' }} alt="" />}
                        {usr.name || 'Unnamed'} 
                        {usr.isArchived && <span className="role-badge" style={{ background: '#ff4d4f44', color: '#ff4d4f' }}>Archived</span>}
                        {usr.status === 'approved_unverified' && !usr.isArchived && <span className="role-badge" style={{ background: '#faad1444', color: '#faad14' }}>Unverified</span>}
                      </h3>
                      {usr.isOrphanedAdmin && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--warning, #faad14)', marginTop: '4px' }}>
                          This admin doesn't have a full profile yet. Click Edit to create one.
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                        {getRoleBadges(usr.email)}
                        {(usr.tags || []).map(tid => {
                          const t = tags.find(x => x.id === tid);
                          return t ? <span key={tid} className="role-badge" style={{ background: 'rgba(255,255,255,0.1)' }}>{t.name}</span> : null;
                        })}
                      </div>
                    </div>
                    <div className="card-actions">
                      {!usr.isArchived && <button onClick={() => handleStartEdit(usr)} className="admin-btn edit small">Edit</button>}
                      {usr.isArchived ? (
                        <>
                          <button onClick={() => handleRestore(usr.email)} className="admin-btn edit small">Restore</button>
                          <button onClick={() => handleDelete(usr.email)} className="admin-btn delete small" style={{ background: '#ff4d4f', color: '#fff' }}>Permanently Delete</button>
                        </>
                      ) : (
                        <button onClick={() => handleDelete(usr.email)} className="admin-btn delete small">Archive</button>
                      )}
                    </div>
                  </div>
                </div>
              );

              const groups = [];
              if (selectedTagFilter !== 'untagged' && selectedTagFilter !== 'archived') {
                tags.forEach(tag => {
                  // If filtering by a specific group, skip others
                  if (selectedTagFilter !== 'all' && tag.id !== selectedTagFilter) return;

                  const membersInTag = mergedMembers.filter(m => (m.tags || []).includes(tag.id) && !m.isArchived);
                  
                  // Show the group if it has members OR if it was explicitly selected (even if empty)
                  if (membersInTag.length > 0 || selectedTagFilter === tag.id) {
                    groups.push({ tag, members: membersInTag });
                  }
                });
              }

              // Only show untagged members in "All" view or "untagged" view
              // A member is untagged if they have no tags, or all their tags are deleted
              const validTagIds = new Set(tags.map(t => t.id));
              const untaggedMembers = (selectedTagFilter === 'all' || selectedTagFilter === 'untagged')
                ? mergedMembers.filter(m => {
                    const validUserTags = (m.tags || []).filter(tid => validTagIds.has(tid));
                    return validUserTags.length === 0 && !m.isArchived;
                  }) 
                : [];

              const archivedMembers = (selectedTagFilter === 'all' || selectedTagFilter === 'archived')
                ? mergedMembers.filter(m => m.isArchived)
                : [];

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                  {groups.map(group => (
                    <div key={group.tag.id}>
                      <h3 style={{ color: 'var(--accent)', fontSize: '1.1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', marginBottom: '12px' }}>
                        {group.tag.name}
                      </h3>
                      {group.members.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          {group.members.map(usr => renderMemberCard(usr))}
                        </div>
                      ) : (
                        <p className="empty-state">No members in this group.</p>
                      )}
                    </div>
                  ))}
                  
                  {untaggedMembers.length > 0 && (
                    <div key="untagged">
                      <h3 style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', marginBottom: '12px' }}>
                        Untagged Members
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {untaggedMembers.map(usr => renderMemberCard(usr))}
                      </div>
                    </div>
                  )}

                  {archivedMembers.length > 0 && (
                    <div key="archived">
                      <h3 style={{ color: '#ff4d4f', fontSize: '1.1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', marginBottom: '12px' }}>
                        Archived Members
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {archivedMembers.map(usr => renderMemberCard(usr))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};

export default TeamMembersTab;
