/* 할 일 앱 — 빌드 도구 없이 동작하는 순수 JavaScript.
 * file:// 로 열어도 동작하도록 ES 모듈 대신 일반 스크립트(IIFE)로 작성했습니다. */
(function () {
  'use strict';

  var STORAGE_KEY = 'todo-app.v1';
  var MAX_LENGTH = 200;
  var TOAST_MS = 5000;

  // ---------- DOM ----------
  function $(id) { return document.getElementById(id); }
  var form = $('new-todo-form');
  var input = $('new-todo');
  var list = $('todo-list');
  var template = $('todo-template');
  var emptyEl = $('empty');
  var footer = $('footer');
  var countEl = $('count');
  var clearBtn = $('clear-completed');
  var toggleAllBtn = $('toggle-all');
  var progressEl = $('progress');
  var progressText = $('progress-text');
  var progressBar = $('progress-bar');
  var progressFill = $('progress-fill');
  var toast = $('toast');
  var toastMsg = $('toast-message');
  var toastUndo = $('toast-undo');
  var filterLinks = document.querySelectorAll('[data-filter]');

  // ---------- 상태 ----------
  var state = {
    todos: load(),
    filter: filterFromHash(),
    editingId: null
  };
  var pendingUndo = null;   // { items: [{ index, todo }] }
  var toastTimer = null;
  var storageWarned = false;
  var nodes = new Map();    // todo id -> <li>

  // ---------- 저장소 ----------
  function load() {
    try {
      var data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(data) ? data.filter(isValidTodo) : [];
    } catch (e) {
      return [];
    }
  }

  function isValidTodo(t) {
    return t !== null && typeof t === 'object' &&
      typeof t.id === 'string' &&
      typeof t.title === 'string' && t.title.length > 0 &&
      typeof t.completed === 'boolean';
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.todos));
    } catch (e) {
      if (!storageWarned) {
        storageWarned = true;
        showToast('브라우저 저장소를 쓸 수 없어 새로고침하면 목록이 사라져요.', false);
      }
    }
  }

  function commit() {
    save();
    render();
  }

  // ---------- 동작 ----------
  function createId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (e) { /* 보안 컨텍스트가 아니면 아래 방식 사용 */ }
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function normalize(text) {
    return String(text).replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH);
  }

  function find(id) {
    for (var i = 0; i < state.todos.length; i++) {
      if (state.todos[i].id === id) return state.todos[i];
    }
    return null;
  }

  function addTodo(text) {
    var title = normalize(text);
    if (!title) return false;
    state.todos.push({ id: createId(), title: title, completed: false, createdAt: Date.now() });
    // '완료' 보기에서는 새 항목이 안 보이므로 전체 보기로 전환
    if (state.filter === 'completed') setFilterHash('all');
    commit();
    return true;
  }

  function setCompleted(id, completed) {
    var todo = find(id);
    if (!todo) return;
    todo.completed = completed;
    commit();
  }

  function toggleAll() {
    var allDone = state.todos.length > 0 && state.todos.every(function (t) { return t.completed; });
    state.todos.forEach(function (t) { t.completed = !allDone; });
    commit();
  }

  function removeWhere(predicate, message) {
    var removed = [];
    var kept = [];
    state.todos.forEach(function (todo, index) {
      if (predicate(todo)) removed.push({ index: index, todo: todo });
      else kept.push(todo);
    });
    if (!removed.length) return;

    state.todos = kept;
    if (state.editingId && removed.some(function (r) { return r.todo.id === state.editingId; })) {
      state.editingId = null;
    }
    commit();
    pendingUndo = { items: removed };
    showToast(message(removed.length), true);
  }

  function removeTodo(id) {
    removeWhere(function (t) { return t.id === id; }, function () { return '할 일을 삭제했어요'; });
  }

  function clearCompleted() {
    removeWhere(function (t) { return t.completed; }, function (n) { return '완료 항목 ' + n + '개를 삭제했어요'; });
  }

  function undoRemove() {
    if (!pendingUndo) return;
    var items = pendingUndo.items.slice().sort(function (a, b) { return a.index - b.index; });
    items.forEach(function (entry) {
      if (find(entry.todo.id)) return; // 다른 탭 등에서 이미 복원된 경우
      state.todos.splice(Math.min(entry.index, state.todos.length), 0, entry.todo);
    });
    hideToast();
    commit();
  }

  // ---------- 수정 모드 ----------
  function startEdit(id) {
    if (state.editingId && state.editingId !== id) finishEdit(true, false);
    var todo = find(id);
    if (!todo) return;

    state.editingId = id;
    render();

    var li = nodes.get(id);
    if (!li) return;
    var edit = li.querySelector('.edit');
    edit.value = todo.title;
    edit.focus();
    edit.setSelectionRange(edit.value.length, edit.value.length);
  }

  function finishEdit(shouldSave, refocus) {
    var id = state.editingId;
    if (!id) return;
    var li = nodes.get(id);
    var value = li ? li.querySelector('.edit').value : '';
    state.editingId = null; // focusout 등으로 다시 호출돼도 한 번만 처리

    if (shouldSave) {
      var title = normalize(value);
      if (!title) { // 내용을 모두 지우면 삭제 (실행 취소 가능)
        removeTodo(id);
        return;
      }
      var todo = find(id);
      if (todo) todo.title = title;
    }
    commit();

    if (refocus && li && li.isConnected) li.querySelector('.edit-button').focus();
  }

  // ---------- 필터 ----------
  function filterFromHash() {
    var name = location.hash.replace(/^#\/?/, '');
    return name === 'active' || name === 'completed' ? name : 'all';
  }

  function setFilterHash(filter) {
    state.filter = filter;
    location.hash = filter === 'all' ? '#/' : '#/' + filter;
  }

  function matchesFilter(todo) {
    if (state.filter === 'active') return !todo.completed;
    if (state.filter === 'completed') return todo.completed;
    return true;
  }

  // ---------- 렌더링 ----------
  function render() {
    var todos = state.todos;
    var total = todos.length;
    var done = todos.filter(function (t) { return t.completed; }).length;
    var left = total - done;
    var visible = todos.filter(matchesFilter);

    var focusIndex = focusedItemIndex();
    renderList(visible);
    if (focusIndex > -1 && !list.contains(document.activeElement)) restoreFocus(focusIndex);

    list.hidden = visible.length === 0;
    emptyEl.hidden = visible.length > 0;
    emptyEl.textContent = emptyMessage(total);

    // 진행률
    progressEl.hidden = total === 0;
    var pct = total ? Math.round((done / total) * 100) : 0;
    progressText.textContent = done + ' / ' + total + ' 완료';
    progressFill.style.width = pct + '%';
    progressBar.setAttribute('aria-valuenow', String(pct));

    // 모두 완료 토글
    var allDone = total > 0 && left === 0;
    var toggleLabel = allDone ? '모두 미완료로 표시' : '모두 완료로 표시';
    toggleAllBtn.classList.toggle('is-hidden', total === 0);
    toggleAllBtn.disabled = total === 0;
    toggleAllBtn.setAttribute('aria-pressed', String(allDone));
    toggleAllBtn.setAttribute('aria-label', toggleLabel);
    toggleAllBtn.title = toggleLabel;

    // 하단
    footer.hidden = total === 0;
    countEl.textContent = left === 0 ? '모두 완료했어요' : '남은 할 일 ' + left + '개';
    clearBtn.classList.toggle('is-hidden', done === 0);
    clearBtn.disabled = done === 0;
    filterLinks.forEach(function (a) {
      var selected = a.getAttribute('data-filter') === state.filter;
      a.classList.toggle('selected', selected);
      if (selected) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function emptyMessage(total) {
    if (total === 0) return '할 일이 없어요. 위 입력창에 첫 할 일을 적어 보세요.';
    if (state.filter === 'active') return '진행 중인 할 일이 없어요. 수고했어요!';
    if (state.filter === 'completed') return '아직 완료한 할 일이 없어요.';
    return '';
  }

  // id 기준으로 기존 <li>를 재사용해 체크박스 포커스 등을 유지합니다.
  function renderList(visible) {
    var seen = new Set();
    visible.forEach(function (todo, i) {
      var li = nodes.get(todo.id);
      if (!li) {
        li = template.content.firstElementChild.cloneNode(true);
        li.dataset.id = todo.id;
        nodes.set(todo.id, li);
      }
      updateItem(li, todo);
      seen.add(todo.id);
      var current = list.children[i];
      if (current !== li) list.insertBefore(li, current || null);
    });
    nodes.forEach(function (li, id) {
      if (!seen.has(id)) {
        li.remove();
        nodes.delete(id);
      }
    });
  }

  function updateItem(li, todo) {
    var editing = state.editingId === todo.id;
    li.classList.toggle('completed', todo.completed);
    li.classList.toggle('editing', editing);

    var toggle = li.querySelector('.toggle');
    toggle.checked = todo.completed;
    toggle.setAttribute('aria-label', todo.title);

    var title = li.querySelector('.title');
    if (title.textContent !== todo.title) title.textContent = todo.title;
    title.hidden = editing;

    li.querySelector('.edit').hidden = !editing;
    li.querySelector('.actions').hidden = editing;
    li.querySelector('.edit-button').setAttribute('aria-label', '“' + todo.title + '” 수정');
    li.querySelector('.delete-button').setAttribute('aria-label', '“' + todo.title + '” 삭제');
  }

  function focusedItemIndex() {
    var el = document.activeElement;
    if (!el || !list.contains(el)) return -1;
    var li = el.closest('.todo-item');
    return li ? Array.prototype.indexOf.call(list.children, li) : -1;
  }

  // 포커스된 항목이 사라지면(삭제·필터) 같은 위치의 항목으로 포커스를 옮깁니다.
  function restoreFocus(index) {
    var items = list.children;
    if (!items.length) { input.focus(); return; }
    items[Math.min(index, items.length - 1)].querySelector('.toggle').focus();
  }

  // ---------- 토스트 ----------
  function showToast(message, withUndo) {
    if (!withUndo) pendingUndo = null;
    toastMsg.textContent = message;
    toastUndo.hidden = !withUndo;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, TOAST_MS);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    toast.hidden = true;
    pendingUndo = null;
  }

  // ---------- 이벤트 ----------
  function idOf(el) {
    var li = el.closest('.todo-item');
    return li ? li.dataset.id : null;
  }

  // 한글 입력(IME) 조합 중 Enter는 무시해야 마지막 글자가 중복 입력되지 않습니다.
  function isComposing(e) {
    return e.isComposing || e.keyCode === 229;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    addTodo(input.value);
    input.value = '';
    input.focus();
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !isComposing(e)) input.value = '';
  });

  toggleAllBtn.addEventListener('click', toggleAll);
  clearBtn.addEventListener('click', clearCompleted);
  toastUndo.addEventListener('click', undoRemove);

  list.addEventListener('change', function (e) {
    if (e.target.classList.contains('toggle')) setCompleted(idOf(e.target), e.target.checked);
  });

  list.addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn || !list.contains(btn)) return;
    var id = idOf(btn);
    if (btn.classList.contains('delete-button')) removeTodo(id);
    else if (btn.classList.contains('edit-button')) startEdit(id);
  });

  list.addEventListener('dblclick', function (e) {
    if (e.target.classList && e.target.classList.contains('title')) startEdit(idOf(e.target));
  });

  list.addEventListener('keydown', function (e) {
    if (!e.target.classList.contains('edit') || isComposing(e)) return;
    if (e.key === 'Enter') { e.preventDefault(); finishEdit(true, true); }
    else if (e.key === 'Escape') { e.preventDefault(); finishEdit(false, true); }
  });

  list.addEventListener('focusout', function (e) {
    if (e.target.classList.contains('edit')) finishEdit(true, false);
  });

  // Ctrl/Cmd+Z: 방금 삭제한 항목 되살리기 (글자를 입력 중인 칸에서는 기본 실행 취소 유지)
  document.addEventListener('keydown', function (e) {
    if (!pendingUndo) return;
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || String(e.key).toLowerCase() !== 'z') return;
    var t = e.target;
    if (t && t.tagName === 'INPUT' && t.type === 'text' && t.value) return;
    e.preventDefault();
    undoRemove();
  });

  window.addEventListener('hashchange', function () {
    state.filter = filterFromHash();
    render();
  });

  // 다른 탭에서 바뀐 내용 반영
  window.addEventListener('storage', function (e) {
    if (e.key !== STORAGE_KEY) return;
    state.todos = load();
    if (state.editingId && !find(state.editingId)) state.editingId = null;
    render();
  });

  // ---------- 시작 ----------
  try {
    $('today').textContent = new Intl.DateTimeFormat('ko-KR', {
      month: 'long', day: 'numeric', weekday: 'long'
    }).format(new Date());
  } catch (e) { /* 날짜 표시는 선택 사항 */ }

  render();
})();
