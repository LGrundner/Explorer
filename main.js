// ===== Canvas =====
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d", { alpha: false });
ctx.imageSmoothingEnabled = false;

const VIEW_W = canvas.width;
const VIEW_H = canvas.height;

// Render scale (zoom). 1 = original size, 2 or 3 = zoom in
const SCALE = 3;

// ===== Messages (pickup notifications) =====
const messages = [];
function addMessage(text) {
  messages.unshift({ text, timer: 120 }); // ~2s at 60fps
  if (messages.length > 5) messages.pop();
}

// ===== Pixel world config =====
const TILE = 16;            // 16x16 pixel tiles (retro vibe)
const WORLD_W = 300;        // tiles wide (bigger world)
const WORLD_H = 240;        // tiles high

// Tile IDs
// 0 grass/walkable, 1 tree/solid, 2 water/solid, 3 mountain/solid, 4 hut/solid, 5 cave/solid (will become entrances later)
// Plus item tiles (non-solid): 6 axe, 7 boat, 8 pickaxe, 9 sword
const T = { FLOOR:0, TREE:1, WATER:2, MOUNTAIN:3, HUT:4, CAVE:5, AXE_ITEM:6, BOAT_ITEM:7, PICKAXE_ITEM:8, SWORD_ITEM:9 };

// Simple palette (muted retro overworld)
const PALETTE = {
  floor: "#2d8a2d",      // grass base
  floorVar: "#329b32",   // grass alt
  tree:  "#1f6b1f",      // tree trunk/leaves dark
  treeTop: "#2fb12f",   // tree highlight bright
  water: "#1f4fbf",     // lake blue
  waterEdge: "#3f73ff",
  mountain: "#6b6b6b",   // grey rock
  mountainTop: "#8a8a8a",
  hut: "#7a512f",
  hutRoof: "#915e37",
  cave: "#3a3a3a",      // dark grey cave
  caveEdge: "#4a4a4a"
};

// ===== Input (WASD + Arrows) =====
const keys = new Set();
addEventListener("keydown", e => {
  const k = e.key.toLowerCase();
  // If respawn overlay is active, only allow continue
  if (respawnOverlayActive) {
    if (e.code === "Enter" || e.code === "Space") {
      respawnOverlayActive = false;
      e.preventDefault();
    }
    return;
  }
  keys.add(k);
  if (k === "1" && player.inv.axe) player.tool = TOOLS.AXE;
  if (k === "2" && player.inv.boat) player.tool = TOOLS.BOAT;
  if (k === "3" && player.inv.pickaxe) player.tool = TOOLS.PICKAXE;
  if (k === "4" && player.inv.sword) player.tool = TOOLS.SWORD;
  if (k === "5" && player.inv.goldenSword) player.tool = TOOLS.GOLDEN_SWORD;
  if (k === "6" && player.inv.knife) player.tool = TOOLS.KNIFE;
  if (e.code === "Space") {
    useToolAction();
    e.preventDefault();
  }
});
addEventListener("keyup",   e => keys.delete(e.key.toLowerCase()));

// ===== Tools =====
const TOOLS = { NONE:0, AXE:1, BOAT:2, PICKAXE:3, SWORD:4, GOLDEN_SWORD:5, KNIFE:6 };
function toolName(t) {
  return t === TOOLS.AXE ? "Axe" : t === TOOLS.BOAT ? "Boat" : t === TOOLS.PICKAXE ? "Pickaxe" : t === TOOLS.SWORD ? "Sword" : t === TOOLS.GOLDEN_SWORD ? "Golden Sword" : t === TOOLS.KNIFE ? "Knife" : "None";
}

