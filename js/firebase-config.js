/* ==================================================================
   Configuração do Firebase (passo a passo no README.md).

   1. Crie um projeto em https://console.firebase.google.com
   2. Ative o "Realtime Database".
   3. Em Configurações do projeto › Seus apps, registre um app Web (</>)
      e copie o objeto firebaseConfig para cá, no lugar de null.

   Exemplo:
   window.FIREBASE_CONFIG = {
     apiKey: "AIza...",
     authDomain: "trilha-de-auditoria.firebaseapp.com",
     databaseURL: "https://trilha-de-auditoria-default-rtdb.firebaseio.com",
     projectId: "trilha-de-auditoria",
     appId: "1:123:web:abc"
   };

   Com null, o jogo funciona só na TV (ou em modo de teste entre abas).
   ================================================================== */
window.FIREBASE_CONFIG = null;
