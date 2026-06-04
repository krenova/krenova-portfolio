(function () {
  'use strict';

  const canvas = document.getElementById('boids-canvas');
  const ctx = canvas.getContext('2d');

  // --- Boids configuration ---
  const NUM_BOIDS   = 65;
  const MAX_SPEED   = 3.5;
  const MIN_SPEED   = 1.5;
  const SEP_RADIUS  = 30;   // steer away from crowding
  const ALIGN_RADIUS = 60;  // match velocity of neighbours
  const COH_RADIUS  = 60;   // move toward group centre
  const SEP_FORCE   = 0.15;
  const ALIGN_FORCE = 0.05;
  const COH_FORCE   = 0.004;
  const MOUSE_FORCE = 0.045; // pull toward cursor

  // --- Dash / Flick Configuration ---
  const DASH_MAX_SPEED = 14.0;
  const FLICK_WINDOW   = 200;  // ms window to measure velocity
  const FLICK_VELOCITY = 4;  // Increased from 0.4 to 1.2 to ignore slow movements
  const DASH_STRENGTH  = 0.45; // Increased base force for more impact when triggered
  const DASH_DECAY     = 0.94; // multiplier per frame

  let mouseX = null, mouseY = null;
  let mouseHistory = []; // [{x, y, t}]
  let dashX = 0, dashY = 0;
  let isSimulationRunning = localStorage.getItem('boids-running') !== 'false';

  const toggleBtn = document.getElementById('boids-toggle');
  const toggleIcon = toggleBtn ? toggleBtn.querySelector('.toggle-icon') : null;

  function updateVisuals(running) {
    if (!toggleBtn || !toggleIcon) return;
    if (running) {
      canvas.style.display = 'block';
      toggleBtn.classList.remove('off');
      toggleIcon.textContent = 'ON';
    } else {
      canvas.style.display = 'none';
      toggleBtn.classList.add('off');
      toggleIcon.textContent = 'OFF';
    }
  }

  // Initial state
  updateVisuals(isSimulationRunning);

  function handleToggle() {
    isSimulationRunning = !isSimulationRunning;
    localStorage.setItem('boids-running', isSimulationRunning);
    updateVisuals(isSimulationRunning);
    if (isSimulationRunning) {
      requestAnimationFrame(loop);
    }
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', handleToggle);
  }

  const boidsLabel = document.querySelector('.boids-label');
  if (boidsLabel) {
    boidsLabel.style.cursor = 'pointer';
    boidsLabel.addEventListener('click', handleToggle);
  }

  // Size the pixel buffer to the full viewport
  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  // Track mouse in canvas-local coordinates
  document.addEventListener('mousemove', function (e) {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    mouseX = mx;
    mouseY = my;

    const now = Date.now();
    mouseHistory.push({ x: mx, y: my, t: now });

    // Prune history older than FLICK_WINDOW
    while (mouseHistory.length > 0 && now - mouseHistory[0].t > FLICK_WINDOW) {
      mouseHistory.shift();
    }

    // Detect flick: calculate velocity over the current window
    if (mouseHistory.length > 1) {
      const oldest = mouseHistory[0];
      const dt = now - oldest.t;

      if (dt > 20) { // Require a small time delta for stable velocity calculation
        const dx = mx - oldest.x;
        const dy = my - oldest.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const speed = dist / dt; // pixels per millisecond

        if (speed > FLICK_VELOCITY) {
          // Accumulate dash velocity rather than resetting it.
          // We scale the added strength by how much the speed exceeds the threshold.
          const intensity = Math.min(3.0, speed / FLICK_VELOCITY);
          dashX += (dx / dist) * DASH_STRENGTH * intensity;
          dashY += (dy / dist) * DASH_STRENGTH * intensity;

          // Cap the total dash force to avoid uncontrollable speeds
          const totalDash = Math.sqrt(dashX * dashX + dashY * dashY);
          const MAX_DASH_BOOST = 8.0;
          if (totalDash > MAX_DASH_BOOST) {
            dashX = (dashX / totalDash) * MAX_DASH_BOOST;
            dashY = (dashY / totalDash) * MAX_DASH_BOOST;
          }

          // Instead of clearing all history, we prune most of it to prevent 
          // redundant triggers on the same movement segment, but keep the 
          // last few points to maintain a smooth velocity window.
          if (mouseHistory.length > 2) {
            mouseHistory.splice(0, mouseHistory.length - 2);
          }
        }
      }
    }
  });

  // --- Boid class ---
  function Boid() {
    this.x  = Math.random() * canvas.width;
    this.y  = Math.random() * canvas.height;
    var a   = Math.random() * Math.PI * 2;
    var s   = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
    this.vx = Math.cos(a) * s;
    this.vy = Math.sin(a) * s;
    this.phase = Math.random() * Math.PI * 2; // wing-flap offset
  }

  Boid.prototype.update = function (boids) {
    var sx = 0, sy = 0, sn = 0;
    var ax = 0, ay = 0, an = 0;
    var cx = 0, cy = 0, cn = 0;
    var SEP2   = SEP_RADIUS   * SEP_RADIUS;
    var ALIGN2 = ALIGN_RADIUS * ALIGN_RADIUS;
    var COH2   = COH_RADIUS   * COH_RADIUS;

    for (var i = 0; i < boids.length; i++) {
      var o = boids[i];
      if (o === this) continue;
      var dx = o.x - this.x;
      var dy = o.y - this.y;
      var d2 = dx * dx + dy * dy;

      if (d2 < SEP2 && d2 > 0) {
        var d = Math.sqrt(d2);
        sx -= dx / d; sy -= dy / d; sn++;
      }
      if (d2 < ALIGN2) { ax += o.vx; ay += o.vy; an++; }
      if (d2 < COH2)   { cx += o.x;  cy += o.y;  cn++; }
    }

    // Distance to cursor — drives the scatter / converge effect
    // mouseNear: 1.0 = right at cursor, 0.0 = 450 px away or more
    var mouseNear = 1.0; // full flocking until the user moves the cursor
    var mdx = 0, mdy = 0, md = 0;
    if (mouseX !== null) {
      mdx = mouseX - this.x;
      mdy = mouseY - this.y;
      md  = Math.sqrt(mdx * mdx + mdy * mdy);
      mouseNear = Math.max(0, 1 - md / 450);
    }

    // Far  → scatter : separation boosted, cohesion & alignment weakened
    // Near → converge: separation normal, cohesion & alignment at full strength
    var sepScale   = 0.5 + (1 - mouseNear) * 2.0; // 0.5 (near) → 2.5 (far)
    var alignScale = 0.15 + mouseNear * 0.85;       // 0.15 (far) → 1.0 (near)
    var cohScale   = 0.1  + mouseNear * 0.9;        // 0.10 (far) → 1.0 (near)

    if (sn > 0) { this.vx += (sx / sn) * SEP_FORCE * sepScale;   this.vy += (sy / sn) * SEP_FORCE * sepScale; }
    if (an > 0) { this.vx += ((ax / an) - this.vx) * ALIGN_FORCE * alignScale; this.vy += ((ay / an) - this.vy) * ALIGN_FORCE * alignScale; }
    if (cn > 0) { this.vx += ((cx / cn) - this.x) * COH_FORCE * cohScale;   this.vy += ((cy / cn) - this.y) * COH_FORCE * cohScale; }

    // Mouse attraction — constant pull toward the cursor from any distance
    if (mouseX !== null && md > 1) {
      this.vx += (mdx / md) * MOUSE_FORCE;
      this.vy += (mdy / md) * MOUSE_FORCE;
    }

    // Apply dash force if active
    var dashSpd = Math.sqrt(dashX * dashX + dashY * dashY);
    if (dashSpd > 0.01) {
      this.vx += dashX;
      this.vy += dashY;
    }

    // Clamp to speed limits
    var spd = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    
    // Smooth transition for max speed: linearly interpolate between normal and dash speed based on dash intensity
    // We use a denominator of 4.0 to make the transition smoother as dash force accumulates.
    var currentMax = MAX_SPEED + (DASH_MAX_SPEED - MAX_SPEED) * Math.min(1, dashSpd / 4.0);

    if (spd > currentMax) {
      this.vx = (this.vx / spd) * currentMax;
      this.vy = (this.vy / spd) * currentMax;
    } else if (spd < MIN_SPEED && spd > 0) {
      this.vx = (this.vx / spd) * MIN_SPEED;
      this.vy = (this.vy / spd) * MIN_SPEED;
    }

    this.x += this.vx;
    this.y += this.vy;
    this.phase += 0.18; // advance wing-flap animation

    // Wrap around canvas edges
    var W = canvas.width, H = canvas.height;
    if (this.x < -15) this.x = W + 14;
    if (this.x > W + 15) this.x = -14;
    if (this.y < -15) this.y = H + 14;
    if (this.y > H + 15) this.y = -14;
  };

  Boid.prototype.draw = function () {
    var angle  = Math.atan2(this.vy, this.vx);
    // Wing spread oscillates between 2.5 and 6.5 — simulates flapping
    var spread = 2.5 + Math.abs(Math.sin(this.phase)) * 4;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(angle);

    ctx.beginPath();
    ctx.moveTo(7, 0);          // nose / beak
    ctx.lineTo(-3, -spread);   // left wing tip
    ctx.lineTo(-1.5, 0);       // tail centre
    ctx.lineTo(-3,  spread);   // right wing tip
    ctx.closePath();

    ctx.fillStyle = 'rgba(100, 112, 130, 0.45)';
    ctx.fill();
    ctx.restore();
  };

  // Initialise flock
  var boids = [];
  for (var i = 0; i < NUM_BOIDS; i++) boids.push(new Boid());

  // Animation loop — update all positions first, then draw (avoids directional bias)
  function loop() {
    if (!isSimulationRunning) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Decay dash momentum
    dashX *= DASH_DECAY;
    dashY *= DASH_DECAY;

    for (var i = 0; i < boids.length; i++) boids[i].update(boids);
    for (var i = 0; i < boids.length; i++) boids[i].draw();
    requestAnimationFrame(loop);
  }

  loop();
})();
