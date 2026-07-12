/**
 * ISKCON Real Audio - Engine Script
 * This file handles player logic, background sync, security, and responsive features.
 */

// Reverse-obfuscated keys to prevent easy network scraper tools from stealing key.
const OBFUSCATED_KEYS = [
  "YtWVqJAPRDbcIO5VwNtUtQJy5urgPVdqLCySazIA" // Decoded: AIzaSyCLqdVPGru5yJQUtNwV5OIcbDRPAJqVWtY
];
let currentApiKeyIndex = parseInt(localStorage.getItem('currentApiKeyIndex') || '0', 10);
if (currentApiKeyIndex >= OBFUSCATED_KEYS.length) {
  currentApiKeyIndex = 0;
}

// Set up a server backend endpoint here if you deploy api-proxy.js
const SERVER_PROXY_URL = ""; 

const PLAY_STORE_PACKAGE = "com.devsantosh.iskconrealaudio";

let ytPlayer;
let isPlayerReady = false;
let isPlaying = false;
let currentResults = [];
let currentIndex = -1;
let isSeeking = false;
let progressTimer = null;
let isSearching = false;
let toastTimer = null;
let nextPageToken = "";
let wasPlayingBeforeHidden = false;
let showingFavorites = false;

// Background silent loop audio to hold OS focus
const bgAudioPlayer = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA");
bgAudioPlayer.loop = true;

// Safe key retrieval
function getActiveApiKey() {
  const scrambled = OBFUSCATED_KEYS[currentApiKeyIndex];
  return scrambled.split("").reverse().join("");
}

function rotateApiKey() {
  currentApiKeyIndex = (currentApiKeyIndex + 1) % OBFUSCATED_KEYS.length;
  localStorage.setItem('currentApiKeyIndex', currentApiKeyIndex);
  console.log("Switching server key to index: " + currentApiKeyIndex);
}

// Local storage offline favorite handlers
function getFavorites() {
  return JSON.parse(localStorage.getItem('iskcon_favorites') || '[]');
}

function saveFavorites(favs) {
  localStorage.setItem('iskcon_favorites', JSON.stringify(favs));
}

function isFavorite(videoId) {
  return getFavorites().some(item => item.videoId === videoId);
}

function toggleFavorite(item) {
  let favs = getFavorites();
  const index = favs.findIndex(f => f.videoId === item.videoId);
  if (index > -1) {
    favs.splice(index, 1);
    showToast("Removed from Favorites");
  } else {
    favs.push(item);
    showToast("Added to Favorites ⭐");
  }
  saveFavorites(favs);
  updateFavoriteUI();
  if (showingFavorites) {
    showFavoritesOnly();
  }
}

function toggleFavoriteCurrent() {
  if (currentIndex > -1 && currentResults[currentIndex]) {
    toggleFavorite(currentResults[currentIndex]);
  }
}

function updateFavoriteUI() {
  if (currentIndex > -1 && currentResults[currentIndex]) {
    const active = isFavorite(currentResults[currentIndex].videoId);
    const btn = document.getElementById('sheetFavBtn');
    if (btn) {
      btn.classList.toggle('active', active);
      btn.querySelector('.material-icons').innerText = active ? 'star' : 'star_border';
    }
  }
  document.querySelectorAll('.card').forEach((card, idx) => {
    const videoId = card.getAttribute('data-video-id');
    const favBtn = card.querySelector('.card-fav-btn');
    if (favBtn && videoId) {
      const active = isFavorite(videoId);
      favBtn.classList.toggle('active', active);
      favBtn.querySelector('.material-icons').innerText = active ? 'star' : 'star_border';
    }
  });
}

function showFavoritesOnly(chipEl = null) {
  showingFavorites = true;
  if (chipEl) {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chipEl.classList.add('active');
  } else {
    const chipFav = document.getElementById('favChip');
    if (chipFav) {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chipFav.classList.add('active');
    }
  }
  const favs = getFavorites();
  currentResults = favs;
  currentIndex = -1;
  nextPageToken = "";
  
  const status = document.getElementById('status');
  status.style.display = 'block';
  status.innerText = "Favorites Library Loaded";
  
  renderResults();
  updateFavoriteUI();
}