// ===== World generation =====
const map = makeWorld(WORLD_W, WORLD_H);
function makeWorld(w, h) {
  const m = Array.from({ length: h }, () => Array(w).fill(T.FLOOR));

  // Border mountains (world bounds)
  for (let x = 0; x < w; x++) { m[0][x] = T.MOUNTAIN; m[h-1][x] = T.MOUNTAIN; }
  for (let y = 0; y < h; y++) { m[y][0] = T.MOUNTAIN; m[y][w-1] = T.MOUNTAIN; }

  // Lakes
  blob(m, 28, 22, 10, T.WATER);
  blob(m, 52, 30, 12, T.WATER);
  blob(m, 76, 12, 9, T.WATER);
  blob(m, 20, 55, 8, T.WATER);

  // Forests (several tree blobs)
  randomBlobs(m, { count: 26, rMin: 3, rMax: 8, tile: T.TREE, avoid: [T.WATER, T.MOUNTAIN] });

  // Mountain ridges (random walkers)
  for (let i = 0; i < 7; i++) {
    const sx = 10 + ((i * 13) % (w - 20));
    const sy = 8 + ((i * 17) % (h - 16));
    ridge(m, sx, sy, 70 + (i*7)%40, 0.45, 2);
  }

  // Carve some meandering paths through forests and mountains (keep world traversable)
  for (let i = 0; i < 6; i++) {
    carvePath(m, rand(6, w-7), rand(6, h-7), 120 + rand(0, 100));
  }

  // Place huts near forest clearings
  placeHuts(m, 4);

  // Place cave mouths at mountain bases
  placeCaves(m, 3);

  return m;
}
function blob(m, cx, cy, r, tile) {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x*x + y*y <= r*r) {
        const tx = cx + x, ty = cy + y;
        if (inside(tx, ty)) m[ty][tx] = tile;
      }
    }
  }
}
function randomBlobs(m, { count, rMin, rMax, tile, avoid = [] }) {
  for (let i = 0; i < count; i++) {
    const r = rand(rMin, rMax);
    const cx = rand(r+2, WORLD_W - r - 3);
    const cy = rand(r+2, WORLD_H - r - 3);
    // avoid painting over restricted tiles
    let ok = true;
    for (let y = -r; y <= r && ok; y++) {
      for (let x = -r; x <= r && ok; x++) {
        if (x*x + y*y <= r*r) {
          const tx = cx + x, ty = cy + y;
          if (!inside(tx, ty)) continue;
          if (avoid.includes(m[ty][tx])) ok = false;
        }
      }
    }
    if (ok) blob(m, cx, cy, r, tile);
  }
}
function ridge(m, sx, sy, steps, turnChance, thickness) {
  let x = clampInt(sx, 2, WORLD_W-3);
  let y = clampInt(sy, 2, WORLD_H-3);
  let dx = Math.random() < 0.5 ? 1 : -1;
  let dy = Math.random() < 0.5 ? 1 : -1;
  for (let i = 0; i < steps; i++) {
    paintDisc(m, x, y, thickness, T.MOUNTAIN);
    if (Math.random() < turnChance) {
      // small random turn
      const dir = rand(0, 3);
      dx = (dir === 0) ? 1 : (dir === 1) ? -1 : dx;
      dy = (dir === 2) ? 1 : (dir === 3) ? -1 : dy;
    }
    x = clampInt(x + dx, 2, WORLD_W-3);
    y = clampInt(y + dy, 2, WORLD_H-3);
  }
}
function paintDisc(m, cx, cy, r, tile) {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x*x + y*y <= r*r) {
        const tx = cx + x, ty = cy + y;
        if (inside(tx, ty)) m[ty][tx] = tile;
      }
    }
  }
}
function carvePath(m, sx, sy, steps) {
  let x = sx, y = sy;
  for (let i = 0; i < steps; i++) {
    if (!inside(x, y)) break;
    paintDisc(m, x, y, 1, T.FLOOR);
    // bias away from water to keep paths usable
    const dirs = [ [1,0], [-1,0], [0,1], [0,-1] ];
    const [dx, dy] = dirs[rand(0, dirs.length-1)];
    const nx = x + dx, ny = y + dy;
    if (inside(nx, ny) && m[ny][nx] !== T.WATER) { x = nx; y = ny; }
  }
}
function placeHuts(m, count) {
  let placed = 0; let attempts = 0;
  while (placed < count && attempts++ < 1000) {
    const x = rand(3, WORLD_W-4); const y = rand(3, WORLD_H-4);
    if (m[y][x] !== T.FLOOR) continue;
    // prefer near trees but not on water/mountain
    let nearTrees = 0; let blocked = false;
    for (let j = -2; j <= 2; j++) {
      for (let i = -2; i <= 2; i++) {
        const tx = x+i, ty = y+j; if (!inside(tx, ty)) continue;
        const t = m[ty][tx];
        if (t === T.TREE) nearTrees++;
        if (t === T.WATER || t === T.MOUNTAIN) blocked = true;
      }
    }
    if (!blocked && nearTrees >= 4) {
      m[y][x] = T.HUT; placed++;
    }
  }
}
function placeCaves(m, count) {
  let placed = 0; let attempts = 0;
  while (placed < count && attempts++ < 1000) {
    const x = rand(3, WORLD_W-4); const y = rand(3, WORLD_H-4);
    if (m[y][x] !== T.FLOOR) continue;
    // prefer adjacent to mountain
    let adjacentMountain = false;
    const n = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [dx, dy] of n) {
      const tx = x+dx, ty = y+dy; if (!inside(tx, ty)) continue;
      if (m[ty][tx] === T.MOUNTAIN) { adjacentMountain = true; break; }
    }
    if (adjacentMountain) { m[y][x] = T.CAVE; placed++; }
  }
}
// Item placement is done post-spawn to ensure reachability from start
function findSpawn() {
  for (let tries = 0; tries < 5000; tries++) {
    const tx = rand(2, WORLD_W - 3);
    const ty = rand(2, WORLD_H - 3);
    if (map[ty][tx] !== T.FLOOR) continue;
    let ok = true;
    for (let j = -1; j <= 1 && ok; j++) {
      for (let i = -1; i <= 1 && ok; i++) {
        const nx = tx + i, ny = ty + j;
        const t = map[ny][nx];
        if (t !== T.FLOOR) ok = false;
      }
    }
    if (ok) return { x: tx*TILE + 2, y: ty*TILE + 2 };
  }
  return { x: 5*TILE + 2, y: 5*TILE + 2 };
}

function computeReachableFloors(sx, sy) {
  const seen = Array.from({ length: WORLD_H }, () => Array(WORLD_W).fill(false));
  const q = [[sx, sy]]; seen[sy][sx] = true;
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of dirs) {
      const nx = x+dx, ny = y+dy;
      if (!inside(nx, ny) || seen[ny][nx]) continue;
      const t = map[ny][nx];
      if (t === T.FLOOR || (t >= T.AXE_ITEM && t <= T.SWORD_ITEM)) {
        seen[ny][nx] = true; q.push([nx, ny]);
      }
    }
  }
  return seen;
}
function placeItemNearReachable(m, reachable, itemTile, nearTile) {
  const candidates = [];
  for (let y = 1; y < WORLD_H-1; y++) {
    for (let x = 1; x < WORLD_W-1; x++) {
      if (!reachable[y][x]) continue;
      if (m[y][x] !== T.FLOOR) continue;
      if (nearTile === T.FLOOR) {
        candidates.push([x, y]);
      } else {
        if (m[y][x+1] === nearTile || m[y][x-1] === nearTile || m[y+1][x] === nearTile || m[y-1][x] === nearTile) {
          candidates.push([x, y]);
        }
      }
    }
  }
  if (candidates.length === 0) return;
  const [ix, iy] = candidates[rand(0, candidates.length-1)];
  m[iy][ix] = itemTile;
}
function placeItemFarFrom(m, reachable, itemTile, avoidTile, radius) {
  // try with decreasing radius if needed
  for (let r = radius; r >= 0; r--) {
    const candidates = [];
    for (let y = 1; y < WORLD_H-1; y++) {
      for (let x = 1; x < WORLD_W-1; x++) {
        if (!reachable[y][x]) continue;
        if (m[y][x] !== T.FLOOR) continue;
        if (avoidTile == null || r === 0) {
          candidates.push([x, y]);
          continue;
        }
        let ok = true;
        for (let dy = -r; dy <= r && ok; dy++) {
          for (let dx = -r; dx <= r && ok; dx++) {
            const nx = x + dx, ny = y + dy;
            if (!inside(nx, ny)) continue;
            if (m[ny][nx] === avoidTile) ok = false;
          }
        }
        if (ok) candidates.push([x, y]);
      }
    }
    if (candidates.length) {
      const [ix, iy] = candidates[rand(0, candidates.length-1)];
      m[iy][ix] = itemTile;
      return;
    }
  }
}

