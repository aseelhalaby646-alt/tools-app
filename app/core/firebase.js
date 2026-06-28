// firebase.js — initialise Firebase (Auth + Firestore) from the official CDN.
// Loaded only in the LIVE app (not in demo/tests), via dynamic import, so the
// offline lab never needs the network.
import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager }
  from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Offline persistence: the SDK caches the last data in IndexedDB so reads work with no signal
// (the app stays read-only offline — see app.js). Falls back to a plain instance if unsupported.
let _fdb;
try {
  _fdb = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch (e) {
  _fdb = getFirestore(app);
}
export const fdb = _fdb;

export const login = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const logout = () => signOut(auth);
export const onAuth = (cb) => onAuthStateChanged(auth, cb);