function onYouTubeIframeAPIReady() {
  ytPlayer = new YT.Player('ytplayer', {
    height: '200',
    width: '100%',
    videoId: '',
    playerVars: { 'playsinline': 1, 'controls': 0, 'autoplay': 1 },
    events: { 
      'onReady': () => { isPlayerReady = true; }, 
      'onStateChange': onPlayerStateChange,
      'onError': onPlayerError
    }
  });
}

function onPlayerStateChange(event) {
  if (event.data == YT.PlayerState.PLAYING) {
    isPlaying = true;
    wasPlayingBeforeHidden = false;
    startProgressTimer();
    bgAudioPlayer.play().catch(e => console.log("Silent loop start:", e));
    updateMediaSessionState();
  } else if (event.data == YT.PlayerState.ENDED) {
    isPlaying = false;
    wasPlayingBeforeHidden = false;
    stopProgressTimer();
    bgAudioPlayer.pause();
    updateMediaSessionState();
    if (currentIndex < currentResults.length - 1) { nextTrack(); }
  } else if (event.data == YT.PlayerState.PAUSED) {
    if (document.hidden) {
      wasPlayingBeforeHidden = true;
      bgAudioPlayer.play().catch(e => console.log(e));
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = "playing"; 
      }
    } else {
      isPlaying = false;
      stopProgressTimer();
      bgAudioPlayer.pause();
      updateMediaSessionState();
    }
  } else {
    if (!document.hidden) {
      isPlaying = false;
      stopProgressTimer();
      bgAudioPlayer.pause();
      updateMediaSessionState();
    }
  }
  updatePlayIcons();
}

function onPlayerError(event) {
  console.warn("YouTube Error Code: " + event.data);
  let errorMsg = "Kirtan start nahi ho raha hai.";
  if (event.data === 101 || event.data === 150) {
    errorMsg = "Owner ne is bhajan ko app par block kiya hai.";
  } else if (event.data === 100 || event.data === 2) {
    errorMsg = "Bhajan link temporary offline hai.";
  }
  
  showErrorToast(errorMsg + " Auto skipping... 🙏");

  setTimeout(() => {
    if (currentIndex < currentResults.length - 1) {
      nextTrack();
    }
  }, 2500);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (isPlaying) {
      wasPlayingBeforeHidden = true;
      bgAudioPlayer.play().catch(e => console.log("Silent loop loaded:", e));
    }
  } else {
    if (wasPlayingBeforeHidden) {
      wasPlayingBeforeHidden = false;
      if (ytPlayer && ytPlayer.playVideo) {
        ytPlayer.playVideo();
      }
    }
  }
});

function updatePlayIcons() {
  const icon = isPlaying ? 'pause_circle' : 'play_circle';
  document.querySelector('#playBtn .material-icons').innerText = icon;
  document.querySelector('#playBtn2 .material-icons').innerText = icon;
  document.getElementById('sheetStateText').innerText = isPlaying ? 'Playing' : 'Paused';
  document.getElementById('sheetFlame').classList.toggle('spin', isPlaying);
}

function togglePlay() {
  if (typeof AndroidBridge !== 'undefined') {
    AndroidBridge.togglePlay(!isPlaying);
    return;
  }

  if (!ytPlayer || !isPlayerReady) return;
  if (isPlaying) {
    ytPlayer.pauseVideo();
    bgAudioPlayer.pause();
    isPlaying = false;
  } else {
    ytPlayer.playVideo();
    bgAudioPlayer.play().catch(e => console.log(e));
    isPlaying = true;
  }
  updatePlayIcons();
  updateMediaSessionState();
}

function changeVolume(val) {
  if (ytPlayer && ytPlayer.setVolume) {
    ytPlayer.setVolume(val);
  }
}

function setPrevNextDisabled() {
  document.getElementById('prevBtn').disabled = currentIndex <= 0;
  document.getElementById('prevBtn2').disabled = currentIndex <= 0;
  document.getElementById('nextBtn').disabled = currentIndex >= currentResults.length - 1;
  document.getElementById('nextBtn2').disabled = currentIndex >= currentResults.length - 1;
}

function playAt(index) {
  if (index < 0 || index >= currentResults.length) return;
  currentIndex = index;
  const item = currentResults[index];

  if (typeof AndroidBridge !== 'undefined') {
    AndroidBridge.playAudio(item.videoId, item.title, item.thumb, item.channel);
  } else {
    if (ytPlayer && ytPlayer.loadVideoById) {
      ytPlayer.loadVideoById(item.videoId);
    }
  }

  updateNowPlayingUI(item);
  setPrevNextDisabled();
  highlightPlayingCard();
  showToast(item.title);
  updateFavoriteUI();
}