// ===== Enemies: spiders =====
const spiders = [];
const heartDrops = [];
let boss = null; // {x,y,w,h,hp,active}
const jellies = [];
function spawnSpiders(reachable, count) {
  const farTiles = [];
  const spawnTx = Math.floor(player.x / TILE), spawnTy = Math.floor(player.y / TILE);
  for (let y = 1; y < WORLD_H-1; y++) {
    for (let x = 1; x < WORLD_W-1; x++) {
      if (!reachable[y][x]) continue;
      if (map[y][x] !== T.FLOOR) continue;
      const dx = x - spawnTx, dy = y - spawnTy;
      if (dx*dx + dy*dy >= 120) { // at least ~11 tiles away
        farTiles.push([x, y]);
      }
    }
  }
  for (let i = 0; i < count && farTiles.length; i++) {
    const idx = rand(0, farTiles.length-1);
    const [tx, ty] = farTiles.splice(idx, 1)[0];
    // choose type: large spawns less often
    const isLarge = Math.random() < 0.22; // ~22% large
    const size = isLarge ? 14 : 12;
    spiders.push({
      x: tx*TILE + (TILE - size)/2,
      y: ty*TILE + (TILE - size)/2,
      w: size,
      h: size,
      speed: isLarge ? 0.85 : 1.1,
      attackCooldown: 0,
      state: "idle",
      type: isLarge ? "large" : "small",
      hp: isLarge ? 4 : 2,
      hitCooldown: 0,
      hitFlash: 0
    });
  }
}

function spawnJellies(count) {
  const waterTiles = [];
  for (let y = 1; y < WORLD_H-1; y++) {
    for (let x = 1; x < WORLD_W-1; x++) {
      if (map[y][x] === T.WATER) waterTiles.push([x, y]);
    }
  }
  for (let i = 0; i < count && waterTiles.length; i++) {
    const idx = rand(0, waterTiles.length-1);
    const [tx, ty] = waterTiles.splice(idx, 1)[0];
    jellies.push({
      x: tx*TILE + 2,
      y: ty*TILE + 2,
      w: 12,
      h: 12,
      speed: 0.35,
      state: "idle",
      hp: 2,
      attackCooldown: 0,
      wanderTimer: rand(30, 120),
      vx: 0,
      vy: 0,
      hitCooldown: 0,
      hitFlash: 0
    });
  }
}

function spawnBoss(reachable) {
  const far = [];
  const stx = Math.floor(player.x / TILE), sty = Math.floor(player.y / TILE);
  for (let y = 1; y < WORLD_H-1; y++) {
    for (let x = 1; x < WORLD_W-1; x++) {
      if (!reachable[y][x]) continue;
      if (map[y][x] !== T.FLOOR) continue;
      const dx = x - stx, dy = y - sty;
      if (dx*dx + dy*dy > 400) far.push([x, y]);
    }
  }
  if (!far.length) return;
  const [bx, by] = far[rand(0, far.length-1)];
  boss = { x: bx*TILE - 4, y: by*TILE - 4, w: 24, h: 24, speed: 0.7, hp: 10, state: "idle", attackCooldown: 0, hitFlash: 0 };
}

function updateSpiders() {
  const aggroDist = 90;    // start chase (reduced)
  const leashDist = 140;   // stop chase (reduced)
  for (const s of spiders) {
    if (s.attackCooldown > 0) s.attackCooldown--;
    if (s.hitCooldown > 0) s.hitCooldown--;
    if (s.hitFlash > 0) s.hitFlash--;
    // distance to player (center)
    const sx = s.x + s.w/2, sy = s.y + s.h/2;
    const px = player.x + player.w/2, py = player.y + player.h/2;
    const dx = px - sx, dy = py - sy;
    const dist = Math.hypot(dx, dy);
    if (s.state === "idle") {
      if (dist < aggroDist) s.state = "chase";
    } else if (s.state === "chase") {
      if (dist > leashDist) s.state = "idle";
      // move towards player (avoid water)
      if (dist > 1) {
        const nx = (dx / dist) * s.speed;
        const ny = (dy / dist) * s.speed;
        const moved = collideAndSlide(s.x, s.y, s.w, s.h, nx, ny);
        // prevent entering water: sample next center tile
        const ncx = moved.x + s.w/2, ncy = moved.y + s.h/2;
        const ntx = Math.floor(ncx / TILE), nty = Math.floor(ncy / TILE);
        if (inside(ntx, nty) && map[nty][ntx] !== T.WATER) {
          s.x = moved.x; s.y = moved.y;
        }
      }
      // contact damage
      if (aabbIntersect(s, player) && s.attackCooldown === 0 && player.invulFrames === 0) {
        applyDamage(1); // half-heart
        s.attackCooldown = 60; // 1s between hits
      }
    }
  }
  // remove dead
  for (let i = spiders.length - 1; i >= 0; i--) {
    const sd = spiders[i];
    if (sd.hp <= 0) {
      // drop heart at spider center
      const amount = sd.type === "large" ? 2 : 1; // full or half heart
      heartDrops.push({ x: sd.x + sd.w/2 - 4, y: sd.y + sd.h/2 - 3, w: 8, h: 6, amount, timer: 1200 });
      spiders.splice(i, 1);
      player.kills++;
      checkGoldenSword();
    }
  }
}

function updateJellies() {
  const aggroDist = 60;   // small aggro
  const leashDist = 90;   // small leash
  for (const j of jellies) {
    if (j.attackCooldown > 0) j.attackCooldown--;
    if (j.hitCooldown > 0) j.hitCooldown--;
    if (j.hitFlash > 0) j.hitFlash--;
    const jcx = j.x + j.w/2, jcy = j.y + j.h/2;
    const pcx = player.x + player.w/2, pcy = player.y + player.h/2;
    const dx = pcx - jcx, dy = pcy - jcy;
    const dist = Math.hypot(dx, dy);
    if (dist < aggroDist) j.state = "chase"; else if (dist > leashDist) j.state = "idle";
    let vx = 0, vy = 0;
    if (j.state === "chase" && dist > 1) {
      vx = (dx / dist) * j.speed;
      vy = (dy / dist) * j.speed;
    } else {
      j.wanderTimer--;
      if (j.wanderTimer <= 0) {
        j.vx = (Math.random()*2-1) * j.speed;
        j.vy = (Math.random()*2-1) * j.speed;
        j.wanderTimer = rand(30, 120);
      }
      vx = j.vx; vy = j.vy;
    }
    // move only if staying on water
    const nx = j.x + vx, ny = j.y + vy;
    const ntx = Math.floor((nx + j.w/2) / TILE), nty = Math.floor((ny + j.h/2) / TILE);
    if (inside(ntx, nty) && map[nty][ntx] === T.WATER) {
      j.x = nx; j.y = ny;
    } else {
      j.vx = 0; j.vy = 0; // bounce/stop at edge
    }
    // contact damage (poisonous)
    if (aabbIntersect(j, player) && j.attackCooldown === 0 && player.invulFrames === 0) {
      applyDamage(2); // -1 heart
      j.attackCooldown = 75; // slower ticks
    }
  }
  // remove dead jellies
  for (let i = jellies.length - 1; i >= 0; i--) {
    if (jellies[i].hp <= 0) {
      jellies.splice(i, 1);
      player.kills++;
      checkGoldenSword();
    }
  }
}

