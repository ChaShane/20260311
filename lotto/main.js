/* global THREE - Three.js는 index.html에서 three.min.js 로 로드됨 (file:// CORS 회피) */
const NUM_DISPLAY_BALLS = 24;
const DRUM_RADIUS = 0.95;
const BALL_RADIUS = 0.08;
const TUMBLE_DURATION_SEC = 2.5;
const MIN_NUM = 1, MAX_NUM = 45, MAIN_COUNT = 6;
const MAX_HISTORY = 10;

const BALL_COLORS = [
  new THREE.Color(0xf4d03f), // 1~10
  new THREE.Color(0x3498db), // 11~20
  new THREE.Color(0xe74c3c), // 21~30
  new THREE.Color(0x95a5a6), // 31~40
  new THREE.Color(0x2ecc71), // 41~45
];

function getBallColorRange(num) {
  if (num <= 10) return 0;
  if (num <= 20) return 1;
  if (num <= 30) return 2;
  if (num <= 40) return 3;
  return 4;
}

// JS 폴백 시뮬레이션 (WASM과 동일 API)
class JSLottoSim {
  constructor() {
    this.balls = [];
    this.state = 0; // 0 idle, 1 tumbling, 2 done
    this.tumbleElapsed = 0;
    this.winningNumbers = [];
    this._initBalls();
  }
  _initBalls() {
    const inner = DRUM_RADIUS - BALL_RADIUS * 2;
    for (let i = 0; i < NUM_DISPLAY_BALLS; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 0.2 + Math.random() * (inner - 0.2);
      this.balls.push({
        x: r * Math.sin(phi) * Math.cos(theta),
        y: r * Math.cos(phi),
        z: r * Math.sin(phi) * Math.sin(theta),
        vx: (Math.random() - 0.5) * 1.6,
        vy: (Math.random() - 0.5) * 1.6,
        vz: (Math.random() - 0.5) * 1.6,
        number: MIN_NUM + Math.floor(Math.random() * (MAX_NUM - MIN_NUM + 1)),
      });
    }
  }
  start_draw() {
    this.state = 1;
    this.tumbleElapsed = 0;
    this.winningNumbers = [];
    const inner = DRUM_RADIUS - BALL_RADIUS * 2;
    this.balls.forEach((b) => {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 0.2 + Math.random() * (inner - 0.2);
      b.x = r * Math.sin(phi) * Math.cos(theta);
      b.y = r * Math.cos(phi);
      b.z = r * Math.sin(phi) * Math.sin(theta);
      b.vx = (Math.random() - 0.5) * 2.4;
      b.vy = (Math.random() - 0.5) * 2.4;
      b.vz = (Math.random() - 0.5) * 2.4;
      b.number = MIN_NUM + Math.floor(Math.random() * (MAX_NUM - MIN_NUM + 1));
    });
  }
  step(dt) {
    if (this.state !== 1) return;
    this.tumbleElapsed += dt;
    if (this.tumbleElapsed >= TUMBLE_DURATION_SEC) {
      const pool = [];
      for (let n = MIN_NUM; n <= MAX_NUM; n++) pool.push(n);
      for (let i = 0; i < MAIN_COUNT; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        this.winningNumbers.push(pool.splice(idx, 1)[0]);
      }
      this.winningNumbers.sort((a, b) => a - b);
      this.winningNumbers.push(pool[Math.floor(Math.random() * pool.length)]);
      this.state = 2;
      return;
    }
    const boundary = DRUM_RADIUS - BALL_RADIUS;
    this.balls.forEach((b) => {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      let r = Math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z);
      if (r > boundary) {
        r = Math.max(r, 0.001);
        const nx = b.x / r, ny = b.y / r, nz = b.z / r;
        const dot = b.vx * nx + b.vy * ny + b.vz * nz;
        if (dot > 0) {
          b.vx -= 2 * dot * nx;
          b.vy -= 2 * dot * ny;
          b.vz -= 2 * dot * nz;
        }
        b.x = nx * boundary;
        b.y = ny * boundary;
        b.z = nz * boundary;
      }
    });
  }
  get_state() { return this.state; }
  get_ball_positions() {
    const out = [];
    this.balls.forEach((b) => { out.push(b.x, b.y, b.z); });
    return out;
  }
  get_ball_numbers() { return this.balls.map((b) => b.number); }
  get_winning_numbers() { return this.winningNumbers.slice(); }
  reset() { this.state = 0; this.winningNumbers = []; }
}

// Three.js 3D 씬
let scene, camera, renderer, drumMesh, ballMeshes = [], sim, useWasm = false;
const clock = new THREE.Clock();

function createBallMaterial(num) {
  const color = BALL_COLORS[getBallColorRange(num)];
  return new THREE.MeshPhongMaterial({
    color,
    shininess: 80,
    specular: new THREE.Color(0x444444),
  });
}

