const stageLabels = {
    idle: 'На связи',
    offer: 'Новое дело',
    active: 'В работе',
    report: 'На разборе',
};

const historyLabels = {
    completed: 'Закрыто',
    declined: 'Отклонено',
    withdrawn: 'Прервано',
};

function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function button(text, key, action, { primary = false, danger = false, disabled = false } = {}) {
    const element = node('button', 'jjk-desk-btn', text);
    element.type = 'button';
    element.dataset.jjkFocus = key;
    element.classList.toggle('is-primary', primary);
    element.classList.toggle('is-danger', danger);
    element.disabled = disabled;
    element.addEventListener('click', action);
    return element;
}

function callout(label, description, variant = '') {
    const box = node('div', `jjk-desk-box ${variant}`.trim());
    box.append(node('p', 'jjk-desk-label', label), node('p', '', description));
    return box;
}

function renderHeader(actions) {
    const header = node('header', 'jjk-desk-header');
    const close = button('×', 'close', actions.close);
    close.classList.add('jjk-desk-close');
    close.setAttribute('aria-label', 'Закрыть журнал заданий');
    close.title = 'Закрыть';
    const title = node('h2', 'jjk-desk-title', 'Журнал заданий');
    title.id = 'jjk-desk-title';
    header.append(
        node('p', 'jjk-desk-kicker', 'Полевой журнал · Магическая битва'),
        title,
        node('p', 'jjk-desk-subtitle', 'Задания для текущей ролевой'),
        close,
    );
    return header;
}

function renderControlLine(state, actions) {
    const line = node('div', 'jjk-desk-phase-line');
    const stage = state.enabled ? state.stage : 'idle';
    const label = state.enabled ? stageLabels[stage] : 'Журнал на паузе';
    line.append(node('span', `jjk-desk-phase is-${stage}`, label));

    if (state.available && state.enabled) {
        const settings = node('div', 'jjk-desk-settings');
        const auto = button('Автовыдача', 'auto', actions.toggleAuto);
        auto.setAttribute('aria-pressed', String(state.auto));
        auto.title = 'После трёх новых ходов без открытого дела появляется готовое задание';
        const pause = button('Пауза', 'pause', actions.disable);
        pause.title = 'Приостановить журнал в этом чате';
        settings.append(auto, pause);
        line.append(settings);
    }

    return line;
}

function renderIdle(state, actions) {
    const content = document.createDocumentFragment();
    if (!state.available) {
        content.append(callout('Выбери чат', 'Открой свою ролевую в SillyTavern, чтобы журнал мог хранить задания именно для неё.'));
        return content;
    }

    const controls = node('div', 'jjk-desk-actions');
    if (!state.enabled) {
        content.append(callout('Журнал на паузе', 'Включи журнал, чтобы получать задания и передавать ход дела в ролевую.'));
        controls.append(button('Включить в этом чате', 'enable', actions.enable, { primary: true }));
    } else {
        const title = state.creating ? 'Готовится выезд' : 'Свободное окно';
        let description = 'Открой готовое дело или запроси задание, связанное с последними событиями ролевой.';
        if (state.creating) description = 'Gemini готовит задание по текущей сцене.';
        else if (state.auto && state.remaining > 0) {
            const turns = state.remaining === 1 ? 'ход' : 'хода';
            description = `Следующее дело появится автоматически через ${state.remaining} ${turns}.`;
        }
        content.append(callout(title, description));
        controls.append(button('Готовое дело', 'offer', actions.offer, { primary: true, disabled: state.creating }));
        if (actions.offerFromScene) {
            const fromScene = button('Из текущей сцены', 'from-scene', actions.offerFromScene, { disabled: state.creating });
            fromScene.title = 'Один запрос к подключённой модели';
            controls.append(fromScene);
        }
    }

    content.append(controls);
    return content;
}

function renderMissionHeading(mission) {
    const missionHeader = node('section', 'jjk-desk-mission');
    const tags = node('div', 'jjk-desk-tags');
    for (const label of [mission.kind, mission.risk]) {
        if (label) tags.append(node('span', 'jjk-desk-tag', label));
    }
    const location = node('p', 'jjk-desk-location', mission.location);
    missionHeader.append(tags, node('h3', 'jjk-desk-mission-title', mission.title), location);
    missionHeader.append(node('p', 'jjk-desk-brief', mission.brief));
    return missionHeader;
}

