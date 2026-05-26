(function () {
  'use strict';

  const MONTHS = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];
  const WEEKDAYS = ['do', 'lu', 'ma', 'mi', 'ju', 'vi', 'sa'];
  const instances = new WeakMap();
  const activeInstances = new Set();
  let globalEventsBound = false;

  function parseIso(value) {
    const text = String(value || '').trim();
    if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const [year, month, day] = text.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  function toIso(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatDisplay(value) {
    const date = value instanceof Date ? value : parseIso(value);
    if (!date) return '';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${date.getFullYear()}`;
  }

  function firstOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function sameDate(a, b) {
    return a && b
      && a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  function createButton(className, label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  function dispatchInputEvents(input) {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function buildDaysGrid(instance) {
    const { elements, state } = instance;
    const container = elements.days;
    const activeMonth = state.viewDate.getMonth();
    const year = state.viewDate.getFullYear();
    const firstDay = new Date(year, activeMonth, 1).getDay();
    const lastDate = new Date(year, activeMonth + 1, 0).getDate();
    const prevLastDate = new Date(year, activeMonth, 0).getDate();
    const today = new Date();
    const selected = parseIso(instance.input.value);

    container.innerHTML = '';

    for (let i = firstDay; i > 0; i -= 1) {
      const day = document.createElement('div');
      day.className = 'pro-date-day is-other-month';
      day.textContent = String(prevLastDate - i + 1);
      container.appendChild(day);
    }

    for (let dateNumber = 1; dateNumber <= lastDate; dateNumber += 1) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pro-date-day';
      button.textContent = String(dateNumber);
      const dayDate = new Date(year, activeMonth, dateNumber);

      if (sameDate(dayDate, today)) button.classList.add('is-today');
      if (sameDate(dayDate, selected)) button.classList.add('is-selected');

      button.addEventListener('click', () => {
        instance.input.value = toIso(dayDate);
        state.viewDate = firstOfMonth(dayDate);
        sync(instance);
        close(instance);
        dispatchInputEvents(instance.input);
      });

      container.appendChild(button);
    }

    const totalBoxes = firstDay + lastDate;
    const nextDays = 42 - totalBoxes;
    for (let i = 1; i <= nextDays; i += 1) {
      const day = document.createElement('div');
      day.className = 'pro-date-day is-other-month';
      day.textContent = String(i);
      container.appendChild(day);
    }
  }

  function sync(instance) {
    const selected = parseIso(instance.input.value);
    if (selected) instance.state.viewDate = firstOfMonth(selected);

    instance.elements.display.textContent = selected ? formatDisplay(selected) : instance.placeholder;
    instance.elements.display.classList.toggle('is-placeholder', !selected);
    instance.elements.title.textContent = `${MONTHS[instance.state.viewDate.getMonth()]} ${instance.state.viewDate.getFullYear()}`;
    buildDaysGrid(instance);
  }

  function open(instance) {
    const selected = parseIso(instance.input.value);
    instance.state.viewDate = firstOfMonth(selected || new Date());
    sync(instance);
    instance.wrapper.classList.add('is-open');
  }

  function close(instance) {
    instance.wrapper.classList.remove('is-open');
  }

  function toggle(instance) {
    if (instance.wrapper.classList.contains('is-open')) close(instance);
    else open(instance);
  }

  function attach(input, options = {}) {
    if (!input) return null;
    if (instances.has(input)) {
      const existing = instances.get(input);
      existing.placeholder = options.placeholder || existing.placeholder;
      sync(existing);
      return existing.api;
    }

    const variant = options.variant || input.dataset.proDateVariant || 'field';
    const placeholder = options.placeholder || input.dataset.proDatePlaceholder || input.getAttribute('placeholder') || 'Seleccionar fecha';
    const wrapper = document.createElement('div');
    wrapper.className = `pro-date-picker pro-date-picker--${variant}`;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'pro-date-input';
    trigger.innerHTML = '<span class="pro-date-display"></span><span class="pro-date-chevron">&#9662;</span>';

    const panel = document.createElement('div');
    panel.className = 'pro-date-panel';
    panel.innerHTML = `
      <div class="pro-date-header">
        <div class="pro-date-title"></div>
        <div class="pro-date-nav"></div>
      </div>
      <div class="pro-date-weekdays">${WEEKDAYS.map((day) => `<div>${day}</div>`).join('')}</div>
      <div class="pro-date-days"></div>
      <div class="pro-date-footer"></div>
    `;

    wrapper.appendChild(trigger);
    wrapper.appendChild(panel);

    input.classList.add('pro-date-source');
    input.insertAdjacentElement('afterend', wrapper);

    const elements = {
      trigger,
      display: trigger.querySelector('.pro-date-display'),
      title: panel.querySelector('.pro-date-title'),
      days: panel.querySelector('.pro-date-days')
    };

    const nav = panel.querySelector('.pro-date-nav');
    nav.appendChild(createButton('pro-date-nav-btn', '<', () => {
      instance.state.viewDate.setMonth(instance.state.viewDate.getMonth() - 1);
      sync(instance);
    }));
    nav.appendChild(createButton('pro-date-nav-btn', '>', () => {
      instance.state.viewDate.setMonth(instance.state.viewDate.getMonth() + 1);
      sync(instance);
    }));

    const footer = panel.querySelector('.pro-date-footer');
    footer.appendChild(createButton('pro-date-footer-btn', 'Borrar', () => {
      input.value = '';
      sync(instance);
      dispatchInputEvents(input);
    }));
    footer.appendChild(createButton('pro-date-footer-btn', 'Hoy', () => {
      const today = new Date();
      input.value = toIso(today);
      instance.state.viewDate = firstOfMonth(today);
      sync(instance);
      close(instance);
      dispatchInputEvents(input);
    }));

    const instance = {
      input,
      wrapper,
      placeholder,
      elements,
      state: {
        viewDate: firstOfMonth(parseIso(input.value) || new Date())
      }
    };

    trigger.addEventListener('click', () => toggle(instance));
    input.addEventListener('change', () => sync(instance));
    input.addEventListener('input', () => sync(instance));

    const api = {
      open: () => open(instance),
      close: () => close(instance),
      sync: () => sync(instance),
      destroy: () => {
        close(instance);
        wrapper.remove();
        input.classList.remove('pro-date-source');
        instances.delete(input);
        activeInstances.delete(instance);
        delete input._proDatePicker;
      }
    };

    instance.api = api;
    instances.set(input, instance);
    activeInstances.add(instance);
    input._proDatePicker = api;
    bindGlobalEvents();
    sync(instance);
    return api;
  }

  function bindGlobalEvents() {
    if (globalEventsBound) return;
    globalEventsBound = true;

    document.addEventListener('mousedown', (event) => {
      activeInstances.forEach((instance) => {
        if (!instance.wrapper.isConnected || !instance.input.isConnected) {
          activeInstances.delete(instance);
          return;
        }
        if (!instance.wrapper.contains(event.target)) close(instance);
      });
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      activeInstances.forEach((instance) => close(instance));
    });
  }

  window.DatePickerPro = {
    attach
  };
})();
