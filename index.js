const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'cuestionario.db');
const EXPORT_PATH = path.join(DATA_DIR, 'resultados.xlsx');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function initializeDatabase() {
  await run(`CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE
  )`);

  await run(`CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    respondent_name TEXT,
    total_score INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    option_id INTEGER NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
    FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE,
    FOREIGN KEY(option_id) REFERENCES options(id) ON DELETE CASCADE
  )`);

  const count = (await all('SELECT COUNT(*) as total FROM questions'))[0].total;
  if (count === 0) {
    const q1 = await run('INSERT INTO questions (text) VALUES (?)', ['¿Qué tan motivado te encuentras para aplicar a esta oportunidad?']);
    await run('INSERT INTO options (question_id, text, score, position) VALUES (?, ?, ?, ?)', [q1.id, 'Muy motivado', 5, 0]);
    await run('INSERT INTO options (question_id, text, score, position) VALUES (?, ?, ?, ?)', [q1.id, 'Motivado', 3, 1]);
    await run('INSERT INTO options (question_id, text, score, position) VALUES (?, ?, ?, ?)', [q1.id, 'Poco motivado', 1, 2]);

    const q2 = await run('INSERT INTO questions (text) VALUES (?)', ['¿Qué tan bien te va con el trabajo en equipo?']);
    await run('INSERT INTO options (question_id, text, score, position) VALUES (?, ?, ?, ?)', [q2.id, 'Excelente', 5, 0]);
    await run('INSERT INTO options (question_id, text, score, position) VALUES (?, ?, ?, ?)', [q2.id, 'Bueno', 3, 1]);
    await run('INSERT INTO options (question_id, text, score, position) VALUES (?, ?, ?, ?)', [q2.id, 'Regular', 1, 2]);
  }
}

async function ensureQuestionDetails() {
  const questions = await all(
    `SELECT q.id, q.text,
      (SELECT json_group_array(json_object('id', o.id, 'text', o.text, 'score', o.score, 'position', o.position))
       FROM options o WHERE o.question_id = q.id ORDER BY o.position, o.id) as options_json
    FROM questions q
    ORDER BY q.id ASC`
  );

  return questions.map((question) => ({
    ...question,
    options: JSON.parse(question.options_json || '[]')
  }));
}

function exportWorkbook() {
  return new Promise(async (resolve, reject) => {
    try {
      const questions = await ensureQuestionDetails();
      const rows = await all(`
        SELECT s.id AS submission_id,
               s.respondent_name,
               s.total_score,
               s.created_at,
               a.question_id,
               q.text AS question,
               o.text AS option_selected,
               o.score AS option_score
        FROM submissions s
        LEFT JOIN answers a ON a.submission_id = s.id
        LEFT JOIN questions q ON q.id = a.question_id
        LEFT JOIN options o ON o.id = a.option_id
        ORDER BY s.id ASC, a.question_id ASC
      `);

      const workbook = XLSX.utils.book_new();
      const bySubmission = new Map();

      rows.forEach((row) => {
        if (!bySubmission.has(row.submission_id)) {
          bySubmission.set(row.submission_id, {
            submission_id: row.submission_id,
            respondent_name: row.respondent_name,
            total_score: row.total_score,
            created_at: row.created_at
          });
        }

        if (row.question_id) {
          const submission = bySubmission.get(row.submission_id);
          submission[row.question] = row.option_selected || '';
          submission[`${row.question} (puntaje)`] = row.option_score || 0;
        }
      });

      const finalRows = Array.from(bySubmission.values()).map((row) => {
        const obj = {
          submission_id: row.submission_id,
          respondent_name: row.respondent_name,
          total_score: row.total_score,
          created_at: row.created_at
        };

        questions.forEach((question) => {
          const answer = row[question.text] ?? '';
          const score = row[`${question.text} (puntaje)`] ?? 0;
          obj[question.text] = answer;
          obj[`${question.text} (puntaje)`] = score;
        });

        return obj;
      });

      const emptyRow = {
        submission_id: '',
        respondent_name: '',
        total_score: '',
        created_at: ''
      };
      questions.forEach((question) => {
        emptyRow[question.text] = '';
        emptyRow[`${question.text} (puntaje)`] = '';
      });

      const ws = XLSX.utils.json_to_sheet(finalRows.length ? finalRows : [emptyRow]);
      XLSX.utils.book_append_sheet(workbook, ws, 'Resultados');
      XLSX.writeFile(workbook, EXPORT_PATH);
      resolve(EXPORT_PATH);
    } catch (error) {
      reject(error);
    }
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function normalizeOptions(options) {
  if (!Array.isArray(options) || options.length === 0) {
    return null;
  }

  const normalized = options.map((option, index) => ({
    text: String(option.text || '').trim(),
    score: Number(option.score || 0),
    position: index
  }));

  if (normalized.some((option) => !option.text)) {
    return null;
  }

  return normalized;
}

app.get('/api/questions', async (req, res) => {
  try {
    const questions = await ensureQuestionDetails();
    res.json(questions);
  } catch (error) {
    res.status(500).json({ error: 'No se pudieron cargar las preguntas.' });
  }
});

app.post('/api/questions', async (req, res) => {
  const { text, options } = req.body || {};
  const normalizedOptions = normalizeOptions(options);

  if (!text || !normalizedOptions) {
    return res.status(400).json({ error: 'Debes enviar la pregunta y al menos una alternativa.' });
  }

  try {
    const question = await run('INSERT INTO questions (text) VALUES (?)', [String(text).trim()]);

    for (const option of normalizedOptions) {
      await run('INSERT INTO options (question_id, text, score, position) VALUES (?, ?, ?, ?)', [question.id, option.text, option.score, option.position]);
    }

    const updated = await ensureQuestionDetails();
    res.status(201).json(updated);
  } catch (error) {
    res.status(500).json({ error: 'No se pudo guardar la pregunta.' });
  }
});

app.put('/api/questions/:id', async (req, res) => {
  const { id } = req.params;
  const { text, options } = req.body || {};
  const normalizedOptions = normalizeOptions(options);

  if (!text || !normalizedOptions) {
    return res.status(400).json({ error: 'Debes enviar la pregunta y al menos una alternativa.' });
  }

  try {
    const existingQuestion = await get('SELECT id FROM questions WHERE id = ?', [Number(id)]);
    if (!existingQuestion) {
      return res.status(404).json({ error: 'La pregunta no existe.' });
    }

    await run('UPDATE questions SET text = ? WHERE id = ?', [String(text).trim(), Number(id)]);
    await run('DELETE FROM options WHERE question_id = ?', [Number(id)]);

    for (const option of normalizedOptions) {
      await run('INSERT INTO options (question_id, text, score, position) VALUES (?, ?, ?, ?)', [Number(id), option.text, option.score, option.position]);
    }

    const updated = await ensureQuestionDetails();
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'No se pudo actualizar la pregunta.' });
  }
});

app.get('/api/submissions', async (req, res) => {
  try {
    const submissions = await all(`
      SELECT s.id, s.respondent_name, s.total_score, s.created_at,
             json_group_array(json_object(
                'questionId', a.question_id,
                'questionText', q.text,
                'optionText', o.text,
                'score', o.score
             )) AS answers_json
      FROM submissions s
      LEFT JOIN answers a ON a.submission_id = s.id
      LEFT JOIN questions q ON q.id = a.question_id
      LEFT JOIN options o ON o.id = a.option_id
      GROUP BY s.id, s.respondent_name, s.total_score, s.created_at
      ORDER BY s.total_score DESC, s.created_at DESC
    `);

    res.json(submissions.map((entry) => ({
      ...entry,
      answers: JSON.parse(entry.answers_json || '[]')
    })));
  } catch (error) {
    res.status(500).json({ error: 'No se pudieron cargar las respuestas.' });
  }
});

app.get('/api/ranking', async (req, res) => {
  try {
    const limit = Number(req.query.limit || 30);
    const rows = await all(`
      SELECT id, respondent_name, total_score, created_at,
             ROW_NUMBER() OVER (ORDER BY total_score DESC, created_at ASC) AS ranking_position
      FROM submissions
      ORDER BY total_score DESC, created_at ASC
      LIMIT ?
    `, [limit]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'No se pudo ordenar el ranking.' });
  }
});

