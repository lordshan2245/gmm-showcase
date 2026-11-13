// Loads games and branding from the online database (Firebase Firestore) when it is configured.
// The admin panel at /admin/ writes this data; visitors only ever read it.
const cfg = window.FIREBASE_CONFIG;
if (cfg) {
  try {
    const base = 'https://www.gstatic.com/firebasejs/10.12.2/';
    const [{ initializeApp }, fs] = await Promise.all([
      import(base + 'firebase-app.js'),
      import(base + 'firebase-firestore-lite.js'),
    ]);
    const db = fs.getFirestore(initializeApp(cfg));
    const [gameDocs, siteDoc] = await Promise.all([
      fs.getDocs(fs.collection(db, 'games')),
      fs.getDoc(fs.doc(db, 'config', 'site')),
    ]);
    const games = gameDocs.docs.map((d) => Object.assign({ id: d.id }, d.data()));
    games.sort((a, b) => (a.order || 0) - (b.order || 0));
    // Until the games have been imported into the database, keep showing the saved copy.
    if (games.length || siteDoc.exists()) {
      window.GAMES = games;
      if (siteDoc.exists()) window.SITE = siteDoc.data();
    }
  } catch (err) {
    console.warn('Online data unavailable, showing the saved copy.', err);
  }
  window.dispatchEvent(new Event('gmm-data'));
}
