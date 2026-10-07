const express = require('express');
const multer = require('multer');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const uploadsDir = path.join(__dirname, 'uploads');
const dataDir = path.join(__dirname, 'data');
const submissionsFile = path.join(dataDir, 'submissions.json');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

app.use(cors());
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const safeDate = Date.now();
    const safeName = file.originalname.replace(/\s+/g, '-');
    cb(null, `${safeDate}-${safeName}`);
  }
});

const upload = multer({
  storage,
  fileFilter: function (req, file, cb) {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed.'));
    }
  }
});

function readSubmissions() {
  if (!fs.existsSync(submissionsFile)) return [];
  try {
    return JSON.parse(fs.readFileSync(submissionsFile, 'utf8'));
  } catch (err) {
    console.error('Error reading submissions:', err);
    return [];
  }
}

function writeSubmissions(data) {
  fs.writeFileSync(submissionsFile, JSON.stringify(data, null, 2));
}

app.get('/api/submissions', (req, res) => {
  res.json(readSubmissions());
});

app.post('/api/submit', upload.single('pdf'), (req, res) => {
  try {
    const { author, email, title, institution, abstract } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'PDF is required.' });
    }

    if (!author || !email || !title || !abstract) {
      return res.status(400).json({ error: 'Please fill all required fields.' });
    }

    const newSubmission = {
      id: Date.now(),
      author,
      email,
      title,
      institution: institution || 'N/A',
      abstract,
      pdfFile: req.file.filename,
      pdfPath: `/uploads/${req.file.filename}`,
      status: 'Pending Review',
      submittedAt: new Date().toISOString(),
      reviewedBy: null,
      reviewerNotes: '',
      reviewedAt: null
    };

    const submissions = readSubmissions();
    submissions.unshift(newSubmission);
    writeSubmissions(submissions);

    return res.json({ success: true, message: 'Submission successful', id: newSubmission.id });
  } catch (err) {
    console.error('Submit error:', err);
    return res.status(500).json({ error: 'Failed to save submission.' });
  }
});

app.put('/api/submissions/:id', (req, res) => {
  const { id } = req.params;
  const { status, reviewedBy, reviewerNotes } = req.body;

  const submissions = readSubmissions();
  const index = submissions.findIndex(item => item.id === Number(id));

  if (index === -1) {
    return res.status(404).json({ error: 'Submission not found.' });
  }

  submissions[index].status = status || submissions[index].status;
  submissions[index].reviewedBy = reviewedBy || submissions[index].reviewedBy;
  submissions[index].reviewerNotes = reviewerNotes || submissions[index].reviewerNotes;
  submissions[index].reviewedAt = new Date().toISOString();

  writeSubmissions(submissions);
  return res.json({ success: true, submission: submissions[index] });
});

app.delete('/api/submissions/:id', (req, res) => {
  const { id } = req.params;
  const submissions = readSubmissions();
  const index = submissions.findIndex(item => item.id === Number(id));

  if (index === -1) {
    return res.status(404).json({ error: 'Submission not found.' });
  }

  const fileToDelete = submissions[index].pdfFile;
  const filePath = path.join(uploadsDir, fileToDelete);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  submissions.splice(index, 1);
  writeSubmissions(submissions);
  return res.json({ success: true });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`CYSR server running on http://localhost:${PORT}`);
  console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
});
