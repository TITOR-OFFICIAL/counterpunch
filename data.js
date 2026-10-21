/* «Контрудар» — данные: тексты, бойцы, тренеры, усиления, особенности соперников. */
(function (global) {
    'use strict';

    // ======================================================================
    // Эффекты: одна система для бойцов, тренеров и усилений
    // ======================================================================
    // v — значение с учётом уровня. Модификаторы m собираются перед каждым боем.
    const EFFECTS = {
        maxHp:        (m, v) => { m.maxHp += v; },
        regen:        (m, v) => { m.regen *= 1 + v; },
        coins:        (m, v) => { m.coinMul *= 1 + v; },
        healAfter:    (m, v) => { m.healAfter += v; },
        perfectWide:  (m, v) => { m.perfectFrom = Math.max(0.45, m.perfectFrom - v); },
        perfectPower: (m, v) => { m.perfectMul += v; },
        blockCheap:   (m, v) => { m.blockMul *= Math.max(0.15, 1 - v); },
        costCheap:    (m, v) => { m.costMul *= Math.max(0.4, 1 - v); },
        foresight:    (m, v) => { m.foresight *= 1 + v; },
        firstCounter: (m, v) => { m.firstCounterMul = Math.max(m.firstCounterMul, 1 + v); },
        counterHeal:  (m, v) => { m.counterHeal += v; },
        counterDmg:   (m, v) => { m.counterMul += v; },
        comboPlus:    (m, v) => { m.comboMax += Math.round(v); m.comboDmg += Math.round(v); },
        dmgTaken:     (m, v) => { m.dmgTaken *= Math.max(0.4, 1 - v); },
        reflect:      (m, v) => { m.reflect += v; },
        secondWind:   (m) => { m.secondWind = true; },
        straightAll:  (m) => { m.straightAll = true; },
        hookBreak:    (m) => { m.hookBreak = true; }
    };
    function baseMods() {
        return {
            maxHp: 100, regen: 1, coinMul: 1, healAfter: 0, perfectFrom: 0.7, perfectMul: 1.5,
            blockMul: 1, costMul: 1, foresight: 1, firstCounterMul: 1, counterHeal: 0, counterMul: 1,
            comboMax: 3, comboDmg: 2, dmgTaken: 1, reflect: 0, secondWind: false, straightAll: false, hookBreak: false
        };
    }
    // уровень усиливает только положительные числа: +25% за уровень
    const lvlValue = (v, lvl) => (v > 0 ? v * (1 + 0.25 * ((lvl || 1) - 1)) : v);
    function applyFx(m, fx, lvl) {
        (fx || []).forEach(([type, v]) => EFFECTS[type](m, lvlValue(v || 0, lvl)));
    }

    // ======================================================================
    // Редкости
    // ======================================================================
    // w — шанс в случайном контракте, price — прямая покупка
    const RARITY = {
        c: { w: 55, color: '#a9b4cf', price: 300 },
        r: { w: 30, color: '#4fa3ff', price: 600 },
        e: { w: 12, color: '#b56bff', price: 1200 },
        l: { w: 3, color: '#ffb020', price: 2500 }
    };

    // ======================================================================
    // Бойцы (за кого играешь) и тренеры (кто в углу)
    // ======================================================================
    const FIGHTERS = [
        { id: 'rookie', rar: 'c', fx: [], start: true },
        { id: 'bald', rar: 'c', fx: [['maxHp', 12]] },
        { id: 'ginger', rar: 'c', fx: [['regen', 0.15]] },
        { id: 'curly', rar: 'c', fx: [['coins', 0.15]] },
        { id: 'headgear', rar: 'c', fx: [['dmgTaken', 0.1]] },
        { id: 'veteran', rar: 'r', fx: [['perfectWide', 0.06], ['maxHp', -10]] },
        { id: 'topknot', rar: 'r', fx: [['foresight', 0.08]] },
        { id: 'mohawk', rar: 'r', fx: [['counterDmg', 0.25], ['maxHp', -10]] },
        { id: 'ponytail', rar: 'r', fx: [['comboPlus', 1]] },
        { id: 'cornrows', rar: 'e', fx: [['perfectPower', 0.3]] },
        { id: 'blond', rar: 'e', fx: [['reflect', 6], ['blockCheap', 0.25]] },
        { id: 'mask', rar: 'l', fx: [['secondWind'], ['hookBreak']] }
    ];
    const TRAINERS = [
        { id: 'misha', rar: 'c', fx: [['maxHp', 15]] },
        { id: 'olya', rar: 'c', fx: [['regen', 0.2]] },
        { id: 'palych', rar: 'c', fx: [['coins', 0.2]] },
        { id: 'gosha', rar: 'c', fx: [['healAfter', 10]] },
        { id: 'sen', rar: 'r', fx: [['perfectWide', 0.06]] },
        { id: 'burya', rar: 'r', fx: [['blockCheap', 0.4]] },
        { id: 'prof', rar: 'r', fx: [['foresight', 0.08]] },
        { id: 'fedor', rar: 'e', fx: [['firstCounter', 1]] },
        { id: 'rx9', rar: 'e', fx: [['perfectWide', 0.05], ['perfectPower', 0.2]] },
        { id: 'zina', rar: 'l', fx: [['counterHeal', 3]] }
    ];

    // ======================================================================
    // Усиления в забеге (выбор 1 из 3 после победы)
    // ======================================================================
    const PERKS = [
        { id: 'tough', rar: 'c', stack: true, fx: [['maxHp', 20]] },
        { id: 'lungs', rar: 'c', stack: true, fx: [['regen', 0.3]] },
        { id: 'heavy', rar: 'c', stack: true, fx: [['counterDmg', 0.2]] },
        { id: 'finisher', rar: 'c', stack: true, fx: [['comboPlus', 1]] },
        { id: 'medkit', rar: 'c', stack: true, fx: [['healAfter', 15]] },
        { id: 'thrifty', rar: 'c', fx: [['costCheap', 0.25]] },
        { id: 'ironguard', rar: 'c', fx: [['blockCheap', 0.5]] },
        { id: 'piggy', rar: 'c', stack: true, fx: [['coins', 0.3]] },
        { id: 'sniper', rar: 'r', fx: [['perfectWide', 0.08]] },
        { id: 'vampire', rar: 'r', stack: true, fx: [['counterHeal', 4]] },
        { id: 'chin', rar: 'r', stack: true, fx: [['dmgTaken', 0.2]] },
        { id: 'spikes', rar: 'r', stack: true, fx: [['reflect', 5]] },
        { id: 'foresight', rar: 'r', fx: [['foresight', 0.12]] },
        { id: 'royal', rar: 'e', fx: [['straightAll']] },
        { id: 'breaker', rar: 'e', fx: [['hookBreak']] },
        { id: 'second', rar: 'e', fx: [['secondWind']] },
        { id: 'ko', rar: 'e', fx: [['perfectPower', 0.5]] }
    ];
    const PERK_RAR_W = { c: 60, r: 30, e: 10 };

    // ======================================================================
    // Особенности соперников
    // ======================================================================
    const TRAITS = ['fast', 'series', 'feint', 'guard', 'silent', 'bluff', 'heavy', 'adaptive'];
    const PALETTES = [
        { h: 212, s: 0.85, vm: 1 }, { h: 125, s: 0.8, vm: 0.9 }, { h: 0, s: 0, vm: 0.42 }, { h: 280, s: 0.75, vm: 0.95 },
        { h: 28, s: 0.9, vm: 1 }, { h: 185, s: 0.75, vm: 0.9 }, { h: 330, s: 0.7, vm: 1 }, { h: 0, s: 0, vm: 1.1 }
    ];
    const CHAMP_PALETTE = { h: 46, s: 0.9, vm: 1.1 };

    // ======================================================================
    // Тексты
    // ======================================================================
    const I18N = {
        ru: {
            game_title: 'Контрудар',
            menu_sub: 'Бокс на реакцию: читай замах и бей тем, что сильнее',
            run_new: 'Новый забег', run_continue: 'Продолжить забег · бой {n}/8', contracts: 'Контракты', how_to: 'Как играть', to_menu: 'В меню',
            coins_n: '🪙 {n}', best_n: 'Лучший забег: {n}/8',
            straight: 'Прямой', hook: 'Хук', upper: 'Апперкот', block: 'Блок',
            straight_hint: 'бьёт хук', hook_hint: 'бьёт апперкот', upper_hint: 'бьёт прямой', block_hint: 'держи',
            rules_title: 'Как драться',
            rules_intro: 'Соперник замахивается — над ним появляется значок удара. Пока кольцо не сомкнулось, ответь ударом, который сильнее.',
            rule_straight: 'бьёт хук — короткая линия быстрее широкого замаха',
            rule_hook: 'бьёт апперкот — тот опускает руку и открывается сбоку',
            rule_upper: 'бьёт прямой (нырок и удар снизу) и пробивает блок',
            rule_block: 'держит прямой и хук, но тратит силы. Апперкот проходит сквозь блок',
            rules_perfect: 'Ответ в последний момент — «Идеально!», урон ×1,5. После контратаки соперник оглушён: добивай любыми ударами. Забег — 8 боёв подряд, после каждой победы выбираешь усиление. Проиграл — начинаешь заново.',
            got_it: 'Понятно!',
            you: 'Ты', fight_n: 'Бой {n} из {m}', champion: 'Чемпион',
            // экран подготовки
            setup_title: 'Подготовка к забегу', pick_fighter: 'Боец', pick_trainer: 'Тренер в углу', no_trainer: 'Без тренера',
            start_run: 'Начать забег', back: 'Назад',
            // карта забега
            run_title: 'Забег', next_opp: 'Следующий соперник', your_perks: 'Твои усиления', no_perks: 'Пока нет — выиграй бой',
            hp_n: 'Здоровье {a}/{b}', fight: 'В бой', give_up: 'Сдаться', no_traits: 'Без особенностей',
            give_up_title: 'Сдаться?', give_up_desc: 'Забег закончится. Монеты останутся у тебя.',
            // усиления
            perk_title: 'Победа! Выбери усиление', earned: '+{n} 🪙', double_coins: '×2 монеты', healed: '+{n} здоровья',
            // итог
            lose_title: 'Нокаут', lose_desc: '{name} оказался сильнее.', revive: 'Встать с 50% здоровья', end_run: 'Закончить забег',
            run_end_title: 'Забег окончен', run_win_title: 'Ты чемпион!', run_end_desc: 'Побед: {n} из 8 · Монет за забег: {c}',
            run_win_desc: 'Все 8 соперников побеждены! Монет за забег: {c}',
            stats: 'Контратак: {c} · Идеально: {p}',
            exit_title: 'Сдаться?', exit_desc: 'Бой будет проигран, забег закончится.', exit_no: 'Продолжить бой', exit_yes: 'Сдаться',
            // контракты
            contracts_title: 'Контракты', tab_fighters: 'Бойцы', tab_trainers: 'Тренеры',
            pull: '🎲 Случайный контракт · 100 🪙', pull_free: '🎲 Случайный контракт · бесплатно', pull_ad: '🎬 Бесплатно за видео', pull_wait: 'Бесплатно через {t}',
            rates: 'Шансы: обычный 55%, редкий 30%, эпический 12%, легендарный 3%. Легендарный гарантирован за 40 контрактов (осталось {n}).',
            not_enough: 'Не хватает монет — выигрывай бои', locked: 'Не подписан', level_n: 'Ур. {n}', selected: 'Выбран',
            pull_new: 'Новый контракт!', pull_dup: 'Повтор — уровень {n}!', pull_max: 'Максимальный уровень — +40 🪙', great: 'Отлично',
            rar_c: 'Обычный', rar_r: 'Редкий', rar_e: 'Эпический', rar_l: 'Легендарный',
            buy_for: 'Купить за {n} 🪙', upgrade_for: 'Улучшить до ур. {l} · {n} 🪙', select_run: 'Выбрать для забега', selected_run: '✓ Выбран для забега',
            close: 'Закрыть', item_locked: 'Можно купить сразу или получить в случайном контракте за 100 🪙.', item_max: 'Максимальный уровень',
            item_next: 'Следующий уровень: {d}', bought: 'Контракт подписан!', upgraded: 'Уровень {n}!', setup_more: 'Новые бойцы и тренеры — в «Контрактах»',
            // тексты в бою
            txt_counter: 'КОНТРА!', txt_perfect: 'ИДЕАЛЬНО!', txt_block: 'БЛОК', txt_broken: 'БЛОК ПРОБИТ!', txt_trade: 'РАЗМЕН',
            txt_missed: 'ПРОПУСТИЛ', txt_early: 'РАНО!', txt_late: 'ПОЗДНО!', txt_guard: 'В БЛОК', txt_break: 'ПРОБИЛ!', txt_tired: 'НЕТ СИЛ', txt_ko: 'НОКАУТ!',
            txt_fight: 'БОЙ!', txt_baited: 'ПОВЁЛСЯ!', txt_bluff: 'ФИНТ', txt_second: 'ВТОРОЕ ДЫХАНИЕ!',
            tut_line1: 'Соперник замахнулся: {a}', tut_line2: 'Жми {b}!', tut_wrong: 'Не та кнопка — жми {b}',
            th_early: 'Бьёшь рано? Проверим…', th_late: 'Ждёшь до конца? Ну-ну.', th_block: 'Опять в блоке? Получай снизу!',
            rotate: 'Поверните телефон горизонтально',
            ad_unavailable: 'Реклама недоступна или не досмотрена — попробуйте позже',
            // имена
            f_rookie: 'Новичок', f_bald: 'Борода', f_ginger: 'Рыжий', f_curly: 'Усач', f_headgear: 'Курсант', f_veteran: 'Старик',
            f_topknot: 'Тихий', f_mohawk: 'Панк', f_ponytail: 'Викинг', f_cornrows: 'Кобра', f_blond: 'Пижон', f_mask: 'Маска',
            t_misha: 'Дядя Миша', t_olya: 'Тренер Оля', t_palych: 'Палыч', t_gosha: 'Медик Гоша', t_sen: 'Мастер Сэн', t_burya: 'Сержант Буря',
            t_prof: 'Профессор', t_fedor: 'Железный Фёдор', t_rx9: 'Робот RX-9', t_zina: 'Бабушка Зина',
            p_tough: 'Крепыш', p_lungs: 'Дыхалка', p_heavy: 'Тяжёлая рука', p_finisher: 'Добивание', p_medkit: 'Аптечка', p_thrifty: 'Экономный',
            p_ironguard: 'Железный блок', p_piggy: 'Копилка', p_sniper: 'Снайпер', p_vampire: 'Вампир', p_chin: 'Железный подбородок',
            p_spikes: 'Шипы', p_foresight: 'Предвидение', p_royal: 'Королевский прямой', p_breaker: 'Пробивной хук', p_second: 'Второе дыхание', p_ko: 'Нокаутёр',
            tr_fast: 'Быстрый', tr_series: 'Серийник', tr_feint: 'Финтер', tr_guard: 'Глухарь', tr_silent: 'Молчун', tr_bluff: 'Провокатор', tr_heavy: 'Танк', tr_adaptive: 'Хитрец',
            trd_fast: 'Замахи короче', trd_series: 'Бьёт сериями по 2–3 удара', trd_feint: 'Начинает один удар и переводит в другой',
            trd_guard: 'Уходит в глухой блок — пробей апперкотом', trd_silent: 'Значок гаснет почти сразу — запоминай',
            trd_bluff: 'Ложные замахи с пунктирным кольцом — не ведись', trd_heavy: 'Много здоровья, бьёт сильно, но медленно',
            trd_adaptive: 'Запоминает твои привычки и подстраивается',
            // эффекты
            fx_none: 'Без особых умений', fx_maxHp: '{s}{v} к здоровью', fx_regen: '+{p}% к восстановлению сил', fx_coins: '+{p}% монет',
            fx_healAfter: 'После боя +{v} здоровья', fx_perfectWide: 'Окно «Идеально» шире на {w}%', fx_perfectPower: '«Идеально» +{p}% урона',
            fx_blockCheap: 'Блок тратит на {p}% меньше сил', fx_costCheap: 'Удары тратят на {p}% меньше сил', fx_foresight: 'Замахи соперника на {p}% дольше',
            fx_firstCounter: 'Первая контратака в бою ×{x}', fx_counterHeal: 'Контратака лечит {v}', fx_counterDmg: 'Контратаки +{p}% урона',
            fx_comboPlus: '+{v} удар в добивании', fx_dmgTaken: 'Пропущенные удары −{p}% урона', fx_reflect: 'Удар в твой блок ранит соперника на {v}',
            fx_secondWind: 'Раз за бой не падаешь: остаёшься с 1 здоровья', fx_straightAll: 'Прямой бьёт и хук, и апперкот, но стоит вдвое больше сил',
            fx_hookBreak: 'Хук тоже пробивает глухой блок'
        },
        en: {
            game_title: 'Counterpunch',
            menu_sub: 'A reaction boxing game: read the wind-up and hit with what beats it',
            run_new: 'New run', run_continue: 'Continue run · fight {n}/8', contracts: 'Contracts', how_to: 'How to play', to_menu: 'Menu',
            coins_n: '🪙 {n}', best_n: 'Best run: {n}/8',
            straight: 'Straight', hook: 'Hook', upper: 'Uppercut', block: 'Block',
            straight_hint: 'beats hook', hook_hint: 'beats uppercut', upper_hint: 'beats straight', block_hint: 'hold',
            rules_title: 'How to fight',
            rules_intro: 'Your opponent winds up and a punch icon appears above him. Before the ring closes, answer with the punch that beats it.',
            rule_straight: 'beats the hook — a short line is faster than a wide swing',
            rule_hook: 'beats the uppercut — it drops the hand and opens the side',
            rule_upper: 'beats the straight (duck and hit from below) and breaks the block',
            rule_block: 'stops straights and hooks but costs stamina. The uppercut goes through it',
            rules_perfect: 'Answer at the last moment for "Perfect!" and ×1.5 damage. After a counter the opponent is stunned: finish him with any punches. A run is 8 fights in a row; after every win you pick an upgrade. Lose and you start over.',
            got_it: 'Got it!',
            you: 'You', fight_n: 'Fight {n} of {m}', champion: 'Champion',
            setup_title: 'Get ready', pick_fighter: 'Fighter', pick_trainer: 'Corner trainer', no_trainer: 'No trainer',
            start_run: 'Start run', back: 'Back',
            run_title: 'Run', next_opp: 'Next opponent', your_perks: 'Your upgrades', no_perks: 'None yet — win a fight',
            hp_n: 'Health {a}/{b}', fight: 'Fight', give_up: 'Give up', no_traits: 'No special traits',
            give_up_title: 'Give up?', give_up_desc: 'The run will end. You keep your coins.',
            perk_title: 'Victory! Pick an upgrade', earned: '+{n} 🪙', double_coins: '×2 coins', healed: '+{n} health',
            lose_title: 'Knocked out', lose_desc: '{name} was stronger.', revive: 'Get up with 50% health', end_run: 'End run',
            run_end_title: 'Run over', run_win_title: 'You are the champion!', run_end_desc: 'Wins: {n} of 8 · Coins this run: {c}',
            run_win_desc: 'All 8 opponents beaten! Coins this run: {c}',
            stats: 'Counters: {c} · Perfect: {p}',
            exit_title: 'Give up?', exit_desc: 'You will lose this fight and the run will end.', exit_no: 'Keep fighting', exit_yes: 'Give up',
            contracts_title: 'Contracts', tab_fighters: 'Fighters', tab_trainers: 'Trainers',
            pull: '🎲 Random contract · 100 🪙', pull_free: '🎲 Random contract · free', pull_ad: '🎬 Free for a video', pull_wait: 'Free in {t}',
            rates: 'Odds: common 55%, rare 30%, epic 12%, legendary 3%. A legendary is guaranteed within 40 contracts ({n} left).',
            not_enough: 'Not enough coins — win fights', locked: 'Not signed', level_n: 'Lv. {n}', selected: 'Selected',
            pull_new: 'New contract!', pull_dup: 'Duplicate — level {n}!', pull_max: 'Max level — +40 🪙', great: 'Great',
            rar_c: 'Common', rar_r: 'Rare', rar_e: 'Epic', rar_l: 'Legendary',
            buy_for: 'Buy for {n} 🪙', upgrade_for: 'Upgrade to Lv. {l} · {n} 🪙', select_run: 'Use in runs', selected_run: '✓ Used in runs',
            close: 'Close', item_locked: 'Buy it now or get it from a random contract for 100 🪙.', item_max: 'Max level',
            item_next: 'Next level: {d}', bought: 'Contract signed!', upgraded: 'Level {n}!', setup_more: 'New fighters and trainers are in Contracts',
            txt_counter: 'COUNTER!', txt_perfect: 'PERFECT!', txt_block: 'BLOCK', txt_broken: 'GUARD BROKEN!', txt_trade: 'TRADE',
            txt_missed: 'HIT', txt_early: 'TOO EARLY!', txt_late: 'TOO LATE!', txt_guard: 'BLOCKED', txt_break: 'BROKE IT!', txt_tired: 'NO STAMINA', txt_ko: 'KNOCKOUT!',
            txt_fight: 'FIGHT!', txt_baited: 'TOOK THE BAIT!', txt_bluff: 'FEINT', txt_second: 'SECOND WIND!',
            tut_line1: 'He is winding up: {a}', tut_line2: 'Press {b}!', tut_wrong: 'Wrong button — press {b}',
            th_early: 'Punching early? Let\'s test that…', th_late: 'Waiting till the end? Sure.', th_block: 'Hiding again? Take this from below!',
            rotate: 'Rotate your phone to landscape',
            ad_unavailable: 'Ad unavailable or not finished — try later',
            f_rookie: 'Rookie', f_bald: 'Beard', f_ginger: 'Ginger', f_curly: 'Moustache', f_headgear: 'Cadet', f_veteran: 'Old Timer',
            f_topknot: 'Quiet One', f_mohawk: 'Punk', f_ponytail: 'Viking', f_cornrows: 'Cobra', f_blond: 'Dandy', f_mask: 'The Mask',
            t_misha: 'Uncle Misha', t_olya: 'Coach Olya', t_palych: 'Old Palych', t_gosha: 'Medic Gosha', t_sen: 'Master Sen', t_burya: 'Sergeant Storm',
            t_prof: 'The Professor', t_fedor: 'Iron Fyodor', t_rx9: 'Robot RX-9', t_zina: 'Granny Zina',
            p_tough: 'Tough', p_lungs: 'Lungs', p_heavy: 'Heavy hand', p_finisher: 'Finisher', p_medkit: 'Med kit', p_thrifty: 'Thrifty',
            p_ironguard: 'Iron guard', p_piggy: 'Piggy bank', p_sniper: 'Sniper', p_vampire: 'Vampire', p_chin: 'Iron chin',
            p_spikes: 'Spikes', p_foresight: 'Foresight', p_royal: 'Royal straight', p_breaker: 'Breaker hook', p_second: 'Second wind', p_ko: 'Knockout artist',
            tr_fast: 'Fast', tr_series: 'Combo man', tr_feint: 'Feinter', tr_guard: 'Turtle', tr_silent: 'Silent', tr_bluff: 'Bluffer', tr_heavy: 'Tank', tr_adaptive: 'Schemer',
            trd_fast: 'Shorter wind-ups', trd_series: 'Throws combos of 2–3 punches', trd_feint: 'Starts one punch and switches to another',
            trd_guard: 'Covers up tight — break it with an uppercut', trd_silent: 'The icon fades almost at once — remember it',
            trd_bluff: 'Fake wind-ups with a dashed ring — don\'t bite', trd_heavy: 'Lots of health, hits hard but slow',
            trd_adaptive: 'Learns your habits and adapts',
            fx_none: 'No special skills', fx_maxHp: '{s}{v} max health', fx_regen: '+{p}% stamina recovery', fx_coins: '+{p}% coins',
            fx_healAfter: '+{v} health after each fight', fx_perfectWide: '"Perfect" window {w}% wider', fx_perfectPower: '"Perfect" +{p}% damage',
            fx_blockCheap: 'Blocking costs {p}% less stamina', fx_costCheap: 'Punches cost {p}% less stamina', fx_foresight: 'Opponent wind-ups {p}% longer',
            fx_firstCounter: 'First counter in each fight ×{x}', fx_counterHeal: 'Each counter heals {v}', fx_counterDmg: 'Counters +{p}% damage',
            fx_comboPlus: '+{v} finishing punch', fx_dmgTaken: 'Hits taken −{p}% damage', fx_reflect: 'Hits on your guard hurt the opponent for {v}',
            fx_secondWind: 'Once per fight you stay up with 1 health', fx_straightAll: 'Straight beats both hook and uppercut but costs double stamina',
            fx_hookBreak: 'Hook also breaks a tight guard'
        }
    };

    // Текст эффекта: «+12 к здоровью», «Окно «Идеально» шире на 20%»
    function fxText(t, type, v) {
        const r = Math.round;
        const vars = {
            v: r(Math.abs(v)), s: v < 0 ? '−' : '+', p: r(v * 100), x: (1 + v).toFixed(1).replace('.0', ''),
            w: r(v / 0.3 * 100)
        };
        return t('fx_' + type, vars);
    }
    function describe(t, fx, lvl) {
        if (!fx || !fx.length) return t('fx_none');
        return fx.map(([type, v]) => fxText(t, type, lvlValue(v || 0, lvl))).join(' · ');
    }

    global.CPData = {
        EFFECTS, baseMods, applyFx, lvlValue, describe, RARITY,
        FIGHTERS, TRAINERS, PERKS, PERK_RAR_W, TRAITS, PALETTES, CHAMP_PALETTE, I18N
    };
})(window);

/* Значки ударов: одни и те же контуры для кнопок (SVG) и для значка над соперником (canvas Path2D).
   Сетка 24×24, линии со скруглёнными концами. Удар нарисован в сторону соперника (вправо). */
window.CPData.ICONS = {
    straight: 'M3.5 12H19.5 M14 6.5L19.5 12L14 17.5',
    hook: 'M4 18.5C4 10.5 9 7 15 7H19.5 M15.5 3L19.5 7L15.5 11',
    upper: 'M12 20.5V4.5 M6.5 10L12 4.5L17.5 10',
    block: 'M5 4.5H19V12L12 19.5L5 12Z',
    unknown: 'M8.5 8.5C8.5 6.3 10 4.8 12 4.8C14 4.8 15.5 6.2 15.5 8.2C15.5 11 12 11.3 12 14.2 M12 18.6V19'
};
window.CPData.iconSvg = function (name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="' +
        window.CPData.ICONS[name] + '"/></svg>';
};
