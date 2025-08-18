import { useState, useEffect } from 'react';
import { 
  getAuth, 
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  signInWithPopup,
  GoogleAuthProvider,
  GithubAuthProvider,
  updateProfile,
  User,
  AuthProvider,
  AuthError
} from 'firebase/auth';

export interface AuthHookResult {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<User>;
  signUp: (email: string, password: string, displayName?: string) => Promise<User>;
  signInWithGoogle: () => Promise<User>;
  signInWithGitHub: () => Promise<User>;
  signOut: () => Promise<void>;
  updateUserProfile: (displayName: string, photoURL?: string) => Promise<void>;
}

const useAuth = (): AuthHookResult => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const auth = getAuth();

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsLoading(false);
    }, (error) => {
      setError(error.message);
      setIsLoading(false);
    });

    // Cleanup subscription
    return () => unsubscribe();
  }, [auth]);

  // Sign in with email and password
  const signIn = async (email: string, password: string): Promise<User> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      return result.user;
    } catch (error: any) {
      const authError = error as AuthError;
      setError(authError.message);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  // Sign up with email and password
  const signUp = async (email: string, password: string, displayName?: string): Promise<User> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      
      // Update profile if displayName is provided
      if (displayName && result.user) {
        await updateProfile(result.user, { displayName });
      }
      
      return result.user;
    } catch (error: any) {
      const authError = error as AuthError;
      setError(authError.message);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  // Sign in with Google
  const signInWithGoogle = async (): Promise<User> => {
    setIsLoading(true);
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      return result.user;
    } catch (error: any) {
      const authError = error as AuthError;
      setError(authError.message);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  // Sign in with GitHub
  const signInWithGitHub = async (): Promise<User> => {
    setIsLoading(true);
    setError(null);
    try {
      const provider = new GithubAuthProvider();
      const result = await signInWithPopup(auth, provider);
      return result.user;
    } catch (error: any) {
      const authError = error as AuthError;
      setError(authError.message);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  // Sign out
  const signOut = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      await firebaseSignOut(auth);
    } catch (error: any) {
      const authError = error as AuthError;
      setError(authError.message);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  // Update user profile
  const updateUserProfile = async (displayName: string, photoURL?: string): Promise<void> => {
    setIsLoading(true);
    setError(null);
    if (!user) {
      setError("No user is logged in");
      setIsLoading(false);
      throw new Error("No user is logged in");
    }
    
    try {
      await updateProfile(user, { displayName, photoURL });
      // Force refresh the user object
      setUser({ ...user });
    } catch (error: any) {
      const authError = error as AuthError;
      setError(authError.message);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  return { 
    user, 
    isLoading, 
    error, 
    signIn, 
    signUp, 
    signInWithGoogle,
    signInWithGitHub,
    signOut, 
    updateUserProfile 
  };
};

export default useAuth; 