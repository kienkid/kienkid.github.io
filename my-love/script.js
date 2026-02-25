// ─── Heart layout ───────────────────────────────────────────────
// 6 rows, each row list of which columns (1-indexed, out of 9)
// This creates an approximate heart shape on a 9-col grid
const HEART_LAYOUT = [
  [0,1,1,0,0,0,1,1,0],  // row0
  [1,1,1,1,0,1,1,1,1],  // row1
  [1,1,1,1,1,1,1,1,1],  // row2
  [1,1,1,1,1,1,1,1,1],  // row3
  [0,1,1,1,1,1,1,1,0],  // row4
  [0,0,1,1,1,1,1,0,0],  // row5
  [0,0,0,1,1,1,0,0,0],  // row6
  [0,0,0,0,1,0,0,0,0],  // row7
];

// Collect active positions
const activePositions = [];
HEART_LAYOUT.forEach((row, r) => {
  row.forEach((cell, c) => {
    if (cell) activePositions.push({ r, c });
  });
});

// number of active cell divide by 2.
const NUM_PAIRS = 23;

// ─── Emoji pairs used as "photos" since we can't load real photos ────────────
const EMOJIS = ['../Image/love/love1.webp',
                '../Image/love/love2.webp',
                '../Image/love/love3.webp',
                '../Image/love/love4.webp',
                '../Image/love/love5.webp',
                '../Image/love/love6.webp',
                '../Image/love/love7.webp',
                '../Image/love/love8.webp',
                '../Image/love/love9.webp',
                '../Image/love/love10.webp',
                '../Image/love/love11.webp',
                '../Image/love/love12.webp',
                '../Image/love/love13.webp',
                '../Image/love/love14.webp',
                '../Image/love/love15.webp',
                '../Image/love/love16.webp',
                '../Image/love/love17.webp',
                '../Image/love/love18.webp',
                '../Image/love/love19.webp',
                '../Image/love/love20.webp',
                '../Image/love/love21.webp',
                '../Image/love/love22.webp',
                '../Image/love/love23.webp'];

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Build board ─────────────────────────────────────────────────
const board = document.getElementById('game-board');
board.style.gridTemplateColumns = `repeat(9, 90px)`;
board.style.gridTemplateRows = `repeat(8, 90px)`;

let cards = [];
let emojis = shuffle([...EMOJIS, ...EMOJIS]);

// Place cells
HEART_LAYOUT.forEach((row, r) => {
  row.forEach((cell, c) => {
    const div = document.createElement('div');
    div.classList.add('card');
    if (!cell) {
      div.classList.add('hidden');
      div.innerHTML = '';
    } else {
      const idx = cards.length;
      const emoji = emojis[idx];
      div.dataset.emoji = emoji;
      div.dataset.index = idx;
      div.innerHTML = `
        <div class="card-inner">
            <div class="card-front">💝</div>
            <div class="card-back" style="background:linear-gradient(135deg,#fde8ee,#f9c7d5);overflow:hidden;">
                <img src="${emoji}" alt="card" style="width:100%;height:100%;object-fit:cover;display:block;" />
            </div>
        </div>`;
      div.addEventListener('click', () => flipCard(div));
      cards.push(div);
    }
    div.style.gridColumn = c + 1;
    div.style.gridRow = r + 1;
    board.appendChild(div);
  });
});

// ─── Game state ───────────────────────────────────────────────────
let flipped = [];
let matchedCount = 0;
let locked = false;

function flipCard(card) {
  if (locked) return;
  if (card.classList.contains('flipped') || card.classList.contains('matched')) return;
  if (flipped.length === 2) return;

  card.classList.add('flipped');
  flipped.push(card);

  if (flipped.length === 2) {
    locked = true;
    setTimeout(checkMatch, 700);
  }
}

function checkMatch() {
  const [a, b] = flipped;
  if (a.dataset.emoji === b.dataset.emoji) {
    a.classList.add('matched');
    b.classList.add('matched');
    matchedCount++;
    document.getElementById('matched').textContent = matchedCount;
    if (matchedCount === NUM_PAIRS) {
      setTimeout(() => {
        document.getElementById('proposal').classList.add('show');
      }, 800);
    }
  } else {
    a.classList.add('wrong');
    b.classList.add('wrong');
    setTimeout(() => {
      a.classList.remove('flipped', 'wrong');
      b.classList.remove('flipped', 'wrong');
    }, 600);
  }
  flipped = [];
  locked = false;
}

// ─── No button runs away ─────────────────────────────────────────
let noMoves = 0;
function moveNo() {
  noMoves++;
  const btn = document.getElementById('noBtn');
  const container = document.getElementById('proposalBtns');
  const maxX = 200, maxY = 120;
  const x = (Math.random() - 0.5) * 2 * maxX;
  const y = (Math.random() - 0.5) * 2 * maxY;
  btn.style.transform = `translate(${x}px, ${y}px)`;
  if (noMoves >= 5) btn.style.opacity = '0';
}

// ─── Accept ───────────────────────────────────────────────────────
function accept() {
  document.getElementById('proposal').classList.remove('show');
  document.getElementById('accepted-screen').classList.add('show');
  startFireworks();
}

// ─── Fireworks ────────────────────────────────────────────────────
function startFireworks() {
  const canvas = document.getElementById('fireworks-canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  const particles = [];

  function randomColor() {
    const colors = ['#e8527a','#c0395c','#f7b8cb','#ff80a0','#ffb3c6','#fff'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  function explode(x, y) {
    for (let i = 0; i < 60; i++) {
      const angle = (Math.PI * 2 / 60) * i;
      const speed = 2 + Math.random() * 4;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        alpha: 1,
        color: randomColor(),
        size: 3 + Math.random() * 3,
      });
    }
  }

  let fw;
  function fireLoop() {
    fw = setInterval(() => {
      explode(Math.random() * canvas.width, Math.random() * canvas.height * 0.7);
    }, 600);
  }

  fireLoop();
  setTimeout(() => clearInterval(fw), 6000);

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy + 0.07;
      p.vy += 0.05;
      p.alpha -= 0.018;
      if (p.alpha <= 0) { particles.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    requestAnimationFrame(draw);
  }
  draw();
}

// ─── Rotate Prompt ───────────────────────────────────────────────
const rotatePrompt = document.getElementById('rotate-prompt');

function checkOrientation() {
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth <= 900;
  const isPortrait = window.innerHeight > window.innerWidth;
  if (isMobile && isPortrait) {
    rotatePrompt.classList.add('show');
  } else {
    rotatePrompt.classList.remove('show');
  }
}

checkOrientation();
window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', () => setTimeout(checkOrientation, 150));

// ─── Floating bg hearts ──────────────────────────────────────────
const bgEl = document.getElementById('bgHearts');
for (let i = 0; i < 18; i++) {
  const s = document.createElement('span');
  s.textContent = ['❤️','💕','💗','🌸','💓'][Math.floor(Math.random() * 5)];
  s.style.left = Math.random() * 100 + 'vw';
  s.style.animationDuration = (8 + Math.random() * 12) + 's';
  s.style.animationDelay = (Math.random() * 10) + 's';
  s.style.fontSize = (0.8 + Math.random() * 1.2) + 'rem';
  bgEl.appendChild(s);
}