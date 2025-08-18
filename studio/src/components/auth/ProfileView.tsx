import React, { useState, useEffect } from 'react';
import useAuth from '../../hooks/useAuth';

interface ProfileViewProps {
  onBackClick: () => void;
}

interface UserProfile {
  name: string;
  avatar?: string;
  preferences?: {
    theme?: string;
  };
}

const ProfileView: React.FC<ProfileViewProps> = ({ onBackClick }) => {
  const { user, updateUserProfile, signOut } = useAuth();
  const [profile, setProfile] = useState<UserProfile>({
    name: user?.displayName || ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load user profile from backend
  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) return;
      
      setIsLoading(true);
      try {
        const response = await fetch('/api/user/profile', {
          headers: {
            'Authorization': `Bearer ${await user.getIdToken()}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          setProfile({
            name: data.name || user.displayName || '',
            avatar: data.avatar || user.photoURL || '',
            preferences: data.preferences
          });
        }
      } catch (err) {
        console.error('Error fetching profile:', err);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchProfile();
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);
    
    try {
      // Update Firebase profile
      await updateUserProfile(profile.name, profile.avatar);
      
      // Update backend profile
      const response = await fetch('/api/user/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await user.getIdToken()}`
        },
        body: JSON.stringify({
          name: profile.name,
          avatar: profile.avatar,
          preferences: profile.preferences
        })
      });
      
      if (response.ok) {
        setSuccessMessage('Profile updated successfully!');
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to update profile');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error('Error signing out:', err);
    }
  };

  if (!user) {
    return (
      <div className="profile-container">
        <p>Please sign in to view your profile.</p>
        <button onClick={onBackClick}>Back</button>
      </div>
    );
  }

  const providerIcon = () => {
    // Display the provider icon based on the user's provider data
    const providerId = user.providerData[0]?.providerId;
    
    if (providerId === 'google.com') {
      return (
        <span className="profile-provider google">
          <svg className="provider-icon" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Google
        </span>
      );
    } else if (providerId === 'github.com') {
      return (
        <span className="profile-provider github">
          <svg className="provider-icon" viewBox="0 0 24 24">
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" fill="#191717"/>
          </svg>
          GitHub
        </span>
      );
    } else {
      return (
        <span className="profile-provider email">
          <svg className="provider-icon" viewBox="0 0 24 24">
            <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" fill="#4B5563"/>
          </svg>
          Email
        </span>
      );
    }
  };

  return (
    <div className="profile-container">
      <h1>Your Profile</h1>
      
      {error && <div className="profile-error">{error}</div>}
      {successMessage && <div className="profile-success">{successMessage}</div>}
      
      <form onSubmit={handleSubmit} className="profile-form">
        <div className="form-group">
          <label htmlFor="name">Display Name</label>
          <input
            id="name"
            type="text"
            value={profile.name}
            onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            placeholder="Your name"
            required
          />
        </div>
        
        <div className="form-group">
          <label htmlFor="avatar">Avatar URL</label>
          <input
            id="avatar"
            type="text"
            value={profile.avatar || ''}
            onChange={(e) => setProfile({ ...profile, avatar: e.target.value })}
            placeholder="Avatar URL (optional)"
          />
        </div>
        
        <div className="form-group">
          <label>Email</label>
          <div className="profile-email">{user.email}</div>
        </div>
        
        <div className="form-group">
          <label>Sign-in Provider</label>
          <div className="profile-provider-info">
            {providerIcon()}
          </div>
        </div>
        
        <div className="profile-actions">
          <button 
            type="submit" 
            className="profile-submit-button"
            disabled={isLoading}
          >
            {isLoading ? 'Saving...' : 'Save Profile'}
          </button>
          
          <button 
            type="button" 
            className="profile-back-button"
            onClick={onBackClick}
          >
            Back
          </button>
          
          <button 
            type="button" 
            className="profile-signout-button"
            onClick={handleSignOut}
          >
            Sign Out
          </button>
        </div>
      </form>
    </div>
  );
};

export default ProfileView; 