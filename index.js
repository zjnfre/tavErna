import { missions } from './missions.js';
import { renderDesk } from './view.js';
import {
    newDesk, storyTurns, remainingTurns, pickMission,
    offerMission, closeMission, parseMissionDraft, missionPrompt,
} from './state.js';

const KEY = 'jjk_mission_desk';
const ROLEPLAY_TYPES = new Set(['normal', 'continue', 'swipe', 'regenerate']);
let dialog;
let content;
let launcher;
let badge;
let notice = '';
let pendingDraft;
let suppressPrompt = false;
let generationType = null;

function current() {
    const ctx = globalThis.SillyTavern?.getContext();
    const id = ctx?.chatId ?? ctx?.getCurrentChatId?.();
    const available = id != null && id !== '' && Boolean(ctx?.chatMetadata);
    const turns = available ? storyTurns(ctx.chat ?? []) : 0;
    const saved = available ? ctx.chatMetadata[KEY] : null;
    const state = saved?.version === 1 ? saved : newDesk(turns);
    return { ctx, id, available, turns, state };
}

function sameChat(a, b) {
    return a.available && b.available && a.id === b.id && a.ctx.chatMetadata === b.ctx.chatMetadata;
}

function synchronizePrompt(session = current()) {
    const { ctx, available, state, turns } = session;
    if (!ctx?.setExtensionPrompt) return;
    const text = available && !suppressPrompt ? missionPrompt(state, turns) : '';
    // IN_CHAT, depth 0, excluded from World Info scanning, system role.
    ctx.setExtensionPrompt(KEY, text, 1, 0, false, 0, () => {
        const live = current();
        return !suppressPrompt && sameChat(session, live) && live.state.enabled;
    });
}

function refresh(session = current()) {
    const { state, available, turns } = session;
    const labels = { offer: '!', report: '✓' };
    const status = available && state.enabled
        ? labels[state.stage] ?? (state.stage === 'active' ? `${state.completed.length}/${state.mission.objectives.length}` : '')
        : '';
    if (badge) {
        badge.textContent = status;
        badge.hidden = !status;
    }
    if (launcher) {
        launcher.dataset.stage = status ? state.stage : 'idle';
        launcher.title = state.enabled && state.stage === 'offer' ? 'Журнал заданий · есть новое дело' : 'Журнал заданий · Магическая битва';
        launcher.setAttribute('aria-label', launcher.title);
    }
    if (!dialog?.open) return;
    renderDesk(content, {
        ...state, available, remaining: remainingTurns(state, turns), notice,
        creating: Boolean(pendingDraft && sameChat(pendingDraft, session)),
    }, actions);
}

function update(change, message = '') {
    const session = current();
    if (!session.available) return false;
    const next = structuredClone(session.state);
    if (change(next, session.turns) === false) return false;
    session.ctx.chatMetadata[KEY] = next;
    notice = message;
    const latest = { ...session, state: next };
    synchronizePrompt(latest);
    refresh(latest);
    Promise.resolve(session.ctx.saveMetadata()).catch(error => {
        console.error('[JJK Mission Desk] Saving chat metadata failed', error);
        if (sameChat(session, current())) {
            notice = 'Сохранение в чат не подтвердилось. Проверь подключение к SillyTavern.';
            refresh();
        }
    });
    return true;
}

function offerFromCatalog(state) {
    if (!state.enabled || state.stage !== 'idle') return false;
    offerMission(state, pickMission(missions, state.history));
}