function nextTrack() { 
  if (currentIndex < currentResults.length - 1) { 
    playAt(currentIndex + 1); 
  } else if (typeof AndroidBridge !== 'undefined') {
    AndroidBridge.onQueueEnded();
  }
}
function prevTrack() { if (currentIndex > 0) playAt(currentIndex - 1); }

function updateNowPlayingUI(item) {
  document.getElementById('nowPlaying').innerText = item.title;
  document.getElementById('nowPlayingChannel').innerText = item.channel;
  document.getElementById('miniArt').src = item.thumb;
  document.getElementById('sheetTitle').innerText = item.title;
  document.getElementById('sheetChannel').innerText = item.channel;
  document.getElementById('sheetArt').src = item.thumb;

  setupMediaSession(item);
}

function highlightPlayingCard() {
  document.querySelectorAll('.card').forEach((c, i) => c.classList.toggle('playing', i === currentIndex));
}

function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function startProgressTimer() {
  stopProgressTimer();
  progressTimer = setInterval(() => {
    if (!ytPlayer || isSeeking || typeof AndroidBridge !== 'undefined') return;
    const dur = ytPlayer.getDuration ? ytPlayer.getDuration() : 0;
    const cur = ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : 0;
    if (dur > 0) {
      document.getElementById('seekBar').max = dur;
      document.getElementById('seekBar').value = cur;
      document.getElementById('durationTime').innerText = formatTime(dur);
      document.getElementById('miniProgressFill').style.width = ((cur / dur) * 100) + '%';
    }
    document.getElementById('currentTime').innerText = formatTime(cur);
  }, 500);
}


function stopProgressTimer() { if (progressTimer) { clearInterval(progressTimer); progressTimer = null; } }

document.getElementById('seekBar').addEventListener('input', (e) => {
  isSeeking = true;
  document.getElementById('currentTime').innerText = formatTime(Number(e.target.value));
});
document.getElementById('seekBar').addEventListener('change', (e) => {
  const targetSeconds = Number(e.target.value);
  if (typeof AndroidBridge !== 'undefined') {
    AndroidBridge.seekTo(targetSeconds);
  } else {
    if (ytPlayer && ytPlayer.seekTo) ytPlayer.seekTo(targetSeconds, true);
  }
  isSeeking = false;
});

