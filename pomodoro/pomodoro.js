const workMinInput  = document.getElementById('workMin');
const breakMinInput = document.getElementById('breakMin');
const startBtn      = document.getElementById('startBtn');
const pauseBtn      = document.getElementById('pauseBtn');
const resetBtn      = document.getElementById('resetBtn');
const countdownEl   = document.getElementById('countdown');
const modeLabelEl   = document.getElementById('modeLabel');

const WORK_MUSIC_SRC  = '../Assets/work.mp3';
const BREAK_MUSIC_SRC = '../Assets/break.mp3';

const workAudio  = new Audio(WORK_MUSIC_SRC);
const breakAudio = new Audio(BREAK_MUSIC_SRC);
workAudio.loop = true;
breakAudio.loop = true;


let mode = 'work';
let running = false;
let endTime = 0; 
let remainingMs = 0;
let tickId = null;       

function minutesToMs(m) {
  return Math.max(1, parseInt(m, 10) || 1) * 60 * 1000;
}

function formatTime(ms) {
  ms = Math.max(0, ms);
  const totalSec = Math.floor(ms / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function getWorkMinutes() {
  return Math.max(1, parseInt(workMinInput.value, 10) || 25);
}

function getBreakMinutes() {
  return Math.max(1, parseInt(breakMinInput.value, 10) || 5);
}

function updateCountdownLabel() {
  const msLeft = running ? (endTime - Date.now()) : remainingMs;
  countdownEl.textContent = formatTime(msLeft);
  modeLabelEl.textContent = mode === 'work' ? 'Work' : 'Break';
}

function setButtonsRunning(isRunning) {
  running = isRunning;
  startBtn.disabled = isRunning;
  pauseBtn.disabled = !isRunning;
}


function start() {
  if (running) return;

  if (remainingMs <= 0) {
    remainingMs = minutesToMs(mode === 'work' ? getWorkMinutes() : getBreakMinutes());
  }

  endTime = Date.now() + remainingMs;
  setButtonsRunning(true);
  
  const currentAudio = mode === 'work' ? workAudio : breakAudio;
  currentAudio.play().catch(() => {});

  // countdown
  if (tickId) clearInterval(tickId);
  tickId = setInterval(tick, 250);

  updateCountdownLabel();
}

function pause() {
  if (!running) return;

  // Get remaining time and stop countdown
  remainingMs = Math.max(0, endTime - Date.now());
  clearInterval(tickId);
  tickId = null;

  
  const currentAudio = mode === 'work' ? workAudio : breakAudio;
  try {
    currentAudio.pause();
  } catch (_) {}

  setButtonsRunning(false);
  updateCountdownLabel();
}

function reset() {
  // Stop everything, go back to Work status, reset time to work duration
  clearInterval(tickId);
  tickId = null;

  const currentAudio = mode === 'work' ? workAudio : breakAudio;
  try {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    
  } catch (_) {}

  mode = 'work';
  remainingMs = minutesToMs(getWorkMinutes());

  setButtonsRunning(false);
  updateCountdownLabel();
}

function switchMode() {
  if (mode === 'work') {
    mode = 'break';
    remainingMs = minutesToMs(getBreakMinutes());
  } else {
    mode = 'work';
    remainingMs = minutesToMs(getWorkMinutes());
  }

  endTime = Date.now() + remainingMs;
  updateCountdownLabel();
}


function stopAllAudio() {
  [workAudio, breakAudio].forEach(a => {
    try {
      a.pause();
      a.currentTime = 0;
    } catch (_) {}
  });
}

function playAudioForCurrentMode() {
  // Ensure only the relevant track is playing
  stopAllAudio();
  const toPlay = mode === 'work' ? workAudio : breakAudio;
  toPlay.play().catch(() => {
  });
}

function tick() {
  const msLeft = endTime - Date.now();
  if (msLeft <= 0) {
    // Period finished: switch mode and auto-continue
    remainingMs = 0;
    updateCountdownLabel();
    stopAllAudio()
    switchMode();
    playAudioForCurrentMode();
  } 
  else {
    updateCountdownLabel();
    
    const currentAudio = mode === 'work' ? workAudio : breakAudio;
    if (currentAudio.paused) {
      currentAudio.play().catch(() => {});
    }
  }
}

// Update when change duration
workMinInput.addEventListener('input', () => {
  if (!running && mode === 'work') {
    remainingMs = minutesToMs(getWorkMinutes());
    updateCountdownLabel();
  }
});
breakMinInput.addEventListener('input', () => {
  if (!running && mode === 'break') {
    remainingMs = minutesToMs(getBreakMinutes());
    updateCountdownLabel();
  }
});


// Initial
setButtonsRunning(false);
mode = 'work';
remainingMs = minutesToMs(getWorkMinutes());
updateCountdownLabel();
``
// --- Wire up ---
startBtn.addEventListener('click', start);
pauseBtn.addEventListener('click', pause);
resetBtn.addEventListener('click', reset);
