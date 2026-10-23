/* «Контрудар» — бокс на реакцию: бой, забег-рогалик, контракты (гача). Каркас GameCore. */
(function () {
    'use strict';

    const $ = Core.$;
    const D = window.CPData;
    const W = 480, H = 270;          // логическое разрешение (пиксели спрайтов)
    const FW = 97, FH = 119;          // кадр боксёра
    const FEET = 204;                 // линия ног на ринге
    const PX = 163, OX = 225;         // левый край кадра игрока и соперника
    const DRAW_Y = FEET - 117;
    const POSES = ['stance', 'straight', 'hook', 'upper', 'hit', 'block'];
    const RUN_LEN = 8;
    const PULL_COST = 100, PITY = 40, AD_PULL_COOLDOWN = 240000, MAX_LVL = 5;

    // ======================================================================
    // Правила боя
    // ======================================================================
    const PUNCHES = ['straight', 'hook', 'upper'];
    const BEATS = { straight: 'hook', hook: 'upper', upper: 'straight' };
    const COLORS = { straight: '#ffd23f', hook: '#3fb6ff', upper: '#ff5a4f', block: '#c9d1e8' };
    const COST = { straight: 12, hook: 14, upper: 20, combo: 4, block: 10 };
    const PDMG = { straight: 4, hook: 5, upper: 6 };
    const NEUTRAL = '#e8ecf8';
    const answerFor = punch => PUNCHES.find(k => BEATS[k] === punch);

    // ======================================================================
    // Картинки и спрайты
    // ======================================================================
    const img = {};
    function loadImages() {
        const keys = ['arena', 'ropes'].concat(D.FIGHTERS.map(f => 'f_' + f.id), D.TRAINERS.map(t => 't_' + t.id));
        return Promise.all(keys.map(k => new Promise(res => {
            const src = window.ASSET_DATA && window.ASSET_DATA[k];
            if (!src) { res(); return; }
            const i = new Image();
            i.onload = () => { img[k] = i; res(); };
            i.onerror = () => res();
            i.src = src;
        })));
    }
    function makeCanvas(w, h) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const x = c.getContext('2d');
        x.imageSmoothingEnabled = false;
        return [c, x];
    }
    function rgb2hsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        let h = 0;
        if (d) {
            if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
            h *= 60; if (h < 0) h += 360;
        }
        return [h, mx ? d / mx : 0, mx];
    }
    function hsv2rgb(h, s, v) {
        h = ((h % 360) + 360) % 360;
        const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
        let r = 0, g = 0, b = 0;
        if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
        else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
        return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
    }
    // Набор кадров бойца: { stance: canvas, ..., white: {...} }. col — перекраска шорт и перчаток.
    const setCache = {};
    function fighterSet(fid, col, mirror) {
        const key = fid + '|' + (col ? col.h + ',' + col.s + ',' + col.vm : '-') + '|' + (mirror ? 1 : 0);
        if (setCache[key]) return setCache[key];
        const sheet = img['f_' + fid] || img.f_rookie;
        const [src, sx] = makeCanvas(sheet.width, sheet.height);
        sx.drawImage(sheet, 0, 0);
        if (col) {
            const d = sx.getImageData(0, 0, src.width, src.height);
            const p = d.data;
            for (let i = 0; i < p.length; i += 4) {
                if (!p[i + 3]) continue;
                const [h, s, v] = rgb2hsv(p[i], p[i + 1], p[i + 2]);
                if (s > 0.85 && (h < 6 || h > 354) && v > 0.25) {
                    const [r, g, b] = hsv2rgb(col.h, col.s, Math.min(1, v * col.vm));
                    p[i] = r; p[i + 1] = g; p[i + 2] = b;
                }
            }
            sx.putImageData(d, 0, 0);
        }
        const set = { white: {} };
        POSES.forEach((pose, k) => {
            const [c, x] = makeCanvas(FW, FH);
            if (mirror) { x.translate(FW, 0); x.scale(-1, 1); }
            x.drawImage(src, k * FW, 0, FW, FH, 0, 0, FW, FH);
            set[pose] = c;
            const [wc, wx] = makeCanvas(FW, FH);
            wx.drawImage(c, 0, 0);
            wx.globalCompositeOperation = 'source-in';
            wx.fillStyle = '#ffffff';
            wx.fillRect(0, 0, FW, FH);
            set.white[pose] = wc;
        });
        setCache[key] = set;
        return set;
    }
    function tinted(canvas, color) {
        const [c, x] = makeCanvas(canvas.width, canvas.height);
        x.drawImage(canvas, 0, 0);
        x.globalCompositeOperation = 'source-in';
        x.fillStyle = color;
        x.fillRect(0, 0, c.width, c.height);
        return c;
    }
    function standingCanvas(fid, col, mirror) {
        const [c, x] = makeCanvas(FW, FH);
        x.drawImage(fighterSet(fid, col, mirror).stance, 0, 0);
        c.className = 'px';
        return c;
    }
    function portrait(tid) {
        const i = document.createElement('img');
        i.className = 'px';
        i.alt = '';
        i.src = (window.ASSET_DATA && window.ASSET_DATA['t_' + tid]) || '';
        return i;
    }

    // ======================================================================
    // Звуки (синтез, без файлов)
    // ======================================================================
    function noise(dur, vol, freq, delay) {
        const s = Core.sfx;
        if (s.muted || s.bgPaused) return;
        s.init();
        const ctx = s.ctx;
        if (!ctx) return;
        try {
            const len = Math.floor(ctx.sampleRate * dur);
            const buf = ctx.createBuffer(1, len, ctx.sampleRate);
            const ch = buf.getChannelData(0);
            for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const f = ctx.createBiquadFilter();
            f.type = 'lowpass'; f.frequency.value = freq || 1200;
            const g = ctx.createGain();
            g.gain.value = vol;
            src.connect(f); f.connect(g); g.connect(ctx.destination);
            src.start(ctx.currentTime + (delay || 0));
        } catch (e) {}
    }
    const snd = {
        whoosh: () => noise(0.12, 0.18, 2600),
        hit: () => { Core.sfx.tone(150, 'sine', 0.2, 0.32, 45); noise(0.09, 0.35, 900); },
        bigHit: () => { Core.sfx.tone(120, 'sine', 0.3, 0.4, 35); noise(0.14, 0.45, 700); },
        block: () => { Core.sfx.tone(240, 'square', 0.06, 0.06, 160); noise(0.06, 0.2, 500); },
        perfect: () => { Core.sfx.tone(1320, 'triangle', 0.18, 0.12, 1760, 0.03); },
        tick: () => Core.sfx.tone(900, 'square', 0.03, 0.03),
        bell: () => { Core.sfx.tone(1046, 'triangle', 1.2, 0.18); Core.sfx.tone(1568, 'sine', 0.9, 0.08); Core.sfx.tone(1046, 'triangle', 1.0, 0.14, null, 0.35); },
        crowd: () => noise(0.9, 0.08, 1800),
        coin: () => { Core.sfx.tone(1400, 'square', 0.06, 0.05); Core.sfx.tone(1900, 'square', 0.1, 0.05, null, 0.06); },
        reveal: () => [523, 784, 1047, 1568].forEach((f, i) => Core.sfx.tone(f, 'triangle', 0.25, 0.12, null, i * 0.08))
    };

    // ======================================================================
    // Состояние боя
    // ======================================================================
    const canvas = $('#canvas');
    const ctx = canvas.getContext('2d');
    const [buf, bx] = makeCanvas(W, H);
    let view = null;
    let time = 0;
    let fight = null;
    const keysDown = new Set();

    const rand = (a, b) => a + Math.random() * (b - a);
    const pickOne = arr => arr[Math.floor(Math.random() * arr.length)];
    function pickWeighted(w) {
        let sum = 0;
        for (const k in w) sum += w[k];
        let r = Math.random() * sum;
        for (const k in w) { r -= w[k]; if (r <= 0) return k; }
        return Object.keys(w)[0];
    }
    function shuffle(a) {
        for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
        return a;
    }

    // ======================================================================
    // Режим «Математика»: пример вместо значка удара, три ответа на трёх кнопках
    // ======================================================================
    const MATH_TIME_BASE = 1.9, MATH_TIME_STEP = 0.12;   // множитель времени замаха: бой 1 — ×1.9, бой 8 — ×2.7
    const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
    function makeExample(lvl) {
        let q, a, extra = 0;
        const kind = lvl <= 1 ? pickOne(['+', '-'])
            : lvl <= 3 ? pickOne(['+', '-', '+', '-', '×'])
            : lvl <= 5 ? pickOne(['+', '-', '×', '×', '÷'])
            : pickOne(['+', '-', '×', '×', '÷', '×']);
        if (kind === '+') {
            const hi = [12, 20, 60, 90, 120, 200, 400, 600][lvl] || 600;
            const x = ri(Math.max(3, hi / 4 | 0), hi - 3), y = ri(3, hi - 3);
            a = x + y; q = x + ' + ' + y; extra = ri(1, 9);
        } else if (kind === '-') {
            const hi = [12, 20, 60, 90, 120, 200, 400, 600][lvl] || 600;
            const x = ri(Math.max(6, hi / 3 | 0), hi), y = ri(2, x - 1);
            a = x - y; q = x + ' − ' + y; extra = ri(1, 9);
        } else if (kind === '×') {
            const m = [3, 4, 5, 6, 9, 9, 12, 14][lvl] || 14;
            const x = ri(2, m), y = ri(2, lvl >= 6 ? 9 : Math.min(m, 9));
            a = x * y; q = x + ' × ' + y; extra = ri(0, 1) ? x : y;
        } else {
            const y = ri(2, lvl >= 6 ? 9 : 6), r = ri(2, lvl >= 6 ? 12 : 9);
            a = r; q = (y * r) + ' ÷ ' + y; extra = y;
        }
        // неверные ответы — типичные ошибки: ±1, ±2, ±10, на «лишнее» число
        const pool = [a + 1, a - 1, a + 2, a - 2, a + 10, a - 10, a + extra, a - extra, a + 3, a - 3];
        const bad = [];
        shuffle(pool).forEach(v => { if (bad.length < 2 && v > 0 && v !== a && !bad.includes(v)) bad.push(v); });
        for (let k = 1; bad.length < 2; k++) { if (!bad.includes(a + 10 + k)) bad.push(a + 10 + k); }
        return { q, a, bad };
    }
    // Новый пример под нужную кнопку: правильный ответ ставим на кнопку контратаки к показанному удару
    function setMath(shown) {
        const f = fight;
        const ex = makeExample(f.spec.mathLvl || 0);
        const right = answerFor(shown);
        const others = PUNCHES.filter(k => k !== right);
        const opts = {};
        opts[right] = ex.a;
        opts[others[0]] = ex.bad[0];
        opts[others[1]] = ex.bad[1];
        f.mathId = (f.mathId || 0) + 1;
        f.mathCur = { q: ex.q, opts, id: f.mathId };
    }

    function newFighter(set, side) {
        return {
            set, side, hp: 100, maxHp: 100, sta: 100,
            pose: 'stance', state: 'idle', t: 0, dur: 0,
            busy: 0, dx: 0, flash: 0, ko: 0, phase: Math.random() * 6
        };
    }

    /*
     * opts: { spec, pSet, oSet, mods, hp, oppName, onEnd(won) }
     * spec: hp, dmg, wu0, wu, idle, w, series, guard, feint, bluff, silent, adaptive, colorHint, hints, tutorial
     */
    function startFight(opts) {
        const spec = opts.spec, m = opts.mods;
        const p = newFighter(opts.pSet, 'L');
        const o = newFighter(opts.oSet, 'R');
        p.maxHp = m.maxHp; p.hp = Math.min(m.maxHp, Math.max(1, opts.hp));
        o.hp = o.maxHp = spec.hp;
        o.state = 'intro'; o.dur = 1.3; o.t = 0; o.seriesLeft = 0;
        fight = {
            spec, m, p, o, opts, time: 0, over: false, math: true, mathCur: null, mathId: 0,
            stats: { counters: 0, perfects: 0 }, texts: [], parts: [], shake: 0,
            tutorLeft: spec.tutorial ? 3 : 0, tutorWrong: 0,
            blockHeld: false, combo: 0, fcUsed: false, swUsed: false,
            habit: { early: 0, late: 0, block: 0 }, thought: null, thoughtsShown: {}
        };
        Core.show('scrGame');
        view.resize();
        Core.gameplay(true);
        snd.bell();
        updateControls(true);
    }

    // ======================================================================
    // ИИ соперника
    // ======================================================================
    function oppSet(state, dur) {
        const o = fight.o;
        o.state = state; o.t = 0; o.dur = dur;
    }
    function oppIdle(short) {
        const s = fight.spec;
        oppSet('idle', short ? rand(0.18, 0.3) : rand(s.idle[0], s.idle[1]));
        fight.o.pose = 'stance';
    }
    function think(key) {
        if (fight.thoughtsShown[key]) return;
        fight.thoughtsShown[key] = true;
        fight.thought = { key, t: 0 };
    }
    function oppAct() {
        const s = fight.spec, o = fight.o, hb = fight.habit;
        if (o.seriesLeft <= 0 && s.guard && Math.random() < s.guard) {
            oppSet('guard', 1.35);
            o.pose = 'block';
            return;
        }
        if (o.seriesLeft > 0) o.seriesLeft--;
        else if (s.series && Math.random() < s.series) o.seriesLeft = Math.random() < 0.4 ? 2 : 1;
        let w = s.w;
        let forceFeint = false, quick = false;
        // «Хитрец» подстраивается под привычки игрока
        if (s.adaptive) {
            if (hb.block >= 3 && Math.random() < 0.5) { w = { straight: 0.5, hook: 0.5, upper: 3 }; think('th_block'); }
            else if (hb.early >= 3 && hb.early >= hb.late && Math.random() < 0.45) { forceFeint = true; think('th_early'); }
            else if (hb.late >= 3 && Math.random() < 0.35) { quick = true; think('th_late'); }
        }
        o.punch = pickWeighted(w);
        o.shown = o.punch;
        o.feint = false;
        o.bluff = false;
        if (forceFeint || (s.feint && Math.random() < s.feint)) {
            o.feint = true;
            o.shown = pickOne(PUNCHES.filter(k => k !== o.punch));
        } else if (s.bluff && o.seriesLeft === 0 && Math.random() < s.bluff) {
            o.bluff = true;
        }
        o.resolved = false;
        o.tutorSeen = false;
        if (fight.math) setMath(o.shown);
        // замах ускоряется по ходу боя: от wu0 в начале до wu к концу
        const k = Math.min(1, (1 - o.hp / o.maxHp) * 1.3);
        const mathMul = fight.math ? MATH_TIME_BASE + MATH_TIME_STEP * (s.mathLvl || 0) : 1;
        const dur = (s.wu0 + (s.wu - s.wu0) * k) * fight.m.foresight * (quick ? 0.6 : 1) * mathMul;
        oppSet('windup', dur);
        o.pose = 'stance';
    }
    function hurtPlayer(n) {
        damage(fight.p, Math.round(n * fight.m.dmgTaken));
    }
    function oppStrike() {
        const o = fight.o, p = fight.p, m = fight.m;
        if (o.bluff) {
            // ложный замах: удара не будет
            if (!o.resolved) { o.resolved = true; text('txt_bluff', 'R', '#aab3d3', 11); }
            oppSet('recover', 0.3); o.pose = 'stance'; o.dx = 0;
            return;
        }
        oppSet('strike', 0.24);
        o.pose = o.punch;
        snd.whoosh();
        if (o.resolved) return;
        o.resolved = true;
        // Игрок не успел ответить ударом: блок или пропущенный
        if (fight.blockHeld && p.busy <= 0) {
            const cost = COST.block * m.blockMul;
            if (o.punch === 'upper' || p.sta < cost) {
                hurtPlayer(fight.spec.dmg * 1.2);
                playerBusy('hit', 0.65);
                text('txt_broken', 'R');
                snd.bigHit();
            } else {
                p.sta -= cost;
                fight.habit.block++;
                text('txt_block', 'R', COLORS.block);
                snd.block();
                spawnSpark(PX + 76, 112, '#ffffff', 5);
                if (m.reflect > 0) damage(o, Math.round(m.reflect));
            }
        } else {
            hurtPlayer(fight.spec.dmg);
            playerBusy('hit', 0.5);
            text('txt_missed', 'R', '#ff8a7a');
            snd.hit();
        }
    }
    function updateOpp(dt) {
        const o = fight.o;
        if (o.tutorPaused) return;
        o.t += dt;
        if (o.state === 'ko') return;
        switch (o.state) {
            case 'intro':
                if (o.t >= o.dur) { text('txt_fight', 'C', '#ffd23f', 22); oppIdle(false); }
                break;
            case 'idle':
                if (o.t >= o.dur) oppAct();
                break;
            case 'windup': {
                const f = o.t / o.dur;
                if (o.feint && o.shown !== o.punch && f >= 0.5) { o.shown = o.punch; snd.tick(); if (fight.math) setMath(o.shown); }
                if (fight.tutorLeft > 0 && !o.tutorSeen && f >= 0.55) { o.tutorSeen = true; o.tutorPaused = true; snd.tick(); break; }
                o.dx = Math.round(Math.min(1, f * 3) * 3);          // откидывается назад перед ударом
                if (o.t >= o.dur) oppStrike();
                break;
            }
            case 'strike':
                o.dx = -Math.round(Math.sin(Math.min(1, o.t / o.dur) * Math.PI) * (o.punch === 'upper' ? 14 : 7));
                if (o.t >= o.dur) { o.dx = 0; oppSet('recover', 0.32); o.pose = 'stance'; }
                break;
            case 'recover':
                if (o.t >= o.dur) oppIdle(o.seriesLeft > 0);
                break;
            case 'parry':
                if (o.t >= o.dur) oppIdle(true);
                break;
            case 'stun':
                o.dx = Math.round(Math.max(0, 1 - o.t / 0.25) * 6);
                if (o.t >= o.dur) { o.dx = 0; fight.combo = 0; oppSet('recover', 0.3); o.pose = 'stance'; o.seriesLeft = 0; }
                break;
            case 'guard':
                if (o.t >= o.dur) oppIdle(true);
                break;
        }
    }

    // ======================================================================
    // Действия игрока
    // ======================================================================
    function playerBusy(pose, dur) {
        const p = fight.p;
        p.pose = pose; p.busy = dur;
    }
    function punchCost(type, comboing) {
        const m = fight.m;
        if (comboing) return COST.combo * m.costMul;
        return COST[type] * m.costMul * (type === 'straight' && m.straightAll ? 2 : 1);
    }
    function playerWins(type, real) {
        return BEATS[type] === real || (fight.m.straightAll && type === 'straight' && real !== 'straight');
    }
    function playerPunch(type) {
        if (!fight || fight.over || Core.isPaused() || Core.anyModalOpen()) return;
        const p = fight.p, o = fight.o, m = fight.m;
        if (p.busy > 0 || o.state === 'intro') return;
        if (o.tutorPaused) {
            // обучение: ждём правильную кнопку
            if (type !== answerFor(o.punch)) { fight.tutorWrong = 1.2; snd.tick(); return; }
            o.tutorPaused = false;
            fight.tutorLeft--;
            o.t = o.dur * (m.perfectFrom + 0.1);
            if (fight.tutorLeft <= 0) { Core.data.tutorialDone = true; Core.save(false); }
        }
        const comboing = o.state === 'stun';
        const cost = punchCost(type, comboing);
        if (p.sta < cost) { text('txt_tired', 'L', '#aab3d3'); snd.tick(); return; }
        p.sta -= cost;
        playerBusy(type, comboing ? 0.18 : 0.3);
        p.lunge = type === 'upper' ? 14 : 7;
        p.lungeT = 0; p.lungeDur = comboing ? 0.18 : 0.3;
        snd.whoosh();
        const hitX = OX + 30, hitY = 110;

        if (o.state === 'windup' && !o.resolved) {
            o.resolved = true;
            const f = o.t / o.dur;
            if (f < 0.5) fight.habit.early++; else if (f >= m.perfectFrom) fight.habit.late++;
            if (o.bluff) {
                // повёлся на ложный замах — соперник встречает коротким ударом
                oppSet('strike', 0.22); o.pose = 'straight';
                hurtPlayer(fight.spec.dmg * 0.6);
                playerBusy('hit', 0.45);
                text('txt_baited', 'R', '#ff8a7a', 14);
                snd.hit();
                return;
            }
            const perfect = f >= m.perfectFrom;
            const real = o.punch;
            if (playerWins(type, real)) {
                // Контратака
                let dmg = PDMG[type] * 2 * m.counterMul * (perfect ? m.perfectMul : 1);
                if (!fight.fcUsed) { dmg *= m.firstCounterMul; fight.fcUsed = true; }
                damage(o, Math.round(dmg));
                if (m.counterHeal > 0) p.hp = Math.min(p.maxHp, p.hp + m.counterHeal);
                fight.stats.counters++;
                if (perfect) { fight.stats.perfects++; text('txt_perfect', 'L', '#fff36b', 18); snd.perfect(); }
                else text('txt_counter', 'L', COLORS[type], 16);
                snd.bigHit();
                fight.shake = perfect ? 0.25 : 0.16;
                spawnSpark(hitX, hitY, COLORS[type], perfect ? 14 : 9);
                flashCrowd(perfect ? 10 : 5);
                if (o.hp > 0) { oppSet('stun', 1.05); o.pose = 'hit'; fight.combo = 0; o.dx = 0; }
            } else if (BEATS[real] === type) {
                // Соперник оказался быстрее
                oppSet('strike', 0.24); o.pose = real;
                hurtPlayer(fight.spec.dmg * 1.25);
                playerBusy('hit', 0.55);
                text('txt_missed', 'R', '#ff8a7a');
                snd.hit();
                fight.shake = 0.12;
            } else {
                // Одинаковые удары — размен
                damage(o, PDMG[type]);
                hurtPlayer(fight.spec.dmg);
                playerBusy('hit', 0.45);
                if (o.hp > 0) { oppSet('recover', 0.45); o.pose = 'hit'; }
                text('txt_trade', 'C', '#ffffff');
                snd.hit();
                spawnSpark(hitX, hitY, '#ffffff', 6);
                fight.shake = 0.12;
            }
        } else if (o.state === 'stun') {
            if (fight.combo < m.comboMax) {
                fight.combo++;
                damage(o, m.comboDmg);
                snd.hit();
                spawnSpark(hitX, hitY, '#ffffff', 4);
                fight.texts.push({ s: '×' + (fight.combo + 1), x: OX + 6, y: 88, c: '#ffd23f', t: 0, life: 0.6, size: 12 });
                o.t = Math.min(o.t, o.dur - 0.35);   // каждый добивающий чуть продлевает оглушение
            } else {
                o.pose = 'block'; oppSet('parry', 0.3); text('txt_guard', 'R', COLORS.block); snd.block();
            }
        } else if (o.state === 'guard') {
            if (type === 'upper' || (m.hookBreak && type === 'hook')) {
                damage(o, PDMG[type] + 2);
                oppSet('stun', 0.9); o.pose = 'hit'; fight.combo = 0;
                text('txt_break', 'L', COLORS[type], 16);
                snd.bigHit();
                spawnSpark(hitX, hitY, COLORS[type], 9);
                fight.shake = 0.14;
            } else {
                p.sta = Math.max(0, p.sta - 6);
                text('txt_guard', 'R', COLORS.block);
                snd.block();
                spawnSpark(hitX - 6, hitY + 6, '#ffffff', 3);
            }
        } else {
            // Бить без замаха соперника бесполезно — он закрывается
            const late = o.state === 'strike';
            if (!late) { o.pose = 'block'; oppSet('parry', 0.3); }
            text(late ? 'txt_late' : 'txt_early', 'L', '#aab3d3');
            snd.block();
        }
    }

    function damage(f, n) {
        if (fight.over || n <= 0) return;
        if (f === fight.p && f.hp - n <= 0 && fight.m.secondWind && !fight.swUsed) {
            fight.swUsed = true;
            n = f.hp - 1;
            text('txt_second', 'C', '#7be08b', 16);
        }
        f.hp = Math.max(0, f.hp - n);
        f.flash = 0.1;
        const x = f.side === 'L' ? PX + 58 : OX + 36;
        if (n > 0) fight.texts.push({ s: '-' + n, x: x + rand(-6, 6), y: 100, c: f.side === 'L' ? '#ff6b6b' : '#ffffff', t: 0, life: 0.8, size: 11 });
        for (let i = 0; i < 4; i++) {
            fight.parts.push({ x: x, y: 100, vx: rand(-40, 40) + (f.side === 'L' ? -30 : 30), vy: rand(-70, -20), c: '#cfe8ff', life: rand(0.35, 0.6), t: 0 });
        }
        if (f.hp <= 0) knockout(f);
    }
    function knockout(loser) {
        fight.over = true;
        loser.state = 'ko'; loser.pose = 'hit'; loser.ko = 0;
        const winner = loser === fight.p ? fight.o : fight.p;
        if (winner.state !== 'ko') { winner.pose = 'stance'; winner.busy = 0; winner.dx = 0; }
        fight.o.dx = 0;
        text('txt_ko', 'C', '#ffd23f', 26);
        fight.shake = 0.35;
        flashCrowd(25);
        snd.bigHit();
        setTimeout(snd.crowd, 250);
        Core.gameplay(false);
        updateControls(false);
        const f = fight;
        setTimeout(() => { if (fight === f) f.opts.onEnd(loser === f.o); }, 1900);
    }
    // Встать после нокаута (за рекламу)
    function reviveFight() {
        const p = fight.p, o = fight.o;
        fight.over = false;
        p.hp = Math.round(p.maxHp * 0.5); p.sta = 100; p.state = 'idle'; p.ko = 0; p.pose = 'stance'; p.busy = 0;
        o.pose = 'stance'; o.dx = 0; oppSet('intro', 1.0); o.seriesLeft = 0;
        Core.show('scrGame');
        Core.gameplay(true);
        snd.bell();
        updateControls(true);
    }

    // ======================================================================
    // Эффекты
    // ======================================================================
    function text(key, side, color, size) {
        const s = Core.t(key);
        const x = side === 'L' ? PX + 78 : side === 'R' ? PX + 48 : W / 2;
        fight.texts.push({ s, x: side === 'C' ? x : x + rand(-4, 4), y: side === 'C' ? ((size || 13) >= 24 ? 48 : 62) : 76, c: color || '#ffffff', t: 0, life: 0.9, size: size || 13 });
    }
    function spawnSpark(x, y, c, n) {
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, v = rand(50, 140);
            fight.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, c: i % 3 ? c : '#ffffff', life: rand(0.18, 0.35), t: 0, g: 0 });
        }
    }
    const crowdFlashes = [];
    function flashCrowd(n) {
        for (let i = 0; i < n; i++) {
            crowdFlashes.push({ x: Math.round(rand(10, 470)), y: Math.round(Math.random() < 0.6 ? rand(55, 140) : rand(222, 262)), t: rand(0, 0.15), life: 0.09 });
        }
    }

    // ======================================================================
    // Обновление
    // ======================================================================
    function update() {
        const dt = Core.STEP_MS / 1000;
        time += dt;
        if (Math.random() < 0.012) flashCrowd(1);
        for (let i = crowdFlashes.length - 1; i >= 0; i--) {
            const f = crowdFlashes[i];
            f.t += dt;
            if (f.t > f.life + 0.15) crowdFlashes.splice(i, 1);
        }
        if (!fight || Core.currentScreen !== 'scrGame' || Core.isPaused() || (Core.anyModalOpen() && !fight.over)) return;
        const p = fight.p, o = fight.o;
        fight.time += dt;

        fight.shake = Math.max(0, fight.shake - dt);
        fight.tutorWrong = Math.max(0, fight.tutorWrong - dt);
        if (fight.thought) { fight.thought.t += dt; if (fight.thought.t > 2.4) fight.thought = null; }
        [p, o].forEach(f => { f.flash = Math.max(0, f.flash - dt); });
        for (let i = fight.texts.length - 1; i >= 0; i--) {
            const tx = fight.texts[i];
            tx.t += dt;
            if (tx.t > tx.life) fight.texts.splice(i, 1);
        }
        for (let i = fight.parts.length - 1; i >= 0; i--) {
            const q = fight.parts[i];
            q.t += dt;
            q.x += q.vx * dt; q.y += q.vy * dt;
            q.vy += (q.g === undefined ? 260 : q.g) * dt;
            if (q.t > q.life) fight.parts.splice(i, 1);
        }
        [p, o].forEach(f => { if (f.state === 'ko') f.ko = Math.min(1, f.ko + dt * 1.6); });
        if (fight.over) return;

        if (p.busy > 0) {
            p.busy -= dt;
            if (p.busy <= 0) { p.busy = 0; p.pose = fight.blockHeld ? 'block' : 'stance'; }
        } else {
            p.pose = fight.blockHeld ? 'block' : 'stance';
        }
        if (p.lungeDur) {
            p.lungeT += dt;
            const k = Math.min(1, p.lungeT / p.lungeDur);
            p.dx = Math.round(Math.sin(k * Math.PI) * p.lunge);
            if (k >= 1) { p.lungeDur = 0; p.dx = 0; }
        }
        const regen = (fight.blockHeld ? 9 : 20) * fight.m.regen;
        p.sta = Math.min(100, p.sta + regen * dt);

        updateOpp(dt);
        updateControls();
    }

    // Подсветка кнопок: недостаточно сил, подсказка правильного ответа
    let ctlCache = {};
    function updateControls(force) {
        if (!fight) return;
        const p = fight.p, o = fight.o;
        let hint = null;
        if (fight.spec.hints && !fight.over) {
            if (o.state === 'windup' && !o.resolved && !o.bluff) hint = answerFor(o.shown);
            if (o.state === 'guard') hint = 'upper';
        }
        // математика: пока идёт замах — на кнопках ответы
        const mc = fight.math && fight.mathCur && o.state === 'windup' && !o.resolved && !fight.over ? fight.mathCur : null;
        (ctlNodes || (ctlNodes = document.querySelectorAll('.ctl'))).forEach(b => {
            const a = b.dataset.a;
            const off = fight.over || (a !== 'block' && p.sta < punchCost(a, o.state === 'stun'));
            const glow = hint === a;
            const showMath = !!mc && a !== 'block';
            const key = (off ? 1 : 0) + (glow ? 2 : 0) + (showMath ? 4 + 8 * mc.id : 0);
            if (!force && ctlCache[a] === key) return;
            ctlCache[a] = key;
            b.classList.toggle('off', off);
            b.classList.toggle('glow', glow);
            b.classList.toggle('math', showMath);
            if (showMath) b.querySelector('.ans').textContent = mc.opts[a];
        });
    }

    // ======================================================================
    // Отрисовка боя
    // ======================================================================
    function drawFighter(f, x) {
        const set = f.set;
        const pose = f.pose;
        let bob = 0;
        if (pose === 'stance' || pose === 'block') bob = Math.round(Math.sin(time * 5 + f.phase) * 1);
        const dir = f.side === 'L' ? 1 : -1;
        const jitter = f.flash > 0 ? (Math.random() < 0.5 ? -1 : 1) : 0;
        const X = Math.round(x + f.dx + jitter), Y = DRAW_Y + bob;
        if (f.state === 'ko') {
            const k = f.ko;
            const ang = -dir * k * k * 1.45;          // падает на спину
            const pivotX = X + (f.side === 'L' ? 38 : FW - 38);
            bx.save();
            bx.translate(pivotX, FEET);
            bx.rotate(ang);
            bx.drawImage(set.hit, X - pivotX, Y - FEET);
            bx.restore();
            return;
        }
        bx.drawImage(set[pose], X, Y);
        if (f.flash > 0) {
            bx.globalAlpha = 0.75;
            bx.drawImage(set.white[pose], X, Y);
            bx.globalAlpha = 1;
        }
        // замах: пульсирующая подсветка цветом правильного ответа (у сложных — белым)
        if (f.side === 'R' && f.state === 'windup') {
            const k = f.t / f.dur;
            const hidden = f.bluff || (fight.spec.silent && k > 0.35);
            const c = fight.spec.colorHint && !hidden && !fight.math ? COLORS[answerFor(f.shown)] : '#ffffff';
            const key = 'tint_' + c;
            if (!set[key]) set[key] = tinted(set.stance, c);
            bx.globalAlpha = 0.1 + 0.22 * Math.abs(Math.sin(time * 14)) * Math.min(1, k * 2);
            bx.drawImage(set[key], X, Y);
            bx.globalAlpha = 1;
        }
    }

    function render() {
        bx.setTransform(1, 0, 0, 1, 0, 0);
        let sx = 0, sy = 0;
        // тряска экрана отключена
        bx.translate(sx, sy);
        if (img.arena) bx.drawImage(img.arena, 0, 0, W, H);
        else { bx.fillStyle = '#0b0d18'; bx.fillRect(0, 0, W, H); }
        crowdFlashes.forEach(f => {
            if (f.t < 0 || f.t > f.life) return;
            bx.fillStyle = '#ffffff';
            bx.fillRect(f.x, f.y, 2, 2);
            bx.globalAlpha = 0.35;
            bx.fillRect(f.x - 2, f.y, 6, 2);
            bx.fillRect(f.x, f.y - 2, 2, 6);
            bx.globalAlpha = 1;
        });
        if (fight) {
            const p = fight.p, o = fight.o;
            const pFront = PUNCHES.includes(p.pose) || o.state === 'ko';
            if (pFront) { drawFighter(o, OX); drawFighter(p, PX); }
            else { drawFighter(p, PX); drawFighter(o, OX); }
            if (img.ropes) bx.drawImage(img.ropes, 0, 0);
            fight.parts.forEach(q => {
                bx.fillStyle = q.c;
                bx.fillRect(Math.round(q.x), Math.round(q.y), 2, 2);
            });
        }
        if (Core.currentScreen !== 'scrGame') return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(buf, 0, 0, canvas.width, canvas.height);
        if (!fight) return;
        view.begin(ctx);
        drawHud();
        drawTelegraph();
        drawThought();
        drawTexts();
    }

    function bar(x, y, w, h, v, max, color, back, alignRight) {
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
        ctx.fillStyle = back;
        ctx.fillRect(x, y, w, h);
        const fw = Math.max(0, w * v / max);
        ctx.fillStyle = color;
        ctx.fillRect(alignRight ? x + w - fw : x, y, fw, h);
    }
    function drawHud() {
        const p = fight.p, o = fight.o;
        bar(14, 12, 170, 9, p.hp, p.maxHp, '#e8473a', '#3a1416');
        bar(14, 24, 120, 4, p.sta, 100, '#f5d547', '#3a3416');
        bar(W - 184, 12, 170, 9, o.hp, o.maxHp, '#e8473a', '#3a1416', true);
        ctx.font = 'bold 9px "Segoe UI", Roboto, Arial, sans-serif';
        ctx.textBaseline = 'top';
        outlined(fight.opts.playerName, 14, 31, '#ffffff', 'left');
        outlined(fight.opts.oppName, W - 14, 26, fight.spec.boss ? '#ffd23f' : '#ffffff', 'right');
        ctx.font = 'bold 8px "Segoe UI", Roboto, Arial, sans-serif';
        outlined(fight.opts.title, W / 2, 14, '#ffd23f', 'center');
    }
    function outlined(s, x, y, c, align) {
        ctx.textAlign = align || 'center';
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(s, x, y);
        ctx.fillStyle = c;
        ctx.fillText(s, x, y);
    }

    // Значок над соперником: какой удар он готовит + кольцо времени
    function drawTelegraph() {
        const o = fight.o;
        if (fight.over) return;
        const cx = OX + 44 + o.dx, cy = 66;
        const hint = fight.spec.colorHint;
        if (o.state === 'guard') {
            badge(cx, cy, hint ? COLORS.upper : NEUTRAL, 'block', 1 - o.t / o.dur, false, false);
            if (hint) answerChip(cx + 24, cy, 'upper');
            return;
        }
        if (o.state !== 'windup' || o.resolved) return;
        const k = o.t / o.dur;
        if (o.bluff) {
            if (fight.math && fight.mathCur) drawMathPanel(cx, cy, fight.mathCur.q, NEUTRAL, 1 - k, false, true, null);
            else badge(cx, cy, NEUTRAL, o.shown, 1 - k, false, true);
            return;
        }
        const hidden = fight.spec.silent && k > 0.35;
        const ans = answerFor(o.shown);
        if (fight.math && fight.mathCur) {
            drawMathPanel(cx, cy, hidden ? '? ? ?' : fight.mathCur.q, NEUTRAL, 1 - k, k >= fight.m.perfectFrom, false, null);   // подсказку цветом в математике не даём
            if (o.tutorPaused) drawTutor(o.shown, ans);
            return;
        }
        // цвет кольца — только цвет кнопки-ответа; значок удара соперника всегда белый
        badge(cx, cy, hint && !hidden ? COLORS[ans] : NEUTRAL, hidden ? 'unknown' : o.shown, 1 - k, k >= fight.m.perfectFrom, false);
        if (hint && !hidden) answerChip(cx + 24, cy, ans);
        if (o.tutorPaused) drawTutor(o.shown, ans);
    }
    // Пример над соперником: плашка с текстом и полоска времени под ней
    let ctlNodes = null;
    function drawMathPanel(cx, cy, text, color, left, perfect, dashed, chip) {
        ctx.font = '900 15px "Segoe UI", Roboto, Arial, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const w = Math.max(58, ctx.measureText(text).width + 16), h = 24;
        const x = Math.round(cx - w / 2), y = cy - h / 2 - 1;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, w, h, 7); else ctx.rect(x, y, w, h);
        ctx.fillStyle = 'rgba(8,10,22,0.88)';
        ctx.fill();
        ctx.lineWidth = perfect ? 2.5 : 1.5;
        ctx.strokeStyle = perfect ? 'rgba(255,255,255,' + (0.5 + 0.5 * Math.abs(Math.sin(time * 20))) + ')' : 'rgba(255,255,255,0.25)';
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, cx, y + h / 2 + 1);
        // полоска времени
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(x, y + h + 3, w, 3);
        ctx.fillStyle = color;
        if (dashed) { ctx.setLineDash([3, 3]); ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y + h + 4.5); ctx.lineTo(x + w * Math.max(0, left), y + h + 4.5); ctx.stroke(); ctx.setLineDash([]); }
        else ctx.fillRect(x, y + h + 3, w * Math.max(0, left), 3);
        if (chip) {
            const px = x + w + 13, py = cy;
            ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2); ctx.fillStyle = chip.c; ctx.fill();
            ctx.font = '900 10px "Segoe UI", Roboto, Arial, sans-serif';
            ctx.fillStyle = '#10121f';
            ctx.fillText(String(chip.n), px, py + 1);
        }
    }
    function answerChip(cx, cy, type) {
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.fillStyle = COLORS[type];
        ctx.fill();
        icon(cx, cy, type, '#10121f', 11, 1);
    }
    function drawTutor(punch, ans) {
        ctx.textBaseline = 'middle';
        if (fight.math && fight.mathCur) {
            ctx.fillStyle = 'rgba(5,6,12,0.78)';
            ctx.fillRect(0, 30, W, 18);
            ctx.font = '900 12px "Segoe UI", Roboto, Arial, sans-serif';
            ctx.globalAlpha = 0.75 + 0.25 * Math.abs(Math.sin(time * 6));
            outlined(Core.t(fight.tutorWrong > 0 ? 'tut_math_wrong' : 'tut_math2'), W / 2, 40, '#ffd23f', 'center');
            ctx.globalAlpha = 1;
            return;
        }
        ctx.fillStyle = 'rgba(5,6,12,0.78)';
        ctx.fillRect(0, 30, W, 30);
        ctx.font = '900 11px "Segoe UI", Roboto, Arial, sans-serif';
        outlined(Core.t('tut_line1', { a: Core.t(punch).toUpperCase() }), W / 2, 39, '#ffffff', 'center');
        ctx.font = '900 12px "Segoe UI", Roboto, Arial, sans-serif';
        ctx.globalAlpha = 0.75 + 0.25 * Math.abs(Math.sin(time * 6));
        outlined(Core.t(fight.tutorWrong > 0 ? 'tut_wrong' : 'tut_line2', { b: Core.t(ans).toUpperCase() }), W / 2, 52, COLORS[ans], 'center');
        ctx.globalAlpha = 1;
    }
    function badge(cx, cy, color, type, left, perfect, dashed) {
        const r = 13;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(8,10,22,0.85)';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, left));
        ctx.strokeStyle = color;
        ctx.lineWidth = perfect ? 4 : 3;
        if (dashed) ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (perfect) {
            ctx.beginPath();
            ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,255,255,' + (0.3 + 0.4 * Math.abs(Math.sin(time * 20))) + ')';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
        icon(cx, cy, type, '#ffffff', 16, -1);
    }
    // Значки — те же контуры, что и на кнопках (CPData.ICONS). dir = -1 — удар соперника, летит влево
    const pathCache = {};
    function icon(cx, cy, type, color, size, dir) {
        const path = pathCache[type] || (pathCache[type] = new Path2D(D.ICONS[type]));
        const s = size / 24;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(type === 'upper' || type === 'block' || type === 'unknown' ? s : s * dir, s);
        ctx.translate(-12, -12);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.6;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.stroke(path);
        ctx.restore();
    }
    function drawThought() {
        const th = fight.thought;
        if (!th || fight.over) return;
        const a = Math.min(1, th.t * 4, (2.4 - th.t) * 3);
        ctx.globalAlpha = Math.max(0, a);
        ctx.font = 'bold 9px "Segoe UI", Roboto, Arial, sans-serif';
        const s = Core.t(th.key);
        const w = ctx.measureText(s).width + 12;
        const x = Math.min(W - w - 6, OX + 40 - w / 2), y = 36;
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, w, 16, 6); else ctx.rect(x, y, w, 16);
        ctx.fill();
        ctx.beginPath(); ctx.moveTo(x + w / 2 - 3, y + 16); ctx.lineTo(x + w / 2 + 3, y + 16); ctx.lineTo(x + w / 2, y + 21); ctx.fill();
        ctx.fillStyle = '#1a1d33';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(s, x + w / 2, y + 8.5);
        ctx.globalAlpha = 1;
    }
    function drawTexts() {
        fight.texts.forEach(tx => {
            const k = tx.t / tx.life;
            const pop = k < 0.15 ? 0.7 + k * 2 : 1;
            ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
            ctx.font = '900 ' + Math.round(tx.size * pop) + 'px "Segoe UI", Roboto, Arial, sans-serif';
            ctx.textBaseline = 'middle';
            outlined(tx.s, tx.x, tx.y - k * 14, tx.c, 'center');
            ctx.globalAlpha = 1;
        });
    }

    // ======================================================================
    // Забег (рогалик)
    // ======================================================================
    const fighterDef = id => D.FIGHTERS.find(f => f.id === id) || D.FIGHTERS[0];
    const trainerDef = id => D.TRAINERS.find(t => t.id === id);
    const perkDef = id => D.PERKS.find(p => p.id === id);
    const fname = id => Core.t('f_' + id);
    const tname = id => Core.t('t_' + id);
    const lvlOf = (kind, id) => (Core.data.owned[kind] && Core.data.owned[kind][id]) || 0;

    function computeMods(run) {
        const m = D.baseMods();
        const f = fighterDef(run.fighter);
        D.applyFx(m, f.fx, lvlOf('f', f.id) || 1);
        if (run.trainer) { const t = trainerDef(run.trainer); if (t) D.applyFx(m, t.fx, lvlOf('t', t.id) || 1); }
        run.perks.forEach(id => { const p = perkDef(id); if (p) D.applyFx(m, p.fx, 1); });
        m.maxHp = Math.max(40, Math.round(m.maxHp));
        return m;
    }
    function genOpponents(playerFighter) {
        const pool = shuffle(D.FIGHTERS.map(f => f.id).filter(id => id !== playerFighter));
        const opps = [];
        for (let i = 0; i < RUN_LEN; i++) {
            const t = i + 1;
            const nTraits = t <= 2 ? 0 : t <= 5 ? 1 : 2;
            const traits = shuffle(D.TRAITS.slice()).slice(0, nTraits);
            const boss = i === RUN_LEN - 1;
            opps.push({ f: pool[i % pool.length], pal: boss ? -1 : Math.floor(Math.random() * D.PALETTES.length), traits, boss });
        }
        return opps;
    }
    function specFor(desc, i) {
        const t = i + 1;
        const s = {
            hp: 70 + 20 * t, dmg: Math.round(8 + 1.3 * t), wu0: 1.45 - 0.07 * t, idle: [Math.max(0.5, 1.15 - 0.06 * t), Math.max(0.9, 1.8 - 0.1 * t)],
            w: { straight: 1, hook: 1, upper: 1 }, series: 0, guard: 0, feint: 0, bluff: 0, silent: false, adaptive: false,
            colorHint: t <= 2, hints: false, tutorial: false, boss: desc.boss, mathLvl: i
        };
        s.wu = s.wu0 * 0.76;
        if (i === 0 && !Core.data.tutorialDone) {
            Object.assign(s, { hp: 90, wu0: 1.8, wu: 1.1, idle: [1.2, 2.0], hints: true, tutorial: true, w: { straight: 1, hook: 1, upper: 0.6 } });
        }
        if (desc.boss) { s.hp = Math.round(s.hp * 1.35); s.dmg += 2; }
        desc.traits.forEach(tr => {
            switch (tr) {
                case 'fast': s.wu0 *= 0.8; s.wu *= 0.8; s.idle = s.idle.map(v => v * 0.8); break;
                case 'series': s.series = 0.45; break;
                case 'feint': s.feint = 0.3; break;
                case 'guard': s.guard = 0.28; break;
                case 'silent': s.silent = true; break;
                case 'bluff': s.bluff = 0.25; break;
                case 'heavy': s.hp = Math.round(s.hp * 1.4); s.dmg = Math.round(s.dmg * 1.25); s.wu0 *= 1.12; s.wu *= 1.12; break;
                case 'adaptive': s.adaptive = true; break;
            }
        });
        return s;
    }
    const oppPalette = desc => (desc.pal < 0 ? D.CHAMP_PALETTE : D.PALETTES[desc.pal]);
    const oppName = desc => (desc.boss ? Core.t('champion') + ' ' : '') + fname(desc.f);

    function newRun() {
        const run = {
            fighter: Core.data.selF || 'rookie', trainer: Core.data.selT || null,
            step: 0, perks: [], revived: false, coins: 0, lastCoins: 0, doubled: true
        };
        run.opps = genOpponents(run.fighter);
        run.hp = computeMods(run).maxHp;
        Core.data.run = run;
        Core.data.runs = (Core.data.runs || 0) + 1;
        Core.save(true);
        showRun();
    }
    function startRunFight() {
        const run = Core.data.run;
        if (!run) return;
        const i = run.step, desc = run.opps[i];
        const mods = computeMods(run);
        const spec = specFor(desc, i);
        const begin = () => startFight({
            spec, mods, hp: run.hp,
            pSet: fighterSet(run.fighter, null, false),
            oSet: fighterSet(desc.f, oppPalette(desc), true),
            playerName: fname(run.fighter), oppName: oppName(desc),
            title: Core.t('fight_n', { n: i + 1, m: RUN_LEN }),
            onEnd: won => (won ? runWin() : runLose())
        });
        if (!Core.data.tutorialSeen) {
            showRules(() => { Core.data.tutorialSeen = true; Core.save(false); begin(); });
            return;
        }
        // полноэкранная реклама только между боями (каркас сам ограничивает частоту)
        if (i > 0) Core.ads.fullscreen(begin); else begin();
    }
    function runWin() {
        const run = Core.data.run, m = computeMods(run);
        const t = run.step + 1;
        const boss = run.opps[run.step].boss;
        const coins = Math.round((12 + 5 * t + 2 * fight.stats.perfects) * m.coinMul) + (boss ? 50 : 0);
        Core.data.coins += coins;
        run.coins += coins;
        run.lastCoins = coins;
        run.doubled = false;
        const heal = Math.round(m.maxHp * 0.2 + m.healAfter);
        const hpBefore = fight.p.hp;
        run.hp = Math.min(m.maxHp, fight.p.hp + heal);
        run.step++;
        Core.data.best = Math.max(Core.data.best || 0, run.step);
        Core.data.wins = (Core.data.wins || 0) + 1;
        Core.save(true);
        Core.sfx.win();
        if (run.step >= RUN_LEN) { endRun(true); return; }
        showPerkChoice(coins, run.hp - hpBefore);
    }
    function runLose() {
        const run = Core.data.run;
        Core.sfx.lose();
        $('#loseDesc').textContent = Core.t('lose_desc', { name: oppName(run.opps[run.step]) });
        $('#loseStats').textContent = Core.t('stats', { c: fight.stats.counters, p: fight.stats.perfects });
        $('#btnRevive').style.display = run.revived ? 'none' : '';
        Core.modal('mdLose', true);
    }
    $('#btnRevive').onclick = () => {
        Core.ads.rewarded(() => {
            Core.data.run.revived = true;
            Core.save(false);
            Core.modal('mdLose', false);
            reviveFight();
        });
    };
    $('#btnEndRun').onclick = () => { Core.modal('mdLose', false); endRun(false); };
    function endRun(won) {
        const run = Core.data.run;
        Core.data.run = null;
        Core.save(true);
        fight = null;
        Core.gameplay(false);
        $('#endTitle').textContent = Core.t(won ? 'run_win_title' : 'run_end_title');
        $('#endDesc').textContent = won ? Core.t('run_win_desc', { c: run.coins }) : Core.t('run_end_desc', { n: run.step, c: run.coins });
        renderMenu();
        Core.show('scrMenu');
        Core.modal('mdRunEnd', true);
    }
    $('#endNew').onclick = () => { Core.modal('mdRunEnd', false); openSetup(); };
    $('#endMenu').onclick = () => Core.modal('mdRunEnd', false);

    // --- выбор усиления ---
    function offerPerks(run) {
        const owned = new Set(run.perks);
        const avail = D.PERKS.filter(p => p.stack || !owned.has(p.id));
        const out = [];
        for (let k = 0; k < 3 && avail.length; k++) {
            const rar = pickWeighted(D.PERK_RAR_W);
            let pool = avail.filter(p => p.rar === rar && !out.includes(p));
            if (!pool.length) pool = avail.filter(p => !out.includes(p));
            if (!pool.length) break;
            out.push(pickOne(pool));
        }
        return out;
    }
    function showPerkChoice(coins, healed) {
        const run = Core.data.run;
        const grid = $('#perkGrid');
        grid.innerHTML = '';
        offerPerks(run).forEach(p => {
            const el = document.createElement('div');
            el.className = 'card rc-' + p.rar;
            el.innerHTML = '<div class="rr"></div><div class="nm"></div><div class="ds"></div>';
            el.querySelector('.rr').textContent = Core.t('rar_' + p.rar);
            el.querySelector('.nm').textContent = Core.t('p_' + p.id);
            el.querySelector('.ds').textContent = D.describe(Core.t, p.fx, 1);
            el.onclick = () => pickPerk(p.id);
            grid.appendChild(el);
        });
        $('#perkInfo').textContent = Core.t('earned', { n: coins }) + (healed > 0 ? ' · ' + Core.t('healed', { n: healed }) : '');
        $('#btnDouble').style.display = '';
        Core.modal('mdPerk', true);
        fight = null;
    }
    function pickPerk(id) {
        const run = Core.data.run;
        const before = computeMods(run).maxHp;
        run.perks.push(id);
        const after = computeMods(run).maxHp;
        if (after > before) run.hp += after - before;
        run.hp = Math.min(after, run.hp);
        Core.save(true);
        Core.modal('mdPerk', false);
        showRun();
    }
    $('#btnDouble').onclick = () => {
        const run = Core.data.run;
        if (!run || run.doubled) return;
        Core.ads.rewarded(() => {
            run.doubled = true;
            Core.data.coins += run.lastCoins;
            run.coins += run.lastCoins;
            Core.save(true);
            snd.coin();
            $('#perkInfo').textContent = Core.t('earned', { n: run.lastCoins * 2 });
            $('#btnDouble').style.display = 'none';
        });
    };

    // --- экран забега ---
    function showRun() {
        const run = Core.data.run;
        if (!run) { renderMenu(); Core.show('scrMenu'); return; }
        const m = computeMods(run);
        $('#runTitle').textContent = Core.t('run_title') + ' · ' + Core.t('fight_n', { n: run.step + 1, m: RUN_LEN });
        $('#runCoins').textContent = Core.t('coins_n', { n: Core.data.coins });
        const track = $('#runTrack');
        track.innerHTML = '';
        run.opps.forEach((o, i) => {
            const el = document.createElement('i');
            if (i < run.step) el.className = 'done'; else if (i === run.step) el.className = 'cur';
            if (o.boss) el.classList.add('boss');
            track.appendChild(el);
        });
        const desc = run.opps[run.step];
        const pc = $('#runOppPic');
        const px = pc.getContext('2d');
        px.imageSmoothingEnabled = false;
        px.clearRect(0, 0, FW, FH);
        px.drawImage(fighterSet(desc.f, oppPalette(desc), true).stance, 0, 0);
        $('#runOppName').textContent = oppName(desc);
        const tr = $('#runOppTraits');
        tr.innerHTML = '';
        if (!desc.traits.length) tr.innerHTML = '<div class="trait"></div>', tr.firstChild.textContent = Core.t('no_traits');
        desc.traits.forEach(k => {
            const d = document.createElement('div');
            d.className = 'trait';
            d.innerHTML = '<b></b> — <span></span>';
            d.querySelector('b').textContent = Core.t('tr_' + k);
            d.querySelector('span').textContent = Core.t('trd_' + k);
            tr.appendChild(d);
        });
        const who = $('#runWho');
        who.innerHTML = '';
        who.appendChild(standingCanvas(run.fighter, null, false));
        who.insertAdjacentHTML('beforeend', '<span></span>');
        who.lastChild.textContent = fname(run.fighter);
        if (run.trainer) {
            who.appendChild(portrait(run.trainer));
            who.insertAdjacentHTML('beforeend', '<span></span>');
            who.lastChild.textContent = tname(run.trainer);
        }
        $('#runHpText').textContent = Core.t('hp_n', { a: Math.round(run.hp), b: m.maxHp });
        $('#runHpBar').style.width = Math.round(100 * run.hp / m.maxHp) + '%';
        const chips = $('#runPerks');
        chips.innerHTML = '';
        const counts = {};
        run.perks.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
        Object.keys(counts).forEach(id => {
            const p = perkDef(id);
            const c = document.createElement('span');
            c.className = 'chip rc-' + p.rar;
            c.textContent = Core.t('p_' + id) + (counts[id] > 1 ? ' ×' + counts[id] : '');
            c.title = D.describe(Core.t, p.fx, 1);
            chips.appendChild(c);
        });
        if (!run.perks.length) chips.innerHTML = '<span class="stat-line"></span>', chips.firstChild.textContent = Core.t('no_perks');
        Core.gameplay(false);
        Core.show('scrRun');
    }
    $('#btnFight').onclick = () => startRunFight();
    $('#runMenu').onclick = () => { renderMenu(); Core.show('scrMenu'); };
    $('#btnGiveUp').onclick = () => askExit(false);

    // ======================================================================
    // Контракты (гача)
    // ======================================================================
    const POOL = D.FIGHTERS.filter(f => !f.start).map(f => ({ kind: 'f', id: f.id, rar: f.rar }))
        .concat(D.TRAINERS.map(t => ({ kind: 't', id: t.id, rar: t.rar })));
    function rollContract() {
        Core.data.pity = (Core.data.pity || 0) + 1;
        let rar;
        if (Core.data.pity >= PITY) rar = 'l';
        else {
            const w = {};
            Object.keys(D.RARITY).forEach(k => { w[k] = D.RARITY[k].w; });
            rar = pickWeighted(w);
        }
        if (rar === 'l') Core.data.pity = 0;
        const item = pickOne(POOL.filter(p => p.rar === rar));
        const own = Core.data.owned[item.kind];
        let result;
        if (!own[item.id]) { own[item.id] = 1; result = 'new'; }
        else if (own[item.id] < MAX_LVL) { own[item.id]++; result = 'dup'; }
        else { Core.data.coins += 40; result = 'max'; }
        Core.save(true);
        return { item, result, lvl: own[item.id] };
    }
    function doPull(paid) {
        if (paid) {
            const free = !Core.data.firstPullDone;
            if (!free && Core.data.coins < PULL_COST) { Core.toast(Core.t('not_enough')); return; }
            if (!free) Core.data.coins -= PULL_COST;
            Core.data.firstPullDone = true;
        }
        const r = rollContract();
        showPull(r);
        renderContracts();
    }
    function showPull(r) {
        const { item, result, lvl } = r;
        $('#pullTitle').textContent = Core.t(result === 'new' ? 'pull_new' : result === 'dup' ? 'pull_dup' : 'pull_max', { n: lvl });
        const box = $('#pullCard');
        box.innerHTML = '';
        const card = makeCard(item.kind, item.id, { big: true });
        card.classList.add('pull-card');
        box.appendChild(card);
        Core.modal('mdPull', true);
        snd.reveal();
    }
    $('#pullOk').onclick = () => Core.modal('mdPull', false);
    $('#btnPull').onclick = () => doPull(true);
    $('#btnPullAd').onclick = () => {
        if (Date.now() < (Core.data.adPullAt || 0)) return;
        Core.ads.rewarded(() => {
            Core.data.adPullAt = Date.now() + AD_PULL_COOLDOWN;
            doPull(false);
        });
    };
    const canPull = () => !Core.data.firstPullDone || Core.data.coins >= PULL_COST;
    // --- карточка бойца/тренера: купить, улучшить, выбрать ---
    let itemOpen = null;
    function priceOf(kind, id) {
        const def = kind === 'f' ? fighterDef(id) : trainerDef(id);
        return D.RARITY[def.rar].price;
    }
    const upgradeCost = (kind, id, lvl) => Math.round(priceOf(kind, id) * 0.5 * lvl);
    function openItem(kind, id) {
        itemOpen = { kind, id };
        const def = kind === 'f' ? fighterDef(id) : trainerDef(id);
        const lvl = lvlOf(kind, id);
        const box = $('#itemCard');
        box.innerHTML = '';
        const card = makeCard(kind, id, { locked: false });
        card.classList.add('item-card');
        if (!lvl) card.querySelector('.ds').textContent = D.describe(Core.t, def.fx, 1);
        box.appendChild(card);
        const buy = $('#itemBuy'), sel = $('#itemSelect');
        if (!lvl) {
            $('#itemDesc').textContent = Core.t('item_locked');
            buy.textContent = Core.t('buy_for', { n: priceOf(kind, id) });
            buy.style.display = '';
            sel.style.display = 'none';
        } else {
            if (lvl < MAX_LVL) {
                $('#itemDesc').textContent = def.fx.length ? Core.t('item_next', { d: D.describe(Core.t, def.fx, lvl + 1) }) : '';
                buy.textContent = Core.t('upgrade_for', { l: lvl + 1, n: upgradeCost(kind, id, lvl) });
                buy.style.display = def.fx.length ? '' : 'none';
            } else {
                $('#itemDesc').textContent = Core.t('item_max');
                buy.style.display = 'none';
            }
            const isSel = kind === 'f' ? Core.data.selF === id : Core.data.selT === id;
            sel.textContent = Core.t(isSel ? 'selected_run' : 'select_run');
            sel.style.display = '';
            sel.style.opacity = isSel ? 0.6 : 1;
        }
        buy.classList.toggle('off', false);
        Core.modal('mdItem', true);
    }
    $('#itemBuy').onclick = () => {
        if (!itemOpen) return;
        const { kind, id } = itemOpen;
        const lvl = lvlOf(kind, id);
        const cost = lvl ? upgradeCost(kind, id, lvl) : priceOf(kind, id);
        if (Core.data.coins < cost) { Core.toast(Core.t('not_enough')); snd.tick(); return; }
        Core.data.coins -= cost;
        Core.data.owned[kind][id] = lvl + 1;
        if (!lvl) { if (kind === 'f') Core.data.selF = id; else Core.data.selT = id; }
        Core.save(true);
        snd.reveal();
        Core.toast(Core.t(lvl ? 'upgraded' : 'bought', { n: lvl + 1 }));
        renderContracts();
        openItem(kind, id);
    };
    $('#itemSelect').onclick = () => {
        if (!itemOpen) return;
        const { kind, id } = itemOpen;
        if (kind === 'f') Core.data.selF = id; else Core.data.selT = id;
        Core.save(false);
        renderContracts();
        openItem(kind, id);
    };
    $('#itemClose').onclick = () => { Core.modal('mdItem', false); itemOpen = null; };
    $('#setupMore').onclick = () => { renderContracts(); Core.show('scrContracts'); };

    function makeCard(kind, id, o) {
        o = o || {};
        const def = kind === 'f' ? fighterDef(id) : trainerDef(id);
        const lvl = lvlOf(kind, id);
        const el = document.createElement('div');
        el.className = 'card rc-' + def.rar + (o.locked ? ' locked' : '') + (o.sel ? ' sel' : '');
        const pic = document.createElement('div');
        pic.className = 'pic';
        pic.appendChild(kind === 'f' ? standingCanvas(id, null, false) : portrait(id));
        el.appendChild(pic);
        el.insertAdjacentHTML('beforeend', '<div class="nm"></div><div class="rr"></div><div class="ds"></div>');
        el.querySelector('.nm').textContent = kind === 'f' ? fname(id) : tname(id);
        el.querySelector('.rr').textContent = Core.t('rar_' + def.rar);
        el.querySelector('.ds').textContent = o.locked ? Core.t('locked') : D.describe(Core.t, def.fx, lvl || 1);
        if (lvl && !o.noLevel) el.insertAdjacentHTML('beforeend', '<div class="lv"></div>'), el.querySelector('.lv').textContent = Core.t('level_n', { n: lvl });
        return el;
    }
    let ctTab = 'f';
    document.querySelectorAll('.tab').forEach(tb => {
        tb.onclick = () => { ctTab = tb.dataset.tab; renderContracts(); };
    });
    function renderContracts() {
        document.querySelectorAll('.tab').forEach(tb => tb.classList.toggle('on', tb.dataset.tab === ctTab));
        $('#ctCoins').textContent = Core.t('coins_n', { n: Core.data.coins });
        const grid = $('#ctGrid');
        grid.innerHTML = '';
        const list = ctTab === 'f' ? D.FIGHTERS : D.TRAINERS;
        list.forEach(def => {
            const sel = ctTab === 'f' ? Core.data.selF === def.id : Core.data.selT === def.id;
            const c = makeCard(ctTab, def.id, { locked: !lvlOf(ctTab, def.id), sel: sel && !!lvlOf(ctTab, def.id) });
            c.onclick = () => openItem(ctTab, def.id);
            grid.appendChild(c);
        });
        $('#ctRates').textContent = Core.t('rates', { n: PITY - (Core.data.pity || 0) });
        $('#btnPull').textContent = Core.data.firstPullDone ? Core.t('pull') : Core.t('pull_free');
        $('#btnPull').classList.toggle('pulse', canPull());
        updateAdPullButton();
    }
    function updateAdPullButton() {
        const b = $('#btnPullAd');
        const left = (Core.data.adPullAt || 0) - Date.now();
        if (left > 0) {
            const s = Math.ceil(left / 1000);
            b.textContent = Core.t('pull_wait', { t: Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') });
            b.classList.add('off'); b.style.opacity = 0.5;
        } else {
            b.textContent = Core.t('pull_ad');
            b.style.opacity = 1;
        }
    }
    setInterval(() => { if (Core.currentScreen === 'scrContracts') updateAdPullButton(); }, 1000);
    $('#btnContracts').onclick = () => { renderContracts(); Core.show('scrContracts'); };
    $('#ctBack').onclick = () => { renderMenu(); Core.show('scrMenu'); };

    // ======================================================================
    // Подготовка к забегу
    // ======================================================================
    function openSetup() {
        if (!lvlOf('f', Core.data.selF)) Core.data.selF = 'rookie';
        if (Core.data.selT && !lvlOf('t', Core.data.selT)) Core.data.selT = null;
        renderSetup();
        Core.show('scrSetup');
    }
    function renderSetup() {
        $('#setupCoins').textContent = Core.t('coins_n', { n: Core.data.coins });
        const fl = $('#setupFighters');
        fl.innerHTML = '';
        D.FIGHTERS.filter(f => lvlOf('f', f.id)).forEach(f => {
            const c = makeCard('f', f.id, { sel: Core.data.selF === f.id });
            c.onclick = () => { Core.data.selF = f.id; Core.save(false); renderSetup(); };
            fl.appendChild(c);
        });
        const tl = $('#setupTrainers');
        tl.innerHTML = '';
        const none = document.createElement('div');
        none.className = 'card rc-c' + (!Core.data.selT ? ' sel' : '');
        none.innerHTML = '<div class="pic"></div><div class="nm"></div>';
        none.querySelector('.nm').textContent = Core.t('no_trainer');
        none.onclick = () => { Core.data.selT = null; Core.save(false); renderSetup(); };
        tl.appendChild(none);
        D.TRAINERS.filter(t => lvlOf('t', t.id)).forEach(t => {
            const c = makeCard('t', t.id, { sel: Core.data.selT === t.id });
            c.onclick = () => { Core.data.selT = t.id; Core.save(false); renderSetup(); };
            tl.appendChild(c);
        });
    }
    $('#btnStartRun').onclick = () => newRun();
    $('#setupBack').onclick = () => { renderMenu(); Core.show('scrMenu'); };

    // ======================================================================
    // Меню, правила, выход
    // ======================================================================
    function renderMenu() {
        $('#menuCoins').textContent = Core.t('coins_n', { n: Core.data.coins });
        $('#menuBest').textContent = Core.t('best_n', { n: Core.data.best || 0 });
        const run = Core.data.run;
        $('#btnRun').textContent = run ? Core.t('run_continue', { n: run.step + 1 }) : Core.t('run_new');
        $('#btnContracts').classList.toggle('badge-dot', canPull());
        const hero = $('#menuHero');
        hero.innerHTML = '';
        if (img.f_rookie) {
            hero.appendChild(standingCanvas(run ? run.fighter : (Core.data.selF || 'rookie'), null, false));
            if (run) hero.appendChild(standingCanvas(run.opps[run.step].f, oppPalette(run.opps[run.step]), true));
        }
    }
    $('#btnRun').onclick = () => { Core.sfx.init(); if (Core.data.run) showRun(); else openSetup(); };
    function showRules(after) {
        Core.modal('mdRules', true);
        $('#rulesOk').onclick = () => { Core.modal('mdRules', false); if (after) after(); };
    }
    $('#btnRules').onclick = () => showRules();

    let exitInFight = false;
    function askExit(inFight) {
        exitInFight = inFight;
        $('#exitTitle').textContent = Core.t(inFight ? 'exit_title' : 'give_up_title');
        $('#exitDesc').textContent = Core.t(inFight ? 'exit_desc' : 'give_up_desc');
        Core.modal('mdExit', true);
    }
    $('#btnExit').onclick = () => { if (fight && !fight.over) askExit(true); };
    $('#exitNo').onclick = () => Core.modal('mdExit', false);
    $('#exitYes').onclick = () => {
        Core.modal('mdExit', false);
        fight = null;
        endRun(false);
    };

    document.querySelectorAll('[data-sound]').forEach(b => { b.onclick = () => Core.sfx.setMuted(!Core.sfx.muted); });
    function soundIcons() {
        document.querySelectorAll('[data-sound]').forEach(b => { b.textContent = Core.sfx.muted ? '🔇' : '🔊'; });
    }
    document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = D.iconSvg(el.dataset.icon); });

    // ======================================================================
    // Управление
    // ======================================================================
    function press(a) {
        if (a === 'block') { if (fight) fight.blockHeld = true; return; }
        playerPunch(a);
    }
    function release(a) {
        if (a === 'block' && fight) fight.blockHeld = false;
    }
    document.querySelectorAll('.ctl').forEach(b => {
        const a = b.dataset.a;
        b.addEventListener('pointerdown', e => {
            e.preventDefault();
            b.classList.add('down');
            try { b.setPointerCapture(e.pointerId); } catch (er) {}
            press(a);
        });
        const up = () => { b.classList.remove('down'); release(a); };
        b.addEventListener('pointerup', up);
        b.addEventListener('pointercancel', up);
        b.addEventListener('lostpointercapture', up);
    });
    const KEYMAP = { Digit1: 'straight', KeyJ: 'straight', Numpad1: 'straight', Digit2: 'hook', KeyK: 'hook', Numpad2: 'hook',
                     Digit3: 'upper', KeyL: 'upper', Numpad3: 'upper', Space: 'block', ShiftLeft: 'block', KeyS: 'block' };
    document.addEventListener('keydown', e => {
        const a = KEYMAP[e.code];
        if (!a || Core.currentScreen !== 'scrGame') return;
        e.preventDefault();
        if (e.repeat || keysDown.has(e.code)) return;
        keysDown.add(e.code);
        const b = document.querySelector('.ctl[data-a="' + a + '"]');
        if (b) b.classList.add('down');
        press(a);
    });
    document.addEventListener('keyup', e => {
        const a = KEYMAP[e.code];
        if (!a) return;
        keysDown.delete(e.code);
        const b = document.querySelector('.ctl[data-a="' + a + '"]');
        if (b) b.classList.remove('down');
        release(a);
    });
    window.addEventListener('blur', () => { keysDown.clear(); if (fight) fight.blockHeld = false; });

    // ======================================================================
    // Запуск
    // ======================================================================
    Core.init({
        id: 'counterpunch2',
        i18n: D.I18N,
        defaultSave: {
            coins: 100, best: 0, wins: 0, runs: 0, run: null,
            owned: { f: { rookie: 1 }, t: {} }, selF: 'rookie', selT: null,
            pity: 0, firstPullDone: false, adPullAt: 0, tutorialSeen: false, tutorialDone: false
        },
        cloudField: 'progress',
        onReady: () => {
            view = Core.fitCanvas(canvas, $('#wrap'), W, H);
            soundIcons();
            loadImages().then(() => {
                renderMenu();
                window.__ready = true;
            });
            Core.startLoop(update, render);
        },
        onSDKReady: () => renderMenu(),
        onLangChange: () => { renderMenu(); if (Core.currentScreen === 'scrContracts') renderContracts(); },
        onMuteChange: () => soundIcons()
    });

    // для автотестов
    window.__game = {
        get fight() { return fight; }, press, release, newRun, startRunFight, doPull, rollContract,
        makeExample, pickPerk, showRun, computeMods: () => Core.data.run && computeMods(Core.data.run)
    };
})();
