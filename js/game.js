'use strict';

// ================================================================
// CONSTANTS
// ================================================================
const CANVAS_W     = 960;
const CANVAS_H     = 540;
const GROUND_Y     = 420;
const GRAVITY      = 0.75;
const JUMP_FORCE   = -15;
const WALK_SPEED   = 4;
const WALL_L       = 80;
const WALL_R       = CANVAS_W - 80;
const ROUND_TIME   = 99;
const ROUNDS_TO_WIN = 2;
const FB_SPEED     = 6;
const FB_DMG       = 15;

// Fighter state IDs
const FS = Object.freeze({
  IDLE:     0,
  WALK_FWD: 1,
  WALK_BWD: 2,
  JUMP_N:   3,
  JUMP_F:   4,
  JUMP_B:   5,
  CROUCH:   6,
  PUNCH_L:  7,
  PUNCH_H:  8,
  KICK_L:   9,
  KICK_H:   10,
  SPECIAL:  11,
  BLOCK_HI: 12,
  BLOCK_LO: 13,
  HURT_HI:  14,
  HURT_LO:  15,
  KO:       16,
  WIN:      17,
});

// Game state IDs
const GS = Object.freeze({
  MENU:      0,
  INTRO:     1,
  FIGHT:     2,
  ROUND_END: 3,
  GAME_OVER: 4,
});

// Attack frame data: damage, block_dmg, reach, y_offset, width, height,
//                    startup_frames, active_frames, recovery_frames
const MOVES = {
  [FS.PUNCH_L]: { dmg: 5,  bdmg: 1, reach: 56, yo: -82, aw: 46, ah: 24, su: 3, ac: 4, rec: 8  },
  [FS.PUNCH_H]: { dmg: 10, bdmg: 2, reach: 66, yo: -88, aw: 52, ah: 28, su: 7, ac: 5, rec: 13 },
  [FS.KICK_L]:  { dmg: 7,  bdmg: 1, reach: 70, yo: -50, aw: 56, ah: 24, su: 5, ac: 5, rec: 10 },
  [FS.KICK_H]:  { dmg: 13, bdmg: 3, reach: 80, yo: -60, aw: 62, ah: 28, su: 9, ac: 6, rec: 15 },
  [FS.SPECIAL]: { su: 12, ac: 0, rec: 20 },
};

const HURT_DUR = 16;

// ================================================================
// INPUT HANDLER
// ================================================================
class InputHandler {
  constructor() {
    this._held   = new Set();
    this._pressed = new Set();
    this._buf    = new Set();

    window.addEventListener('keydown', e => {
      if (!this._held.has(e.code)) this._buf.add(e.code);
      this._held.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code))
        e.preventDefault();
    });

    window.addEventListener('keyup', e => this._held.delete(e.code));
  }

  isDown(c)    { return this._held.has(c); }
  isPressed(c) { return this._pressed.has(c); }

  flush() {
    this._pressed = new Set(this._buf);
    this._buf.clear();
  }
}

// ================================================================
// AUDIO SYSTEM  (Web Audio API — procedural sound effects)
// ================================================================
class AudioSystem {
  constructor() {
    this.ctx = null;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) { /* audio unavailable */ }
  }

  _resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  _play({ type = 'sine', freq, freqEnd, dur, vol = 0.3, delay = 0 }) {
    if (!this.ctx) return;
    this._resume();
    const t0   = this.ctx.currentTime + delay;
    const osc  = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.start(t0);
    osc.stop(t0 + dur + 0.01);
  }

  punch()    { this._play({ type: 'sawtooth', freq: 220, freqEnd: 55,  dur: 0.10, vol: 0.35 }); }
  kick()     { this._play({ type: 'sine',     freq: 160, freqEnd: 30,  dur: 0.15, vol: 0.40 }); }
  block()    { this._play({ type: 'square',   freq: 280, freqEnd: 200, dur: 0.08, vol: 0.20 }); }
  fireball() { this._play({ type: 'sawtooth', freq: 440, freqEnd: 180, dur: 0.30, vol: 0.20 }); }
  bell()     { this._play({ type: 'sine',     freq: 880, freqEnd: 440, dur: 0.80, vol: 0.50 }); }

  ko() {
    [0, 0.22, 0.44].forEach((d, i) => {
      const f = [300, 200, 120][i];
      this._play({ type: 'sine', freq: f, freqEnd: f * 0.4, dur: 0.18, vol: 0.45, delay: d });
    });
  }
}

// ================================================================
// PROJECTILE  (hadouken fireball)
// ================================================================
class Projectile {
  constructor(x, y, vx, owner) {
    this.x     = x;
    this.y     = y;
    this.vx    = vx;
    this.owner = owner;
    this.active = true;
    this.w     = 36;
    this.h     = 24;
    this.age   = 0;
  }

  update() {
    this.x += this.vx;
    this.age++;
    if (this.x < -120 || this.x > CANVAS_W + 120) this.active = false;
  }

  draw(ctx) {
    if (!this.active) return;
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    const r  = 14 + Math.sin(this.age * 0.4) * 2;

    ctx.save();
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0,    'rgba(255,255,220,1)');
    g.addColorStop(0.3,  'rgba(255,180,0,0.9)');
    g.addColorStop(0.65, 'rgba(255,60,0,0.7)');
    g.addColorStop(1,    'rgba(180,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  hitbox() {
    return { x: this.x + 6, y: this.y + 4, w: this.w - 12, h: this.h - 8 };
  }
}

