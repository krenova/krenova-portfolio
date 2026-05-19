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

  let mouseX = null, mouseY = null;

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
    mouseX = e.clientX - r.left;
    mouseY = e.clientY - r.top;
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

    // Clamp to speed limits
    var spd = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (spd > MAX_SPEED) {
      this.vx = (this.vx / spd) * MAX_SPEED;
      this.vy = (this.vy / spd) * MAX_SPEED;
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

    ctx.fillStyle = 'rgba(37, 50, 72, 0.62)';
    ctx.fill();
    ctx.restore();
  };

  // Initialise flock
  var boids = [];
  for (var i = 0; i < NUM_BOIDS; i++) boids.push(new Boid());

  // Animation loop — update all positions first, then draw (avoids directional bias)
  function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (var i = 0; i < boids.length; i++) boids[i].update(boids);
    for (var i = 0; i < boids.length; i++) boids[i].draw();
    requestAnimationFrame(loop);
  }

  loop();
})();
