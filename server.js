const express = require('express');
const multer = require('multer');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const RSSParser = require('rss-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const parser = new RSSParser();

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

const NEWS_FEEDS = [
  'https://www.thehindu.com/sci-tech/science/feeder/default.rss',
  'https://indianexpress.com/section/technology/tech-news/feed/',
  'https://www.ndtv.com/rss/india.xml',
  'https://www.sciencealert.com/rss'
];

let newsCache = { items: [], updatedAt: 0 };
const NEWS_TTL = 5 * 60 * 1000;

app.get('/api/news', async (req, res) => {
  try {
    const now = Date.now();
    if (newsCache.items.length && (now - newsCache.updatedAt) < NEWS_TTL) {
      return res.json({ items: newsCache.items });
    }

    const allItems = [];

    await Promise.all(NEWS_FEEDS.map(async (feedUrl) => {
      try {
        const feed = await parser.parseURL(feedUrl);
        const feedTitle = feed.title || 'Science News';

        (feed.items || []).forEach((item) => {
          const link = item.link || item.guid || '#';
          const title = item.title || 'Untitled';
          const description = (item.contentSnippet || item.summary || item.content || '').replace(/\s+/g, ' ').trim();
          const pubDate = item.isoDate || item.pubDate || new Date().toISOString();

          const cleanItem = {
            title,
            link,
            pubDate,
            description,
            source: feedTitle
          };

          if (title && link) allItems.push(cleanItem);
        });
      } catch (err) {
        console.warn('RSS feed error:', feedUrl, err.message);
      }
    }));

    allItems.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    const items = allItems.slice(0, 20);
    newsCache = { items, updatedAt: now };

    return res.json({ items });
  } catch (err) {
    console.error('News fetch error:', err);
    return res.status(500).json({ items: [] });
  }
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