function updateBoss() {
  if (!boss) return;
  if (boss.attackCooldown > 0) boss.attackCooldown--;
  if (boss.hitFlash > 0) boss.hitFlash--;
  const bx = boss.x + boss.w/2, by = boss.y + boss.h/2;
  const px = player.x + player.w/2, py = player.y + player.h/2;
  const dx = px - bx, dy = py - by;
  const dist = Math.hypot(dx, dy);
  const aggro = 160, leash = 260;
  if (boss.state !== "chase" && dist < aggro) boss.state = "chase";
  if (boss.state === "chase" && dist > leash) boss.state = "idle";
  if (boss.state === "chase" && dist > 2) {
    const nx = (dx / dist) * boss.speed;
    const ny = (dy / dist) * boss.speed;
    const moved = collideAndSlide(boss.x, boss.y, boss.w, boss.h, nx, ny);
    boss.x = moved.x; boss.y = moved.y;
  }
  if (aabbIntersect(boss, player) && player.invulFrames === 0 && boss.attackCooldown === 0) {
    applyDamage(2); // full heart
    boss.attackCooldown = 60;
  }
  if (boss.hp <= 0) {
    // drop 4 hearts
    for (let i = 0; i < 4; i++) {
      heartDrops.push({ x: boss.x + boss.w/2 - 4 + rand(-6,6), y: boss.y + boss.h/2 - 3 + rand(-6,6), w: 8, h: 6, amount: 2, timer: 1200 });
    }
    // drop one missing item, if any
    const missing = [];
    if (!player.inv.axe) missing.push("axe");
    if (!player.inv.boat) missing.push("boat");
    if (!player.inv.pickaxe) missing.push("pickaxe");
    if (!player.inv.sword && !player.inv.goldenSword) missing.push("sword");
    if (missing.length) {
      const k = missing[rand(0, missing.length-1)];
      deathDrops.push({ kind: k, x: boss.x + boss.w/2 - 8, y: boss.y + boss.h/2 - 8, w: 16, h: 16, timer: 7200 });
    }
    boss = null;
    player.kills++;
    checkGoldenSword();
  }
}

function aabbIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function applyDamage(amount) {
  player.health = Math.max(0, player.health - amount);
  player.invulFrames = 45; // brief invulnerability (~0.75s)
  if (player.health === 0) {
    // drop inventory on death
    dropInventoryAt(player.x + player.w/2, player.y + player.h/2);
    // choose a different respawn
    const prevX = playerSpawn.x, prevY = playerSpawn.y;
    const newSpawn = findDifferentSpawn(prevX, prevY);
    player.x = newSpawn.x;
    player.y = newSpawn.y;
    player.health = player.maxHealth;
    respawnOverlayActive = true; // wait for user to continue
    addMessage("You fainted... respawning.");
  }
}

function toolAttackDamage(tool) {
  if (tool === TOOLS.GOLDEN_SWORD) return 3;
  if (tool === TOOLS.SWORD) return 2;
  if (tool === TOOLS.KNIFE) return 0.25;
  if (tool === TOOLS.AXE || tool === TOOLS.PICKAXE) return 1;
  return 0;
}
function applyAttackHit() {
  const dmg = toolAttackDamage(player.tool);
  if (dmg <= 0) return;
  // small hitbox in facing direction
  const fx = player.facingDx, fy = player.facingDy;
  let ax = player.x, ay = player.y, aw = player.w, ah = player.h;
  const reach = 10;
  if (fx === 1) { ax = player.x + player.w; ay = player.y + 2; aw = reach; ah = player.h - 4; }
  else if (fx === -1) { ax = player.x - reach; ay = player.y + 2; aw = reach; ah = player.h - 4; }
  else if (fy === 1) { ax = player.x + 2; ay = player.y + player.h; aw = player.w - 4; ah = reach; }
  else if (fy === -1) { ax = player.x + 2; ay = player.y - reach; aw = player.w - 4; ah = reach; }
  const hitBox = { x: ax, y: ay, w: aw, h: ah };
  for (const s of spiders) {
    if (s.hp > 0 && s.hitCooldown === 0 && aabbIntersect(hitBox, s)) {
      s.hp -= dmg;
      s.hitCooldown = 10; // short i-frames to avoid multi-hit per swing
      // knockback
      const sx = s.x + s.w/2, sy = s.y + s.h/2;
      const px = player.x + player.w/2, py = player.y + player.h/2;
      let kdx = sx - px, kdy = sy - py;
      const klen = Math.hypot(kdx, kdy) || 1;
      kdx = (kdx / klen) * 6; kdy = (kdy / klen) * 6;
      const moved = collideAndSlide(s.x, s.y, s.w, s.h, kdx, kdy);
      s.x = moved.x; s.y = moved.y;
      s.hitFlash = 6;
    }
  }
  // boss hit
  if (boss && aabbIntersect(hitBox, boss)) {
    boss.hp -= dmg;
    const bx = boss.x + boss.w/2, by = boss.y + boss.h/2;
    const px = player.x + player.w/2, py = player.y + player.h/2;
    let kdx = bx - px, kdy = by - py;
    const klen = Math.hypot(kdx, kdy) || 1;
    kdx = (kdx / klen) * 4; kdy = (kdy / klen) * 4;
    const moved = collideAndSlide(boss.x, boss.y, boss.w, boss.h, kdx, kdy);
    boss.x = moved.x; boss.y = moved.y;
    boss.hitFlash = 6;
  }
  // jellies hit
  for (const j of jellies) {
    if (j.hp > 0 && j.hitCooldown === 0 && aabbIntersect(hitBox, j)) {
      j.hp -= dmg;
      j.hitCooldown = 10;
      j.hitFlash = 6;
      // small knockback on water surface
      const jcx = j.x + j.w/2, jcy = j.y + j.h/2;
      const pcx = player.x + player.w/2, pcy = player.y + player.h/2;
      let kdx = jcx - pcx, kdy = jcy - pcy;
      const klen = Math.hypot(kdx, kdy) || 1;
      kdx = (kdx / klen) * 3; kdy = (kdy / klen) * 3;
      const nx = j.x + kdx, ny = j.y + kdy;
      const ntx = Math.floor((nx + j.w/2) / TILE), nty = Math.floor((ny + j.h/2) / TILE);
      if (inside(ntx, nty) && map[nty][ntx] === T.WATER) { j.x = nx; j.y = ny; }
    }
  }
}

