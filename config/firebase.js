import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, addDoc, serverTimestamp } from "firebase/firestore";

// Use the same config as frontend
const firebaseConfig = {
  apiKey: "AIzaSyCW5_zWpJOlbCD4DNhZNLFhR1ocUycbyD4",
  authDomain: "alertify-31071.firebaseapp.com",
  projectId: "alertify-31071",
  storageBucket: "alertify-31071.firebasestorage.app",
  messagingSenderId: "550197651053",
  appId: "1:550197651053:web:91cc31a575b5504c2fc164",
  measurementId: "G-3PT5EF7L8Y"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);