async function offerFromScene() {
    const session = current();
    if (!session.available || !session.state.enabled || session.state.stage !== 'idle') return;
    if (pendingDraft || document.body.dataset.generating === 'true') {
        notice = 'Дождись конца текущей генерации и попробуй снова.';
        refresh();
        return;
    }
    if (typeof session.ctx.generateQuietPrompt !== 'function') {
        notice = 'В этой версии SillyTavern доступна выдача заданий из каталога.';
        refresh();
        return;
    }
    pendingDraft = session;
    notice = 'Gemini готовит зацепку по текущей сцене…';
    refresh();
    try {
        const recent = session.state.history.slice(0, 5).map(item => item.title).join(' · ');
        const raw = await session.ctx.generateQuietPrompt({
            quietPrompt: [
                'Составь одну новую карточку квеста для текущей русскоязычной ролевой по аниме «Магическая битва». Это внеигровая подготовка. Ответ строго один JSON-объект.',
                'Исходи из текущей эпохи, места, уже сыгранных событий и активного лора. Привяжи квест к конкретной незакрытой зацепке либо добавь правдоподобный бытовой или служебный повод рядом. Допустимы выезд, опрос, исследование, учёба, эвакуация, охрана, работа с вещдоками и тихие миссии. Сохрани право героини решать, принимать ли задание и как действовать. Исход остаётся открытым. Новые NPC и места допустимы там, где согласуются с миром. Используй только доступные по эпохе сведения аниме.',
                'Поля JSON: title, kind, risk, location, brief, objectives, complication, debrief. Все значения на русском, objectives — массив из 3–4 разных проверяемых этапов. risk — «Низкий», «Средний» или «Высокий». В brief изложи только стартовые вводные. complication — одна скрытая условная помеха для показа после прогресса. debrief — краткая тема для разбора по реально сыгранным событиям. Пиши короткими фразами, без Markdown и HTML.',
                recent ? `Недавние дела для ориентира: ${recent}. Придумай другую зацепку.` : '',
            ].filter(Boolean).join('\n'),
            responseLength: 1800,
        });
        const live = current();
        if (!sameChat(session, live) || !live.state.enabled || live.state.stage !== 'idle') return;
        const id = `scene-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
        const mission = parseMissionDraft(raw, id);
        update(state => offerMission(state, mission), 'Дело по текущей сцене готово. Его можно принять или отклонить.');
    } catch (error) {
        console.warn('[JJK Mission Desk] Scene assignment failed', error);
        if (sameChat(session, current())) notice = 'Модель не вернула карточку в нужном формате. Можно повторить или взять дело из каталога.';
    } finally {
        pendingDraft = null;
        refresh();
    }
}

const actions = {
    close: () => dialog.close(),
    enable: () => update((state, turns) => {
        if (state.enabled) return false;
        state.enabled = true;
        state.sinceTurn = turns;
    }, 'Журнал включён для этого чата.'),
    disable: () => update(state => {
        if (!state.enabled) return false;
        state.enabled = false;
    }, 'Журнал приостановлен. Дела и отметки сохранены.'),
    toggleAuto: () => update((state, turns) => {
        if (!state.enabled) return false;
        state.auto = !state.auto;
        state.sinceTurn = turns;
    }),
    offer: () => update(offerFromCatalog, 'В журнал поступило дело.'),
    offerFromScene,
    accept: () => update(state => {
        if (!state.enabled || state.stage !== 'offer') return false;
        state.stage = 'active';
    }, 'Дело принято. Сыграй следующий этап и отметь, когда он выполнен.'),
    decline: () => update((state, turns) => {
        if (!state.enabled || state.stage !== 'offer') return false;
        closeMission(state, 'declined', turns);
    }, 'Предложение отклонено.'),
    toggleObjective: index => update(state => {
        if (!state.enabled || state.stage !== 'active' || !Number.isInteger(index) || index < 0 || index >= state.mission.objectives.length) return false;
        state.completed = state.completed.includes(index)
            ? state.completed.filter(value => value !== index)
            : [...state.completed, index];
    }),
    openComplication: () => update(state => {
        if (!state.enabled || state.stage !== 'active' || !state.completed.length || state.complicationOpen) return false;
        state.complicationOpen = true;
    }, 'Осложнение готово войти в следующую подходящую сцену.'),
    requestReport: () => update(state => {
        if (!state.enabled || state.stage !== 'active' || state.completed.length !== state.mission.objectives.length) return false;
        state.stage = 'report';
    }, 'Журнал передаст запрос на разбор в следующий ролевой ответ.'),
    complete: () => update((state, turns) => {
        if (!state.enabled || state.stage !== 'report') return false;
        closeMission(state, 'completed', turns);
    }, 'Дело закрыто и перенесено в архив.'),
    withdraw: () => update((state, turns) => {
        if (!state.enabled || !['active', 'report'].includes(state.stage)) return false;
        closeMission(state, 'withdrawn', turns);
    }, 'Выезд остановлен и отмечен в архиве.'),
};

function onStoryChange() {
    const session = current();
    const { state, turns } = session;
    if (session.available && state.enabled && state.stage === 'idle') {
        if (turns < state.sinceTurn) {
            update(next => { next.sinceTurn = turns; });
            return;
        }
        if (state.auto && !pendingDraft && remainingTurns(state, turns) === 0) {
            if (update(offerFromCatalog, 'Диспетчерская прислала новое дело.')) {
                globalThis.toastr?.info('В журнале заданий появилось новое дело.', 'Магическая битва');
            }
            return;
        }
    }
    synchronizePrompt(session);
    refresh(session);
}

function mount() {
    if (launcher) return;
    const context = globalThis.SillyTavern?.getContext();
    const toolbar = document.querySelector('#leftSendForm') ?? document.querySelector('#extensionsMenu');
    if (!toolbar || !context?.eventSource) return;

    launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'jjk-mission-launcher';
    launcher.setAttribute('aria-haspopup', 'dialog');
    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-clipboard-list';
    icon.setAttribute('aria-hidden', 'true');
    badge = document.createElement('span');
    badge.className = 'jjk-mission-launcher-badge';
    launcher.append(icon, badge);
    toolbar.append(launcher);

    dialog = document.createElement('dialog');
    dialog.className = 'jjk-mission-dialog';
    dialog.setAttribute('aria-labelledby', 'jjk-desk-title');
    content = document.createElement('div');
    dialog.append(content);
    document.body.append(dialog);
    launcher.addEventListener('click', event => {
        event.preventDefault();
        if (!dialog.open) {
            dialog.showModal();
            refresh();
            dialog.querySelector('button')?.focus();
        }
    });
    dialog.addEventListener('close', () => launcher.focus());

    const { eventSource, eventTypes } = context;
    eventSource.on(eventTypes.CHAT_CHANGED, () => {
        notice = '';
        generationType = null;
        suppressPrompt = false;
        synchronizePrompt();
        refresh();
    });
    eventSource.on(eventTypes.GENERATION_AFTER_COMMANDS, (type, _options, dryRun) => {
        if (dryRun) return;
        generationType = type ?? 'normal';
        suppressPrompt = !ROLEPLAY_TYPES.has(generationType);
        synchronizePrompt();
    });
    eventSource.on(eventTypes.GENERATION_ENDED, () => {
        generationType = null;
        suppressPrompt = false;
        onStoryChange();
    });
    eventSource.on(eventTypes.MESSAGE_DELETED, () => {
        // Regeneration briefly removes the reply and then replaces the same turn.
        if (generationType !== 'regenerate') onStoryChange();
    });
    synchronizePrompt();
    refresh();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
    mount();
}

const app = globalThis.SillyTavern?.getContext();
if (app?.eventTypes.APP_INITIALIZED) {
    app.eventSource.on(app.eventTypes.APP_INITIALIZED, mount);
}