function renderObjectives(state, actions) {
    const progress = node('section', 'jjk-desk-progress');
    const heading = node('div', 'jjk-desk-progress-head');
    const list = node('ol', 'jjk-desk-objectives');
    const { objectives } = state.mission;
    const completed = objectives.filter((_, index) => state.completed.includes(index)).length;
    const editable = state.stage === 'active';
    const showProgress = state.stage !== 'offer';
    heading.append(node('p', 'jjk-desk-label', 'Этапы дела'));

    if (showProgress) {
        heading.append(node('span', 'jjk-desk-progress-count', `${completed} / ${objectives.length}`));
    }
    progress.append(heading);

    if (showProgress && objectives.length) {
        const meter = node('progress', 'jjk-desk-meter');
        meter.max = objectives.length;
        meter.value = completed;
        meter.setAttribute('aria-label', 'Выполненные этапы');
        progress.append(meter);
    }

    objectives.forEach((objective, index) => {
        const row = node('li');
        const done = state.completed.includes(index);
        const control = node(editable ? 'label' : 'div', 'jjk-desk-objective');
        control.classList.toggle('is-done', done);
        if (editable) {
            const checkbox = node('input');
            checkbox.type = 'checkbox';
            checkbox.checked = done;
            checkbox.dataset.jjkFocus = `objective-${index}`;
            checkbox.addEventListener('change', () => actions.toggleObjective(index));
            control.append(checkbox);
        } else {
            const status = node('span', 'jjk-desk-objective-num', done ? '✓' : String(index + 1).padStart(2, '0'));
            if (done) status.setAttribute('aria-label', 'Выполнено');
            control.append(status);
        }
        control.append(node('span', '', objective));
        row.append(control);
        list.append(row);
    });

    progress.append(list);
    return progress;
}

function renderMission(state, actions) {
    const content = document.createDocumentFragment();
    const controls = node('div', 'jjk-desk-actions');
    content.append(renderMissionHeading(state.mission), renderObjectives(state, actions));

    if (state.stage === 'offer') {
        controls.append(
            button('Принять дело', 'accept', actions.accept, { primary: true }),
            button('Пропустить', 'decline', actions.decline),
        );
    } else {
        if (state.complicationOpen && state.mission.complication) {
            content.append(callout('Осложнение', state.mission.complication, 'is-complication'));
        }
        if (state.stage === 'active') {
            const allDone = state.mission.objectives.length > 0 && state.mission.objectives.every((_, index) => state.completed.includes(index));
            if (!state.complicationOpen && state.mission.complication && state.completed.length > 0) {
                controls.append(button('Открыть осложнение', 'complication', actions.openComplication));
            }
            controls.append(
                button('Передать на разбор', 'report', actions.requestReport, { primary: true, disabled: !allDone }),
                button('Прервать дело', 'withdraw', actions.withdraw, { danger: true }),
            );
        } else {
            content.append(callout('Разбор выезда', state.mission.debrief, 'is-report'));
            content.append(node('p', 'jjk-desk-note', 'Следующий ответ Gemini подхватит разбор. После него можно закрыть дело.'));
            controls.append(
                button('Закрыть дело', 'complete', actions.complete, { primary: true }),
                button('Прервать дело', 'withdraw', actions.withdraw, { danger: true }),
            );
        }
    }

    content.append(controls);
    return content;
}

function renderHistory(history, open) {
    const details = node('details', 'jjk-desk-history');
    details.open = open;
    const summary = node('summary', '', `Архив · ${history.length}`);
    summary.dataset.jjkFocus = 'archive';
    details.append(summary);

    if (!history.length) {
        details.append(node('p', 'jjk-desk-history-list jjk-desk-note', 'Здесь появятся завершённые и пропущенные дела.'));
        return details;
    }

    const list = node('ol', 'jjk-desk-history-list');
    for (const record of history) {
        const item = node('li', 'jjk-desk-history-item');
        item.append(node('span', 'jjk-desk-meta', historyLabels[record.status]), node('span', '', record.title));
        list.append(item);
    }
    details.append(list);
    return details;
}

export function renderDesk(container, state, actions) {
    const focusKey = container.contains(document.activeElement) ? document.activeElement.dataset.jjkFocus : null;
    const archiveOpen = container.querySelector('.jjk-desk-history')?.open ?? false;
    const panel = node('div', 'jjk-mission-desk');
    const body = node('div', 'jjk-desk-body');
    const notice = node('p', 'jjk-desk-notice', state.notice || '');
    notice.setAttribute('role', 'status');

    body.append(renderControlLine(state, actions), notice);
    if (state.available && state.enabled && state.stage !== 'idle' && state.mission) {
        body.append(renderMission(state, actions));
    } else {
        body.append(renderIdle(state, actions));
    }

    panel.append(renderHeader(actions), body);
    if (state.available) panel.append(renderHistory(state.history, archiveOpen));
    panel.append(node('footer', 'jjk-desk-footer', 'Принятое дело и отмеченные этапы учитываются в следующем ответе Gemini.'));
    container.replaceChildren(panel);

    if (focusKey) {
        const sameControl = [...panel.querySelectorAll('[data-jjk-focus]')].find(element => element.dataset.jjkFocus === focusKey && !element.disabled);
        const nextControl = sameControl ?? panel.querySelector('.is-primary:not(:disabled)') ?? panel.querySelector('.jjk-desk-close');
        nextControl?.focus({ preventScroll: true });
    }
}