function checkGoldenSword() {
  if (player.kills >= 5 && !player.inv.goldenSword) {
    player.inv.goldenSword = true;
    player.inv.sword = false;
    player.tool = TOOLS.GOLDEN_SWORD;
    goldenOverlayTimer = 150; // ~2.5s big notification
  }
}

// ===== Death drops and respawn overlay =====
const deathDrops = []; // {kind:"axe"|"boat"|"pickaxe"|"sword", x,y,w,h,timer}
let respawnOverlayTimer = 0;
let respawnOverlayActive = false;
let goldenOverlayTimer = 0;

function dropInventoryAt(cx, cy) {
  const kinds = [];
  if (player.inv.axe) { kinds.push("axe"); player.inv.axe = false; }
  if (player.inv.boat) { kinds.push("boat"); player.inv.boat = false; }
  if (player.inv.pickaxe) { kinds.push("pickaxe"); player.inv.pickaxe = false; }
  if (player.inv.sword) { kinds.push("sword"); player.inv.sword = false; }
  if (!kinds.length) return;
  if ((player.tool === TOOLS.AXE && !player.inv.axe) || (player.tool === TOOLS.BOAT && !player.inv.boat) || (player.tool === TOOLS.PICKAXE && !player.inv.pickaxe) || (player.tool === TOOLS.SWORD && !player.inv.sword)) {
    player.tool = TOOLS.NONE;
  }
  for (const k of kinds) {
    deathDrops.push({ kind: k, x: cx-8, y: cy-8, w: 16, h: 16, timer: 7200 }); // 2 minutes at 60fps
  }
}
function relocateDrop(i) {
  const drop = deathDrops[i];
  const pcx = Math.floor(player.x / TILE), pcy = Math.floor(player.y / TILE);
  const reach = computeReachableFloors(pcx, pcy);
  const candidates = [];
  for (let y = 1; y < WORLD_H-1; y++) {
    for (let x = 1; x < WORLD_W-1; x++) {
      if (!reach[y][x]) continue;
      if (map[y][x] !== T.FLOOR) continue;
      candidates.push([x, y]);
    }
  }
  if (!candidates.length) { deathDrops.splice(i,1); return; }
  const [tx, ty] = candidates[rand(0, candidates.length-1)];
  drop.x = tx*TILE + (TILE - drop.w)/2;
  drop.y = ty*TILE + (TILE - drop.h)/2;
  drop.timer = 7200;
}
function findDifferentSpawn(prevX, prevY) {
  for (let tries = 0; tries < 5000; tries++) {
    const s = findSpawn();
    const dx = s.x - prevX, dy = s.y - prevY;
    if (dx*dx + dy*dy > (TILE*TILE*100)) return s; // at least ~10 tiles away
  }
  return findSpawn();
}

function inside(x, y) {
  return x > 0 && y > 0 && x < WORLD_W - 1 && y < WORLD_H - 1;
}
function rand(a, b) {
  return (Math.random() * (b - a + 1) | 0) + a;
}
function clampInt(v, a, b) {
  return v < a ? a : (v > b ? b : v);
}

// ===== Player =====
const playerSpawn = findSpawn();
const player = {
  x: playerSpawn.x, y: playerSpawn.y,
  w: 12, h: 16,
  speed: 1.6,
  stepTimer: 0,
  stepFrame: 0,
  isMoving: false,
  tool: TOOLS.KNIFE,
  facingDx: 0,
  facingDy: 1,
  swingTimer: 0,
  inv: { axe:false, boat:false, pickaxe:false, sword:false, goldenSword:false, knife:true },
  health: 10, // half-hearts (5 hearts)
  maxHealth: 10,
  invulFrames: 0,
  kills: 0,
  onBoat: false
};

// After we know spawn, place items on reachable floor tiles
(function placeItemsReachable() {
  const spawnTx = Math.floor(player.x / TILE);
  const spawnTy = Math.floor(player.y / TILE);
  const reachable = computeReachableFloors(spawnTx, spawnTy);
  // Harder: place items far from their typical terrain
  placeItemFarFrom(map, reachable, T.AXE_ITEM, T.TREE, 4);
  placeItemFarFrom(map, reachable, T.PICKAXE_ITEM, T.MOUNTAIN, 4);
  placeItemFarFrom(map, reachable, T.BOAT_ITEM, T.WATER, 4);
  // Sword can be anywhere reachable (no avoidance)
  placeItemFarFrom(map, reachable, T.SWORD_ITEM, null, 0);

  // Spawn spiders on reachable floors, not too close to spawn
  spawnSpiders(reachable, 14);
  // Spawn boss
  spawnBoss(reachable);
  // Spawn jellyfish in water
  spawnJellies(12);
})();

// ===== Camera =====
const camera = { x: 0, y: 0, w: VIEW_W / SCALE, h: VIEW_H / SCALE };