app.post('/api/submissions', async (req, res) => {
  const { respondentName, answers } = req.body || {};

  if (!Array.isArray(answers)) {
    return res.status(400).json({ error: 'Debe enviar una lista de respuestas.' });
  }

  try {
    const questions = await ensureQuestionDetails();
    const questionIds = new Set(questions.map((q) => q.id));

    if (questions.length === 0) {
      return res.status(400).json({ error: 'Primero crea al menos una pregunta.' });
    }

    if (answers.length !== questions.length) {
      return res.status(400).json({ error: 'Debes responder cada una de las preguntas.' });
    }

    let totalScore = 0;
    const answersToInsert = [];

    for (const answer of answers) {
      if (!questionIds.has(Number(answer.questionId))) {
        return res.status(400).json({ error: `Pregunta inválida: ${answer.questionId}` });
      }

      const question = questions.find((q) => q.id === Number(answer.questionId));
      const option = question.options.find((opt) => opt.id === Number(answer.optionId));

      if (!option) {
        return res.status(400).json({ error: `Alternativa inválida para la pregunta ${question.text}` });
      }

      totalScore += Number(option.score || 0);
      answersToInsert.push({
        question_id: Number(answer.questionId),
        option_id: Number(answer.optionId),
        score: Number(option.score || 0)
      });
    }

    const submission = await run(
      'INSERT INTO submissions (respondent_name, total_score) VALUES (?, ?)',
      [respondentName ? String(respondentName).trim() : 'Invitado', totalScore]
    );

    for (const answer of answersToInsert) {
      await run(
        'INSERT INTO answers (submission_id, question_id, option_id, score) VALUES (?, ?, ?, ?)',
        [submission.id, answer.question_id, answer.option_id, answer.score]
      );
    }

    await exportWorkbook();

    const ranking = await all(
      `SELECT id, respondent_name, total_score, created_at,
              ROW_NUMBER() OVER (ORDER BY total_score DESC, created_at ASC) AS ranking_position
       FROM submissions
       ORDER BY total_score DESC, created_at ASC`
    );

    const position = ranking.find((entry) => entry.id === submission.id)?.ranking_position || 1;

    res.status(201).json({
      success: true,
      submissionId: submission.id,
      totalScore,
      rankingPosition: position,
      excelFile: '/resultados.xlsx'
    });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo registrar la respuesta.' });
  }
});

app.get('/api/export/xlsx', async (req, res) => {
  try {
    await exportWorkbook();
    res.download(EXPORT_PATH, 'resultados.xlsx');
  } catch (error) {
    res.status(500).json({ error: 'No se pudo exportar el archivo Excel.' });
  }
});

app.get('/encuestado', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'encuestado.html'));
});

app.get('/resultados.xlsx', (req, res) => {
  res.sendFile(EXPORT_PATH, (error) => {
    if (error) {
      res.status(404).send('Archivo no disponible aún.');
    }
  });
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }

  if (req.path === '/encuestado' || req.path === '/encuestado.html') {
    return res.sendFile(path.join(__dirname, 'public', 'encuestado.html'));
  }

  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor activo en http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Error inicializando la base de datos:', error);
    process.exit(1);
  });