// ================================================================
// FIGHTER
// ================================================================
class Fighter {
  constructor(cfg) {
    this.name          = cfg.name;
    this.primaryColor  = cfg.primaryColor;
    this.accentColor   = cfg.accentColor;
    this.skinColor     = cfg.skinColor     || '#d4a070';
    this.hairColor     = cfg.hairColor     || '#1a1000';
    this.headbandColor = cfg.headbandColor || null;
    this.isP1          = cfg.isP1;

    this._startX = cfg.x;
    this.x = cfg.x;
    this.y = GROUND_Y;
    this.facingRight = cfg.facingRight;
    this.vx = 0;
    this.vy = 0;

    this.health    = 100;
    this.maxHealth = 100;
    this.wins      = 0;

    this.state       = FS.IDLE;
    this.sf          = 0;   // state frame counter
    this.tf          = 0;   // total frame counter (for looping animations)
    this.attackPhase = 0;   // 1=startup  2=active  3=recovery
    this.moveData    = null;
    this.hasHit      = false;

    this.projectiles = [];
    this.hitFlash    = 0;

    this.W = 56;
    this.H = 110;
  }

  reset() {
    this.x           = this._startX;
    this.y           = GROUND_Y;
    this.vx          = 0;
    this.vy          = 0;
    this.health      = 100;
    this.state       = FS.IDLE;
    this.sf          = 0;
    this.attackPhase = 0;
    this.moveData    = null;
    this.hasHit      = false;
    this.projectiles = [];
    this.hitFlash    = 0;
  }

  // --- Computed state flags ---
  get inAttack() { return this.state >= FS.PUNCH_L && this.state <= FS.SPECIAL; }
  get inHurt()   { return this.state === FS.HURT_HI || this.state === FS.HURT_LO; }
  get inJump()   { return this.state >= FS.JUMP_N  && this.state <= FS.JUMP_B; }
  get inCrouch() { return this.state === FS.CROUCH  || this.state === FS.BLOCK_LO; }
  get inBlock()  { return this.state === FS.BLOCK_HI || this.state === FS.BLOCK_LO; }
  get grounded() { return this.y >= GROUND_Y - 1; }

  // ---- Process player / CPU input ----
  processInput(inp) {
    if (this.state === FS.KO || this.state === FS.WIN) return;

    const fwd = this.facingRight ? inp.right : inp.left;
    const bwd = this.facingRight ? inp.left  : inp.right;

    const canAct    = this.grounded && !this.inAttack && !this.inHurt;
    const canActAir = this.inJump   && !this.inAttack;

    if (canAct) {
      if (inp.special)       { this._enter(FS.SPECIAL);  return; }
      if (inp.punchH)        { this._enter(FS.PUNCH_H);  return; }
      if (inp.kickH)         { this._enter(FS.KICK_H);   return; }
      if (inp.punch)         { this._enter(FS.PUNCH_L);  return; }
      if (inp.kick)          { this._enter(FS.KICK_L);   return; }
      if (inp.up)            { this._doJump(fwd, bwd);   return; }
      if (inp.down && bwd && !fwd) { this._enter(FS.BLOCK_LO); return; }
      if (bwd && !fwd && !inp.down){ this._enter(FS.BLOCK_HI); return; }
      if (inp.down)          { this._enter(FS.CROUCH);   return; }
      if (fwd && !bwd)       { this._enter(FS.WALK_FWD); return; }
      if (bwd && !fwd)       { this._enter(FS.WALK_BWD); return; }
      this._enter(FS.IDLE);
    } else if (canActAir) {
      if (inp.punch) { this._enter(FS.PUNCH_L); return; }
      if (inp.kick)  { this._enter(FS.KICK_L);  return; }
    }
  }

  _doJump(fwd, bwd) {
    this.vy = JUMP_FORCE;
    if (fwd)       this._enter(FS.JUMP_F);
    else if (bwd)  this._enter(FS.JUMP_B);
    else           this._enter(FS.JUMP_N);
  }

  _enter(s) {
    if (this.state === s) return;
    this.state       = s;
    this.sf          = 0;
    this.hasHit      = false;
    this.moveData    = MOVES[s] || null;
    this.attackPhase = 0;
  }

  // ---- Per-frame update ----
  update(opponent) {
    this.tf++;
    this.sf++;
    if (this.hitFlash > 0) this.hitFlash--;

    // Gravity
    if (!this.grounded) this.vy += GRAVITY;
    this.y = Math.min(GROUND_Y, this.y + this.vy);
    if (this.y >= GROUND_Y) {
      this.vy = 0;
      if (this.inJump) this._enter(FS.IDLE);
    }

    // Horizontal movement
    this.x += this.vx;
    this.vx *= 0.75;
    if (Math.abs(this.vx) < 0.1) this.vx = 0;
    this.x = Math.max(WALL_L, Math.min(WALL_R, this.x));

    // State-specific logic
    switch (this.state) {
      case FS.WALK_FWD: this.vx = this.facingRight ?  WALK_SPEED       : -WALK_SPEED;       break;
      case FS.WALK_BWD: this.vx = this.facingRight ? -WALK_SPEED * 0.7 :  WALK_SPEED * 0.7; break;
      case FS.JUMP_F:   this.vx = this.facingRight ?  WALK_SPEED * 1.2 : -WALK_SPEED * 1.2; break;
      case FS.JUMP_B:   this.vx = this.facingRight ? -WALK_SPEED       :  WALK_SPEED;        break;

      case FS.PUNCH_L:
      case FS.PUNCH_H:
      case FS.KICK_L:
      case FS.KICK_H:
        this._updateAttack();
        break;

      case FS.SPECIAL:
        this._updateSpecial();
        break;

      case FS.HURT_HI:
      case FS.HURT_LO:
        if (this.sf >= HURT_DUR) this._enter(FS.IDLE);
        break;
    }

    // Projectile updates
    this.projectiles = this.projectiles.filter(p => { p.update(); return p.active; });

    // Auto-face opponent
    if (opponent && this.state !== FS.KO && this.state !== FS.WIN)
      this.facingRight = this.x < opponent.x;
  }

