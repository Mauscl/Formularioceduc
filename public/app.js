const questionForm = document.getElementById('question-form');
const addOptionButton = document.getElementById('add-option');
const cancelEditButton = document.getElementById('cancel-edit-btn');
const saveQuestionButton = document.getElementById('save-question-btn');
const optionsList = document.getElementById('options-list');
const surveyForm = document.getElementById('survey-form');
const questionsContainer = document.getElementById('questions-container');
const adminQuestionsList = document.getElementById('admin-questions-list');
const rankingContainer = document.getElementById('ranking-table-container');
const thankYouBox = document.getElementById('thank-you');
const exportButton = document.getElementById('export-btn');
let editingQuestionId = null;

function createOptionRow(value = '', score = 0) {
  const row = document.createElement('div');
  row.className = 'option-row';

  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.value = value;
  textInput.placeholder = 'Texto de la alternativa';

  const scoreInput = document.createElement('input');
  scoreInput.type = 'number';
  scoreInput.value = score;
  scoreInput.placeholder = 'Puntaje';
  scoreInput.min = '0';

  row.appendChild(textInput);
  row.appendChild(scoreInput);
  return row;
}

function addDefaultOptions() {
  optionsList.innerHTML = '';
  const rows = [
    createOptionRow('Alternativa 1', 1),
    createOptionRow('Alternativa 2', 2),
    createOptionRow('Alternativa 3', 3)
  ];
  rows.forEach((row) => optionsList.appendChild(row));
}

function renderAdminQuestions(questions) {
  adminQuestionsList.innerHTML = '';

  if (!questions.length) {
    adminQuestionsList.innerHTML = '<p class="empty-state">Todavía no hay preguntas creadas.</p>';
    return;
  }

  const list = document.createElement('div');
  list.className = 'questions-admin-list';

  questions.forEach((question) => {
    const item = document.createElement('div');
    item.className = 'admin-question-item';

    const content = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = question.text;
    content.appendChild(title);

    const options = document.createElement('ul');
    question.options.forEach((option) => {
      const optionItem = document.createElement('li');
      optionItem.textContent = `${option.text} (${option.score} pts)`;
      options.appendChild(optionItem);
    });
    content.appendChild(options);

    const actions = document.createElement('div');
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'secondary-btn';
    editButton.textContent = 'Editar';
    editButton.addEventListener('click', () => fillQuestionEditor(question));
    actions.appendChild(editButton);

    item.appendChild(content);
    item.appendChild(actions);
    list.appendChild(item);
  });

  adminQuestionsList.appendChild(list);
}

async function loadQuestions() {
  const response = await fetch('/api/questions');
  const questions = await response.json();

  if (adminQuestionsList) {
    renderAdminQuestions(questions);
  }

  if (rankingContainer) {
    renderRanking();
  }
}

function buildQuestionPayloadFromForm() {
  const questionText = document.getElementById('question-text').value.trim();
  const optionRows = [...optionsList.querySelectorAll('.option-row')];
  const options = optionRows.map((row) => {
    const inputs = row.querySelectorAll('input');
    return {
      text: inputs[0].value.trim(),
      score: Number(inputs[1].value || 0)
    };
  }).filter((option) => option.text);

  if (!questionText || !options.length) {
    return null;
  }

  return { text: questionText, options };
}

function resetQuestionForm() {
  editingQuestionId = null;
  questionForm.reset();
  addDefaultOptions();
  cancelEditButton.classList.add('hidden');
  saveQuestionButton.textContent = 'Guardar pregunta';
}

function fillQuestionEditor(question) {
  editingQuestionId = question.id;
  document.getElementById('question-text').value = question.text;
  optionsList.innerHTML = '';
  question.options.forEach((option) => {
    optionsList.appendChild(createOptionRow(option.text, option.score));
  });
  saveQuestionButton.textContent = 'Actualizar pregunta';
  cancelEditButton.classList.remove('hidden');
  window.location.hash = '#admin';
}

async function saveQuestion(event) {
  event.preventDefault();

  const payload = buildQuestionPayloadFromForm();
  if (!payload) {
    alert('Debes ingresar la pregunta y al menos una alternativa válida.');
    return;
  }

  const url = editingQuestionId ? `/api/questions/${editingQuestionId}` : '/api/questions';
  const method = editingQuestionId ? 'PUT' : 'POST';

  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json();

  if (!response.ok) {
    alert(result.error || 'No se pudo guardar la pregunta.');
    return;
  }

  resetQuestionForm();
  await loadQuestions();
}

async function renderRanking() {
  const response = await fetch('/api/ranking?limit=30');
  const rows = await response.json();

  if (!rows.length) {
    rankingContainer.innerHTML = '<p class="empty-state">Todavía no hay respuestas registradas.</p>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'ranking-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Posición</th>
        <th>Participante</th>
        <th>Puntaje</th>
        <th>Fecha</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((row) => `
        <tr>
          <td>#${row.ranking_position}</td>
          <td>${row.respondent_name || 'Invitado'}</td>
          <td>${row.total_score}</td>
          <td>${new Date(row.created_at).toLocaleString('es-AR')}</td>
        </tr>
      `).join('')}
    </tbody>
  `;

  rankingContainer.innerHTML = '';
  rankingContainer.appendChild(table);
}

if (exportButton) {
  exportButton.addEventListener('click', async () => {
    window.open('/api/export/xlsx', '_blank');
  });
}

if (cancelEditButton) {
  cancelEditButton.addEventListener('click', () => {
    resetQuestionForm();
  });
}

if (addOptionButton) {
  addOptionButton.addEventListener('click', () => {
    optionsList.appendChild(createOptionRow('', 0));
  });
}

if (questionForm) {
  questionForm.addEventListener('submit', saveQuestion);
}

if (questionForm && optionsList) {
  resetQuestionForm();
}

if (adminQuestionsList || rankingContainer) {
  loadQuestions();
}