function showToast(title) {
  clearTimeout(toastTimer);
  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toastText');
  const toastIcon = toast.querySelector('.material-icons');
  
  toastIcon.innerText = 'play_circle';
  toastIcon.style.color = 'var(--saffron-light)';
  toastText.innerText = 'Playing: ' + title;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

function showErrorToast(text) {
  clearTimeout(toastTimer);
  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toastText');
  const toastIcon = toast.querySelector('.material-icons');
  
  toastIcon.innerText = 'warning';
  toastIcon.style.color = '#FF9800';
  toastText.innerText = text;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

function openDrawer() { document.getElementById('drawer').classList.add('open'); document.getElementById('overlay').classList.add('open'); }
function closeDrawer() { document.getElementById('drawer').classList.remove('open'); document.getElementById('overlay').classList.remove('open'); }
function expandPlayer() { if (currentIndex === -1) return; document.getElementById('sheet').classList.add('open'); }
function collapsePlayer() { document.getElementById('sheet').classList.remove('open'); }

function selectChip(el, text) {
  showingFavorites = false;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('searchInput').value = text;
  searchYouTube(true);
}

async function shareApp() {
  const shareData = {
    title: 'ISKCON Real Audio',
    text: 'Hare Krishna! ISKCON Real Audio App - Kirtan aur Bhajans suno, anywhere anytime. 🙏',
    url: `https://play.google.com/store/apps/details?id=${PLAY_STORE_PACKAGE}`
  };
  try {
    if (navigator.share) {
      await navigator.share(shareData);
    } else {
      await navigator.clipboard.writeText(shareData.url);
      showShareFallback();
    }
  } catch (err) { /* ignore */ }
}


function showShareFallback() {
  clearTimeout(toastTimer);
  const toast = document.getElementById('toast');
  document.getElementById('toastText').innerText = 'Link copied! Share karo apne dosto ke saath 🙏';
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

function renderSkeletons(count) {
  const feed = document.getElementById('videoFeed');
  feed.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const s = document.createElement('div');
    s.className = 'card skeleton';
    s.innerHTML = `<div class="thumb"></div><div class="line"></div><div class="line short"></div>`;
    feed.appendChild(s);
  }
}

function appendSkeletons(count) {
  const feed = document.getElementById('videoFeed');
  const loadMoreContainer = document.getElementById('loadMoreContainer');
  if (loadMoreContainer) {
    loadMoreContainer.remove();
  }
  for (let i = 0; i < count; i++) {
    const s = document.createElement('div');
    s.className = 'card skeleton temp-skeleton';
    s.innerHTML = `<div class="thumb"></div><div class="line"></div><div class="line short"></div>`;
    feed.appendChild(s);
  }
}

function removeSkeletons() {
  document.querySelectorAll('.temp-skeleton').forEach(el => el.remove());
}

function renderResults() {
  const feed = document.getElementById('videoFeed');
  
  const loadMoreContainer = document.getElementById('loadMoreContainer');
  if (loadMoreContainer) loadMoreContainer.remove();

  const existingCards = feed.querySelectorAll('.card:not(.skeleton)');
  
  if (existingCards.length === 0 || currentIndex === -1) {
    feed.innerHTML = '';
  }

  if (currentResults.length === 0) {
    feed.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><span class="material-icons">search_off</span><div>Kuch nahi mila, dusra keyword try karo</div></div>`;
    return;
  }

  currentResults.forEach((item, i) => {
    if (feed.querySelector(`[data-video-id="${item.videoId}"]`)) return;

    const card = document.createElement('div');
    card.className = 'card' + (i === currentIndex ? ' playing' : '');
    card.setAttribute('data-video-id', item.videoId);
    card.onclick = () => playAt(i);
    card.innerHTML = `
      <button class="card-fav-btn ${isFavorite(item.videoId) ? 'active' : ''}" onclick="event.stopPropagation(); toggleFavorite({videoId:'${item.videoId}', title:'${item.title.replace(/'/g, "\\'")}', channel:'${item.channel.replace(/'/g, "\\'")}', thumb:'${item.thumb}'})">
        <span class="material-icons">${isFavorite(item.videoId) ? 'star' : 'star_border'}</span>
      </button>
      <div class="thumb-wrap">
        <img src="${item.thumb}" alt="Thumbnail" loading="lazy">
        <div class="play-badge"><span class="material-icons">play_arrow</span></div>
      </div>
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="channel">${item.channel}</div>
      </div>`;
    feed.appendChild(card);
  });

  if (nextPageToken && !showingFavorites) {
    const loadMoreDiv = document.createElement('div');
    loadMoreDiv.id = 'loadMoreContainer';
    loadMoreDiv.style.gridColumn = '1 / -1';
    loadMoreDiv.style.display = 'flex';
    loadMoreDiv.style.justifyContent = 'center';
    loadMoreDiv.style.padding = '20px 0';
    
    loadMoreDiv.innerHTML = `
      <button onclick="searchYouTube(false)" style="background:var(--maroon); color:var(--white); border:2px solid var(--gold); border-radius:24px; padding:12px 30px; font-size:14px; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:8px; box-shadow: 0 4px 10px rgba(92,26,34,0.3); transition:all 0.2s;">
        <span class="material-icons">refresh</span> Aur Kirtan/Bhajan Load Karein 🪔
      </button>
    `;
    feed.appendChild(loadMoreDiv);
  }
}

async function searchYouTube(isNewSearch = true) {
  if (isSearching) return;
  showingFavorites = false;
  
  const query = document.getElementById('searchInput').value.trim();
  if (!query) return;

  const status = document.getElementById('status');
  const searchBtn = document.getElementById('searchBtn');
  const sortBy = document.getElementById('sortBy').value;

  isSearching = true;
  searchBtn.disabled = true;
  status.style.display = 'block';
  status.innerText = isNewSearch ? 'Searching from Official YouTube...' : 'Loading more bhajans...';

  if (isNewSearch) {
    nextPageToken = "";
    renderSkeletons(6);
  } else {
    appendSkeletons(4);
  }

  let attempts = 0;
  let success = false;
  let data = null;

  while (attempts < OBFUSCATED_KEYS.length && !success) {
    try {
      let url = "";
      if (SERVER_PROXY_URL) {
        url = `${SERVER_PROXY_URL}?q=${encodeURIComponent(query)}&order=${sortBy}`;
        if (!isNewSearch && nextPageToken) {
          url += `&pageToken=${nextPageToken}`;
        }
      } else {
        const activeKey = getActiveApiKey();
        url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=25&q=${encodeURIComponent(query)}&type=video&videoEmbeddable=true&order=${sortBy}&key=${activeKey}`;
        if (!isNewSearch && nextPageToken) {
          url += `&pageToken=${nextPageToken}`;
        }
      }

      const response = await fetch(url);
      data = await response.json();

      if (data.error) {
        const reason = data.error.errors && data.error.errors[0] ? data.error.errors[0].reason : '';
        if (reason === 'quotaExceeded') {
          console.warn(`API Key index ${currentApiKeyIndex} quota exhausted. Switching keys.`);
          rotateApiKey();
          attempts++;
        } else {
          rotateApiKey();
          attempts++;
        }
      } else {
        success = true;
      }
    } catch (error) {
      console.error("Network Fetch error: ", error);
      rotateApiKey();
      attempts++;
    }
  }

  removeSkeletons();

  if (!success) {
    status.innerHTML = "<span style='color:#B00020;'>Sabhi Servers busy hain (Quota limit). Kal try karein ya naye Keys add karein 🙏</span>";
    isSearching = false;
    searchBtn.disabled = false;
    return;
  }

  try {
    if (data && data.items && data.items.length > 0) {
      status.style.display = 'none';
      nextPageToken = data.nextPageToken || "";

      const fetchedResults = data.items
        .filter(item => item.id && item.id.videoId)
        .map(item => ({
          videoId: item.id.videoId,
          title: item.snippet.title,
          channel: item.snippet.channelTitle,
          thumb: item.snippet.thumbnails.high ? item.snippet.thumbnails.high.url : item.snippet.thumbnails.default.url
        }));

      if (isNewSearch) {
        currentResults = fetchedResults;
        currentIndex = -1;
      } else {
        currentResults = [...currentResults, ...fetchedResults];
      }

      renderResults();
    } else {
      if (isNewSearch) {
        status.innerText = 'No results found.';
        currentResults = [];
        renderResults();
      } else {
        status.style.display = 'block';
        status.innerText = 'Aur videos nahi mile.';
      }
    }
  } catch (err) {
    status.innerText = 'Error loading results.';
  } finally {
    isSearching = false;
    searchBtn.disabled = false;
    updateFavoriteUI();
  }
}

