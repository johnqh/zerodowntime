import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { firebaseAuth } from "../firebase";

export interface AuthState {
  user: Pick<User, "uid" | "email"> | null;
  token: string | null;
  loading: boolean;
  signIn(): Promise<void>;
  signOutUser(): Promise<void>;
}

export const AuthContext = createContext<AuthState>({
  user: null,
  token: null,
  loading: true,
  signIn: async () => {},
  signOutUser: async () => {},
});

export const useAuth = (): AuthState => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthState["user"]>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const auth = firebaseAuth();
    return onAuthStateChanged(auth, async (next) => {
      if (next) {
        setUser({ uid: next.uid, email: next.email });
        setToken(await next.getIdToken());
      } else {
        setUser(null);
        setToken(null);
      }
      setLoading(false);
    });
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      token,
      loading,
      signIn: async () => {
        await signInWithPopup(firebaseAuth(), new GoogleAuthProvider());
      },
      signOutUser: async () => {
        await signOut(firebaseAuth());
      },
    }),
    [user, token, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
