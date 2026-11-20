import React, { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot, query, orderBy, addDoc, updateDoc, deleteDoc, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { uploadFile, deleteCloudinaryImage, logAdminAction, syncUserPermissions, fetchAdmins } from '../../lib/adminApi';
import { getGrantedTagIds, buildReadableMirrors } from '../../lib/tagGrants';
import { getDocs, getDoc } from 'firebase/firestore';

const formatBoardYear = (year) => {
  if (typeof year === 'string' && year.length === 4 && !isNaN(parseInt(year))) {
    return `${year}-${parseInt(year) + 1}`;
  }
  return year;
};

const EMPTY_MEMBER_FORM = {
  userId: '',
  role: '',
  category: 'leaders',
  order: 0,
  isActive: true
};

const TeamTab = () => {
  const [teamYears, setTeamYears] = useState([]);
  const [teamYearsData, setTeamYearsData] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [selectedTeamYear, setSelectedTeamYear] = useState('');
  const [newTeamYear, setNewTeamYear] = useState('');
  const [editingTeamMemberId, setEditingTeamMemberId] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [usersList, setUsersList] = useState([]);
  const [tagsList, setTagsList] = useState([]);
  const [adminsList, setAdminsList] = useState([]);
  const [teamMemberFormData, setTeamMemberFormData] = useState(EMPTY_MEMBER_FORM);
  const seniorCoreFileInputRef = useRef(null);

  const refreshAdmins = async () => {
    try {
      const currentAdmins = await fetchAdmins();
      setAdminsList(currentAdmins);
    } catch (e) {
      console.error("Error fetching admins:", e);
    }
  };

  const syncPublicBoardProfile = async (userId, role) => {
    const user = usersList.find((candidate) => candidate.id === userId);
    if (!user) return;

    await setDoc(doc(db, 'public_board_profiles', userId), {
      name: user.name || '',
      image: user.image || '',
      role: role || '',
      linkedin: user.linkedin || '',
      github: user.github || '',
      updatedAt: serverTimestamp()
    }, { merge: true });
  };

  useEffect(() => {
    const qTeamYears = query(collection(db, 'team_years'), orderBy('year', 'desc'));
    const unsubYears = onSnapshot(qTeamYears, (snapshot) => {
      const dataStrings = snapshot.docs.map(d => d.data().year);
      const dataObjects = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setTeamYears(dataStrings);
      setTeamYearsData(dataObjects);
      if (dataStrings.length > 0) {
        setSelectedTeamYear(prev => prev || dataStrings[0]);
      }
    }, (error) => {
      console.error("Error fetching team years:", error);
    });

    const qTeamMembers = query(collection(db, 'team_members'), orderBy('order', 'asc'));
    const unsubMembers = onSnapshot(qTeamMembers, (snapshot) => {
      const data = snapshot.docs.map(d => {
        const member = d.data();
        if (member.category === 'miscellaneous') member.category = 'essential';
        return { id: d.id, ...member };
      });
      setTeamMembers(data);
    }, (error) => {
      console.error("Error fetching team members:", error);
    });

    const unsubUsers = onSnapshot(query(collection(db, 'users'), orderBy('name', 'asc')), (snapshot) => {
      setUsersList(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Error fetching users:", error);
    });

    const unsubTags = onSnapshot(query(collection(db, 'tags')), (snapshot) => {
      setTagsList(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    fetchAdmins().then(setAdminsList).catch((e) => console.error("Error fetching admins:", e));

    return () => {
      unsubYears();
      unsubMembers();
      unsubUsers();
      unsubTags();
    };
  }, []);

  const handleAddYear = async (e) => {
    e.preventDefault();
    const year = newTeamYear.trim();
    if (!year) return;
    // Year becomes the Firestore document ID, so enforce a strict 4-digit
    // format (e.g. "2025") — rejects free-text that would create junk doc IDs.
    if (!/^\d{4}$/.test(year)) {
      alert('Enter a valid 4-digit year, e.g. 2025.');
      return;
    }
    try {
      const existingYearDoc = await getDoc(doc(db, 'team_years', year));
      if (existingYearDoc.exists()) {
        alert(`${year} already exists.`);
        return;
      }
      await setDoc(doc(db, 'team_years', year), {
        year,
        isCurrent: false,
        createdAt: serverTimestamp()
      });
      await logAdminAction('CREATE', 'TeamYear', `Added new team year: ${year}`);
      
      // Calculate the latest year from Firestore, not a possibly delayed
      // realtime snapshot (important when a year was just deleted/re-created).
      const yearsSnapshot = await getDocs(collection(db, 'team_years'));
      const validYears = yearsSnapshot.docs
        .map(yearDoc => parseInt(yearDoc.data().year, 10))
        .filter(Number.isFinite)
        .filter(existingYear => existingYear !== parseInt(year, 10));
      const maxYear = validYears.length > 0 ? Math.max(...validYears) : 0;
      
      if (parseInt(year, 10) > maxYear) {
        // Wait for the complete transition. This prevents a newly created year
        // from being displayed or edited before its current-board state is set.
        const transitioned = await handleMakeCurrent(year, true);
        if (!transitioned) {
          throw new Error(`Could not make ${year} the current board.`);
        }
      }
      
      setNewTeamYear('');
      setSelectedTeamYear(year);
    } catch (error) {
      console.error("Add Year Error:", error);
      alert("Failed to add year. " + error.message);
    }
  };

  const handleDeleteYear = async (year) => {
    if (window.confirm(`Permanently delete ${year}, including all its board-member records? User profiles will be kept.`)) {
      try {
        // Use fresh data so deletion cannot leave behind records that the
        // realtime listeners have not received yet.
        const [yearsSnapshot, membersSnapshot, tagsSnapshot, currentAdmins] = await Promise.all([
          getDocs(collection(db, 'team_years')),
          getDocs(collection(db, 'team_members')),
          getDocs(collection(db, 'tags')),
          fetchAdmins()
        ]);
        const currentYears = yearsSnapshot.docs.map(yearDoc => ({ id: yearDoc.id, ...yearDoc.data() }));
        const deletedMembers = membersSnapshot.docs
          .map(memberDoc => ({ id: memberDoc.id, ...memberDoc.data() }))
          .filter(member => member.year === year);
        const currentTags = tagsSnapshot.docs.map(tagDoc => ({ id: tagDoc.id, ...tagDoc.data() }));
        const yearObj = currentYears.find(teamYear => teamYear.year === year);
        const wasCurrent = yearObj?.isCurrent;
        const activeBoardUserIds = new Set(
          membersSnapshot.docs
            .map(memberDoc => memberDoc.data())
            .filter(member => member.year !== year && currentYears.some(teamYear => teamYear.isCurrent && teamYear.year === member.year))
            .map(member => member.userId)
            .filter(Boolean)
        );

        // A deleted board year removes its members' tag assignments as well.
        // The sole exception is a member who is still on another active board.
        const exBoardTag = currentTags.find(tag => tag.name === `Ex-Board-${year}`);
        for (const m of deletedMembers) {
          try {
            if (!m.userId) continue;
            const userDocSnap = await getDoc(doc(db, 'users', m.userId));
            if (userDocSnap.exists()) {
              const uData = userDocSnap.data();
              const newTags = activeBoardUserIds.has(m.userId) ? (uData.tags || []) : [];
              if (newTags.length !== (uData.tags || []).length) {
                await updateDoc(doc(db, 'users', m.userId), { tags: newTags, tagNames: buildReadableMirrors(newTags, currentTags).tagNames });
                if (uData.email) {
                  await syncUserPermissions(uData.email, newTags, currentTags, currentAdmins);
                }
              }
            }
          } catch (memberErr) {
            console.error(`Failed to clean up deleted board member ${m.userId}:`, memberErr);
          }
        }

        // The team-member records are part of the year and must not survive a
        // deletion; otherwise they reappear when the same year is created.
        await Promise.all(deletedMembers.map(member => deleteDoc(doc(db, 'team_members', member.id))));
        if (exBoardTag) await deleteDoc(doc(db, 'tags', exBoardTag.id));
        await deleteDoc(doc(db, 'team_years', year));
        await logAdminAction('DELETE', 'TeamYear', `Deleted team year: ${year}`);
        
        const remainingYears = currentYears.filter(teamYear => teamYear.year !== year).map(teamYear => teamYear.year);
        if (selectedTeamYear === year) {
          setSelectedTeamYear(remainingYears[0] || '');
        }
        
        // If we deleted the active board, fallback to the next highest year automatically
        if (wasCurrent && remainingYears.length > 0) {
          const validRemaining = remainingYears.map(y => parseInt(y)).filter(y => !isNaN(y));
          if (validRemaining.length > 0) {
            const maxRemainingYear = Math.max(...validRemaining).toString();
            await handleMakeCurrent(maxRemainingYear, true, year);
          }
        }
        
      } catch (error) {
        console.error("Delete Year Error:", error);
        alert("Failed to delete year.");
      }
    }
  };

  const handleTeamMemberInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setTeamMemberFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const resetTeamMemberForm = () => {
    setTeamMemberFormData(EMPTY_MEMBER_FORM);
    setEditingTeamMemberId(null);
  };

  const handleTeamMemberEdit = (item) => {
    setEditingTeamMemberId(item.id);
    setTeamMemberFormData({
      userId: item.userId || '',
      role: item.role || '',
      category: item.category || 'leaders',
      order: item.order || 0,
      isActive: item.isActive !== false // default to true if undefined
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleTeamMemberDelete = async (member) => {
    if (window.confirm("Are you sure you want to delete this team member?")) {
      try {
        await deleteDoc(doc(db, 'team_members', member.id));
        await logAdminAction('DELETE', 'TeamMember', `Deleted team member record: ${member.id}`);

        // If this member was deleted from the Current Board, remove their Board tag and permissions
        const yearDoc = teamYearsData.find(y => y.year === member.year);
        if (yearDoc?.isCurrent && member.userId) {
          const userDocSnap = await getDoc(doc(db, 'users', member.userId));
          if (userDocSnap.exists()) {
            const userData = userDocSnap.data();
            const boardTag = tagsList.find(t => t.name === 'Board');
            if (boardTag && userData.tags?.includes(boardTag.id)) {
              const newTags = userData.tags.filter(t => t !== boardTag.id);
              await updateDoc(doc(db, 'users', member.userId), { tags: newTags, tagNames: buildReadableMirrors(newTags, tagsList).tagNames });
              if (userData.email) {
                await syncUserPermissions(userData.email, newTags, tagsList, adminsList);
              }
              await refreshAdmins();
            }
          }
        }
      } catch (error) {
        console.error("Delete Error:", error);
        alert("Failed to delete team member.");
      }
    }
  };

  const getOrCreateTag = async (tagName, grantsAdmin, grantsSuperAdmin, currentTagsList) => {
    let tag = currentTagsList.find(t => t.name === tagName);
    let updatedTagsList = [...currentTagsList];
    
    if (!tag) {
      const newTagRef = await addDoc(collection(db, 'tags'), {
        name: tagName,
        grantsAdmin: grantsAdmin,
        grantsSuperAdmin: grantsSuperAdmin,
        isGroup: true,
        isExMember: tagName.startsWith('Ex-Board'),
        grantsTags: []
      });
      tag = { id: newTagRef.id, name: tagName, grantsAdmin, grantsSuperAdmin, grantsTags: [] };
      updatedTagsList.push(tag);
    } else if ((grantsAdmin && !tag.grantsAdmin) || (grantsSuperAdmin && !tag.grantsSuperAdmin)) {
      // Force update if it exists but lacks permissions
      await updateDoc(doc(db, 'tags', tag.id), {
        grantsAdmin: tag.grantsAdmin || grantsAdmin,
        grantsSuperAdmin: tag.grantsSuperAdmin || grantsSuperAdmin
      });
      tag.grantsAdmin = tag.grantsAdmin || grantsAdmin;
      tag.grantsSuperAdmin = tag.grantsSuperAdmin || grantsSuperAdmin;
      updatedTagsList = updatedTagsList.map(t => t.id === tag.id ? tag : t);
    }
    
    return { tag, updatedTagsList };
  };

  const handleMakeCurrent = async (yearStr, skipConfirm = false, deletedYear = null) => {
    if (!skipConfirm && !window.confirm(`Make ${yearStr} the Current Board? The outgoing board will automatically receive the Ex-Board tag and lose Super Admin permissions.`)) return;
    
    try {
      // Read fresh data instead of relying on snapshot state. In particular,
      // a just-created year is not guaranteed to be present in React state yet.
      const [yearsSnapshot, membersSnapshot] = await Promise.all([
        getDocs(collection(db, 'team_years')),
        getDocs(collection(db, 'team_members'))
      ]);
      const currentYears = yearsSnapshot.docs.map(yearDoc => ({ id: yearDoc.id, ...yearDoc.data() }));
      const currentMembers = membersSnapshot.docs.map(memberDoc => ({ id: memberDoc.id, ...memberDoc.data() }));

      // 1. Find ALL outgoing current years (in case of inconsistent state)
      const outgoingYearDocs = currentYears.filter(y => y.isCurrent && y.year !== yearStr && y.year !== deletedYear);
      const incomingYear = currentYears.find(y => y.year === yearStr);
      if (!incomingYear) throw new Error(`Team year ${yearStr} does not exist.`);

      // The board status is the primary operation. Commit it before tag and
      // permission work, which depends on extra Firestore/API calls and may
      // legitimately fail independently.
      await Promise.all([
        ...outgoingYearDocs.map(outgoingYear => updateDoc(doc(db, 'team_years', outgoingYear.id), { isCurrent: false })),
        updateDoc(doc(db, 'team_years', incomingYear.id), { isCurrent: true })
      ]);

      const [tagsSnapshot, currentAdmins] = await Promise.all([
        getDocs(collection(db, 'tags')),
        fetchAdmins().catch(error => {
          console.warn('Could not refresh admins before tag sync:', error);
          return adminsList;
        })
      ]);
      
      // Ensure 'Board' tag exists
      let currentTags = tagsSnapshot.docs.map(tagDoc => ({ id: tagDoc.id, ...tagDoc.data() }));
      const { tag: boardTag, updatedTagsList: afterBoard } = await getOrCreateTag('Board', true, true, currentTags);
      currentTags = afterBoard;
      const resolvedBoardGrantIds = getGrantedTagIds(boardTag, currentTags);

      // Persist the normalized form so the Tags UI accurately shows the
      // checked defaults the next time Board is edited.
      if (JSON.stringify(boardTag.grantsTags || []) !== JSON.stringify(resolvedBoardGrantIds)) {
        await updateDoc(doc(db, 'tags', boardTag.id), { grantsTags: resolvedBoardGrantIds });
        boardTag.grantsTags = resolvedBoardGrantIds;
        currentTags = currentTags.map(tag => tag.id === boardTag.id ? boardTag : tag);
      }
      
      let exBoardTag = null;

      if (outgoingYearDocs.length > 0) {
        for (const outgoingYearDoc of outgoingYearDocs) {
          // Create Ex-Board tag for outgoing year
          const { tag: eTag, updatedTagsList: afterEx } = await getOrCreateTag(`Ex-Board-${outgoingYearDoc.year}`, false, false, currentTags);
          exBoardTag = eTag;
          currentTags = afterEx;
          
          // Find members of outgoing board
          const outgoingMembers = currentMembers.filter(m => m.year === outgoingYearDoc.year);
          for (const m of outgoingMembers) {
            try {
              if (!m.userId) continue;
              const userDocSnap = await getDoc(doc(db, 'users', m.userId));
              if (userDocSnap.exists()) {
                const uData = userDocSnap.data();
                // An outgoing board member keeps only the Ex-Board identity
                // and that tag's explicit defaults; all prior team tags are
                // intentionally cleared.
                const newTags = [...new Set([
                  exBoardTag.id,
                  ...getGrantedTagIds(exBoardTag, currentTags)
                ])];
                const tagsChanged = newTags.length !== (uData.tags || []).length
                  || newTags.some(tagId => !(uData.tags || []).includes(tagId));
                
                if (tagsChanged) {
                  await updateDoc(doc(db, 'users', m.userId), { tags: newTags, tagNames: buildReadableMirrors(newTags, currentTags).tagNames });
                }
                // Repair permissions even when the Board tag was already
                // present but an earlier partial transition skipped the claim.
                if (uData.email) {
                  await syncUserPermissions(uData.email, newTags, currentTags, currentAdmins);
                }
              }
            } catch (memberErr) {
              console.error(`Failed to transition outgoing member ${m.userId}:`, memberErr);
            }
          }
          
        }
      }

      // 2. Update members of new current board (give them 'Board' tag, remove their Ex-Board tag if it exists)
      const incomingMembers = currentMembers.filter(m => m.year === yearStr);
      let incomingExBoardTag = currentTags.find(t => t.name === `Ex-Board-${yearStr}`);
      
      for (const m of incomingMembers) {
        try {
          if (!m.userId) continue;
          const userDocSnap = await getDoc(doc(db, 'users', m.userId));
          if (userDocSnap.exists()) {
          const uData = userDocSnap.data();
            // Current-board membership replaces all previous team roles. Keep
            // Board and its configured defaults only.
            const newTags = [...new Set([boardTag.id, ...resolvedBoardGrantIds])];
            const tagsChanged = newTags.length !== (uData.tags || []).length
              || newTags.some(tagId => !(uData.tags || []).includes(tagId));
            
            if (tagsChanged) {
              await updateDoc(doc(db, 'users', m.userId), { tags: newTags, tagNames: buildReadableMirrors(newTags, currentTags).tagNames });
            }
            // The tag can predate a failed permission update, so reconcile
            // every current-board member, even when their tags are unchanged.
            if (uData.email) {
              await syncUserPermissions(uData.email, newTags, currentTags, currentAdmins);
            }
          }
        } catch (memberErr) {
          console.error(`Failed to transition incoming member ${m.userId}:`, memberErr);
        }
      }

      // Reconcile any incomplete historical transition. A person on an older
      // board must not retain Board unless they are also on this current board.
      // This is intentionally run for "Sync Board Tags" as well.
      const incomingUserIds = new Set(incomingMembers.map(member => member.userId).filter(Boolean));
      const staleBoardUserIds = [...new Set(
        currentMembers
          .filter(member => member.userId && !incomingUserIds.has(member.userId))
          .map(member => member.userId)
      )];

      for (const userId of staleBoardUserIds) {
        try {
          const userDocSnap = await getDoc(doc(db, 'users', userId));
          if (!userDocSnap.exists()) continue;

          const uData = userDocSnap.data();
          if (!uData.tags?.includes(boardTag.id)) continue;

          const previousYear = currentMembers
            .filter(member => member.userId === userId && member.year !== yearStr)
            .map(member => member.year)
            .filter(Boolean)
            .sort((a, b) => Number(b) - Number(a))[0];
          let newTags = [];

          if (previousYear) {
            const { tag: repairedExBoardTag, updatedTagsList } = await getOrCreateTag(
              `Ex-Board-${previousYear}`, false, false, currentTags
            );
            currentTags = updatedTagsList;
            newTags = [...new Set([
              repairedExBoardTag.id,
              ...getGrantedTagIds(repairedExBoardTag, currentTags)
            ])];
          }

          await updateDoc(doc(db, 'users', userId), { tags: newTags, tagNames: buildReadableMirrors(newTags, currentTags).tagNames });
          if (uData.email) {
            await syncUserPermissions(uData.email, newTags, currentTags, currentAdmins);
          }
        } catch (memberErr) {
          console.error(`Failed to reconcile former board member ${userId}:`, memberErr);
        }
      }
      
      // If the incoming year had an Ex-Board tag, delete the tag entirely since they are active again
      if (incomingExBoardTag) {
        try {
          await deleteDoc(doc(db, 'tags', incomingExBoardTag.id));
        } catch (err) {
          console.error("Failed to delete old Ex-Board tag:", err);
        }
      }

      await refreshAdmins();
      if (!skipConfirm) alert(`${yearStr} is now the Current Board! Tag transitions and permissions applied.`);
      return true;

    } catch (e) {
      console.error("Error transitioning board:", e);
      if (!skipConfirm) alert("Failed to make current board. Check console.");
      return false;
    }
  };

  const handleTeamMemberSubmit = async (e) => {
    e.preventDefault();
    if (!selectedTeamYear) {
      alert("Please select a year first.");
      return;
    }
    if (!teamMemberFormData.userId) {
      alert("Please select a User.");
      return;
    }

    // Validation: Enforce Unique(userId + year)
    const isDuplicate = teamMembers.some(
      m => m.year === selectedTeamYear && m.userId === teamMemberFormData.userId && m.id !== editingTeamMemberId
    );
    if (isDuplicate) {
      alert("This user is already on the board for this year!");
      return;
    }

    const dataToSave = {
      year: selectedTeamYear,
      userId: teamMemberFormData.userId,
      role: teamMemberFormData.role,
      category: teamMemberFormData.category,
      order: Number(teamMemberFormData.order),
      isActive: teamMemberFormData.isActive,
      updatedAt: serverTimestamp()
    };

    try {
      if (editingTeamMemberId) {
        await updateDoc(doc(db, 'team_members', editingTeamMemberId), dataToSave);
        await logAdminAction('UPDATE', 'TeamMember', `Updated team member record for ${dataToSave.userId}`);
      } else {
        dataToSave.createdAt = serverTimestamp();
        await addDoc(collection(db, 'team_members'), dataToSave);
        await logAdminAction('CREATE', 'TeamMember', `Added team member record for ${dataToSave.userId}`);
      }

      await syncPublicBoardProfile(dataToSave.userId, dataToSave.role);

      // Automate tags if this board is the Current Board
      // Read the year directly so a member added immediately after creating a
      // year still receives the Board tag and its super-admin permission.
      const yearDocSnap = await getDoc(doc(db, 'team_years', selectedTeamYear));
      const yearDoc = yearDocSnap.exists() ? yearDocSnap.data() : null;
      if (yearDoc?.isCurrent) {
        // The Board tag may have been created by the year transition only
        // moments earlier, before the realtime listener has updated state.
        const [tagsSnapshot, currentAdmins] = await Promise.all([
          getDocs(collection(db, 'tags')),
          fetchAdmins()
        ]);
        const currentTags = tagsSnapshot.docs.map(tagDoc => ({ id: tagDoc.id, ...tagDoc.data() }));
        const { tag: boardTag, updatedTagsList } = await getOrCreateTag('Board', true, true, currentTags);
        const resolvedBoardGrantIds = getGrantedTagIds(boardTag, updatedTagsList);
        const userDocSnap = await getDoc(doc(db, 'users', dataToSave.userId));
        if (userDocSnap.exists()) {
          const uData = userDocSnap.data();
          const newTags = [...new Set([boardTag.id, ...resolvedBoardGrantIds])];
          const tagsChanged = newTags.length !== (uData.tags || []).length
            || newTags.some(tagId => !(uData.tags || []).includes(tagId));
          if (tagsChanged) {
            await updateDoc(doc(db, 'users', dataToSave.userId), { tags: newTags, tagNames: buildReadableMirrors(newTags, updatedTagsList).tagNames });
          }
          if (uData.email) {
            await syncUserPermissions(uData.email, newTags, updatedTagsList, currentAdmins);
          }
          await refreshAdmins();
        }
      }

      resetTeamMemberForm();
    } catch (error) {
      console.error("Save Error:", error);
      alert("Failed to save team member.");
    }
  };

  const handleSeniorCoreUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !selectedTeamYear) return;

    setIsUploading(true);
    try {
      const { ok, data: uploadedImage } = await uploadFile(file, "board/senior-core");
      if (ok && uploadedImage.secure_url) {
        const yearDoc = teamYearsData.find(y => y.year === selectedTeamYear);
        if (yearDoc && yearDoc.seniorCorePhoto) {
          await deleteCloudinaryImage(yearDoc.seniorCorePhoto);
        }
        await setDoc(doc(db, 'team_years', selectedTeamYear), {
          seniorCorePhoto: uploadedImage.secure_url,
          updatedAt: serverTimestamp()
        }, { merge: true });
        alert("Senior Core Photo uploaded successfully!");
      } else {
        alert(uploadedImage.error || "Upload failed.");
      }
    } catch (error) {
      console.error("Upload error:", error);
      alert("Error uploading image.");
    } finally {
      setIsUploading(false);
      if (seniorCoreFileInputRef.current) seniorCoreFileInputRef.current.value = '';
    }
  };

  const handleDeleteSeniorCore = async () => {
    if (!selectedTeamYear) return;
    const yearDoc = teamYearsData.find(y => y.year === selectedTeamYear);
    if (!yearDoc || !yearDoc.seniorCorePhoto) return;

    if (window.confirm("Are you sure you want to delete the Senior Core photo for this year?")) {
      try {
        await deleteCloudinaryImage(yearDoc.seniorCorePhoto);
        await updateDoc(doc(db, 'team_years', selectedTeamYear), {
          seniorCorePhoto: null
        });
        alert("Senior Core Photo deleted.");
      } catch (error) {
        console.error("Delete Error:", error);
        alert("Failed to delete photo.");
      }
    }
  };

  const selectedYearDoc = teamYearsData.find(y => y.year === selectedTeamYear);

  const [userSearchQuery, setUserSearchQuery] = useState('');
  
  const filteredUsers = usersList.filter(u => {
    const q = userSearchQuery.toLowerCase();
    return (u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.id?.toLowerCase().includes(q));
  });

  return (
    <div className="admin-grid">
      <div className="admin-left-column">
        <div className="admin-glass-panel form-panel">
          <h2>Manage Years</h2>
          <form onSubmit={handleAddYear} className="admin-form inline-form">
            <input
              type="text"
              value={newTeamYear}
              onChange={(e) => setNewTeamYear(e.target.value)}
              placeholder="e.g. 2026 or 2026-2027"
              required
            />
            <button type="submit" className="admin-btn primary small">Add Year</button>
          </form>
          <div className="year-pills">
            {teamYears.map(year => {
              const yearObj = teamYearsData.find(y => y.year === year);
              const isCurrent = yearObj?.isCurrent;
              return (
                <div key={year} style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '10px' }}>
                  <div className={`year-pill ${selectedTeamYear === year ? 'active' : ''}`} style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span onClick={() => { setSelectedTeamYear(year); resetTeamMemberForm(); }} style={{ flex: 1, cursor: 'pointer' }}>
                      {formatBoardYear(year)}
                      {isCurrent && <span style={{ marginLeft: '10px', fontSize: '0.8em', background: '#faad14', color: '#000', padding: '2px 6px', borderRadius: '4px' }}>⭐ Current</span>}
                    </span>
                    <button onClick={() => handleDeleteYear(year)} className="delete-year-btn">×</button>
                  </div>
                  {/* Keep Make Current button for manual fixes, but hide it if it's current */}
                  {!isCurrent && (
                    <button onClick={() => handleMakeCurrent(year)} className="admin-btn secondary small" style={{ fontSize: '0.7rem', padding: '2px 6px', opacity: 0.7, alignSelf: 'flex-start' }}>Force Make Current</button>
                  )}
                  {isCurrent && (
                    <button onClick={() => handleMakeCurrent(year, true)} className="admin-btn secondary small" style={{ fontSize: '0.7rem', padding: '2px 6px', opacity: 0.7, alignSelf: 'flex-start' }}>Sync Board Tags</button>
                  )}
                </div>
              );
            })}
            {teamYears.length === 0 && <span className="empty-text">No years created yet.</span>}
          </div>
        </div>

        {selectedTeamYear && (
          <>
            <div className="admin-glass-panel form-panel">
              <h2>Senior Core Photo ({formatBoardYear(selectedTeamYear)})</h2>
              {selectedYearDoc?.seniorCorePhoto ? (
                <div className="image-preview achievement">
                  <img src={selectedYearDoc.seniorCorePhoto} alt="Senior Core" />
                  <div className="stack-sm">
                    <button type="button" onClick={handleDeleteSeniorCore} className="admin-btn delete small">Delete Photo</button>
                  </div>
                </div>
              ) : (
                <p className="empty-text">No Senior Core photo uploaded for this year.</p>
              )}
              <div className="form-group stack-md">
                <label>Upload New Photo</label>
                <div className="file-upload">
                  <input
                    type="file"
                    accept="image/*,.heic,.heif"
                    ref={seniorCoreFileInputRef}
                    onChange={handleSeniorCoreUpload}
                    disabled={isUploading}
                  />
                  {isUploading && <span className="upload-status">Uploading…</span>}
                </div>
              </div>
            </div>

            <div className="admin-glass-panel form-panel">
              <h2>{editingTeamMemberId ? `Edit Member (${formatBoardYear(selectedTeamYear)})` : `Add Member (${formatBoardYear(selectedTeamYear)})`}</h2>
              <form onSubmit={handleTeamMemberSubmit} className="admin-form">
                <div className="form-row">
                  <div className="form-group" style={{ position: 'relative' }}>
                    <label>Select User</label>
                    
                    {teamMemberFormData.userId ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px' }}>
                        {(() => {
                          const u = usersList.find(x => x.id === teamMemberFormData.userId);
                          if (!u) return <span>User not found ({teamMemberFormData.userId})</span>;
                          return (
                            <>
                              {u.image && <img src={u.image} alt="" style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} />}
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold' }}>{u.name || u.id}</div>
                                <div style={{ fontSize: '0.8rem', color: '#888' }}>{u.email || u.id}</div>
                              </div>
                              <button type="button" onClick={() => setTeamMemberFormData({...teamMemberFormData, userId: ''})} className="admin-btn secondary small">Change</button>
                            </>
                          );
                        })()}
                      </div>
                    ) : (
                      <>
                        <input 
                          type="text" 
                          placeholder="Search users by name or email..." 
                          value={userSearchQuery}
                          onChange={(e) => setUserSearchQuery(e.target.value)}
                          style={{ marginBottom: '10px' }}
                        />
                        <div style={{ maxHeight: '200px', overflowY: 'auto', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                          {filteredUsers.map(u => (
                            <div 
                              key={u.id}
                              onClick={() => setTeamMemberFormData({...teamMemberFormData, userId: u.id})}
                              style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                              className="user-select-row"
                            >
                              {u.image ? (
                                <img src={u.image} alt="" style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }} />
                              ) : (
                                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#444' }} />
                              )}
                              <div>
                                <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{u.name || u.id}</div>
                                <div style={{ fontSize: '0.75rem', color: '#888' }}>{u.email || u.id}</div>
                              </div>
                            </div>
                          ))}
                          {filteredUsers.length === 0 && <div style={{ padding: '10px', color: '#888', fontSize: '0.85rem' }}>No users found.</div>}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="form-group">
                    <label>Category</label>
                    <select
                      name="category"
                      value={teamMemberFormData.category}
                      onChange={handleTeamMemberInputChange}
                      required
                    >
                      <option value="leaders">Leaders</option>
                      <option value="technical">Technical</option>
                      <option value="essential">Essential</option>
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Role</label>
                    <input
                      type="text"
                      name="role"
                      value={teamMemberFormData.role}
                      onChange={handleTeamMemberInputChange}
                      required
                      placeholder="e.g. CAPTAIN"
                    />
                  </div>
                  <div className="form-group">
                    <label>Order</label>
                    <input
                      type="number"
                      name="order"
                      value={teamMemberFormData.order}
                      onChange={handleTeamMemberInputChange}
                      required
                    />
                  </div>
                </div>



                <div className="form-group checkbox-group">
                  <label>
                    <input
                      type="checkbox"
                      name="isActive"
                      checked={teamMemberFormData.isActive}
                      onChange={handleTeamMemberInputChange}
                    />
                    Active (visible on website)
                  </label>
                </div>

                <div className="form-actions">
                  {editingTeamMemberId && (
                    <button type="button" onClick={resetTeamMemberForm} className="admin-btn cancel">
                      Cancel
                    </button>
                  )}
                  <button type="submit" className="admin-btn primary">
                    {editingTeamMemberId ? 'Update Member' : 'Add Member'}
                  </button>
                </div>
              </form>
            </div>
          </>
        )}
      </div>

      <div className="admin-right-column">
        <div className="admin-glass-panel list-panel">
          <h2>Members in {selectedTeamYear ? formatBoardYear(selectedTeamYear) : '...'}</h2>
          {['leaders', 'technical', 'essential'].map(category => {
            const categoryMembers = teamMembers.filter(m => m.year === selectedTeamYear && m.category === category);
            if (categoryMembers.length === 0) return null;

            return (
              <div key={category} className="team-category-section">
                <h3 className="category-title">{category.charAt(0).toUpperCase() + category.slice(1)}</h3>
                <div className="achievements-list">
                  {categoryMembers.map(member => {
                    // Resolve user details
                    const resolvedUser = usersList.find(u => u.id === member.userId) || { name: member.name || 'Unknown User' };

                    return (
                      <div key={member.id} className={`admin-achievement-card ${!member.isActive ? 'inactive-member' : ''}`}>
                        <div className="card-info" style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                          {resolvedUser.image ? (
                            <img src={resolvedUser.image} alt="" style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
                          )}
                          <div>
                            <h3>{resolvedUser.name} <span className={`status-badge ${member.isActive ? 'active' : 'inactive'}`}>{member.isActive ? 'Active' : 'Inactive'}</span></h3>
                            <span className="order-badge">Role: {member.role} | Order: {member.order}</span>
                          </div>
                        </div>
                        <div className="card-actions">
                          <button onClick={() => handleTeamMemberEdit(member)} className="admin-btn edit small">Edit</button>
                          <button onClick={() => handleTeamMemberDelete(member)} className="admin-btn delete small">Delete</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {selectedTeamYear && teamMembers.filter(m => m.year === selectedTeamYear).length === 0 && (
            <p className="empty-state">No members found for this year.</p>
          )}
          {!selectedTeamYear && (
            <p className="empty-state">Select a year to view members.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default TeamTab;
