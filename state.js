export const OFFER_AFTER_TURNS = 3;

export function newDesk(turns) {
    return {
        version: 1,
        enabled: false,
        auto: true,
        stage: 'idle',
        mission: null,
        completed: [],
        complicationOpen: false,
        history: [],
        sinceTurn: turns,
    };
}

export function storyTurns(chat) {
    let count = 0;
    let waitingForReply = false;
    for (const message of chat) {
        if (message.is_system || typeof message.mes !== 'string' || !message.mes.trim()) continue;
        if (message.is_user) {
            waitingForReply = true;
        } else if (waitingForReply) {
            count += 1;
            waitingForReply = false;
        }
    }
    return count;
}

export function remainingTurns(state, turns) {
    return Math.max(0, OFFER_AFTER_TURNS - Math.max(0, turns - state.sinceTurn));
}

export function pickMission(catalog, history, random = Math.random) {
    const used = new Set(history.map(entry => entry.id));
    let candidates = catalog.filter(mission => !used.has(mission.id));
    if (!candidates.length) candidates = catalog.filter(mission => mission.id !== history[0]?.id);
    const otherKinds = candidates.filter(mission => mission.kind !== history[0]?.kind);
    const pool = otherKinds.length ? otherKinds : candidates.length ? candidates : catalog;
    return pool[Math.floor(random() * pool.length)];
}

export function offerMission(state, mission) {
    state.stage = 'offer';
    state.mission = mission;
    state.completed = [];
    state.complicationOpen = false;
}

export function closeMission(state, status, turns) {
    const { id, title, kind } = state.mission;
    state.history = [{ id, title, kind, status }, ...state.history].slice(0, 24);
    state.stage = 'idle';
    state.mission = null;
    state.completed = [];
    state.complicationOpen = false;
    state.sinceTurn = turns;
}

export function parseMissionDraft(raw, id) {
    if (typeof raw !== 'string' || raw.length > 16000) throw new Error('Invalid mission response');
    const clean = raw.trim().replace(/^\x60\x60\x60(?:json)?\s*([\s\S]*?)\s*\x60\x60\x60$/i, '$1');
    const draft = JSON.parse(clean);
    const field = (value, max) => {
        if (typeof value !== 'string') throw new Error('Missing mission field');
        const text = value.replace(/\s+/g, ' ').trim();
        if (!text || text.length > max || /[{}<>]/.test(text)) throw new Error('Invalid mission field');
        return text;
    };
    if (!Array.isArray(draft?.objectives) || draft.objectives.length < 3 || draft.objectives.length > 4) {
        throw new Error('A mission needs three or four objectives');
    }
    const objectives = draft.objectives.map(value => field(value, 200));
    if (new Set(objectives.map(value => value.toLowerCase())).size !== objectives.length) throw new Error('Repeated objective');
    const risk = field(draft.risk, 30);
    if (!['Низкий', 'Средний', 'Высокий'].includes(risk)) throw new Error('Invalid risk label');
    return {
        id,
        title: field(draft.title, 80),
        kind: field(draft.kind, 45),
        risk,
        location: field(draft.location, 120),
        brief: field(draft.brief, 620),
        objectives,
        complication: field(draft.complication, 380),
        debrief: field(draft.debrief, 300),
    };
}

export function missionPrompt(state, turns) {
    if (!state.enabled) return '';
    const { mission, stage, completed } = state;
    if (!mission) {
        const last = state.history[0];
        if (!last || turns - state.sinceTurn > 1) return '';
        const result = {
            completed: 'закрыто игроком после разбора',
            declined: 'отклонено игроком',
            withdrawn: 'выезд прекращён по решению игрока',
        }[last.status];
        return `[Внеигровая запись журнала JJK. Дело «${last.title}» ${result}. Учитывай это, если оно всплывает в сцене. Продолжай обычную ролевую игру.]`;
    }
    const header = [
        '[Внеигровая запись журнала заданий JJK]',
        'Пункты журнала служат обстоятельствами сцены. Сохрани эпоху, канон аниме, знания персонажей и правила выбранного AU. Действия, мысли, слова и решения игрока оставляй игроку.',
        `Дело «${mission.title}» · ${mission.kind} · риск по первичной оценке: ${mission.risk}.`,
        `Район: ${mission.location}. Вводные: ${mission.brief}`,
    ];
    if (stage === 'offer') {
        return [...header,
            'Задание предложено, решение ещё открыто. Когда в текущей сцене есть естественный повод, пусть доступный по сценарию наставник, диспетчер, свидетель или иной уместный источник передаст зацепку. Если предложение уже прозвучало, продолжи разговор с этой точки. Сохрани текущий кадр и оставь игроку право отказаться или уточнить детали.',
        ].join('\n');
    }
    const checklist = mission.objectives.map((objective, index) =>
        `${index + 1}. ${completed.includes(index) ? '[отмечено]' : '[открыто]'} ${objective}`);
    const guidance = stage === 'report'
        ? `Игрок запросил разбор. При ближайшей естественной возможности дай в сцене короткую обратную связь от подходящего персонажа или через отчёт. Опираться на сыгранные факты. Ориентир разбора: ${mission.debrief}`
        : 'Задание принято. Продвигай ближайший уместный этап через доступные действия мира и NPC. Открытые пункты требуют игры. Отмеченные пункты считай пройденными, детали бери из уже сыгранного. Оставляй место для повседневных сцен и диалогов.';
    return [...header, ...checklist,
        ...(state.complicationOpen ? [`Осложнение открыто игроком: ${mission.complication} Вводи его через признаки или последствия, когда оно уместно.`] : []),
        guidance,
        'Ответь только следующим ролевым постом на русском. Внутриигровой отчёт остаётся частью сцены.',
    ].join('\n');
}