// ===== Core loop =====
function update() {
  // maintain on-boat state: activating boat toggles onBoat true; stays true while on water until leaving water
  const curTileX = Math.floor((player.x + player.w/2) / TILE);
  const curTileY = Math.floor((player.y + player.h/2) / TILE);
  const currentlyOnWater = inside(curTileX, curTileY) && map[curTileY][curTileX] === T.WATER;
  if (player.tool === TOOLS.BOAT && player.inv.boat && currentlyOnWater) player.onBoat = true;
  if (!currentlyOnWater) player.onBoat = false;

  let vx = 0, vy = 0;

  if (keys.has("arrowleft") || keys.has("a")) vx -= player.speed;
  if (keys.has("arrowright")|| keys.has("d")) vx += player.speed;
  if (keys.has("arrowup")   || keys.has("w")) vy -= player.speed;
  if (keys.has("arrowdown") || keys.has("s")) vy += player.speed;

  // normalize diagonal
  if (vx && vy) { vx *= Math.SQRT1_2; vy *= Math.SQRT1_2; }

  player.isMoving = !!(vx || vy);
  if (player.isMoving) {
    // update facing based on dominant axis
    if (Math.abs(vx) > Math.abs(vy)) {
      player.facingDx = vx > 0 ? 1 : -1; player.facingDy = 0;
    } else if (Math.abs(vy) > 0) {
      player.facingDx = 0; player.facingDy = vy > 0 ? 1 : -1;
    }
    player.stepTimer += 1;
    if (player.stepTimer > 8) {
      player.stepTimer = 0;
      player.stepFrame = player.stepFrame ^ 1; // toggle 0/1
    }
  } else {
    player.stepTimer = 0;
  }

  // sword swing timer decay
  if (player.swingTimer > 0) player.swingTimer--;
  if (player.invulFrames > 0) player.invulFrames--;

  // interactions moved to Space via useToolAction()

  // collisions
  const { x:nx, y:ny } = collideAndSlide(player.x, player.y, player.w, player.h, vx, vy);
  player.x = Math.round(nx);
  player.y = Math.round(ny);

  // Pickup items when standing on them
  const tileCx = Math.floor((player.x + player.w/2) / TILE);
  const tileCy = Math.floor((player.y + player.h/2) / TILE);
  if (inside(tileCx, tileCy)) {
    const t = map[tileCy][tileCx];
    if (t === T.AXE_ITEM) { player.inv.axe = true; map[tileCy][tileCx] = T.FLOOR; addMessage("You found an axe!"); }
    else if (t === T.BOAT_ITEM) { player.inv.boat = true; map[tileCy][tileCx] = T.FLOOR; addMessage("You found a boat!"); }
    else if (t === T.PICKAXE_ITEM) { player.inv.pickaxe = true; map[tileCy][tileCx] = T.FLOOR; addMessage("You found a pickaxe!"); }
    else if (t === T.SWORD_ITEM) { player.inv.sword = true; map[tileCy][tileCx] = T.FLOOR; addMessage("You found a sword!"); }
  }

  // camera follow
  const cx = Math.round(player.x + player.w/2 - camera.w/2);
  const cy = Math.round(player.y + player.h/2 - camera.h/2);
  camera.x = clamp(cx, 0, WORLD_W*TILE - camera.w);
  camera.y = clamp(cy, 0, WORLD_H*TILE - camera.h);

  // enemies
  updateSpiders();
  updateBoss();
 
  // heart drop pickups
  for (let i = heartDrops.length - 1; i >= 0; i--) {
    const d = heartDrops[i];
    d.timer--;
    if (d.timer <= 0) { heartDrops.splice(i, 1); continue; }
    if (aabbIntersect(d, player)) {
      const before = player.health;
      player.health = Math.min(player.maxHealth, player.health + d.amount);
      if (player.health > before) {
        addMessage(d.amount >= 2 ? "+1 Heart" : "+1/2 Heart");
      }
      heartDrops.splice(i, 1);
    }
  }

  // death drop pickups
  for (let i = deathDrops.length - 1; i >= 0; i--) {
    const d = deathDrops[i];
    d.timer--;
    if (d.timer <= 0) { relocateDrop(i); continue; }
    if (aabbIntersect(d, player)) {
      const kind = d.kind;
      if (kind === "axe") { player.inv.axe = true; addMessage("You found an axe!"); }
      else if (kind === "boat") { player.inv.boat = true; addMessage("You found a boat!"); }
      else if (kind === "pickaxe") { player.inv.pickaxe = true; addMessage("You found a pickaxe!"); }
      else if (kind === "sword") { player.inv.sword = true; addMessage("You found a sword!"); }
      deathDrops.splice(i, 1);
    }
  }
}

function useToolAction() {
  // target tile in facing direction
  const pcx = Math.floor((player.x + player.w/2) / TILE);
  const pcy = Math.floor((player.y + player.h/2) / TILE);
  const tx = pcx + player.facingDx;
  const ty = pcy + player.facingDy;
  if (!inside(tx, ty)) return;
  const t = map[ty][tx];
  if (player.tool === TOOLS.AXE) {
    player.swingTimer = 6;
    if (t === T.TREE) {
      map[ty][tx] = T.FLOOR;
    }
    applyAttackHit();
  } else if (player.tool === TOOLS.PICKAXE) {
    player.swingTimer = 6;
    if (t === T.MOUNTAIN) {
      map[ty][tx] = T.FLOOR;
    }
    applyAttackHit();
  } else if (player.tool === TOOLS.SWORD || player.tool === TOOLS.GOLDEN_SWORD || player.tool === TOOLS.KNIFE) {
    player.swingTimer = 6;
    applyAttackHit();
  }
}

