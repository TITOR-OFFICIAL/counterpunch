/*
 * GameCore — общий каркас HTML5-игр на GamePush.
 *
 * Что внутри (одинаково для всех игр):
 *   - GamePush: инициализация, gameStart, разметка gameplayStart/Stop, пауза SDK
 *   - Реклама: rewarded и fullscreen через Promise (как в документации GamePush)
 *   - Сохранения: localStorage + облако (поле игрока, по умолчанию 'progress')
 *   - Пауза (вкладка скрыта / реклама / SDK) и звук (Web Audio, без файлов)
 *   - Языки RU/EN: автоопределение по платформе, data-i18n в разметке
 *   - Игровой цикл с фиксированным шагом 60 Гц (одинаковая скорость на 60/120/144 Гц)
 *   - Canvas с учётом плотности пикселей, пересчёт координат указателя
 *   - Экраны, модальные окна, всплывающие подсказки, задание дня, генератор случайных чисел
 *
 * Использование: Core.init({...}) в game.js. Подробности — README.md.
 */
(function (global) {
    'use strict';

    const Core = {};
    let cfg = null;

    // ======================================================================
    // Утилиты
    // ======================================================================
    Core.rng = function (seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    };
    Core.hash = function (str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    };
    const pad = n => (n < 10 ? '0' : '') + n;
    // Локальная дата игрока в виде 'YYYY-MM-DD'
    Core.today = function (offsetDays) {
        const d = new Date();
        if (offsetDays) d.setDate(d.getDate() + offsetDays);
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    };
    Core.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    Core.$ = sel => document.querySelector(sel);

    function deepMerge(base, extra) {
        const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
        if (!extra || typeof extra !== 'object') return out;
        for (const k of Object.keys(extra)) {
            const bv = out[k], ev = extra[k];
            if (bv && ev && typeof bv === 'object' && typeof ev === 'object' && !Array.isArray(bv) && !Array.isArray(ev)) {
                out[k] = deepMerge(bv, ev);
            } else {
                out[k] = ev;
            }
        }
        return out;
    }
    Core.deepMerge = deepMerge;

    // ======================================================================
    // Языки
    // ======================================================================
    Core.lang = 'ru';
    function normalizeLang(l) {
        l = String(l || '').toLowerCase().slice(0, 2);
        return (l === 'ru' || l === 'be' || l === 'kk') ? 'ru' : 'en';
    }
    Core.t = function (key, vars) {
        const dict = (cfg && cfg.i18n) || {};
        let s = (dict[Core.lang] && dict[Core.lang][key]);
        if (s === undefined) s = dict.ru && dict.ru[key];
        if (s === undefined) s = key;
        if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
        return s;
    };
    Core.applyI18n = function (root) {
        (root || document).querySelectorAll('[data-i18n]').forEach(el => {
            el.textContent = Core.t(el.getAttribute('data-i18n'));
        });
        (root || document).querySelectorAll('[data-i18n-title]').forEach(el => {
            el.title = Core.t(el.getAttribute('data-i18n-title'));
        });
        const title = Core.t('game_title');
        if (title !== 'game_title') document.title = title;
    };
    Core.chooseLang = function (l) {
        try { localStorage.setItem(cfg.id + '_lang', normalizeLang(l)); } catch (e) {}
        Core.setLang(l);
        refreshLangButton();
    };
    function refreshLangButton() {
        document.querySelectorAll('[data-lang-toggle]').forEach(b => { b.textContent = Core.lang === 'ru' ? 'RU' : 'EN'; });
    }
    Core.setLang = function (l) {
        l = normalizeLang(l);
        if (l === Core.lang) return;
        Core.lang = l;
        document.documentElement.lang = l;
        Core.applyI18n();
        if (cfg && cfg.onLangChange) cfg.onLangChange(l);
    };

    // ======================================================================
    // Пауза: несколько причин одновременно ('hidden', 'ad', 'sdk', игровые)
    // ======================================================================
    const pauseReasons = new Set();
    let windowBlurred = false;
    Core.isPaused = () => pauseReasons.size > 0;
    function updateAudioPause() {
        Core.sfx.setBackgroundPause(pauseReasons.size > 0 || windowBlurred);
    }
    Core.setPause = function (reason, on) {
        const was = Core.isPaused();
        if (on) pauseReasons.add(reason); else pauseReasons.delete(reason);
        updateAudioPause();
        if (was !== Core.isPaused() && cfg && cfg.onPauseChange) cfg.onPauseChange(Core.isPaused());
    };

    // ======================================================================
    // Звук (синтезатор, без файлов)
    // ======================================================================
    class SoundFX {
        constructor() { this.ctx = null; this.muted = false; this.bgPaused = false; this.dirty = false; }
        init() {
            // После рекламы / сворачивания звук контекста мог «умереть» (реклама забирает аудио,
            // состояние suspended/interrupted или контекст молча не играет). Поэтому после каждой паузы
            // создаём свежий AudioContext — это то же, что даёт выключить и включить звук вручную.
            if (this.dirty && this.ctx && !this.muted && !this.bgPaused) {
                this.dirty = false;
                const old = this.ctx;
                this.ctx = null;
                try { old.close().catch(() => {}); } catch (e) {}
            }
            if (!this.ctx) {
                const AC = global.AudioContext || global.webkitAudioContext;
                if (AC) { try { this.ctx = new AC(); } catch (e) { this.ctx = null; } }
            }
            if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed' && !this.muted && !this.bgPaused) {
                this.ctx.resume().catch(() => {});
            }
        }
        setMuted(m) {
            this.muted = !!m;
            if (this.ctx) {
                if (this.muted) this.ctx.suspend().catch(() => {});
                else if (!this.bgPaused) { this.dirty = true; this.init(); }
            }
            try { localStorage.setItem(cfg.id + '_muted', this.muted ? '1' : '0'); } catch (e) {}
            if (cfg && cfg.onMuteChange) cfg.onMuteChange(this.muted);
        }
        setBackgroundPause(p) {
            if (this.bgPaused === p) return;
            this.bgPaused = p;
            if (!this.ctx) return;
            if (p) { this.dirty = true; this.ctx.suspend().catch(() => {}); }
            else if (!this.muted) this.init();
        }
        tone(freq, type, duration, vol, slideFreq, delay) {
            if (this.muted || this.bgPaused) return;
            this.init();
            if (!this.ctx) return;
            try {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                const t0 = this.ctx.currentTime + (delay || 0);
                osc.type = type || 'sine';
                osc.frequency.setValueAtTime(freq, t0);
                if (slideFreq) osc.frequency.exponentialRampToValueAtTime(slideFreq, t0 + duration);
                gain.gain.setValueAtTime(vol === undefined ? 0.14 : vol, t0);
                gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(t0);
                osc.stop(t0 + duration);
            } catch (e) {}
        }
        // Готовые звуки, которые нужны почти в любой игре
        click() { this.tone(520, 'sine', 0.06, 0.08); }
        win() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 'triangle', 0.18, 0.14, null, i * 0.09)); }
        lose() { this.tone(300, 'sawtooth', 0.45, 0.12, 90); }
        reward() { this.tone(660, 'triangle', 0.12, 0.14, 990); this.tone(990, 'triangle', 0.16, 0.12, 1320, 0.1); }
    }
    Core.sfx = new SoundFX();

    // ======================================================================
    // GamePush
    // ======================================================================
    Core.gp = null;
    Core.sdkReady = false;
    function gpCall(name) {
        try {
            if (Core.gp && typeof Core.gp[name] === 'function') return Core.gp[name]();
        } catch (e) { console.warn('GP ' + name + ':', e); }
    }
    let gameplayActive = false;
    // true — игрок играет, false — меню/результаты. GamePush использует это для платформ (например, Яндекс).
    Core.gameplay = function (active) {
        active = !!active;
        if (gameplayActive === active) return;
        gameplayActive = active;
        gpCall(active ? 'gameplayStart' : 'gameplayStop');
    };

    // ======================================================================
    // Пикабу Игры: собственный SDK (PkbSDK). Включается флагом window.PIKABU_BUILD
    // в index.html пикабовской сборки. Реклама GamePush на Пикабу не работает —
    // площадка отдаёт рекламу только через свой SDK.
    // ======================================================================
    Core.pkb = null;
    let lastPkbFlush = 0;
    function loadPikabuSDK() {
        if (!global.PIKABU_BUILD) return;
        const s = document.createElement('script');
        s.async = true;
        s.src = 'https://games.pikabu.ru/sdk/sdk.js';
        s.onload = function () {
            try {
                Promise.resolve(global.PkbSDK.init()).then(onPkbReady).catch(e => console.warn('PkbSDK init:', e));
            } catch (e) { console.warn('PkbSDK:', e); }
        };
        s.onerror = function () { console.warn('PkbSDK: script not loaded'); };
        document.head.appendChild(s);
    }
    function savePkb(force) {
        if (!cfg.cloudField) return;
        try {
            Core.pkb.storage.set(cfg.cloudField, Core.data);
            // Лимит платформы: 100 явных flush за 5 минут — держим не чаще раза в 15 с
            if (force && Date.now() - lastPkbFlush >= 15000) {
                lastPkbFlush = Date.now();
                Promise.resolve(Core.pkb.storage.flush()).catch(e => console.warn('Pkb flush:', e));
            }
        } catch (e) { console.warn('Pkb save:', e); }
    }
    function onPkbReady(sdk) {
        if (Core.pkb || !sdk) return;
        Core.pkb = sdk;
        // требование Пикабу: по умолчанию русский интерфейс; выбор игрока (кнопка RU/EN) запоминается
        let saved = null;
        try { saved = localStorage.getItem(cfg.id + '_lang'); } catch (e) {}
        Core.setLang(saved || 'ru');
        refreshLangButton();
        mergeCloud();
        try { sdk.gameStarted(); } catch (e) { console.warn('PkbSDK gameStarted:', e); }
        if (cfg.onSDKReady) cfg.onSDKReady();
    }

    // ======================================================================
    // Сохранения
    // ======================================================================
    Core.data = {};
    let cloudDirty = false;
    let lastCloudSync = 0;
    function localKey() { return cfg.id + '_save'; }

    function readLocal() {
        try {
            const raw = localStorage.getItem(localKey());
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }
    function readCloud() {
        if (!cfg.cloudField) return null;
        // Пикабу: собственное облачное хранилище PkbSDK
        if (Core.pkb) {
            try {
                const raw = Core.pkb.storage.get(cfg.cloudField);
                if (!raw) return null;
                return typeof raw === 'string' ? JSON.parse(raw) : raw;
            } catch (e) { return null; }
        }
        if (!Core.sdkReady) return null;
        try {
            const raw = Core.gp.player.get(cfg.cloudField);
            if (!raw) return null;
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (e) { return null; }
    }
    // По умолчанию побеждает более свежее сохранение. Игра может передать свою функцию mergeSaves.
    function defaultMerge(a, b) {
        if (!a) return b;
        if (!b) return a;
        return (b._t || 0) > (a._t || 0) ? b : a;
    }

    // Сохранить. forceCloud — сразу отправить в облако (конец уровня, сворачивание вкладки).
    Core.save = function (forceCloud) {
        Core.data._t = Date.now();
        try { localStorage.setItem(localKey(), JSON.stringify(Core.data)); } catch (e) {}
        if (Core.pkb) savePkb(forceCloud);
        if (!Core.sdkReady) return;
        try {
            const player = Core.gp.player;
            if (cfg.cloudField) {
                player.set(cfg.cloudField, JSON.stringify(Core.data));
                cloudDirty = true;
            }
            // Стандартное поле 'score' (лидерборды) — лучший результат
            if (cfg.scoreKey) {
                const best = Number(Core.data[cfg.scoreKey]) || 0;
                if (best > (Number(player.get('score')) || 0)) {
                    player.set('score', best);
                    cloudDirty = true;
                }
            }
            if (cloudDirty && (forceCloud || Date.now() - lastCloudSync >= 15000)) {
                cloudDirty = false;
                lastCloudSync = Date.now();
                Promise.resolve(player.sync()).catch(err => {
                    cloudDirty = true;
                    console.warn('Cloud sync:', err);
                });
            }
        } catch (e) { console.warn('Save:', e); }
    };
    setInterval(() => { if (cloudDirty && cfg) Core.save(false); }, 10000);

    // ======================================================================
    // Реклама (Promise API GamePush)
    // ======================================================================
    Core.ads = {
        busy: false,
        lastFullscreen: Date.now()
    };
    function withTimeout(p, ms) {
        return Promise.race([Promise.resolve(p), new Promise(r => setTimeout(() => r(false), ms))]);
    }
    function hasAds(m) {
        return !!(Core.gp && Core.gp.ads && typeof Core.gp.ads[m] === 'function');
    }
    // Награда выдаётся только если видео досмотрено. Без SDK (локальный тест) — сразу.
    Core.ads.rewarded = async function (onReward) {
        if (Core.ads.busy) return false;
        if (!Core.pkb) {
            // Пикабу-сборка: SDK ещё не готов или недоступен — награду бесплатно не даём
            if (global.PIKABU_BUILD) { Core.toast(Core.t('ad_unavailable')); return false; }
            if (!hasAds('showRewardedVideo')) { onReward(); return true; }
        }
        Core.ads.busy = true;
        Core.setPause('ad', true);
        let ok = false;
        try {
            if (Core.pkb) {
                // PkbSDK: награда только при reward === true в результате show()
                const ad = Core.pkb.ads && Core.pkb.ads.rewarded;
                if (ad && ad.isSupported && await ad.canShow()) {
                    const res = await withTimeout(ad.show(), 120000);
                    ok = !!(res && res.reward === true);
                }
            } else {
                ok = await withTimeout(Core.gp.ads.showRewardedVideo(), 120000);
            }
        } catch (e) {
            console.warn('Rewarded:', e);
            ok = false;
        } finally {
            Core.ads.busy = false;
            Core.setPause('ad', false);
        }
        if (ok) {
            onReward();
            Core.sfx.reward();
        } else {
            Core.toast(Core.t('ad_unavailable'));
        }
        return !!ok;
    };
    // Полноэкранная реклама: только между партиями и не чаще minInterval сек.
    // На Пикабу платформа сама не пускает чаще раза в 120 с.
    Core.ads.fullscreen = async function (after) {
        const minSec = Math.max(cfg.fullscreenInterval || 60, Core.pkb ? 120 : 0);
        const supported = Core.pkb ? !!(Core.pkb.ads && Core.pkb.ads.fullscreen) : hasAds('showFullscreen');
        if (Core.ads.busy || !supported || Date.now() - Core.ads.lastFullscreen < minSec * 1000) {
            if (after) after();
            return;
        }
        Core.ads.busy = true;
        try {
            if (Core.pkb) {
                const ad = Core.pkb.ads.fullscreen;
                if (ad.isSupported && await ad.canShow()) {
                    Core.ads.lastFullscreen = Date.now();
                    Core.setPause('ad', true);
                    try { await withTimeout(ad.show(), 60000); } finally { Core.setPause('ad', false); }
                }
            } else {
                Core.ads.lastFullscreen = Date.now();
                Core.setPause('ad', true);
                try { await withTimeout(Core.gp.ads.showFullscreen(), 60000); } finally { Core.setPause('ad', false); }
            }
        } catch (e) {
            console.warn('Fullscreen:', e);
        } finally {
            Core.ads.busy = false;
        }
        if (after) after();
    };

    // ======================================================================
    // Игровой цикл с фиксированным шагом
    // ======================================================================
    Core.STEP_MS = 1000 / 60;
    Core.startLoop = function (update, render) {
        let last = performance.now();
        let acc = 0;
        function frame(now) {
            let dt = now - last;
            last = now;
            if (!(dt >= 0)) dt = 0;
            if (dt > 250) dt = 250;
            acc += dt;
            let steps = 0;
            while (acc >= Core.STEP_MS && steps < 5) {
                update();
                acc -= Core.STEP_MS;
                steps++;
            }
            if (steps === 5) acc = 0;
            render(now);
            requestAnimationFrame(frame);
        }
        requestAnimationFrame(t => { last = t; requestAnimationFrame(frame); });
    };

    // ======================================================================
    // Canvas: вписать логическое поле W×H в контейнер с учётом DPR
    // ======================================================================
    // onScale(rs) вызывается, когда меняется масштаб (пересоздать кэш спрайтов и т.п.)
    Core.fitCanvas = function (canvas, wrap, W, H, onScale) {
        let rs = 0;
        function resize() {
            const aw = wrap.clientWidth - 4, ah = wrap.clientHeight - 4;
            if (aw <= 0 || ah <= 0) return;
            const s = Math.min(aw / W, ah / H);
            canvas.style.width = Math.max(10, Math.floor(W * s)) + 'px';
            canvas.style.height = Math.max(10, Math.floor(H * s)) + 'px';
            const dpr = Math.min(global.devicePixelRatio || 1, 2.5);
            const bw = Math.max(1, Math.round(canvas.clientWidth * dpr));
            const bh = Math.max(1, Math.round(canvas.clientHeight * dpr));
            if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
            const nrs = bw / W;
            if (Math.abs(nrs - rs) > 0.01) {
                rs = nrs;
                if (onScale) onScale(rs);
            }
        }
        global.addEventListener('resize', resize);
        if (global.ResizeObserver) new ResizeObserver(resize).observe(wrap);
        resize();
        return {
            resize,
            get rs() { return rs; },
            // Подготовить контекст к рисованию в логических координатах
            begin(ctx) { ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0); },
            // Экранные координаты -> координаты поля (могут выходить за 0..W — это нормально)
            toLocal(clientX, clientY) {
                const r = canvas.getBoundingClientRect();
                const cw = canvas.clientWidth || r.width, ch = canvas.clientHeight || r.height;
                return {
                    x: (clientX - r.left - canvas.clientLeft) * (W / cw),
                    y: (clientY - r.top - canvas.clientTop) * (H / ch)
                };
            }
        };
    };

    // ======================================================================
    // UI: экраны, модалки, подсказки
    // ======================================================================
    Core.show = function (screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === screenId));
        Core.currentScreen = screenId;
    };
    Core.modal = function (id, on) {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('show', !!on);
    };
    Core.anyModalOpen = () => !!document.querySelector('.modal-overlay.show');
    Core.toast = function (msg, ms) {
        let t = document.getElementById('toast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'toast';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.classList.add('visible');
        clearTimeout(t._timer);
        t._timer = setTimeout(() => t.classList.remove('visible'), ms || 2500);
    };

    // ======================================================================
    // Задание дня: одинаковое для всех игроков в этот день
    // ======================================================================
    Core.daily = {
        key: () => Core.today(),
        seed: () => Core.hash(cfg.id + ':' + Core.today()),
        isDone: () => !!(Core.data.daily && Core.data.daily.last === Core.today()),
        streak: () => {
            const d = Core.data.daily;
            if (!d) return 0;
            return (d.last === Core.today() || d.last === Core.today(-1)) ? (d.streak || 0) : 0;
        },
        complete: () => {
            const d = Core.data.daily || (Core.data.daily = { last: null, streak: 0 });
            if (d.last === Core.today()) return false;
            d.streak = d.last === Core.today(-1) ? (d.streak || 0) + 1 : 1;
            d.last = Core.today();
            Core.save(true);
            return true;
        }
    };

    // ======================================================================
    // Инициализация
    // ======================================================================
    /*
     * config:
     *   id            — уникальный id игры (ключи localStorage)       [обязательно]
     *   i18n          — { ru: {...}, en: {...} }                       [обязательно]
     *   defaultSave   — структура сохранения по умолчанию
     *   cloudField    — поле игрока GamePush для облака ('progress'); null — без облака
     *   scoreKey      — ключ в Core.data с лучшим результатом -> стандартное поле 'score'
     *   mergeSaves(local, cloud) — объединение сохранений с разных устройств
     *   fullscreenInterval — мин. секунд между полноэкранной рекламой (60)
     *   onReady()     — игра может стартовать (сохранение загружено)
     *   onSDKReady()  — SDK подключён, облачное сохранение подтянуто
     *   onLangChange(lang), onPauseChange(paused), onMuteChange(muted)
     */
    Core.init = function (config) {
        cfg = Object.assign({ cloudField: 'progress', fullscreenInterval: 60 }, config);

        // Защита от контекстного меню и выделения (требование модерации)
        global.addEventListener('contextmenu', e => e.preventDefault());
        global.addEventListener('selectstart', e => e.preventDefault());

        Core.lang = normalizeLang(navigator.language);
        document.documentElement.lang = Core.lang;

        Core.data = deepMerge(cfg.defaultSave || {}, readLocal() || {});
        try { Core.sfx.muted = localStorage.getItem(cfg.id + '_muted') === '1'; } catch (e) {}

        document.addEventListener('visibilitychange', () => {
            Core.setPause('hidden', document.hidden);
            if (document.hidden) Core.save(true);
        });
        global.addEventListener('pagehide', () => Core.save(true));
        global.addEventListener('blur', () => { windowBlurred = true; updateAudioPause(); });
        global.addEventListener('focus', () => { windowBlurred = false; updateAudioPause(); });
        // Первое касание разблокирует звук в браузере
        document.addEventListener('pointerdown', () => Core.sfx.init(), { capture: true });

        Core.applyI18n();
        if (cfg.onReady) cfg.onReady();

        global.GameApp = { onSDKReady: onSDKReady };
        if (global.__gpReady && global.gp) onSDKReady(global.gp);
        document.querySelectorAll('[data-lang-toggle]').forEach(b => {
            if (!global.PIKABU_BUILD) { b.style.display = 'none'; return; }
            b.addEventListener('click', () => Core.chooseLang(Core.lang === 'ru' ? 'en' : 'ru'));
        });
        // Пикабу: сразу русский (или сохранённый выбор), не дожидаясь SDK
        if (global.PIKABU_BUILD) {
            let saved = null;
            try { saved = localStorage.getItem(cfg.id + '_lang'); } catch (e) {}
            Core.setLang(saved || 'ru');
            refreshLangButton();
        }
        loadPikabuSDK();
    };

    // Облачное сохранение: объединяем с локальным (побеждает более свежее)
    function mergeCloud() {
        try {
            const cloud = readCloud();
            const local = Core.data;
            const merged = cfg.mergeSaves ? cfg.mergeSaves(local, cloud) : defaultMerge(local, cloud);
            Core.data = deepMerge(cfg.defaultSave || {}, merged || {});
            Core.save(true);
        } catch (e) { console.warn('Cloud load:', e); }
    }

    let sdkInited = false;
    function onSDKReady(gp) {
        if (sdkInited) return;
        sdkInited = true;
        Core.gp = gp;
        Core.sdkReady = true;
        try { if (gp.language) Core.setLang(gp.language); } catch (e) {}

        mergeCloud();

        try {
            if (typeof gp.on === 'function') {
                gp.on('pause', () => Core.setPause('sdk', true));
                gp.on('resume', () => Core.setPause('sdk', false));
            }
        } catch (e) {}

        gpCall('gameStart');
        if (gameplayActive) { gameplayActive = false; Core.gameplay(true); }
        if (cfg.onSDKReady) cfg.onSDKReady();
    }

    global.Core = Core;
})(window);