function initScene() {
  const canvas = document.getElementById('lotto3d');
  const w = canvas.parentElement.clientWidth;
  const h = canvas.parentElement.clientHeight;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x151515);

  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0.8, 2.8);
  camera.lookAt(0, 0.2, 0);

  const amb = new THREE.AmbientLight(0x404060, 0.6);
  scene.add(amb);
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(3, 5, 4);
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0x6080c0, 0.3);
  fill.position.set(-2, 2, -2);
  scene.add(fill);

  // 기계 받침대 (크롬 느낌)
  const standGeo = new THREE.CylinderGeometry(0.5, 0.65, 0.25, 24);
  const standMat = new THREE.MeshPhongMaterial({
    color: 0xc0c0c0,
    shininess: 120,
    specular: new THREE.Color(0x888888),
    envMapIntensity: 0.5,
  });
  const stand = new THREE.Mesh(standGeo, standMat);
  stand.position.y = -0.35;
  scene.add(stand);

  // 유리 드럼 (반투명 구)
  const drumGeo = new THREE.SphereGeometry(1.0, 32, 32);
  const drumMat = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.12,
    shininess: 100,
    specular: new THREE.Color(0xaaaaaa),
    side: THREE.DoubleSide,
  });
  drumMesh = new THREE.Mesh(drumGeo, drumMat);
  drumMesh.position.y = 0.35;
  scene.add(drumMesh);

  // 드럼 안 공들 (WASM/JS에서 위치만 갱신)
  const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 16, 16);
  ballMeshes = [];
  for (let i = 0; i < NUM_DISPLAY_BALLS; i++) {
    const num = MIN_NUM + Math.floor(Math.random() * (MAX_NUM - MIN_NUM + 1));
    const mat = createBallMaterial(num);
    const mesh = new THREE.Mesh(ballGeo, mat);
    mesh.userData.index = i;
    ballMeshes.push(mesh);
    drumMesh.add(mesh); // 드럼 로컬 좌표
  }

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap = true;
}

function updateBallPositions() {
  if (!sim) return;
  const pos = sim.get_ball_positions();
  for (let i = 0; i < NUM_DISPLAY_BALLS; i++) {
    const m = ballMeshes[i];
    m.position.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  }
}

function showResultSummary(numbers, bonus) {
  const wrap = document.getElementById('resultSummary');
  wrap.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'numbers-row';
  numbers.forEach((n) => {
    const b = document.createElement('span');
    b.className = 'ball';
    b.dataset.range = getBallColorRange(n) + 1;
    b.textContent = n;
    row.appendChild(b);
  });
  wrap.appendChild(row);
  const bonusLine = document.createElement('div');
  bonusLine.className = 'bonus-row';
  bonusLine.textContent = '보너스 ';
  const b = document.createElement('span');
  b.className = 'ball';
  b.dataset.range = getBallColorRange(bonus) + 1;
  b.textContent = bonus;
  bonusLine.appendChild(b);
  wrap.appendChild(bonusLine);
  wrap.classList.add('visible');
}

let history = [];
function addToHistory(numbers, bonus) {
  history.unshift({ numbers, bonus });
  if (history.length > MAX_HISTORY) history.pop();
  try { localStorage.setItem('lottoHistory', JSON.stringify(history)); } catch (_) {}
  renderHistory();
}

function renderHistory() {
  const list = document.getElementById('historyList');
  list.innerHTML = '';
  if (history.length === 0) {
    list.innerHTML = '<div style="color:#7f8c8d;font-size:0.85rem;">아직 기록이 없습니다</div>';
    return;
  }
  const rangeColors = ['#f4d03f', '#3498db', '#e74c3c', '#95a5a6', '#2ecc71'];
  history.forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    (entry.numbers || entry).forEach((n) => {
      const b = document.createElement('span');
      b.className = 'mini-ball';
      b.textContent = n;
      b.style.background = rangeColors[getBallColorRange(n)];
      item.appendChild(b);
    });
    if (entry.bonus != null) {
      const plus = document.createElement('span');
      plus.textContent = ' +';
      plus.style.color = 'var(--text-muted)';
      item.appendChild(plus);
      const b = document.createElement('span');
      b.className = 'mini-ball';
      b.textContent = entry.bonus;
      b.style.background = rangeColors[getBallColorRange(entry.bonus)];
      item.appendChild(b);
    }
    list.appendChild(item);
  });
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (sim && sim.get_state() === 1) {
    sim.step(dt);
    updateBallPositions();
    if (sim.get_state() === 2) {
      const win = sim.get_winning_numbers();
      const numbers = win.slice(0, 6);
      const bonus = win[6];
      showResultSummary(numbers, bonus);
      addToHistory(numbers, bonus);
      document.getElementById('btnDraw').disabled = false;
      sim.reset();
    }
  }
  if (renderer && scene && camera) renderer.render(scene, camera);
}

async function init() {
  try {
    const mod = await import('./pkg/lotto_wasm.js');
    await mod.default();
    sim = new mod.LottoSim();
    useWasm = true;
    document.getElementById('wasmBadge').textContent = '시뮬레이션: WebAssembly (Rust)';
  } catch (_) {
    sim = new JSLottoSim();
    document.getElementById('wasmBadge').textContent = '시뮬레이션: JavaScript (WASM 빌드 시 Rust 사용)';
  }

  try {
    history = JSON.parse(localStorage.getItem('lottoHistory') || '[]');
  } catch (_) {
    history = [];
  }
  renderHistory();

  initScene();
  updateBallPositions();

  document.getElementById('btnDraw').addEventListener('click', () => {
    document.getElementById('btnDraw').disabled = true;
    document.getElementById('resultSummary').classList.remove('visible');
    document.getElementById('resultSummary').innerHTML = '';
    sim.start_draw();
  });

  window.addEventListener('resize', () => {
    const canvas = document.getElementById('lotto3d');
    if (!canvas?.parentElement) return;
    const w = canvas.parentElement.clientWidth;
    const h = canvas.parentElement.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  animate();
}

init();