  _updateAttack() {
    const md = this.moveData;
    if (!md) return;
    const total = md.su + md.ac + md.rec;
    if      (this.sf <= md.su)         this.attackPhase = 1; // startup
    else if (this.sf <= md.su + md.ac) this.attackPhase = 2; // active
    else if (this.sf <= total)         this.attackPhase = 3; // recovery
    else this._enter(FS.IDLE);
  }

  _updateSpecial() {
    const md = this.moveData;
    if (!md) return;
    if (this.sf === md.su) {
      const dir = this.facingRight ? 1 : -1;
      const fbX = this.x + (this.facingRight ? 28 : -64);
      const fbY = this.y - 85;
      this.projectiles.push(new Projectile(fbX, fbY, dir * FB_SPEED, this));
    }
    if (this.sf >= md.su + md.rec) this._enter(FS.IDLE);
  }

  // Returns the active attack hitbox, or null
  attackHitbox() {
    if (this.attackPhase !== 2 || this.hasHit || !this.moveData) return null;
    if (this.state === FS.SPECIAL) return null;
    const { reach, yo, aw, ah } = this.moveData;
    const baseX = this.facingRight ? this.x + reach - aw : this.x - reach;
    return { x: baseX, y: this.y + yo, w: aw, h: ah };
  }

  // Returns the body hitbox (shorter when crouching)
  bodyHitbox() {
    const h = this.inCrouch ? this.H * 0.65 : this.H;
    return { x: this.x - this.W * 0.5, y: this.y - h, w: this.W, h };
  }

  takeDamage(dmg, blocked) {
    if (this.state === FS.KO) return;
    const actual = blocked ? Math.ceil(dmg * 0.2) : dmg;
    this.health  = Math.max(0, this.health - actual);
    this.hitFlash = 8;
    if (!blocked) {
      if (this.health <= 0) {
        this._enter(FS.KO);
        this.vy = -5;
      } else {
        this._enter(this.inCrouch ? FS.HURT_LO : FS.HURT_HI);
        this.vx = this.facingRight ? -3.5 : 3.5;
      }
    }
  }

  isBlocking(attackFromRight) {
    if (!this.inBlock) return false;
    // Fighter must be facing toward the attacker to block
    return attackFromRight ? !this.facingRight : this.facingRight;
  }

  // ================================================================
  // RENDERING  — all drawing uses canvas 2-D primitives
  // ================================================================
  draw(ctx) {
    ctx.save();
    if (this.hitFlash > 0 && this.hitFlash % 2 === 1)
      ctx.filter = 'brightness(3) saturate(0)';
    ctx.translate(this.x, this.y);
    ctx.scale(this.facingRight ? 1 : -1, 1);
    this._drawPose(ctx);
    ctx.restore();

    // Projectiles live in world-space
    this.projectiles.forEach(p => p.draw(ctx));
  }

  _drawPose(ctx) {
    const bob = Math.sin(this.tf * 0.1) * 2;
    switch (this.state) {
      case FS.IDLE:      this._pIdle(ctx, bob);                break;
      case FS.WALK_FWD:
      case FS.WALK_BWD:  this._pWalk(ctx, this.sf);            break;
      case FS.JUMP_N:
      case FS.JUMP_F:
      case FS.JUMP_B:    this._pJump(ctx);                     break;
      case FS.CROUCH:    this._pCrouch(ctx, false);            break;
      case FS.BLOCK_LO:  this._pCrouch(ctx, true);             break;
      case FS.PUNCH_L:   this._pPunch(ctx, false);             break;
      case FS.PUNCH_H:   this._pPunch(ctx, true);              break;
      case FS.KICK_L:    this._pKick(ctx, false);              break;
      case FS.KICK_H:    this._pKick(ctx, true);               break;
      case FS.SPECIAL:   this._pSpecial(ctx, this.sf);         break;
      case FS.BLOCK_HI:  this._pBlock(ctx);                    break;
      case FS.HURT_HI:
      case FS.HURT_LO:   this._pHurt(ctx);                     break;
      case FS.KO:        this._pKO(ctx);                       break;
      case FS.WIN:       this._pWin(ctx, this.tf);             break;
    }
  }

