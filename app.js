(function () {
  'use strict';

  var PLATFORMS = ['PC', 'Mobile', 'Web'];
  var games = Array.isArray(window.GAMES) ? window.GAMES : [];

  var grid = document.getElementById('grid');
  var empty = document.getElementById('empty');
  var filters = document.getElementById('filters');
  var video = document.getElementById('bgVideo');
  var frame = document.getElementById('bgFrame');
  var nowName = document.getElementById('nowName');

  var filter = 'All';
  var currentId = null;
  var showTimer = null;
  var hideTimer = null;
  var touchMode = window.matchMedia('(hover: none)').matches;

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function safeLink(url) {
    return typeof url === 'string' && /^https?:\/\//i.test(url.trim()) ? url.trim() : '';
  }

  // Per-platform links: { PC: url, Mobile: url, Web: url }. Older entries had a single "link".
  function linksOf(game) {
    var out = {};
    var raw = game.links && typeof game.links === 'object' ? game.links : null;
    (game.platforms || []).forEach(function (p) {
      var url = safeLink(raw ? raw[p] : game.link);
      if (url) out[p] = url;
    });
    return out;
  }

  function youtubeId(url) {
    var m = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/i.exec(url || '');
    return m ? m[1] : '';
  }

  // ---------- Trailer background ----------
  function startTrailer(game, card) {
    clearTimeout(hideTimer);
    if (currentId === game.id) return;
    stopNow();
    if (!game.trailer) return;

    currentId = game.id;
    card.classList.add('active');
    nowName.textContent = game.name || '';

    var yt = youtubeId(game.trailer);
    if (yt) {
      video.hidden = true;
      frame.hidden = false;
      var iframe = document.createElement('iframe');
      iframe.allow = 'autoplay; encrypted-media';
      // Starts muted (always allowed), then applySound() turns the sound on through the player API.
      iframe.src = 'https://www.youtube-nocookie.com/embed/' + yt +
        '?autoplay=1&mute=1&controls=0&loop=1&playlist=' + yt +
        '&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&enablejsapi=1';
      iframe.addEventListener('load', function () {
        // The player takes a moment to accept commands after the frame loads.
        [0, 400, 1200, 2500].forEach(function (ms) {
          setTimeout(function () { if (iframe.isConnected) applySound(); }, ms);
        });
      });
      frame.appendChild(iframe);
      document.body.classList.add('trailer-on');
    } else {
      frame.hidden = true;
      video.hidden = false;
      document.body.classList.add('trailer-on');
      var uploaded = /^db:(.+)$/.exec(game.trailer);
      var drive = driveFileId(game.trailer);
      if (uploaded) {
        // A video uploaded through the admin panel: fetch it from the database (kept in memory after the first time).
        if (!window.GMM_CLOUD) { nowName.textContent = (game.name || '') + ' — trailer unavailable'; return; }
        nowName.textContent = (game.name || '') + ' — loading trailer…';
        window.GMM_CLOUD.loadVideo(uploaded[1]).then(function (url) {
          if (currentId !== game.id) return;
          nowName.textContent = game.name || '';
          playFile(url);
        }).catch(function () {
          if (currentId === game.id) nowName.textContent = (game.name || '') + ' — trailer could not be loaded';
        });
      } else if (drive) {
        video.onerror = function () {
          if (currentId === game.id) nowName.textContent = (game.name || '') + ' — Google Drive would not play this video';
        };
        playFile('https://drive.google.com/uc?export=download&id=' + drive);
      } else {
        playFile(game.trailer);
      }
    }
    updateSoundUi();
  }

  function playFile(url) {
    video.src = url;
    video.currentTime = 0;
    video.muted = !(soundOn && unlocked);
    var p = video.play();
    if (p && p.catch) p.catch(function () {
      // The browser refused to start with sound: play silently instead.
      video.muted = true;
      var q = video.play();
      if (q && q.catch) q.catch(function () {});
    });
  }

  // Google Drive share links: .../file/d/<id>/view, open?id=<id>, uc?id=<id>
  function driveFileId(url) {
    if (!/(^|\/\/)(drive|docs)\.google\.com\//i.test(url || '')) return '';
    var m = /\/file\/d\/([\w-]{20,})/.exec(url) || /[?&]id=([\w-]{20,})/.exec(url);
    return m ? m[1] : '';
  }

  // ---------- Sound ----------
  // Browsers only allow sound after the visitor has clicked or pressed a key on the page,
  // so trailers play silently until that first interaction.
  var soundBtn = document.getElementById('soundBtn');
  var soundHint = document.getElementById('soundHint');
  var soundOn = true;
  var unlocked = false;
  try { soundOn = localStorage.getItem('gmm-sound') !== 'off'; } catch (e) {}

  function ytCommand(func, args) {
    var iframe = frame.querySelector('iframe');
    if (!iframe || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: func, args: args || [] }), '*');
  }

  function applySound() {
    var audible = soundOn && unlocked;
    video.muted = !audible;
    if (audible) { ytCommand('unMute'); ytCommand('setVolume', [100]); }
    else ytCommand('mute');
    updateSoundUi();
  }

  function updateSoundUi() {
    soundBtn.textContent = soundOn ? '🔊 Sound on' : '🔇 Sound off';
    soundBtn.setAttribute('aria-pressed', String(soundOn));
    soundHint.hidden = !(soundOn && !unlocked);
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    applySound();
  }
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);

  soundBtn.addEventListener('click', function () {
    soundOn = !soundOn;
    try { localStorage.setItem('gmm-sound', soundOn ? 'on' : 'off'); } catch (e) {}
    unlocked = true;
    applySound();
  });

  function stopNow() {
    clearTimeout(hideTimer);
    currentId = null;
    var active = grid.querySelector('.card.active');
    if (active) active.classList.remove('active');
    video.onerror = null;
    video.pause();
    video.removeAttribute('src');
    video.load();
    frame.textContent = '';
  }

  function stopTrailer() {
    clearTimeout(showTimer);
    if (currentId === null) return;
    document.body.classList.remove('trailer-on');
    var active = grid.querySelector('.card.active');
    if (active) active.classList.remove('active');
    currentId = null;
    // Let the fade-out finish before unloading the video.
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      if (currentId === null) stopNow();
    }, 480);
  }

  // ---------- Cards ----------
  function buildCard(game) {
    var card = el('article', 'card');
    var links = linksOf(game);
    // The icon opens the quickest way to play: browser first, then PC, then mobile.
    var link = links.Web || links.PC || links.Mobile || '';

    var icon = el('a', 'icon');
    icon.setAttribute('aria-label', (game.name || 'Game') + (link ? ' — play' : ''));
    if (link) {
      icon.href = link;
      icon.target = '_blank';
      icon.rel = 'noopener';
    } else {
      icon.tabIndex = 0;
    }
    if (game.icon) {
      var img = el('img');
      img.src = game.icon;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = function () {
        img.remove();
        icon.insertBefore(el('span', 'letter', (game.name || '?').trim().charAt(0).toUpperCase()), icon.firstChild);
      };
      icon.appendChild(img);
    } else {
      icon.appendChild(el('span', 'letter', (game.name || '?').trim().charAt(0).toUpperCase()));
    }
    if (game.trailer) icon.appendChild(el('span', 'has-trailer', '▶'));

    // Hover (mouse) and keyboard focus start the trailer after a short beat,
    // so sweeping the cursor across the grid doesn't flicker.
    // The whole card is the hover area, so the trailer keeps playing while the
    // cursor moves from the icon down to the platform links.
    card.addEventListener('pointerenter', function (e) {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(showTimer);
      showTimer = setTimeout(function () { startTrailer(game, card); }, 140);
    });
    card.addEventListener('pointerleave', function (e) {
      if (e.pointerType !== 'mouse') return;
      stopTrailer();
    });
    icon.addEventListener('focus', function () { if (!touchMode) startTrailer(game, card); });
    icon.addEventListener('blur', function () { if (!touchMode) stopTrailer(); });

    // Touch screens have no hover: first tap on the icon previews the trailer,
    // the Play button opens the game.
    icon.addEventListener('click', function (e) {
      if (!touchMode || !game.trailer) return;
      e.preventDefault();
      e.stopPropagation();
      if (currentId === game.id) stopTrailer();
      else startTrailer(game, card);
    });

    card.appendChild(icon);
    card.appendChild(el('h2', '', game.name || 'Untitled'));
    if (game.genre) card.appendChild(el('p', 'genre', game.genre));

    // Platform tags double as the playable links: a platform with a link is clickable.
    var tags = el('ul', 'tags');
    PLATFORMS.forEach(function (p) {
      if ((game.platforms || []).indexOf(p) === -1) return;
      var li = el('li');
      if (links[p]) {
        var a = el('a', 'tag link ' + p.toLowerCase(), p + ' ↗');
        a.href = links[p];
        a.target = '_blank';
        a.rel = 'noopener';
        a.setAttribute('aria-label', 'Play ' + (game.name || 'game') + ' on ' + p);
        li.appendChild(a);
      } else {
        li.appendChild(el('span', 'tag ' + p.toLowerCase(), p));
      }
      tags.appendChild(li);
    });
    card.appendChild(tags);
    return card;
  }

  function render() {
    stopNow();
    document.body.classList.remove('trailer-on');
    grid.textContent = '';
    var list = games.filter(function (g) {
      return filter === 'All' || (g.platforms || []).indexOf(filter) !== -1;
    });
    list.forEach(function (g) { grid.appendChild(buildCard(g)); });
    empty.hidden = list.length > 0;
  }

  function renderFilters() {
    filters.textContent = '';
    ['All'].concat(PLATFORMS).forEach(function (name) {
      var count = name === 'All' ? games.length : games.filter(function (g) {
        return (g.platforms || []).indexOf(name) !== -1;
      }).length;
      var chip = el('button', 'chip', name);
      chip.type = 'button';
      chip.appendChild(el('small', '', String(count)));
      chip.setAttribute('aria-pressed', String(name === filter));
      chip.addEventListener('click', function () {
        filter = name;
        renderFilters();
        render();
      });
      filters.appendChild(chip);
    });
  }

  document.addEventListener('click', function () { if (touchMode) stopTrailer(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stopTrailer(); });

  // ---------- Branding (logo + colours from settings.js) ----------
  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function luminance(rgb) { return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255; }

  function applyBranding() {
    var site = window.SITE && typeof window.SITE === 'object' ? window.SITE : {};
    var root = document.documentElement.style;
    var bg = hexToRgb(site.bg);
    var accent = hexToRgb(site.accent);
    if (bg) {
      root.setProperty('--bg', site.bg);
      // Pick readable text for a dark or a light background.
      root.setProperty('--text', luminance(bg) > 0.55 ? '#14161d' : '#f4f1e8');
    }
    if (accent) {
      root.setProperty('--accent', site.accent);
      root.setProperty('--accent-ink', luminance(accent) > 0.55 ? '#14161d' : '#ffffff');
    }
    // Optional second accent: the end colour of the brand gradient.
    if (hexToRgb(site.accent2)) root.setProperty('--accent2', site.accent2);
    if (site.logo) {
      var mark = document.getElementById('mark');
      var img = el('img', 'logo');
      img.src = site.logo;
      img.alt = 'Game Makers Myanmar';
      img.onload = function () { mark.replaceWith(img); };
      var icon = document.createElement('link');
      icon.rel = 'icon';
      icon.href = site.logo;
      document.head.appendChild(icon);
    }
    if (site.showTitle === false && site.logo) document.getElementById('siteTitle').hidden = true;
  }

  function boot() {
    games = Array.isArray(window.GAMES) ? window.GAMES : [];
    applyBranding();
    updateSoundUi();
    renderFilters();
    render();
  }

  // With the online database configured, cloud.js loads the games and fires "gmm-data".
  // If it takes too long (offline, blocked), fall back to the games saved with the site.
  if (window.FIREBASE_CONFIG) {
    var booted = false;
    var once = function () { if (!booted) { booted = true; boot(); } };
    window.addEventListener('gmm-data', once);
    setTimeout(once, 7000);
  } else {
    boot();
  }
})();
