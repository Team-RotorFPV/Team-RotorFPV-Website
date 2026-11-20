import React, { useState, useEffect, useRef } from 'react';
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { auth } from '../firebaseAuth';
import { API_URL } from '../lib/adminApi';
import { User } from 'lucide-react';
import HomeSettingsTab from '../components/admin/HomeSettingsTab';
import EventsTab from '../components/admin/EventsTab';
import DronesTab from '../components/admin/DronesTab';
import AchievementsTab from '../components/admin/AchievementsTab';
import GalleryTab from '../components/admin/GalleryTab';
import TeamTab from '../components/admin/TeamTab';
import SponsorsTab from '../components/admin/SponsorsTab';
import TeamMembersTab from '../components/admin/TeamMembersTab';
import TrafficTab from '../components/admin/TrafficTab';
import ContactMessagesAdmin from '../components/ContactMessagesAdmin';
import LogsTab from '../components/admin/LogsTab';

import ProfileTab from '../components/admin/ProfileTab';
import SocialsTab from '../components/admin/SocialsTab';
import PillNav from '../components/PillNav';
import JoinRequestForm from '../components/JoinRequestForm';
import './Admin.css';

const TABS = [
  { key: 'gallery', label: 'Gallery', adminOnly: true },
  { key: 'sponsors', label: 'Sponsor Us', adminOnly: true },
  { key: 'drones', label: 'Drones', adminOnly: true },
  { key: 'home', label: 'Home Page', adminOnly: true },
  { key: 'achievements', label: 'Achievements', adminOnly: true },
  // Super-admin only: putting someone on the current Board gives them the
  // Board tag, which grants super admin. Firestore rules enforce this too.
  { key: 'team', label: 'Board', superAdminOnly: true },
  { key: 'events', label: 'Events', adminOnly: true },
  { key: 'socials', label: 'Socials', adminOnly: true },

  { key: 'contact_messages', label: 'Messages', adminOnly: true },
  { key: 'traffic', label: 'Traffic', adminOnly: true },
  { key: 'team_members', label: 'Team', superAdminOnly: true },
  { key: 'logs', label: 'Logs', superAdminOnly: true },
];