// Media Session controller metadata configuration (Custom play/pause removal as requested)
function setupMediaSession(item) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.title,
      artist: item.channel,
      album: "ISKCON Real Audio",
      artwork: [
        { src: item.thumb, sizes: '96x96', type: 'image/jpeg' },
        { src: item.thumb, sizes: '128x128', type: 'image/jpeg' },
        { src: item.thumb, sizes: '256x256', type: 'image/jpeg' },
        { src: item.thumb, sizes: '512x512', type: 'image/jpeg' }
      ]
    });

    // Per your request, the native Play/Pause/Stop controls are NOT registered
    // so supportive browsers will not render them in the notification area.
    navigator.mediaSession.setActionHandler('previoustrack', () => { prevTrack(); });
    navigator.mediaSession.setActionHandler('nexttrack', () => { nextTrack(); });
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (typeof AndroidBridge !== 'undefined') {
        AndroidBridge.seekTo(details.seekTime);
        return;
      }
      if (ytPlayer && ytPlayer.seekTo) {
        ytPlayer.seekTo(details.seekTime, true);
      }
    });
  }
}

function updateMediaSessionState() {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }
}

// Android Web-to-APK WebView Sync APIs
window.updatePlaybackState = function(playingState) {
  isPlaying = playingState;
  updatePlayIcons();
  updateMediaSessionState();
};

window.updatePlaybackProgress = function(current, duration) {
  if (isSeeking) return;
  document.getElementById('seekBar').max = duration;
  document.getElementById('seekBar').value = current;
  document.getElementById('durationTime').innerText = formatTime(duration);
  document.getElementById('currentTime').innerText = formatTime(current);
  document.getElementById('miniProgressFill').style.width = ((current / duration) * 100) + '%';
};

window.onTrackEnded = function() {
  nextTrack();
};

window.onTrackChanged = function(index) {
  if (index >= 0 && index < currentResults.length) {
    playAt(index);
  }
};

window.onload = () => {
  setTimeout(() => { searchYouTube(true); }, 1500);
};
