import React, { useState, useEffect } from 'react';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import { logAdminAction } from '../../lib/adminApi';

const CustomFieldsTab = () => {
  const [fields, setFields] = useState([]);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldAskOnJoin, setNewFieldAskOnJoin] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [editingAskOnJoin, setEditingAskOnJoin] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'custom_fields'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setFields(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, []);

  const handleAddField = async (e) => {
    e.preventDefault();
    if (!newFieldName.trim()) return;

    try {
      await addDoc(collection(db, 'custom_fields'), { name: newFieldName.trim(), askOnJoin: newFieldAskOnJoin });
      await logAdminAction('custom_field_created', 'system', `Created dynamic field: ${newFieldName.trim()}`);
      setNewFieldName('');
      setNewFieldAskOnJoin(false);
    } catch (error) {
      console.error("Error adding field:", error);
      alert("Failed to add field");
    }
  };

  const handleDeleteField = async (id, name) => {
    if (!window.confirm(`Delete field "${name}"? This will not remove the data from existing users, but it will no longer show up as a standard field.`)) return;
    
    try {
      await deleteDoc(doc(db, 'custom_fields', id));
      await logAdminAction('custom_field_deleted', 'system', `Deleted dynamic field: ${name}`);
    } catch (error) {
      console.error("Error deleting field:", error);
      alert("Failed to delete field");
    }
  };

  const handleStartEdit = (field) => {
    setEditingId(field.id);
    setEditingName(field.name);
    setEditingAskOnJoin(field.askOnJoin || false);
  };

  const handleSaveEdit = async (id, oldName) => {
    if (!editingName.trim()) return;
    try {
      await updateDoc(doc(db, 'custom_fields', id), { name: editingName.trim(), askOnJoin: editingAskOnJoin });
      await logAdminAction('custom_field_updated', 'system', `Renamed field from ${oldName} to ${editingName.trim()}`);
      setEditingId(null);
      setEditingName('');
      setEditingAskOnJoin(false);
    } catch (error) {
      console.error("Error updating field:", error);
      alert("Failed to update field");
    }
  };

  return (
    <div className="admin-grid">
      <div className="admin-left-column">
        <div className="admin-glass-panel form-panel">
          <h2>Add Dynamic Field</h2>
          <p className="panel-desc">Create custom profile fields (e.g., Phone, Batch, Specialization) that will appear for all users.</p>
          <form onSubmit={handleAddField} className="admin-form">
            <div className="form-group">
              <label>Field Name</label>
              <input
                type="text"
                value={newFieldName}
                onChange={(e) => setNewFieldName(e.target.value)}
                placeholder="e.g., Department"
                required
              />
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '15px', marginBottom: '15px' }}>
              <input
                type="checkbox"
                id="askOnJoin"
                checked={newFieldAskOnJoin}
                onChange={(e) => setNewFieldAskOnJoin(e.target.checked)}
                style={{ width: 'auto' }}
              />
              <label htmlFor="askOnJoin" style={{ marginBottom: 0 }}>Ask new person on join</label>
            </div>
            <div className="form-actions">
              <button type="submit" className="admin-btn primary">Create Field</button>
            </div>
          </form>
        </div>
      </div>

      <div className="admin-right-column">
        <div className="admin-glass-panel list-panel">
          <h2>Existing Fields</h2>
          <div className="achievements-list">
            {/* Built-in locked fields */}
            <div className="admin-achievement-card admin-user-card" style={{ opacity: 0.8 }}>
              <div className="card-info">
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  Name
                  <span style={{ fontSize: '10px', padding: '2px 6px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', color: '#8892b0' }}>Built-in</span>
                </h3>
              </div>
              <div className="card-actions">
                <span style={{ fontSize: '12px', color: '#8892b0', fontStyle: 'italic' }}>Locked</span>
              </div>
            </div>
            
            <div className="admin-achievement-card admin-user-card" style={{ opacity: 0.8 }}>
              <div className="card-info">
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  Room No
                  <span style={{ fontSize: '10px', padding: '2px 6px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', color: '#8892b0' }}>Built-in</span>
                </h3>
              </div>
              <div className="card-actions">
                <span style={{ fontSize: '12px', color: '#8892b0', fontStyle: 'italic' }}>Locked</span>
              </div>
            </div>

            {/* Dynamic fields */}
            {fields.map(field => (
              <div key={field.id} className="admin-achievement-card admin-user-card">
                <div className="card-info">
                  {editingId === field.id ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <input 
                        type="text" 
                        value={editingName} 
                        onChange={e => setEditingName(e.target.value)}
                        style={{ padding: '6px', borderRadius: '4px', border: '1px solid #ccc', background: '#fff', color: '#000' }}
                      />
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
                        <input 
                          type="checkbox" 
                          checked={editingAskOnJoin} 
                          onChange={e => setEditingAskOnJoin(e.target.checked)} 
                          style={{ width: 'auto' }} 
                        />
                        Ask new person on join
                      </label>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <h3>{field.name}</h3>
                      {field.askOnJoin && <span style={{ fontSize: '10px', padding: '2px 6px', background: 'rgba(100, 255, 218, 0.1)', borderRadius: '4px', color: 'var(--accent)', width: 'fit-content' }}>Asked on Join</span>}
                    </div>
                  )}
                </div>
                <div className="card-actions">
                  {editingId === field.id ? (
                    <>
                      <button onClick={() => handleSaveEdit(field.id, field.name)} className="admin-btn primary small">Save</button>
                      <button onClick={() => setEditingId(null)} className="admin-btn secondary small">Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => handleStartEdit(field)} className="admin-btn edit small">Edit</button>
                      <button onClick={() => handleDeleteField(field.id, field.name)} className="admin-btn delete small">Delete</button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {fields.length === 0 && <p className="empty-state">No dynamic fields found.</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomFieldsTab;