function draw() {
  // bg
  ctx.fillStyle = "#0f1522";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // world to camera
  ctx.save();
  ctx.scale(SCALE, SCALE);
  ctx.translate(-(camera.x|0), -(camera.y|0));

  // visible range
  const sx = Math.max(0, (camera.x / TILE) | 0);
  const sy = Math.max(0, (camera.y / TILE) | 0);
  const ex = Math.min(WORLD_W, ((camera.x + camera.w) / TILE | 0) + 2);
  const ey = Math.min(WORLD_H, ((camera.y + camera.h) / TILE | 0) + 2);

  for (let ty = sy; ty < ey; ty++) {
    for (let tx = sx; tx < ex; tx++) {
      const t = map[ty][tx];
      const px = tx*TILE, py = ty*TILE;

      if (t === T.FLOOR) {
        ctx.fillStyle = ((tx + ty) & 1) ? PALETTE.floor : PALETTE.floorVar;
        ctx.fillRect(px, py, TILE, TILE);
      } else if (t === T.TREE) {
        ctx.fillStyle = PALETTE.tree;
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = PALETTE.treeTop;
        ctx.fillRect(px, py, TILE, 4);
      } else if (t === T.MOUNTAIN) {
        ctx.fillStyle = PALETTE.mountain;
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = PALETTE.mountainTop;
        ctx.fillRect(px, py, TILE, 3);
      } else if (t === T.WATER) {
        ctx.fillStyle = PALETTE.water;
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = PALETTE.waterEdge;
        ctx.fillRect(px, py+TILE-3, TILE, 3);
      } else if (t === T.HUT) {
        ctx.fillStyle = PALETTE.hut;
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = PALETTE.hutRoof;
        ctx.fillRect(px, py, TILE, 5);
      } else if (t === T.CAVE) {
        ctx.fillStyle = PALETTE.cave;
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = PALETTE.caveEdge;
        ctx.fillRect(px, py, TILE, 4);
      } else if (t === T.AXE_ITEM) {
        // axe icon
        ctx.fillStyle = "#d0b48a"; ctx.fillRect(px+6, py+4, 4, 3);
        ctx.fillStyle = "#6b4b2a"; ctx.fillRect(px+7, py+7, 2, 6);
      } else if (t === T.PICKAXE_ITEM) {
        ctx.fillStyle = "#bfbfbf"; ctx.fillRect(px+5, py+4, 6, 3);
        ctx.fillStyle = "#6b4b2a"; ctx.fillRect(px+7, py+7, 2, 6);
      } else if (t === T.BOAT_ITEM) {
        ctx.fillStyle = "#7b5a2a"; ctx.fillRect(px+3, py+9, 10, 3);
        ctx.fillStyle = "#a57a3f"; ctx.fillRect(px+5, py+8, 6, 1);
      } else if (t === T.SWORD_ITEM) {
        ctx.fillStyle = "#e6e6e6"; ctx.fillRect(px+7, py+3, 2, 9);
        ctx.fillStyle = "#8a8a8a"; ctx.fillRect(px+5, py+11, 6, 2);
      }
    }
  }

  // Draw a simple raft under player if boating on water
  const playerTileX = Math.floor((player.x + player.w/2) / TILE);
  const playerTileY = Math.floor((player.y + player.h/2) / TILE);
  const onWater = inside(playerTileX, playerTileY) && map[playerTileY][playerTileX] === T.WATER;
  if ((player.tool === TOOLS.BOAT || player.onBoat) && onWater) {
    ctx.fillStyle = "#7b5a2a";
    ctx.fillRect(player.x-1, player.y+player.h-3, player.w+2, 3);
  }

  // Sword/Axe/Pickaxe swing effect
  if (player.swingTimer > 0 && (player.tool === TOOLS.SWORD || player.tool === TOOLS.AXE || player.tool === TOOLS.PICKAXE || player.tool === TOOLS.GOLDEN_SWORD || player.tool === TOOLS.KNIFE)) {
    // color per tool
    ctx.fillStyle = player.tool === TOOLS.GOLDEN_SWORD ? "#ffd24d" : player.tool === TOOLS.SWORD ? "#e6e6e6" : player.tool === TOOLS.KNIFE ? "#cfcfcf" : (player.tool === TOOLS.AXE ? "#d0b48a" : "#bfbfbf");
    const fx = player.facingDx, fy = player.facingDy;
    const swingCx = player.x + player.w/2;
    const swingCy = player.y + player.h/2;
    if (fx === 1) {
      ctx.fillRect(swingCx+4, swingCy-4, 6, 2);
      ctx.fillRect(swingCx+6, swingCy-1, 6, 2);
      ctx.fillRect(swingCx+4, swingCy+2, 6, 2);
    } else if (fx === -1) {
      ctx.fillRect(swingCx-10, swingCy-4, 6, 2);
      ctx.fillRect(swingCx-12, swingCy-1, 6, 2);
      ctx.fillRect(swingCx-10, swingCy+2, 6, 2);
    } else if (fy === 1) {
      ctx.fillRect(swingCx-4, swingCy+4, 2, 6);
      ctx.fillRect(swingCx-1, swingCy+6, 2, 6);
      ctx.fillRect(swingCx+2, swingCy+4, 2, 6);
    } else if (fy === -1) {
      ctx.fillRect(swingCx-4, swingCy-10, 2, 6);
      ctx.fillRect(swingCx-1, swingCy-12, 2, 6);
      ctx.fillRect(swingCx+2, swingCy-10, 2, 6);
    }
  }

  // Draw heart drops
  for (const d of heartDrops) {
    ctx.fillStyle = "#e34d4d";
    ctx.fillRect(d.x, d.y, d.w, d.h);
    ctx.fillStyle = "#9c2b2b";
    ctx.fillRect(d.x, d.y, d.w, 2);
  }

  // Draw spiders
  for (const s of spiders) {
    const isLarge = s.type === "large";
    const bodyColor = isLarge ? "#cc2222" : "#0b0b0b";
    const legColor = isLarge ? "#991111" : "#222222";
    // legs: 3 per side
    ctx.fillStyle = legColor;
    const lx = s.x, ly = s.y, lw = s.w, lh = s.h;
    // left legs
    ctx.fillRect(lx-3, ly+2, 3, 1);
    ctx.fillRect(lx-3, ly+lh/2|0, 3, 1);
    ctx.fillRect(lx-3, ly+lh-3, 3, 1);
    // right legs
    ctx.fillRect(lx+lw, ly+2, 3, 1);
    ctx.fillRect(lx+lw, ly+lh/2|0, 3, 1);
    ctx.fillRect(lx+lw, ly+lh-3, 3, 1);
    // front legs
    ctx.fillRect(lx+2, ly-2, 1, 2);
    ctx.fillRect(lx+lw-3, ly-2, 1, 2);
    // body
    ctx.fillStyle = bodyColor;
    ctx.fillRect(s.x, s.y, s.w, s.h);
    // eyes
    ctx.fillStyle = "#c0c0c0";
    ctx.fillRect(s.x+3, s.y+3, 2, 2);
    ctx.fillRect(s.x+s.w-5, s.y+3, 2, 2);
    if (s.hitFlash > 0) {
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillRect(s.x, s.y, s.w, s.h);
    }
  }

  // Draw boss
  if (boss) {
    ctx.fillStyle = "#1fa345"; // green troll
    ctx.fillRect(boss.x, boss.y, boss.w, boss.h);
    ctx.fillStyle = "#0e6e2f";
    ctx.fillRect(boss.x, boss.y, boss.w, 4);
    // eyes
    ctx.fillStyle = "#103b14";
    ctx.fillRect(boss.x+6, boss.y+6, 3, 3);
    ctx.fillRect(boss.x+boss.w-9, boss.y+6, 3, 3);
    if (boss.hitFlash > 0) {
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillRect(boss.x, boss.y, boss.w, boss.h);
    }
  }

  // player (12x16 sprite) with 2-frame walk
  const px = player.x, py = player.y;
  const bob = player.isMoving && player.stepFrame === 0 ? -1 : 0;

  // Hat/hair (top band)
  ctx.fillStyle = "#3a2b4d";
  ctx.fillRect(px, py + bob, player.w, 4);
  // Head (skin)
  ctx.fillStyle = "#f2c770";
  ctx.fillRect(px+1, py+4 + bob, player.w-2, 5);
  // Eyes
  ctx.fillStyle = "#0b0b0b";
  ctx.fillRect(px+3, py+6 + bob, 2, 2);
  ctx.fillRect(px+player.w-5, py+6 + bob, 2, 2);
  // Torso (shirt)
  ctx.fillStyle = "#3a74c7";
  ctx.fillRect(px+1, py+9 + bob, player.w-2, 5);

  // Legs (alternate)
  const leftUp = player.isMoving ? (player.stepFrame === 0) : false;
  // left leg
  ctx.fillStyle = "#2b2f4f";
  ctx.fillRect(px+2, py + (leftUp ? 13 : 14), 2, leftUp ? 3 : 2);
  // right leg
  ctx.fillRect(px+player.w-4, py + (leftUp ? 14 : 13), 2, leftUp ? 2 : 3);

  // Shoes
  ctx.fillStyle = "#7b4b2a";
  ctx.fillRect(px+2, py+15, 2, 1);
  ctx.fillRect(px+player.w-4, py+15, 2, 1);

  ctx.restore();

  // HUD
  // Hearts
  drawHearts(10, 16);

  ctx.fillStyle = "#b9c6d3";
  ctx.font = "12px system-ui, sans-serif";
  const invStr = `[${player.inv.knife?"K":"-"}${player.inv.axe?"A":"-"}${player.inv.boat?"B":"-"}${player.inv.pickaxe?"P":"-"}${player.inv.sword?"S":"-"}${player.inv.goldenSword?"G":"-"}]`;
  let hudY = VIEW_H - 10;
  ctx.fillText("WASD/Arrows • 1:Axe 2:Boat 3:Pickaxe 4:Sword 5:Golden 6:Knife • Space: Use • Tool: " + toolName(player.tool) + " • Inv " + invStr, 10, hudY);
  // Pickup messages
  hudY -= 16;
  ctx.fillStyle = "#e5f3ff";
  for (let i = 0; i < messages.length; i++) {
    ctx.fillText(messages[i].text, 10, hudY);
    hudY -= 14;
  }

  // death drop pickups
  for (let i = deathDrops.length - 1; i >= 0; i--) {
    const d = deathDrops[i];
    d.timer--;
    if (d.timer <= 0) { relocateDrop(i); continue; }
    if (aabbIntersect(d, player)) {
      const kind = d.kind;
      if (kind === "axe") { player.inv.axe = true; addMessage("You found an axe!"); }
      else if (kind === "boat") { player.inv.boat = true; addMessage("You found a boat!"); }
      else if (kind === "pickaxe") { player.inv.pickaxe = true; addMessage("You found a pickaxe!"); }
      else if (kind === "sword") { player.inv.sword = true; addMessage("You found a sword!"); }
      deathDrops.splice(i, 1);
    }
  }
  if (goldenOverlayTimer > 0) {
    goldenOverlayTimer--;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = "#ffd24d";
    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("You obtained the GOLDEN SWORD!", VIEW_W/2, VIEW_H/2);
  }
}