const Admin = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setActiveTab] = useState('profile');
  const [accessDenied, setAccessDenied] = useState(false);
  const resendTokenRef = useRef(null);
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [requestSubmitted, setRequestSubmitted] = useState(false);
  const [userProfile, setUserProfile] = useState(null);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        // Fetch custom claims to check if the user is an admin
        const token = await currentUser.getIdTokenResult();
        const isAdmin = token.claims.admin === true;
        const isSuperAdmin = token.claims.superAdmin === true;
        
        let isTeamMember = false;
        let isVerified = true;
        
        // Always check the user document to ensure they haven't been archived/deleted
        const userDoc = await getDoc(doc(db, 'users', currentUser.email.toLowerCase()));
        
        if (userDoc.exists()) {
          const data = userDoc.data();
          if (data.isArchived) {
            isTeamMember = false;
          } else {
            isTeamMember = true;
            if (data.status && data.status !== 'active') {
              isVerified = false;
            }
          }
        } else {
          // If no user doc exists, they are only a member if they possess admin claims (e.g. root fallback)
          isTeamMember = isAdmin;
        }

        if (!isTeamMember) {
          await signOut(auth);
          setAccessDenied('not_member');
          setLoading(false);
          return;
        }

        if (!isVerified) {
          // Keep this account's ID token (valid for an hour) so "Resend
          // Verification Email" can prove who is asking after we sign out.
          resendTokenRef.current = await currentUser.getIdToken();
          await signOut(auth);
          setAccessDenied('unverified');
          setLoading(false);
          return;
        }

        setUser({
          ...currentUser,
          isAdmin,
          isSuperAdmin
        });
      } catch (error) {
        console.error("Error checking claims:", error);
        setUser(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!user || !user.email) return;
    const unsub = onSnapshot(doc(db, 'users', user.email.toLowerCase()), (snap) => {
      if (snap.exists()) {
        setUserProfile(snap.data());
      }
    });
    return () => unsub();
  }, [user]);

  // Non-admins only ever see their profile. Derived during render rather than
  // corrected in an effect, which rendered the wrong tab first.
  const activeTab = user && !user.isAdmin ? 'profile' : selectedTab;

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login Error:", error);
      alert("Failed to login: " + error.message);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout Error:", error);
    }
  };

  if (loading) {
    return (
      <div className="admin-container flex-center">
        <div className="loading-spinner">Loading…</div>
      </div>
    );
  }

  if (showJoinForm) {
    return (
      <div className="admin-container flex-center" style={{ padding: '40px 20px' }}>
        <JoinRequestForm 
          onCancel={() => setShowJoinForm(false)} 
          onSuccess={() => {
            setShowJoinForm(false);
            setRequestSubmitted(true);
          }} 
        />
      </div>
    );
  }

  if (requestSubmitted) {
    return (
      <div className="admin-container flex-center">
        <div className="admin-glass-panel login-panel">
          <h2>Request Submitted</h2>
          <p>Your request to join the team has been submitted. A Super Admin will review it shortly.</p>
          <button onClick={() => setRequestSubmitted(false)} className="admin-btn secondary">
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="admin-container flex-center">
        <div className="admin-glass-panel login-panel">
          {accessDenied === 'unverified' ? (
            <>
              <h2 style={{ color: '#ff4d4f' }}>Account Not Verified</h2>
              <p>Your account has not yet been activated. Please verify your email using the verification email sent after your team request was approved.</p>
              <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button 
                  onClick={async () => {
                    const idToken = resendTokenRef.current;
                    if (!idToken) {
                      alert("Please sign in again, then resend the email.");
                      return;
                    }
                    try {
                      const res = await fetch(`${API_URL}/api/resend-verification`, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${idToken}` },
                      });
                      if (res.ok) {
                        alert("Verification email resent!");
                      } else if (res.status === 401) {
                        resendTokenRef.current = null;
                        alert("Your sign-in has expired. Please sign in again, then resend the email.");
                      } else {
                        const err = await res.json().catch(() => ({}));
                        alert(err.error || "Failed to resend email.");
                      }
                    } catch {
                      alert("Network error.");
                    }
                  }}
                  className="admin-btn primary"
                >
                  Resend Verification Email
                </button>
                <button onClick={() => setAccessDenied(false)} className="admin-btn secondary">Try Another Account</button>
              </div>
            </>
          ) : (
            <>
              <h2 style={{ color: '#ff4d4f' }}>Access Denied</h2>
              <p>You do not have team member privileges for this email.</p>
              <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button onClick={() => setShowJoinForm(true)} className="admin-btn primary">Join Team Rotor</button>
                <button onClick={() => setAccessDenied(false)} className="admin-btn secondary">Try Another Account</button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="admin-container flex-center">
        <div className="admin-glass-panel login-panel">
          <h2>Admin Access</h2>
          <p>Please sign in to manage achievements, gallery, and admins.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <button onClick={handleLogin} className="google-login-btn">
              Sign in with Google
            </button>
            <button onClick={() => setShowJoinForm(true)} className="admin-btn secondary">
              Request Team Access
            </button>
          </div>
        </div>
      </div>
    );
  }

  const visibleTabs = TABS.filter(tab => {
    if (tab.superAdminOnly && !user.isSuperAdmin) return false;
    if (tab.adminOnly && !user.isAdmin) return false;
    return true;
  });

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'profile': return <ProfileTab user={user} />;
      case 'home': return <HomeSettingsTab user={user} />;
      case 'achievements': return <AchievementsTab />;
      case 'gallery': return <GalleryTab />;
      case 'team': return user.isSuperAdmin ? <TeamTab /> : null;
      case 'events': return <EventsTab user={user} />;
      case 'drones': return <DronesTab user={user} />;
      case 'sponsors': return <SponsorsTab user={user} />;
      case 'socials': return <SocialsTab />;

      case 'contact_messages': return <ContactMessagesAdmin />;
      case 'traffic': return <TrafficTab />;
      case 'team_members': return user.isSuperAdmin ? <TeamMembersTab user={user} /> : null;
      case 'logs': return user.isSuperAdmin ? <LogsTab /> : null;
      default: return null;
    }
  };

  return (
    <div className="admin-container">
      <div className="admin-header">
        <h1>Dashboard</h1>
        <div className="user-info">
          <button 
            onClick={() => setActiveTab('profile')} 
            className="admin-btn secondary"
            title={user.email}
            style={{ 
              padding: userProfile?.image ? '0' : '8px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              borderRadius: '50%',
              background: activeTab === 'profile' ? 'rgba(100, 255, 218, 0.15)' : '',
              color: activeTab === 'profile' ? 'var(--accent)' : '',
              borderColor: activeTab === 'profile' ? 'rgba(100, 255, 218, 0.5)' : '',
              overflow: 'hidden',
              width: '38px',
              height: '38px'
            }}
          >
            {userProfile?.image ? (
              <img src={userProfile.image} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <User size={20} />
            )}
          </button>
          <button onClick={handleLogout} className="admin-btn secondary">Sign Out</button>
        </div>
      </div>

      <div className="admin-tabs">
        <PillNav
          items={visibleTabs.map(tab => ({ key: tab.key, label: tab.label }))}
          activeKey={activeTab}
          onItemClick={setActiveTab}
        />
      </div>

      <div className="admin-content">
        {renderActiveTab()}
      </div>
    </div>
  );
};

export default Admin;
