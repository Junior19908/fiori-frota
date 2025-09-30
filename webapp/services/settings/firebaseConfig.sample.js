// Exemplo de configuração Firebase (NÃO COMMITAR firebaseConfig.js real)
// Copie este arquivo para firebaseConfig.js e preencha as credenciais.

// Você pode exportar apenas o objeto abaixo (recomendado para não depender do SDK no build),
// ou exportar { app, db, storage } já inicializados. O serviço de exportação suporta ambos.

export const firebaseConfig = {
  apiKey: "AIzaSyDYT-I6dQ5ofBMkW4bJWuzVh4LsSMvh604",
  authDomain: "sistemagsg.firebaseapp.com",
  databaseURL: "https://sistemagsg.firebaseio.com",
  projectId: "sistemagsg",
  // Atenção: normalmente o bucket padrão é <project-id>.appspot.com
  storageBucket: "sistemagsg.appspot.com",
  messagingSenderId: "556048686957",
  appId: "1:556048686957:web:82d6f972ed4741e3174464"
};
// Alternativa (opcional): descomente e use o SDK localmente, se preferir
// import { initializeApp } from "firebase/app";
// import { getFirestore } from "firebase/firestore";
// import { getStorage } from "firebase/storage";
// export const app = initializeApp(firebaseConfig);
// export const db = getFirestore(app);
// export const storage = getStorage(app);
