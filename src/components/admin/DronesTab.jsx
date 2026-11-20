import React, { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot, query, orderBy, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { db } from '../../firebase';
import { uploadFile, deleteCloudinaryImage, uploadModel, deleteModel, logAdminAction } from '../../lib/adminApi';

const EMPTY_DRONE_FORM = {
  name: '',
  description: '',
  longDescription: '',
  image: '',
  modelUrl: '',
  modelPath: '',
  modelName: '',
  order: 0,
  isActive: true,
  components: [],
};

const DronesTab = ({ user }) => {
  const [drones, setDrones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isUploadingModel, setIsUploadingModel] = useState(false);
  const [formData, setFormData] = useState(EMPTY_DRONE_FORM);
  // Part names read from the model, tagged with the URL they came from, so
  // "loading" and "no model" are derived instead of set inside the effect.
  const [modelParts, setModelParts] = useState({ url: null, names: [] });
  const nodeNames = formData.modelUrl && modelParts.url === formData.modelUrl ? modelParts.names : [];
  const loadingNodes = Boolean(formData.modelUrl) && modelParts.url !== formData.modelUrl;
  const [showHelp, setShowHelp] = useState(false);
  const imageInputRef = useRef(null);
  const modelInputRef = useRef(null);

  useEffect(() => {
    const qDrones = query(collection(db, 'drones'), orderBy('order', 'asc'));
    const unsub = onSnapshot(qDrones, (snapshot) => {
      setDrones(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, (error) => {
      console.error('Error fetching drones:', error);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Whenever a model is present, load it in the browser and read out its
  // top-level node names — fully automatic, no AI/manual step. These become the
  // checklist of parts the admin can mark as interactive.
  useEffect(() => {
    const url = formData.modelUrl;
    if (!url) return undefined;
    let cancelled = false;
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    // Self-hosted Draco decoder (public/draco/) — no third-party CDN at runtime.
    draco.setDecoderPath('/draco/');
    loader.setDRACOLoader(draco);
    loader.load(
      url,
      (gltf) => {
        if (cancelled) return;
        const names = gltf.scene.children.map((n) => n.name).filter(Boolean);
        setModelParts({ url, names });
        draco.dispose();
      },
      undefined,
      (err) => {
        if (cancelled) return;
        console.error('Failed to read model parts:', err);
        setModelParts({ url, names: [] });
        draco.dispose();
      },
    );
    return () => { cancelled = true; };
  }, [formData.modelUrl]);

  // ── Interactive-component helpers ──
  const getComponent = (nodeName) => formData.components.find((c) => c.nodeName === nodeName);

  const toggleComponent = (nodeName) => {
    setFormData((prev) => {
      const exists = prev.components.some((c) => c.nodeName === nodeName);
      return {
        ...prev,
        components: exists
          ? prev.components.filter((c) => c.nodeName !== nodeName)
          : [...prev.components, { nodeName, label: nodeName, description: '' }],
      };
    });
  };

  const updateComponent = (nodeName, field, value) => {
    setFormData((prev) => ({
      ...prev,
      components: prev.components.map((c) => (c.nodeName === nodeName ? { ...c, [field]: value } : c)),
    }));
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const safeName = () => formData.name.trim().replace(/\s+/g, '-');

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!formData.name) {
      alert('Please enter the drone name before uploading its image.');
      e.target.value = '';
      return;
    }
    setIsUploadingImage(true);
    try {
      const { ok, data } = await uploadFile(file, `drones/${safeName()}`);
      if (ok && data.secure_url) {
        setFormData((prev) => ({ ...prev, image: data.secure_url }));
      } else {
        alert(data.error || 'Image upload failed.');
      }
    } catch (error) {
      console.error('Image upload error:', error);
      alert('Error uploading image.');
    } finally {
      setIsUploadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const handleModelUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!formData.name) {
      alert('Please enter the drone name before uploading its model.');
      e.target.value = '';
      return;
    }
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'glb' && ext !== 'gltf') {
      alert('Please upload a .glb or .gltf 3D model file.');
      e.target.value = '';
      return;
    }
    setIsUploadingModel(true);
    try {
      const { ok, data } = await uploadModel(file, `drones/${safeName()}`);
      if (ok && data.url) {
        setFormData((prev) => ({ ...prev, modelUrl: data.url, modelPath: data.path, modelName: file.name }));
      } else {
        alert(data.error || 'Model upload failed.');
      }
    } catch (error) {
      console.error('Model upload error:', error);
      alert('Error uploading model.');
    } finally {
      setIsUploadingModel(false);
      if (modelInputRef.current) modelInputRef.current.value = '';
    }
  };

  const resetForm = () => {
    setFormData(EMPTY_DRONE_FORM);
    setEditingId(null);
  };

  const handleEdit = (item) => {
    setEditingId(item.id);
    setFormData({
      name: item.name || '',
      description: item.description || '',
      longDescription: item.longDescription || '',
      image: item.image || '',
      modelUrl: item.modelUrl || '',
      modelPath: item.modelPath || '',
      modelName: item.modelName || '',
      order: item.order || 0,
      isActive: item.isActive !== false,
      components: item.components || [],
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Delete "${item.name}"? This removes its image and 3D model too.`)) return;
    try {
      await deleteDoc(doc(db, 'drones', item.id));
      await deleteCloudinaryImage(item.image);
      await deleteModel(item.modelPath);
      await logAdminAction('DELETE', 'Drone', `Deleted drone: ${item.name}`);
    } catch (error) {
      console.error('Delete error:', error);
      alert('Failed to delete drone.');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.image || !formData.modelUrl) {
      alert('Name, card image, and 3D model are all required.');
      return;
    }
    const dataToSave = {
      name: formData.name,
      description: formData.description,
      longDescription: formData.longDescription,
      image: formData.image,
      modelUrl: formData.modelUrl,
      modelPath: formData.modelPath,
      modelName: formData.modelName,
      order: Number(formData.order),
      isActive: formData.isActive,
      components: formData.components,
      updatedAt: serverTimestamp(),
      updatedBy: user.email,
    };

    try {
      if (editingId) {
        const old = drones.find((d) => d.id === editingId);
        // Clean up replaced assets.
        if (old?.image && old.image !== formData.image) await deleteCloudinaryImage(old.image);
        if (old?.modelPath && old.modelPath !== formData.modelPath) await deleteModel(old.modelPath);
        await updateDoc(doc(db, 'drones', editingId), dataToSave);
        await logAdminAction('UPDATE', 'Drone', `Updated drone: ${dataToSave.name}`);
      } else {
        dataToSave.createdAt = serverTimestamp();
        dataToSave.createdBy = user.email;
        await addDoc(collection(db, 'drones'), dataToSave);
        await logAdminAction('CREATE', 'Drone', `Created drone: ${dataToSave.name}`);
      }
      resetForm();
    } catch (error) {
      console.error('Save error:', error);
      alert('Failed to save drone.');
    }
  };

  const busy = isUploadingImage || isUploadingModel;

  return (
    <div className="admin-grid">
      <div className="admin-left-column">
        <div className="admin-glass-panel form-panel">
          <h2>{editingId ? 'Edit Drone' : 'Add New Drone'}</h2>

          <button
            type="button"
            className="admin-btn secondary small"
            onClick={() => setShowHelp((s) => !s)}
            style={{ marginBottom: 14 }}
          >
            {showHelp ? 'Hide guide' : 'ℹ How to prepare & upload a model'}
          </button>

          {showHelp && (
            <div
              style={{
                marginBottom: 18,
                padding: '14px 16px',
                borderRadius: 10,
                border: '1px solid rgba(120,180,255,0.25)',
                background: 'rgba(10,20,40,0.5)',
                fontSize: '0.86rem',
                lineHeight: 1.5,
                color: 'rgba(230,238,250,0.85)',
              }}
            >
              <strong style={{ color: '#9ec5ff' }}>1. Export from FreeCAD</strong>
              <ul style={{ margin: '6px 0 12px', paddingLeft: 18 }}>
                <li>Name each part in the model tree (e.g. “Front Left Motor”, “PIXHAWK 5X-6X”) — these names become the clickable components.</li>
                <li>Select all parts → <strong>File → Export</strong> → choose <strong>glTF Binary (.glb)</strong>.</li>
                <li><strong>Upload a single .glb</strong> (self-contained). A plain <code>.gltf</code> makes a separate <code>.bin</code> file that can’t be auto-optimized from one upload.</li>
              </ul>

              <strong style={{ color: '#9ec5ff' }}>2. Upload it below</strong>
              <p style={{ margin: '6px 0 12px' }}>
                The site automatically cleans, simplifies and compresses the model
                (keeping every part separate) before storing — you don’t need to
                optimize it yourself.
              </p>

              <strong style={{ color: '#9ec5ff' }}>3. If the automatic optimization fails</strong>
              <p style={{ margin: '6px 0 6px' }}>
                (e.g. a very large file) optimize it offline, then upload the result:
              </p>
              <ol style={{ margin: '0 0 4px', paddingLeft: 18 }}>
                <li><a href="/glb-optimizer.zip" download style={{ color: '#9ec5ff', textDecoration: 'underline' }}>Download the optimizer tool</a>.</li>
                <li>Unzip it, install <a href="https://nodejs.org" target="_blank" rel="noreferrer" style={{ color: '#9ec5ff', textDecoration: 'underline' }}>Node.js</a>, open a terminal in the folder and run <code>npm install</code>.</li>
                <li>Put your <code>.glb</code> in <code>input/</code>, run <code>npm run optimize</code>.</li>
                <li>Upload the file from <code>output/</code> here.</li>
              </ol>
            </div>
          )}

          <form onSubmit={handleSubmit} className="admin-form">
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                required
                placeholder="e.g. Swaayatt"
              />
            </div>

            <div className="form-group">
              <label>Description (shown on the card)</label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                rows="2"
                placeholder="A short one-or-two line summary for the card…"
              ></textarea>
            </div>

            <div className="form-group">
              <label>Detailed Description (shown in the 3D viewer panel)</label>
              <textarea
                name="longDescription"
                value={formData.longDescription}
                onChange={handleInputChange}
                rows="5"
                placeholder="The full write-up shown beside the 3D model. Use blank lines to separate paragraphs."
              ></textarea>
            </div>

            <div className="form-group">
              <label>Order</label>
              <input
                type="number"
                name="order"
                value={formData.order}
                onChange={handleInputChange}
                required
              />
            </div>

            <div className="form-group">
              <label>Card Image</label>
              <div className="file-upload">
                <input
                  type="file"
                  accept="image/*,.heic,.heif"
                  ref={imageInputRef}
                  onChange={handleImageUpload}
                  disabled={busy}
                />
                {isUploadingImage && <span className="upload-status">Uploading…</span>}
              </div>
              <div className="input-divider">or</div>
              <input
                type="text"
                name="image"
                value={formData.image}
                onChange={handleInputChange}
                placeholder="Paste an image URL directly"
              />
              {formData.image && (
                <div className="image-preview achievement">
                  <img src={formData.image} alt="Preview" />
                </div>
              )}
            </div>

            <div className="form-group">
              <label>3D Model — upload a self-contained <strong>.glb</strong> (recommended, up to 50 MB)</label>
              <p className="card-desc" style={{ margin: '0 0 8px' }}>
                Optimized automatically on upload. A plain <code>.gltf</code> with an
                external <code>.bin</code> will be stored without optimization — use a .glb.
              </p>
              <div className="file-upload">
                <input
                  type="file"
                  accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                  ref={modelInputRef}
                  onChange={handleModelUpload}
                  disabled={busy}
                />
                {isUploadingModel && <span className="upload-status">Optimizing & uploading… (may take a while)</span>}
              </div>
              {formData.modelUrl && (
                <p className="card-desc" style={{ marginTop: 8 }}>
                  ✓ Model uploaded{formData.modelName ? `: ${formData.modelName}` : ''}
                </p>
              )}
            </div>

            {formData.modelUrl && (
              <div className="form-group">
                <label>Interactive Components</label>
                <p className="card-desc" style={{ marginTop: 0, marginBottom: 8 }}>
                  Tick the parts visitors can click in the 3D viewer, then give each a label and description.
                </p>
                {loadingNodes && <span className="upload-status">Reading model parts…</span>}
                {!loadingNodes && nodeNames.length === 0 && (
                  <p className="card-desc">No named parts found in this model.</p>
                )}
                <div
                  style={{
                    maxHeight: 320,
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    marginTop: 6,
                  }}
                >
                  {nodeNames.map((nodeName) => {
                    const sel = getComponent(nodeName);
                    return (
                      <div
                        key={nodeName}
                        style={{
                          border: '1px solid rgba(255,255,255,0.12)',
                          borderRadius: 8,
                          padding: '8px 10px',
                          background: sel ? 'rgba(56,189,248,0.08)' : 'transparent',
                        }}
                      >
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                          <input type="checkbox" checked={!!sel} onChange={() => toggleComponent(nodeName)} />
                          <span style={{ fontSize: '0.9rem' }}>{nodeName}</span>
                        </label>
                        {sel && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                            <label style={{ fontSize: '0.78rem', opacity: 0.8 }}>
                              Display name (shown in the viewer — edit to fix typos)
                            </label>
                            <input
                              type="text"
                              value={sel.label}
                              onChange={(e) => updateComponent(nodeName, 'label', e.target.value)}
                              placeholder="e.g. Flight Controller"
                            />
                            <label style={{ fontSize: '0.78rem', opacity: 0.8, marginTop: 6 }}>
                              Description
                            </label>
                            <textarea
                              rows="2"
                              value={sel.description}
                              onChange={(e) => updateComponent(nodeName, 'description', e.target.value)}
                              placeholder="Shown when this part is selected"
                            ></textarea>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="form-group checkbox-group">
              <label>
                <input
                  type="checkbox"
                  name="isActive"
                  checked={formData.isActive}
                  onChange={handleInputChange}
                />
                Active (visible on website)
              </label>
            </div>

            <div className="form-actions">
              {editingId && (
                <button type="button" onClick={resetForm} className="admin-btn cancel">
                  Cancel
                </button>
              )}
              <button type="submit" className="admin-btn primary" disabled={busy}>
                {editingId ? 'Update Drone' : 'Add Drone'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="admin-right-column">
        <div className="admin-glass-panel list-panel">
          <h2>Current Drones</h2>
          <div className="achievements-list">
            {drones.map((item) => (
              <div key={item.id} className={`admin-achievement-card ${!item.isActive ? 'inactive-member' : ''}`}>
                <div className="card-info">
                  <h3>
                    {item.name}{' '}
                    <span className={`status-badge ${item.isActive ? 'active' : 'inactive'}`}>
                      {item.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </h3>
                  <span className="order-badge">Order: {item.order}</span>
                  {item.description && <p className="card-desc">{item.description}</p>}
                  <p className="card-desc">{item.modelUrl ? '✓ 3D model attached' : '⚠ No model'}</p>
                </div>
                <div className="card-actions">
                  <button onClick={() => handleEdit(item)} className="admin-btn edit small">Edit</button>
                  <button onClick={() => handleDelete(item)} className="admin-btn delete small">Delete</button>
                </div>
              </div>
            ))}
            {!loading && drones.length === 0 && <p className="empty-state">No drones yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DronesTab;
