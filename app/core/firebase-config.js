// firebase-config.js — public Firebase project config for "tools-251d3".
// NOTE: the apiKey here is NOT a secret. In Firebase it only identifies the
// project; real access control is enforced by Firestore Security Rules + Auth.
// Safe to ship in client code.
export const firebaseConfig = {
  apiKey: "AIzaSyC1SeMl-EYHgu1RMZQRGUKD_j7RisW4rhM",
  authDomain: "tools-251d3.firebaseapp.com",
  projectId: "tools-251d3",
  storageBucket: "tools-251d3.firebasestorage.app",
  messagingSenderId: "82198599742",
  appId: "1:82198599742:web:ff369efe63771d3607596f",
};

// Which Firebase services this app uses (wired in the Firebase storage adapter).
export const FIREBASE_SERVICES = ["auth", "firestore", "storage"];