function drawHearts(x, y) {
  const hearts = player.maxHealth / 2;
  let hp = player.health;
  for (let i = 0; i < hearts; i++) {
    const hx = x + i*14;
    // background heart container
    ctx.fillStyle = "#2a2a2a";
    ctx.fillRect(hx, y, 12, 10);
    // fill full or half
    if (hp >= 2) {
      ctx.fillStyle = "#e34d4d";
      ctx.fillRect(hx+1, y+1, 10, 8);
      hp -= 2;
    } else if (hp === 1) {
      ctx.fillStyle = "#e34d4d";
      ctx.fillRect(hx+1, y+1, 5, 8);
      hp -= 1;
    }
    // border
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;
    ctx.strokeRect(hx+0.5, y+0.5, 11, 9);
  }
}

// === Collision helpers ===
function collideAndSlide(px, py, w, h, vx, vy) {
  // move X
  let nx = px + vx, ny = py;
  if (vx > 0) {
    if (isSolidRect(nx + w, ny, 1, h)) {
      nx = Math.floor((px + w + vx) / TILE) * TILE - w - 0.001;
    }
  } else if (vx < 0) {
    if (isSolidRect(nx, ny, 1, h)) {
      nx = Math.floor((px + vx) / TILE + 1) * TILE + 0.001;
    }
  }
  // move Y
  let nx2 = nx, ny2 = ny + vy;
  if (vy > 0) {
    if (isSolidRect(nx2, ny2 + h, w, 1)) {
      ny2 = Math.floor((py + h + vy) / TILE) * TILE - h - 0.001;
    }
  } else if (vy < 0) {
    if (isSolidRect(nx2, ny2, w, 1)) {
      ny2 = Math.floor((py + vy) / TILE + 1) * TILE + 0.001;
    }
  }
  return { x: nx2, y: ny2 };
}

function isSolidRect(x, y, w, h) {
  for (let ix = 0; ix < w; ix++) if (solidAt(x + ix, y)) return true;
  for (let iy = 0; iy < h; iy++) if (solidAt(x, y + iy)) return true;
  return false;
}
function solidAt(px, py) {
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  if (tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H) return true;
  const t = map[ty][tx];
  if (t === T.WATER && (player.tool === TOOLS.BOAT || player.onBoat)) return false;
  return t === T.TREE || t === T.WATER || t === T.MOUNTAIN || t === T.HUT || t === T.CAVE; // items are non-solid
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// ===== Main loop =====
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}
loop();