  // --- Drawing primitives ---
  _head(ctx, cx, cy, sz = 20) {
    // Neck
    ctx.fillStyle = this.skinColor;
    ctx.fillRect(cx - 5, cy + sz - 4, 10, 10);

    // Head
    ctx.beginPath();
    ctx.arc(cx, cy, sz, 0, Math.PI * 2);
    ctx.fillStyle = this.skinColor;
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Hair
    ctx.fillStyle = this.hairColor;
    ctx.beginPath();
    ctx.arc(cx, cy - 3, sz, Math.PI, 0);
    ctx.fill();

    // Headband
    if (this.headbandColor) {
      ctx.fillStyle = this.headbandColor;
      ctx.fillRect(cx - sz, cy - 8, sz * 2, 7);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(cx - sz, cy - 8, sz * 2, 7);
    }

    // Eye
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(cx + 8, cy + 2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx + 9, cy + 1, 1.2, 0, Math.PI * 2);
    ctx.fill();

    // Mouth
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + 4, cy + 9);
    ctx.lineTo(cx + 14, cy + 7);
    ctx.stroke();
  }

  _body(ctx, cx, top, w, h) {
    ctx.fillStyle = this.primaryColor;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(cx - w / 2, top, w, h, [4, 4, 2, 2]);
    } else {
      ctx.rect(cx - w / 2, top, w, h);
    }
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Belt
    ctx.fillStyle = this.accentColor;
    ctx.fillRect(cx - w / 2 - 2, top + h * 0.62, w + 4, 7);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(cx - w / 2 - 2, top + h * 0.62, w + 4, 7);
  }

  _arm(ctx, x1, y1, x2, y2, fist = false) {
    ctx.strokeStyle = this.primaryColor;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    if (fist) {
      ctx.fillStyle = this.skinColor;
      ctx.beginPath();
      ctx.arc(x2, y2, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  _leg(ctx, x1, y1, x2, y2) {
    ctx.strokeStyle = this.primaryColor;
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Foot
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.ellipse(x2 + 6, y2, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Pose methods ---
  _pIdle(ctx, bob) {
    this._leg(ctx, -10, -30 + bob, -18, bob);
    this._leg(ctx,  10, -30 + bob,  18, bob);
    this._body(ctx, 0, -102 + bob, 44, 72);
    this._arm(ctx, -18, -88 + bob, -34, -56 + bob, true);
    this._arm(ctx,  18, -88 + bob,  38, -62 + bob, true);
    this._head(ctx, 0, -118 + bob);
  }

  _pWalk(ctx, sf) {
    const t  = sf * 0.28;
    const l1 = Math.sin(t) * 22, l2 = Math.cos(t) * 22;
    const a1 = Math.cos(t) * 14, a2 = Math.sin(t) * 14;
    this._leg(ctx, -10, -30, -14 + l1, 0);
    this._leg(ctx,  10, -30,  14 + l2, 0);
    this._body(ctx, 0, -102, 44, 72);
    this._arm(ctx, -18, -88, -32 + a1, -58, true);
    this._arm(ctx,  18, -88,  36 + a2, -64, true);
    this._head(ctx, 0, -118);
  }

  _pJump(ctx) {
    this._leg(ctx, -10, -40, -26, -18);
    this._leg(ctx,  10, -40,  26, -18);
    this._body(ctx, 0, -106, 44, 68);
    this._arm(ctx, -18, -92, -50, -82, true);
    this._arm(ctx,  18, -92,  50, -82, true);
    this._head(ctx, 0, -122);
  }

  _pCrouch(ctx, blocking) {
    this._leg(ctx, -10, -22, -26, 0);
    this._leg(ctx,  10, -22,  26, 0);
    this._body(ctx, 0, -72, 42, 50);
    if (blocking) {
      this._arm(ctx, -14, -60,  18, -76, true);
      this._arm(ctx,  14, -60,  30, -80, true);
    } else {
      this._arm(ctx, -14, -60, -28, -40, true);
      this._arm(ctx,  14, -60,  24, -34, true);
    }
    this._head(ctx, 0, -86);
  }

  _pPunch(ctx, heavy) {
    const md     = this.moveData;
    if (!md) return;
    const active = this.attackPhase === 2;
    this._leg(ctx, -10, -30, -20, 0);
    this._leg(ctx,  10, -30,  22, 0);
    this._body(ctx, 0, -102, 44, 72);
    this._arm(ctx, -18, -88, -30, -62, true);
    if (active) {
      const ext = heavy ? 72 : 56;
      this._arm(ctx, 18, -88, ext, -88, true);
    } else {
      this._arm(ctx, 18, -88, 34, -66, true);
    }
    this._head(ctx, 0, -118);
  }

  _pKick(ctx, heavy) {
    const md     = this.moveData;
    if (!md) return;
    const active = this.attackPhase === 2;
    this._leg(ctx, -8, -30, -8, 0);
    if (active) {
      const ex = heavy ? 78 : 62;
      const ey = heavy ? -68 : -52;
      this._leg(ctx, 10, -32, ex, ey);
    } else {
      this._leg(ctx, 10, -32, 22, -12);
    }
    this._body(ctx, 0, -102, 44, 72);
    this._arm(ctx, -18, -88, -46, -76, true);
    this._arm(ctx,  18, -88,  30, -72, true);
    this._head(ctx, 0, -118);
  }

  _pSpecial(ctx, sf) {
    const md       = this.moveData;
    if (!md) return;
    const charging = sf < md.su;
    this._leg(ctx, -12, -30, -28, 0);
    this._leg(ctx,  12, -30,  24, 0);
    this._body(ctx, 0, -102, 44, 72);
    if (charging) {
      this._arm(ctx, -18, -88, -48, -76, true);
      this._arm(ctx,  18, -88,  44, -80, true);
    } else {
      this._arm(ctx, -18, -88, -14, -82, true);
      this._arm(ctx,  18, -88,  58, -82, true);
    }
    this._head(ctx, 0, -118);
  }

  _pBlock(ctx) {
    this._leg(ctx, -10, -30, -20, 0);
    this._leg(ctx,  10, -30,  20, 0);
    this._body(ctx, 0, -102, 44, 72);
    this._arm(ctx, -18, -88,  16, -104, true);
    this._arm(ctx,  18, -88,  32, -108, true);
    this._head(ctx, -4, -118);
  }

  _pHurt(ctx) {
    this._leg(ctx, -10, -30, -24, 0);
    this._leg(ctx,  10, -30,  16, 0);
    this._body(ctx, -4, -102, 44, 72);
    this._arm(ctx, -18, -88, -44, -70, true);
    this._arm(ctx,  14, -88,  36, -68, true);
    this._head(ctx, -6, -118);
  }

  _pKO(ctx) {
    ctx.save();
    ctx.translate(0, -12);

    // Lying body
    ctx.fillStyle = this.primaryColor;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(-52, -12, 104, 28, 8);
    } else {
      ctx.rect(-52, -12, 104, 28);
    }
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Head
    ctx.fillStyle = this.skinColor;
    ctx.beginPath();
    ctx.arc(-56, -4, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Limb bumps
    ctx.fillStyle = this.primaryColor;
    ctx.fillRect(-28, -26, 18, 14);
    ctx.fillRect(22, -26, 18, 14);

    ctx.restore();
  }

  _pWin(ctx, tf) {
    const r = Math.abs(Math.sin(tf * 0.15)) * 28;
    this._leg(ctx, -10, -30, -20, 0);
    this._leg(ctx,  10, -30,  20, 0);
    this._body(ctx, 0, -102, 44, 72);
    this._arm(ctx, -18, -88, -40, -112 - r, true);
    this._arm(ctx,  18, -88,  40, -112 - r, true);
    this._head(ctx, 0, -118);
  }
}

// ================================================================
// CPU AI
// ================================================================
class CPUAI {
  constructor(fighter, opponent) {
    this.f    = fighter;
    this.o    = opponent;
    this._timer = 0;
    this._move  = {};       // persistent movement keys
    this._atk   = {};       // one-shot attack keys
    this._atkUsed = true;   // consume attack after one frame
  }

  getInput() {
    const f    = this.f, o = this.o;
    const dx   = o.x - f.x;
    const dist = Math.abs(dx);
    const facing = (dx > 0) === f.facingRight;

    this._timer++;
    if (this._timer >= 18) {
      this._timer   = 0;
      const dec     = this._decide(dist, facing);
      this._move    = {
        left:  dec.left  || false,
        right: dec.right || false,
        up:    dec.up    || false,
        down:  dec.down  || false,
      };
      this._atk     = {
        punch:   dec.punch   || false,
        punchH:  dec.punchH  || false,
        kick:    dec.kick    || false,
        kickH:   dec.kickH   || false,
        special: dec.special || false,
      };
      this._atkUsed = false;
    }

    const attacks = this._atkUsed ? {} : this._atk;
    if (!this._atkUsed) this._atkUsed = true;

    return {
      left:    false,
      right:   false,
      up:      false,
      down:    false,
      punch:   false,
      punchH:  false,
      kick:    false,
      kickH:   false,
      special: false,
      ...this._move,
      ...attacks,
    };
  }

  _decide(dist, facing) {
    const r        = Math.random();
    const approach = this.f.facingRight ? { right: true } : { left:  true };
    const retreat  = this.f.facingRight ? { left:  true } : { right: true };

    if (dist < 90 && facing) {
      if (r < 0.28) return { punch: true };
      if (r < 0.46) return { kick:  true };
      if (r < 0.54) return { punchH: true };
      if (r < 0.60) return { kickH:  true };
      if (r < 0.66) return { up:    true };
      if (r < 0.78) return retreat;
      return {};
    }

    if (dist > 220) {
      if (r < 0.12) return { special: true };
      if (r < 0.82) return approach;
      return {};
    }

    // Mid range (90–220 px)
    if (r < 0.14) return { special: true };
    if (r < 0.28) return { punch:   true };
    if (r < 0.40) return { kick:    true };
    if (r < 0.55) return approach;
    if (r < 0.63) return retreat;
    return {};
  }
}

// ================================================================
// GAME
// ================================================================
class Game {
  constructor() {
    this.canvas    = document.getElementById('gameCanvas');
    this.ctx       = this.canvas.getContext('2d');
    this.audio     = new AudioSystem();
    this.input     = new InputHandler();

    this.gameState  = GS.MENU;
    this.round      = 1;
    this.roundTime  = ROUND_TIME;
    this.roundTimer = 0;  // frame sub-counter for second tracking
    this.stateTimer = 0;
    this.twoPlayer  = false;

    this.p1 = new Fighter({
      name: 'RYU', isP1: true, x: 260, facingRight: true,
      primaryColor: '#e8e0d0', accentColor: '#1a44bb',
      skinColor: '#d4a070', hairColor: '#1a1000', headbandColor: '#cc2200',
    });

    this.p2 = new Fighter({
      name: 'KEN', isP1: false, x: CANVAS_W - 260, facingRight: false,
      primaryColor: '#cc2200', accentColor: '#222222',
      skinColor: '#d4a070', hairColor: '#ccaa00', headbandColor: null,
    });

    this.cpu = new CPUAI(this.p2, this.p1);
    this.hitEffects = [];

    // Pre-render static background
    this._bgCanvas = this._buildBackground();

    requestAnimationFrame(this._loop.bind(this));
  }

  _loop() {
    this._update();
    this._draw();
    requestAnimationFrame(this._loop.bind(this));
  }

  // ================================================================
  // UPDATE
  // ================================================================
  _update() {
    this.stateTimer++;

    switch (this.gameState) {
      case GS.MENU:       this._uMenu();      break;
      case GS.INTRO:      this._uIntro();     break;
      case GS.FIGHT:      this._uFight();     break;
      case GS.ROUND_END:  this._uRoundEnd();  break;
      case GS.GAME_OVER:  this._uGameOver();  break;
    }

    this.input.flush();
  }

  _uMenu() {
    if (this.input.isPressed('Enter') || this.input.isPressed('Space')) {
      this.p1.wins = 0;
      this.p2.wins = 0;
      this.round   = 1;
      this._startRound();
    }
    if (this.input.isPressed('KeyT')) this.twoPlayer = !this.twoPlayer;
  }

  _uIntro() {
    // Keep idle animations alive during intro countdown
    this.p1.tf++;
    this.p2.tf++;
    if (this.stateTimer >= 130) {
      this.gameState  = GS.FIGHT;
      this.stateTimer = 0;
      this.audio.bell();
    }
  }

  _uFight() {
    // Countdown clock
    this.roundTimer++;
    if (this.roundTimer >= 60) {
      this.roundTimer = 0;
      this.roundTime  = Math.max(0, this.roundTime - 1);
      if (this.roundTime === 0) { this._endRound(); return; }
    }

    // Gather inputs
    const p1inp = this._getP1Input();
    const p2inp = this.twoPlayer ? this._getP2Input() : this.cpu.getInput();

    this.p1.processInput(p1inp);
    this.p2.processInput(p2inp);

    this.p1.update(this.p2);
    this.p2.update(this.p1);

    this._resolveOverlap();
    this._checkHit(this.p1, this.p2);
    this._checkHit(this.p2, this.p1);
    this._checkFireballs(this.p1.projectiles, this.p2);
    this._checkFireballs(this.p2.projectiles, this.p1);

    this.hitEffects = this.hitEffects.filter(e => { e.life--; return e.life > 0; });

    // KO check — wait a moment before advancing
    if ((this.p1.state === FS.KO || this.p2.state === FS.KO) && this.stateTimer > 55)
      this._endRound();
  }

  _uRoundEnd() {
    // Animate WIN / KO poses during the pause
    this.p1.tf++;
    this.p2.tf++;
    if (this.stateTimer < 130) return;

    if (this.p1.wins >= ROUNDS_TO_WIN || this.p2.wins >= ROUNDS_TO_WIN) {
      this.gameState  = GS.GAME_OVER;
      this.stateTimer = 0;
    } else {
      this.round++;
      this._startRound();
    }
  }

  _uGameOver() {
    this.p1.tf++;
    this.p2.tf++;
    if (this.stateTimer >= 180 && (this.input.isPressed('Enter') || this.input.isPressed('Space'))) {
      this.p1.wins    = 0;
      this.p2.wins    = 0;
      this.round      = 1;
      this.gameState  = GS.MENU;
      this.stateTimer = 0;
    }
  }

  _startRound() {
    this.p1.reset();
    this.p2.reset();
    this.roundTime  = ROUND_TIME;
    this.roundTimer = 0;
    this.hitEffects = [];
    this.gameState  = GS.INTRO;
    this.stateTimer = 0;
  }

  _endRound() {
    this.gameState  = GS.ROUND_END;
    this.stateTimer = 0;

    if (this.p2.health <= 0 || (this.roundTime === 0 && this.p1.health > this.p2.health)) {
      this.p1.wins++;
      this.p1._enter(FS.WIN);
    } else if (this.p1.health <= 0 || (this.roundTime === 0 && this.p2.health > this.p1.health)) {
      this.p2.wins++;
      this.p2._enter(FS.WIN);
    }
    // Tied health / time — no win awarded (draw)

    this.audio.ko();
  }

  // ---- Collision helpers ----
  _resolveOverlap() {
    const minD = 72;
    const dx   = this.p2.x - this.p1.x;
    if (Math.abs(dx) < minD) {
      const push = (minD - Math.abs(dx)) / 2 + 0.5;
      const dir  = dx >= 0 ? 1 : -1;
      this.p1.x -= dir * push;
      this.p2.x += dir * push;
      this.p1.x  = Math.max(WALL_L, Math.min(WALL_R, this.p1.x));
      this.p2.x  = Math.max(WALL_L, Math.min(WALL_R, this.p2.x));
    }
  }

  _overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
  }

  _checkHit(attacker, defender) {
    const hb   = attacker.attackHitbox();
    if (!hb) return;
    const body = defender.bodyHitbox();
    if (!this._overlap(hb, body)) return;

    const blocked = defender.isBlocking(attacker.x > defender.x);
    const dmg     = attacker.moveData ? attacker.moveData.dmg : 5;
    defender.takeDamage(dmg, blocked);

    if (blocked) {
      this.audio.block();
    } else {
      if (attacker.state === FS.KICK_L || attacker.state === FS.KICK_H)
        this.audio.kick();
      else
        this.audio.punch();
      this._addHitFx(hb.x + hb.w / 2, hb.y + hb.h / 2);
    }
    attacker.hasHit = true;
  }

  _checkFireballs(projectiles, defender) {
    projectiles.forEach(p => {
      if (!p.active) return;
      if (!this._overlap(p.hitbox(), defender.bodyHitbox())) return;

      // Fireball can be blocked by standing block facing the projectile
      const blocked = defender.state === FS.BLOCK_HI &&
        ((p.vx > 0 && !defender.facingRight) || (p.vx < 0 && defender.facingRight));

      defender.takeDamage(FB_DMG, blocked);
      if (blocked) {
        this.audio.block();
      } else {
        this.audio.punch();
        this._addHitFx(p.x + p.w / 2, p.y + p.h / 2);
      }
      p.active = false;
    });
  }

  _addHitFx(x, y) {
    this.hitEffects.push({ x, y, life: 22, maxLife: 22 });
  }

  // ---- Input mappings ----
  _getP1Input() {
    const d = c => this.input.isDown(c);
    const p = c => this.input.isPressed(c);
    return {
      left:    d('KeyA'),
      right:   d('KeyD'),
      up:      p('KeyW'),
      down:    d('KeyS'),
      punch:   p('KeyJ'),
      punchH:  p('KeyK'),
      kick:    p('KeyU'),
      kickH:   p('KeyI'),
      special: p('KeyL'),
    };
  }

  _getP2Input() {
    const d = c => this.input.isDown(c);
    const p = c => this.input.isPressed(c);
    return {
      left:    d('ArrowLeft'),
      right:   d('ArrowRight'),
      up:      p('ArrowUp'),
      down:    d('ArrowDown'),
      punch:   p('Numpad1'),
      punchH:  p('Numpad2'),
      kick:    p('Numpad3'),
      kickH:   p('Numpad0'),
      special: p('NumpadDecimal'),
    };
  }

  // ================================================================
  // DRAW
  // ================================================================
  _draw() {
    const ctx = this.ctx;

    // Static background
    ctx.drawImage(this._bgCanvas, 0, 0);

    // Fighters & projectiles (drawn during all non-menu states)
    if (this.gameState !== GS.MENU) {
      this.p1.draw(ctx);
      this.p2.draw(ctx);
      this._drawHitFx(ctx);
      this._drawHUD(ctx);
    }

    // State overlays
    switch (this.gameState) {
      case GS.MENU:       this._drawMenu(ctx);      break;
      case GS.INTRO:      this._drawIntro(ctx);     break;
      case GS.ROUND_END:  this._drawRoundEnd(ctx);  break;
      case GS.GAME_OVER:  this._drawGameOver(ctx);  break;
    }
  }

  // Pre-renders the static arena background to an offscreen canvas
  _buildBackground() {
    const oc  = document.createElement('canvas');
    oc.width  = CANVAS_W;
    oc.height = CANVAS_H;
    const ctx = oc.getContext('2d');

    // Sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0,    '#0d0820');
    sky.addColorStop(0.55, '#1e0f3c');
    sky.addColorStop(1,    '#2e1020');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Stars
    const rng = this._seededRng(42);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 120; i++) {
      ctx.beginPath();
      ctx.arc(rng() * CANVAS_W, rng() * 280, rng() * 1.2 + 0.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Building silhouettes
    ctx.fillStyle = 'rgba(8,4,18,0.92)';
    [
      [0, 270, 70, 160], [70, 240, 55, 190], [125, 265, 90, 155],
      [215, 250, 45, 170], [260, 225, 80, 195], [340, 255, 65, 165],
      [405, 240, 55, 180], [460, 260, 110, 160], [570, 235, 60, 185],
      [630, 255, 75, 165], [705, 230, 50, 190], [755, 248, 85, 172],
      [840, 270, 120, 150],
    ].forEach(([x, y, w, h]) => ctx.fillRect(x, y, w, h));

    // Building windows
    ctx.fillStyle = '#ffee99';
    const rng2 = this._seededRng(77);
    for (let i = 0; i < 90; i++) {
      const wx = rng2() * CANVAS_W;
      const wy = rng2() * 200 + 230;
      if (wy > GROUND_Y) continue;
      ctx.globalAlpha = rng2() * 0.6 + 0.3;
      ctx.fillRect(wx, wy, 5, 6);
    }
    ctx.globalAlpha = 1;

    // Neon signs
    [
      { x: 30,  y: 278, w: 22, h: 7, c: '#ff0088' },
      { x: 96,  y: 252, w: 32, h: 6, c: '#00ddff' },
      { x: 278, y: 240, w: 28, h: 8, c: '#ff6600' },
      { x: 476, y: 268, w: 38, h: 9, c: '#ff0088' },
      { x: 648, y: 263, w: 22, h: 7, c: '#9900ff' },
      { x: 776, y: 256, w: 32, h: 6, c: '#00ff88' },
    ].forEach(n => {
      ctx.shadowColor = n.c;
      ctx.shadowBlur  = 12;
      ctx.fillStyle   = n.c;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(n.x, n.y, n.w, n.h);
      ctx.globalAlpha = 1;
      ctx.shadowBlur  = 0;
    });

    // Arena floor
    const floor = ctx.createLinearGradient(0, GROUND_Y, 0, CANVAS_H);
    floor.addColorStop(0,   '#3c2010');
    floor.addColorStop(0.4, '#2a1408');
    floor.addColorStop(1,   '#120800');
    ctx.fillStyle = floor;
    ctx.fillRect(0, GROUND_Y, CANVAS_W, CANVAS_H - GROUND_Y);

    // Glowing floor line
    ctx.strokeStyle = '#dd6600';
    ctx.lineWidth   = 3;
    ctx.shadowColor = '#ff8800';
    ctx.shadowBlur  = 10;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.lineTo(CANVAS_W, GROUND_Y);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Floor tile lines
    ctx.strokeStyle = 'rgba(180,90,0,0.18)';
    ctx.lineWidth   = 1;
    for (let x = 0; x < CANVAS_W; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y);
      ctx.lineTo(x, CANVAS_H);
      ctx.stroke();
    }

    return oc;
  }

  // Simple deterministic pseudo-random number generator for reproducible backgrounds
  _seededRng(seed) {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      return (s >>> 0) / 0xffffffff;
    };
  }

  _drawHitFx(ctx) {
    this.hitEffects.forEach(e => {
      const p  = e.life / e.maxLife;
      const sz = (1 - p) * 38 + 8;
      ctx.save();
      ctx.globalAlpha = p;

      // Hit burst
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, sz);
      g.addColorStop(0,   'rgba(255,255,200,0.95)');
      g.addColorStop(0.4, 'rgba(255,160,0,0.75)');
      g.addColorStop(1,   'rgba(255,50,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(e.x, e.y, sz, 0, Math.PI * 2);
      ctx.fill();

      // Star rays
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth   = 1.5;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + (e.maxLife - e.life) * 0.12;
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.x + Math.cos(a) * sz * 1.4, e.y + Math.sin(a) * sz * 1.4);
        ctx.stroke();
      }

      ctx.restore();
    });
  }

  _drawHUD(ctx) {
    const BAR_W = 350, BAR_H = 22, BAR_Y = 18;
    const P1X   = 28;
    const P2X   = CANVAS_W - 28 - BAR_W;

    this._drawHPBar(ctx, P1X, BAR_Y, BAR_W, BAR_H, this.p1.health / 100, true);
    this._drawHPBar(ctx, P2X, BAR_Y, BAR_W, BAR_H, this.p2.health / 100, false);

    // Names
    ctx.font      = 'bold 13px monospace';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText(this.p1.name, P1X, BAR_Y + BAR_H + 14);
    ctx.textAlign = 'right';
    ctx.fillText(this.p2.name, P2X + BAR_W, BAR_Y + BAR_H + 14);

    // Win dots
    for (let i = 0; i < ROUNDS_TO_WIN; i++) {
      this._dot(ctx, P1X + 10 + i * 22, BAR_Y + BAR_H + 28, i < this.p1.wins);
      this._dot(ctx, P2X + BAR_W - 10 - i * 22, BAR_Y + BAR_H + 28, i < this.p2.wins);
    }

    // Timer box
    const tx = CANVAS_W / 2;
    ctx.fillStyle = '#000';
    ctx.fillRect(tx - 28, 8, 56, 48);
    ctx.strokeStyle = '#cc8800';
    ctx.lineWidth   = 2;
    ctx.strokeRect(tx - 28, 8, 56, 48);
    ctx.font      = 'bold 30px monospace';
    ctx.fillStyle = this.roundTime <= 10 ? '#ff3300' : '#ffcc00';
    ctx.textAlign = 'center';
    ctx.fillText(this.roundTime, tx, 44);
  }

  _drawHPBar(ctx, x, y, w, h, hp, ltr) {
    // Background
    ctx.fillStyle = '#111';
    ctx.fillRect(x, y, w, h);

    // Fill
    const fw = w * hp;
    ctx.fillStyle = hp > 0.5 ? '#44cc22' : hp > 0.25 ? '#ffaa00' : '#cc2200';
    if (ltr) ctx.fillRect(x, y, fw, h);
    else     ctx.fillRect(x + w - fw, y, fw, h);

    // Shine
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y, w, h / 3);

    // Border
    ctx.strokeStyle = '#888';
    ctx.lineWidth   = 2;
    ctx.strokeRect(x, y, w, h);
  }

  _dot(ctx, x, y, filled) {
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle   = filled ? '#ffcc00' : '#444';
    ctx.fill();
    ctx.strokeStyle = '#888';
    ctx.lineWidth   = 1;
    ctx.stroke();
  }

  // ---- Screen overlays ----
  _drawMenu(ctx) {
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.textAlign = 'center';

    // Title glow
    ctx.shadowColor = '#ff4400';
    ctx.shadowBlur  = 36;
    ctx.font        = 'bold 68px monospace';
    ctx.fillStyle   = '#fff';
    ctx.fillText('STREET FIGHTER', CANVAS_W / 2, 140);

    ctx.shadowColor = '#ffaa00';
    ctx.shadowBlur  = 22;
    ctx.font        = 'bold 46px monospace';
    ctx.fillStyle   = '#ffcc00';
    ctx.fillText('2026', CANVAS_W / 2, 202);
    ctx.shadowBlur  = 0;

    ctx.font      = '17px monospace';
    ctx.fillStyle = '#bbb';
    ctx.fillText(
      `Mode: ${this.twoPlayer ? '2 PLAYERS' : '1 PLAYER vs CPU'}   [ T to toggle ]`,
      CANVAS_W / 2, 280,
    );

    if (Math.floor(this.stateTimer / 30) % 2 === 0) {
      ctx.font      = 'bold 23px monospace';
      ctx.fillStyle = '#fff';
      ctx.fillText('PRESS  ENTER  TO  START', CANVAS_W / 2, 338);
    }

    ctx.font      = '12px monospace';
    ctx.fillStyle = '#666';
    ctx.fillText(
      'P1: A/D=Move  W=Jump  S=Crouch  J=Punch  K=Heavy Punch  U=Kick  I=Heavy Kick  L=Hadouken',
      CANVAS_W / 2, 398,
    );
    ctx.fillText(
      'P2: Arrows=Move  Numpad: 1=Punch  2=Heavy Punch  3=Kick  0=Heavy Kick  .=Hadouken',
      CANVAS_W / 2, 420,
    );
  }

  _drawIntro(ctx) {
    const t = this.stateTimer;
    ctx.textAlign = 'center';

    // "ROUND N"
    if (t < 75) {
      const sc = Math.min(1, t / 20);
      ctx.save();
      ctx.translate(CANVAS_W / 2, CANVAS_H / 2 - 28);
      ctx.scale(sc, sc);
      ctx.shadowColor = '#ffaa00';
      ctx.shadowBlur  = 22;
      ctx.font        = 'bold 54px monospace';
      ctx.fillStyle   = '#fff';
      ctx.fillText(`ROUND ${this.round}`, 0, 0);
      ctx.restore();
    }

    // "FIGHT!"
    if (t >= 80 && t < 130) {
      const sc = Math.min(1.15, 1 + (t - 80) / 55);
      const al = Math.min(1, (t - 80) / 10);
      ctx.save();
      ctx.translate(CANVAS_W / 2, CANVAS_H / 2 + 32);
      ctx.scale(sc, sc);
      ctx.globalAlpha = al;
      ctx.shadowColor = '#ff2200';
      ctx.shadowBlur  = 32;
      ctx.font        = 'bold 78px monospace';
      ctx.fillStyle   = '#ff4400';
      ctx.fillText('FIGHT!', 0, 0);
      ctx.restore();
    }
  }

  _drawRoundEnd(ctx) {
    if (this.stateTimer < 12) return;
    const ko = this.p1.state === FS.KO || this.p2.state === FS.KO;
    ctx.textAlign   = 'center';
    ctx.shadowColor = '#ff0000';
    ctx.shadowBlur  = 24;
    ctx.font        = 'bold 86px monospace';
    ctx.fillStyle   = '#fff';
    ctx.fillText(ko ? 'K.O.!' : 'TIME!', CANVAS_W / 2, CANVAS_H / 2);
    ctx.shadowBlur  = 0;
  }

  _drawGameOver(ctx) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const winner = this.p1.wins >= ROUNDS_TO_WIN ? this.p1 : this.p2;
    ctx.textAlign   = 'center';
    ctx.shadowColor = '#ffaa00';
    ctx.shadowBlur  = 28;
    ctx.font        = 'bold 52px monospace';
    ctx.fillStyle   = '#ffcc00';
    ctx.fillText(`${winner.name}  WINS!`, CANVAS_W / 2, CANVAS_H / 2 - 36);
    ctx.shadowBlur  = 0;

    if (this.stateTimer >= 180 && Math.floor(this.stateTimer / 30) % 2 === 0) {
      ctx.font      = '21px monospace';
      ctx.fillStyle = '#aaa';
      ctx.fillText('PRESS  ENTER  TO  PLAY  AGAIN', CANVAS_W / 2, CANVAS_H / 2 + 24);
    }
  }
}

// ================================================================
// ENTRY POINT
// ================================================================
window.addEventListener('load', () => new Game());
