const surveyForm = document.getElementById('survey-form');
const questionsContainer = document.getElementById('questions-container');
const thankYouBox = document.getElementById('thank-you');

async function loadQuestions() {
  const response = await fetch('/api/questions');
  const questions = await response.json();

  questionsContainer.innerHTML = '';

  if (!questions.length) {
    questionsContainer.innerHTML = '<p class="empty-state">No hay preguntas creadas todavía.</p>';
    return;
  }

  questions.forEach((question, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'question-box';

    const title = document.createElement('h3');
    title.textContent = `${index + 1}. ${question.text}`;
    wrapper.appendChild(title);

    question.options.forEach((option) => {
      const label = document.createElement('label');
      label.className = 'option-label';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `question-${question.id}`;
      radio.value = option.id;
      radio.required = true;

      const text = document.createTextNode(`${option.text} (${option.score} pts)`);
      label.appendChild(radio);
      label.appendChild(text);
      wrapper.appendChild(label);
    });

    questionsContainer.appendChild(wrapper);
  });
}

async function submitSurvey(event) {
  event.preventDefault();

  const respondentName = document.getElementById('respondent-name').value.trim();
  const questionCards = [...document.querySelectorAll('.question-box')];
  const answers = [];

  questionCards.forEach((card) => {
    const radio = card.querySelector('input[type="radio"]:checked');
    if (!radio) {
      return;
    }

    const questionId = radio.name.replace('question-', '');
    answers.push({ questionId: Number(questionId), optionId: Number(radio.value) });
  });

  if (answers.length !== questionCards.length) {
    alert('Debes responder todas las preguntas antes de continuar.');
    return;
  }

  const response = await fetch('/api/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ respondentName, answers })
  });

  const payload = await response.json();

  if (!response.ok) {
    alert(payload.error || 'No se pudo enviar el formulario.');
    return;
  }

  thankYouBox.classList.remove('hidden');
  thankYouBox.innerHTML = 'Muchas gracias por responder, tus respuestas han sido guardadas correctamente y seras comunicado por nuestro personal capacitado el día de la selección';
  surveyForm.reset();
  surveyForm.classList.add('hidden');
  await loadQuestions();
}

surveyForm.addEventListener('submit', submitSurvey);
loadQuestions();
