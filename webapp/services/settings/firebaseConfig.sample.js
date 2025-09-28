// Exemplo de configuração Firebase (NÃO COMMITAR firebaseConfig.js real)
// Copie este arquivo para firebaseConfig.js e preencha as credenciais.

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyDYT-I6dQ5ofBMkW4bJWuzVh4LsSMvh604",
  authDomain: "sistemagsg.firebaseapp.com",
  databaseURL: "https://sistemagsg.firebaseio.com",
  projectId: "sistemagsg",
  storageBucket: "sistemagsg.firebasestorage.app",
  messagingSenderId: "556048686957",
  appId: "1:556048686957:web:82d6f972ed4741e3174464"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);

