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

    // Uploaded trailers are stored as numbered pieces (a database entry holds at most 1 MB).
    // They are fetched only when a visitor first hovers the game, then kept in memory.
    const videoUrls = new Map();
    window.GMM_CLOUD = {
      loadVideo(id) {
        if (!videoUrls.has(id)) {
          const job = (async () => {
            const meta = await fs.getDoc(fs.doc(db, 'videos', id));
            if (!meta.exists()) throw new Error('Video not found');
            const info = meta.data();
            const parts = await Promise.all(Array.from({ length: info.chunks }, (_, i) =>
              fs.getDoc(fs.doc(db, 'videos', id, 'chunks', String(i).padStart(4, '0')))));
            const bytes = parts.map((p) => {
              if (!p.exists()) throw new Error('Video is incomplete');
              return p.data().data.toUint8Array();
            });
            return URL.createObjectURL(new Blob(bytes, { type: info.type || 'video/mp4' }));
          })();
          job.catch(() => videoUrls.delete(id));
          videoUrls.set(id, job);
        }
        return videoUrls.get(id);
      },
    };

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
