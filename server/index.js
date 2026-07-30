import express from 'express';
import cors from 'cors';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import ws from 'ws';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';

// Polyfill WebSocket for Supabase client on Node.js versions < 22
globalThis.WebSocket = ws;

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5005;

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET environment variable is required. Set it in your .env file.');
  process.exit(1);
}

// Rate limiter for login endpoints
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // limit each IP to 15 login requests per windowMs
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware to authenticate JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: 'Access token is missing.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(401).json({ error: 'Access token is invalid or expired.' });
    }
    req.user = user;
    next();
  });
}

// Middleware to authorize admin-only endpoints
function authorizeAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

// CORS: restrict to configured origins or allow all in development
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : null;

app.use(cors(allowedOrigins ? {
  origin: allowedOrigins,
  credentials: true
} : undefined));
app.use(express.json());

// Set up public upload static files serving
const publicUploadsDir = path.join(__dirname, '../client/public/uploads');
const clientBuildDir = path.join(__dirname, '../client/dist');
const dataDir = path.join(__dirname, 'data');

app.use('/uploads', express.static(publicUploadsDir));
app.use(express.static(clientBuildDir));

// Protect all non-public API endpoints
app.use((req, res, next) => {
  const publicRoutes = [
    { path: '/api/admin/config', method: 'GET' },
    { path: '/api/admin/setup', method: 'POST' },
    { path: '/api/admin/login', method: 'POST' },
    { path: '/api/supervisors/login', method: 'POST' },
    { path: '/api/supervisors', method: 'GET' }
  ];

  const isPublic = publicRoutes.some(route => 
    req.path === route.path && req.method === route.method
  );

  if (isPublic) {
    return next();
  }

  authenticateToken(req, res, next);
});

// Multer storage in memory with file type validation and size limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed.'), false);
    }
  }
});

// Connect to Supabase using URL and Service Key
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

let supabase = null;
let mode = 'local';

if (supabaseUrl && supabaseUrl !== 'YOUR_SUPABASE_PROJECT_URL' && supabaseKey && supabaseKey !== 'YOUR_SUPABASE_SERVICE_ROLE_KEY' && supabaseKey !== 'YOUR_SUPABASE_SERVICE_ROLE_KEY_OR_ANON_KEY') {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    mode = 'supabase';
    console.log('⚡ Connected to Supabase in cloud mode!');
  } catch (err) {
    console.error('❌ Supabase initialization failed. Falling back to local offline mode.', err.message);
  }
} else {
  console.log('⚠️ Supabase credentials missing. Running in Local LAN Mode (JSON files).');
}

// Local storage init (ensure directories and placeholder JSON files exist)
async function initLocalStorage() {
  if (mode === 'local') {
    await fs.mkdir(publicUploadsDir, { recursive: true });
    await fs.mkdir(dataDir, { recursive: true });

    const files = [
      { name: 'supervisors.json', default: '[]' },
      { name: 'expenses.json', default: '[]' },
      { name: 'app_config.json', default: '{}' },
      { name: 'labourers.json', default: '[]' },
      { name: 'income.json', default: '[]' },
      { name: 'expenditures.json', default: '[]' },
      { name: 'settlements.json', default: '[]' }
    ];

    for (const f of files) {
      const filepath = path.join(dataDir, f.name);
      try {
        await fs.access(filepath);
      } catch {
        await fs.writeFile(filepath, f.default, 'utf8');
      }
    }
  }
}

// Local Helper Readers/Writers
async function readLocalFile(filename) {
  const filepath = path.join(dataDir, filename);
  const data = await fs.readFile(filepath, 'utf8');
  return JSON.parse(data);
}

async function writeLocalFile(filename, data) {
  const filepath = path.join(dataDir, filename);
  await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');
}

// -------------------------------------------------------------
// ENDPOINTS
// -------------------------------------------------------------

// 1. GET ALL SUPERVISORS
app.get('/api/supervisors', async (req, res) => {
  try {
    if (mode === 'supabase') {
      const { data, error } = await supabase
        .from('supervisors')
        .select('id, name')
        .order('name', { ascending: true });
      if (error) throw error;
      return res.json(data);
    } else {
      const supervisors = await readLocalFile('supervisors.json');
      const safeList = supervisors.map(s => ({ id: s.id, name: s.name }));
      return res.json(safeList.sort((a, b) => a.name.localeCompare(b.name)));
    }
  } catch (err) {
    console.error('GET /api/supervisors error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. CREATE SUPERVISOR (ADMIN ONLY)
app.post('/api/supervisors', authorizeAdmin, async (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) {
    return res.status(400).json({ error: 'Name and 4-digit PIN are required.' });
  }
  try {
    const pin_hash = await bcrypt.hash(pin, 10);
    if (mode === 'supabase') {
      const { data, error } = await supabase
        .from('supervisors')
        .insert([{ name, pin_hash }])
        .select('id, name');
      if (error) {
        if (error.code === '23505') return res.status(400).json({ error: 'Supervisor name already exists.' });
        throw error;
      }
      return res.json({ success: true, supervisor: data[0] });
    } else {
      const supervisors = await readLocalFile('supervisors.json');
      if (supervisors.some(s => s.name.toLowerCase() === name.toLowerCase())) {
        return res.status(400).json({ error: 'Supervisor name already exists.' });
      }
      const newSup = {
        id: `sup-${Date.now()}`,
        name,
        pin_hash,
        created_at: new Date().toISOString()
      };
      supervisors.push(newSup);
      await writeLocalFile('supervisors.json', supervisors);
      return res.json({ success: true, supervisor: { id: newSup.id, name: newSup.name } });
    }
  } catch (err) {
    console.error('POST /api/supervisors error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. DELETE SUPERVISOR (ADMIN ONLY)
app.delete('/api/supervisors/:id', authorizeAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    if (mode === 'supabase') {
      const { error } = await supabase
        .from('supervisors')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return res.json({ success: true });
    } else {
      let supervisors = await readLocalFile('supervisors.json');
      supervisors = supervisors.filter(s => s.id !== id);
      await writeLocalFile('supervisors.json', supervisors);

      // Cascade delete related records
      const incomes = await readLocalFile('income.json');
      await writeLocalFile('income.json', incomes.filter(i => i.supervisor_id !== id));

      const expenditures = await readLocalFile('expenditures.json');
      await writeLocalFile('expenditures.json', expenditures.filter(e => e.supervisor_id !== id));

      const expenses = await readLocalFile('expenses.json');
      const supervisorExpenses = expenses.filter(e => e.supervisor_id === id);
      for (const exp of supervisorExpenses) {
        if (exp.photo_url && exp.photo_url.startsWith('/uploads/')) {
          const filename = exp.photo_url.replace('/uploads/', '');
          const filepath = path.join(publicUploadsDir, filename);
          try {
            await fs.unlink(filepath);
          } catch (e) {
            console.warn('Local file cascade delete warning:', e.message);
          }
        }
      }
      await writeLocalFile('expenses.json', expenses.filter(e => e.supervisor_id !== id));

      const settlements = await readLocalFile('settlements.json');
      await writeLocalFile('settlements.json', settlements.filter(s => s.supervisor_id !== id));

      return res.json({ success: true });
    }
  } catch (err) {
    console.error('DELETE /api/supervisors error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. SUPERVISOR LOGIN
app.post('/api/supervisors/login', loginLimiter, async (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) {
    return res.status(400).json({ error: 'Supervisor name and PIN are required.' });
  }
  try {
    let supervisor = null;
    if (mode === 'supabase') {
      const { data, error } = await supabase
        .from('supervisors')
        .select('*')
        .eq('name', name)
        .maybeSingle();
      if (error || !data) {
        return res.status(401).json({ error: 'Invalid name or PIN.' });
      }
      supervisor = data;
    } else {
      const supervisors = await readLocalFile('supervisors.json');
      supervisor = supervisors.find(s => s.name === name);
      if (!supervisor) {
        return res.status(401).json({ error: 'Invalid name or PIN.' });
      }
    }

    const matches = await bcrypt.compare(pin, supervisor.pin_hash);
    if (!matches) {
      return res.status(401).json({ error: 'Invalid name or PIN.' });
    }

    const token = jwt.sign(
      { id: supervisor.id, name: supervisor.name, role: 'supervisor' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      supervisor: { id: supervisor.id, name: supervisor.name }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// 5. GET ADMIN PIN CONFIG STATUS
app.get('/api/admin/config', async (req, res) => {
  try {
    if (mode === 'supabase') {
      const { data, error } = await supabase
        .from('app_config')
        .select('value')
        .eq('key', 'admin_pin_hash')
        .maybeSingle();
      if (error) throw error;
      return res.json({ exists: !!data });
    } else {
      const config = await readLocalFile('app_config.json');
      return res.json({ exists: !!config.admin_pin_hash });
    }
  } catch (err) {
    console.error('GET /api/admin/config error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. INITIAL ADMIN SETUP PIN
app.post('/api/admin/setup', async (req, res) => {
  const { pin } = req.body;
  if (!pin || pin.length < 4) {
    return res.status(400).json({ error: 'Valid PIN must be at least 4 digits.' });
  }
  try {
    let exists = false;
    if (mode === 'supabase') {
      const { data } = await supabase
        .from('app_config')
        .select('value')
        .eq('key', 'admin_pin_hash')
        .maybeSingle();
      exists = !!data;
    } else {
      const config = await readLocalFile('app_config.json');
      exists = !!config.admin_pin_hash;
    }

    if (exists) {
      return res.status(400).json({ error: 'Admin PIN is already configured.' });
    }

    const hashed = await bcrypt.hash(pin, 10);

    if (mode === 'supabase') {
      const { error } = await supabase
        .from('app_config')
        .upsert([{ key: 'admin_pin_hash', value: hashed }]);
      if (error) throw error;
    } else {
      const config = await readLocalFile('app_config.json');
      config.admin_pin_hash = hashed;
      await writeLocalFile('app_config.json', config);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/admin/setup error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 7. ADMIN LOGIN
app.post('/api/admin/login', loginLimiter, async (req, res) => {
  const { pin } = req.body;
  if (!pin) {
    return res.status(400).json({ error: 'Admin PIN is required.' });
  }
  try {
    let storedHash = '';
    if (mode === 'supabase') {
      const { data, error } = await supabase
        .from('app_config')
        .select('value')
        .eq('key', 'admin_pin_hash')
        .maybeSingle();
      if (error || !data) {
        return res.status(400).json({ error: 'Admin PIN setup not completed yet.' });
      }
      storedHash = data.value;
    } else {
      const config = await readLocalFile('app_config.json');
      if (!config.admin_pin_hash) {
        return res.status(400).json({ error: 'Admin PIN setup not completed yet.' });
      }
      storedHash = config.admin_pin_hash;
    }

    const matches = await bcrypt.compare(pin, storedHash);
    if (!matches) {
      return res.status(401).json({ error: 'Invalid Admin PIN.' });
    }

    const token = jwt.sign(
      { role: 'admin' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ success: true, token });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// 8. GET ALL EXPENSES (WITH FILTERS)
app.get('/api/expenses', async (req, res) => {
  const { supervisor_id, verified } = req.query;
  try {
    if (mode === 'supabase') {
      let query = supabase.from('expenses').select('*');

      if (supervisor_id) {
        query = query.eq('supervisor_id', supervisor_id);
      }

      if (verified === 'verified') {
        query = query.eq('verified', true);
      } else if (verified === 'pending') {
        query = query.eq('verified', false);
      }

      const { data, error } = await query
        .order('date', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return res.json(data);
    } else {
      let expenses = await readLocalFile('expenses.json');

      if (supervisor_id) {
        expenses = expenses.filter(e => e.supervisor_id === supervisor_id);
      }

      if (verified === 'verified') {
        expenses = expenses.filter(e => e.verified === true);
      } else if (verified === 'pending') {
        expenses = expenses.filter(e => e.verified === false);
      }

      expenses.sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        if (dateA.getTime() !== dateB.getTime()) {
          return dateA - dateB;
        }
        return new Date(a.created_at) - new Date(b.created_at);
      });

      return res.json(expenses);
    }
  } catch (err) {
    console.error('GET /api/expenses error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 9. LOG NEW EXPENSE + STORAGE UPLOAD
app.post('/api/expenses', upload.single('file'), async (req, res) => {
  const { supervisor_id, supervisor_name, amount, note, date } = req.body;
  const file = req.file;

  if (!supervisor_id || !supervisor_name || !amount || !date || !file) {
    return res.status(400).json({ error: 'Missing required fields or receipt image.' });
  }

  try {
    let photo_url = '';
    const filename = `${Date.now()}-${Math.floor(Math.random() * 1000000)}.jpg`;

    if (mode === 'supabase') {
      const { error: uploadError } = await supabase.storage
        .from('bill-photos')
        .upload(filename, file.buffer, {
          contentType: file.mimetype,
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('bill-photos')
        .getPublicUrl(filename);
      
      photo_url = urlData.publicUrl;
    } else {
      await fs.mkdir(publicUploadsDir, { recursive: true });
      const filepath = path.join(publicUploadsDir, filename);
      await fs.writeFile(filepath, file.buffer);
      photo_url = `/uploads/${filename}`;
    }

    const expenseData = {
      supervisor_id,
      supervisor_name,
      amount: parseFloat(amount),
      note: note || '',
      date,
      photo_url,
      verified: false
    };

    if (mode === 'supabase') {
      const { data, error: dbError } = await supabase
        .from('expenses')
        .insert([expenseData])
        .select('*');
      if (dbError) throw dbError;
      return res.status(201).json(data[0]);
    } else {
      const localRecord = {
        id: `exp-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
        ...expenseData,
        created_at: new Date().toISOString()
      };
      const expenses = await readLocalFile('expenses.json');
      expenses.push(localRecord);
      await writeLocalFile('expenses.json', expenses);
      return res.status(201).json(localRecord);
    }
  } catch (err) {
    console.error('POST /api/expenses error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 9b. DELETE EXPENSE (BILL CHIT)
app.delete('/api/expenses/:id', async (req, res) => {
  const { id } = req.params;
  try {
    let photoUrl = '';
    if (mode === 'supabase') {
      const { data: existing, error: fetchErr } = await supabase
        .from('expenses')
        .select('verified, photo_url')
        .eq('id', id)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (existing && existing.verified) {
        return res.status(400).json({ error: 'Cannot delete verified bills.' });
      }
      photoUrl = existing ? existing.photo_url : '';

      const { error } = await supabase.from('expenses').delete().eq('id', id);
      if (error) throw error;

      if (photoUrl) {
        const urlParts = photoUrl.split('/');
        const filename = urlParts[urlParts.length - 1];
        await supabase.storage.from('bill-photos').remove([filename]);
      }
      return res.json({ success: true });
    } else {
      const expenses = await readLocalFile('expenses.json');
      const idx = expenses.findIndex(x => x.id === id);
      if (idx === -1) {
        return res.status(404).json({ error: 'Record not found.' });
      }
      if (expenses[idx].verified) {
        return res.status(400).json({ error: 'Cannot delete verified bills.' });
      }
      photoUrl = expenses[idx].photo_url;
      const filtered = expenses.filter(x => x.id !== id);
      await writeLocalFile('expenses.json', filtered);

      if (photoUrl && photoUrl.startsWith('/uploads/')) {
        const filename = photoUrl.replace('/uploads/', '');
        const filepath = path.join(publicUploadsDir, filename);
        try {
          await fs.unlink(filepath);
        } catch (e) {
          console.warn('Local file delete warning:', e.message);
        }
      }
      return res.json({ success: true });
    }
  } catch (err) {
    console.error('DELETE /api/expenses error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 10. TOGGLE VERIFICATION STATUS
app.patch('/api/expenses/:id/toggle', authorizeAdmin, async (req, res) => {
  const { id } = req.params;
  const { verified } = req.body;
  
  if (verified === undefined) {
    return res.status(400).json({ error: 'Verified status boolean is required.' });
  }

  try {
    if (mode === 'supabase') {
      const { data, error } = await supabase
        .from('expenses')
        .update({ verified: !!verified })
        .eq('id', id)
        .select('*');
      if (error) throw error;
      if (data.length === 0) return res.status(404).json({ error: 'Expense log not found.' });
      return res.json(data[0]);
    } else {
      const expenses = await readLocalFile('expenses.json');
      const expense = expenses.find(e => e.id === id);
      if (!expense) return res.status(404).json({ error: 'Expense log not found.' });
      
      expense.verified = !!verified;
      await writeLocalFile('expenses.json', expenses);
      return res.json(expense);
    }
  } catch (err) {
    console.error('PATCH /api/expenses/:id/toggle error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 10b. TOGGLE EXPENDITURE VERIFICATION STATUS
app.patch('/api/expenditures/:id/toggle', authorizeAdmin, async (req, res) => {
  const { id } = req.params;
  const { verified } = req.body;
  
  if (verified === undefined) {
    return res.status(400).json({ error: 'Verified status boolean is required.' });
  }

  try {
    if (mode === 'supabase') {
      const { data, error } = await supabase
        .from('supervisor_expenditure')
        .update({ verified: !!verified })
        .eq('id', id)
        .select('*');
      if (error) throw error;
      if (data.length === 0) return res.status(404).json({ error: 'Expenditure log not found.' });
      return res.json(data[0]);
    } else {
      const expenditures = await readLocalFile('expenditures.json');
      const exp = expenditures.find(e => e.id === id);
      if (!exp) return res.status(404).json({ error: 'Expenditure log not found.' });
      
      exp.verified = !!verified;
      await writeLocalFile('expenditures.json', expenditures);
      return res.json(exp);
    }
  } catch (err) {
    console.error('PATCH /api/expenditures/:id/toggle error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 11. GET ALL LABOURERS
app.get('/api/labourers', async (req, res) => {
  try {
    if (mode === 'supabase') {
      const { data, error } = await supabase
        .from('labourers')
        .select('*')
        .order('name', { ascending: true });
      if (error) throw error;
      return res.json(data);
    } else {
      const labourers = await readLocalFile('labourers.json');
      labourers.sort((a, b) => a.name.localeCompare(b.name));
      return res.json(labourers);
    }
  } catch (err) {
    console.error('GET /api/labourers error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 12. CREATE A NEW LABOURER
app.post('/api/labourers', authorizeAdmin, async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Labourer name is required.' });
  }

  try {
    if (mode === 'supabase') {
      const { data, error } = await supabase
        .from('labourers')
        .insert([{ name }])
        .select('*');
      if (error) throw error;
      return res.status(201).json(data[0]);
    } else {
      const labourers = await readLocalFile('labourers.json');
      const duplicate = labourers.find(l => l.name.toLowerCase() === name.toLowerCase());
      if (duplicate) {
        return res.status(400).json({ error: 'Labourer name already exists.' });
      }
      const newLabourer = {
        id: `lab-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
        name,
        created_at: new Date().toISOString()
      };
      labourers.push(newLabourer);
      await writeLocalFile('labourers.json', labourers);
      return res.status(201).json(newLabourer);
    }
  } catch (err) {
    console.error('POST /api/labourers error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 13. DELETE A LABOURER
app.delete('/api/labourers/:id', authorizeAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    if (mode === 'supabase') {
      const { error } = await supabase
        .from('labourers')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return res.json({ success: true });
    } else {
      let labourers = await readLocalFile('labourers.json');
      labourers = labourers.filter(l => l.id !== id);
      await writeLocalFile('labourers.json', labourers);
      return res.json({ success: true });
    }
  } catch (err) {
    console.error('DELETE /api/labourers error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 14. GET INCOME LOGS
app.get('/api/income', async (req, res) => {
  const { supervisor_id } = req.query;
  try {
    if (mode === 'supabase') {
      let query = supabase.from('supervisor_income').select('*');
      if (supervisor_id) {
        query = query.eq('supervisor_id', supervisor_id);
      }
      const { data, error } = await query.order('date', { ascending: true });
      if (error) throw error;
      return res.json(data);
    } else {
      let income = await readLocalFile('income.json');
      if (supervisor_id) {
        income = income.filter(i => i.supervisor_id === supervisor_id);
      }
      income.sort((a, b) => a.date.localeCompare(b.date));
      return res.json(income);
    }
  } catch (err) {
    console.error('GET /api/income error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 14b. DELETE CASH INCOME
app.delete('/api/income/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (mode === 'supabase') {
      const { error } = await supabase.from('supervisor_income').delete().eq('id', id);
      if (error) throw error;
      return res.json({ success: true });
    } else {
      const incomes = await readLocalFile('income.json');
      const idx = incomes.findIndex(x => x.id === id);
      if (idx === -1) {
        return res.status(404).json({ error: 'Record not found.' });
      }
      const filtered = incomes.filter(x => x.id !== id);
      await writeLocalFile('income.json', filtered);
      return res.json({ success: true });
    }
  } catch (err) {
    console.error('DELETE /api/income error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 15. LOG CASH INCOME
app.post('/api/income', async (req, res) => {
  const { supervisor_id, supervisor_name, amount, date, note } = req.body;
  if (!supervisor_id || !supervisor_name || !amount || !date) {
    return res.status(400).json({ error: 'Missing required cash income fields.' });
  }

  try {
    const incomeData = {
      supervisor_id,
      supervisor_name,
      amount: parseFloat(amount),
      date,
      note: note || ''
    };

    if (mode === 'supabase') {
      const { data, error } = await supabase
        .from('supervisor_income')
        .insert([incomeData])
        .select('*');
      if (error) throw error;
      return res.status(201).json(data[0]);
    } else {
      const income = await readLocalFile('income.json');
      const newIncome = {
        id: `inc-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
        ...incomeData,
        created_at: new Date().toISOString()
      };
      income.push(newIncome);
      await writeLocalFile('income.json', income);
      return res.status(201).json(newIncome);
    }
  } catch (err) {
    console.error('POST /api/income error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 16. GET EXPENDITURE LOGS
app.get('/api/expenditures', async (req, res) => {
  const { supervisor_id, labourer_id } = req.query;
  try {
    if (mode === 'supabase') {
      let query = supabase.from('supervisor_expenditure').select('*');
      if (supervisor_id) {
        query = query.eq('supervisor_id', supervisor_id);
      }
      if (labourer_id) {
        query = query.eq('labourer_id', labourer_id);
      }
      const { data, error } = await query.order('date', { ascending: true });
      if (error) throw error;
      return res.json(data);
    } else {
      let expenditures = await readLocalFile('expenditures.json');
      if (supervisor_id) {
        expenditures = expenditures.filter(e => e.supervisor_id === supervisor_id);
      }
      if (labourer_id) {
        expenditures = expenditures.filter(e => e.labourer_id === labourer_id);
      }
      expenditures.sort((a, b) => a.date.localeCompare(b.date));
      return res.json(expenditures);
    }
  } catch (err) {
    console.error('GET /api/expenditures error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 17. LOG OUTFLOW EXPENDITURE
app.post('/api/expenditures', async (req, res) => {
  const { supervisor_id, supervisor_name, amount, type, labourer_id, labourer_name, note, date } = req.body;
  if (!supervisor_id || !supervisor_name || !amount || !type || !date) {
    return res.status(400).json({ error: 'Missing required cash payout fields.' });
  }

  try {
    const expenditureData = {
      supervisor_id,
      supervisor_name,
      amount: parseFloat(amount),
      type, // 'labour' or 'general'
      labourer_id: labourer_id || null,
      labourer_name: labourer_name || null,
      note: note || '',
      date,
      verified: false
    };

    if (mode === 'supabase') {
      const { data, error } = await supabase
        .from('supervisor_expenditure')
        .insert([expenditureData])
        .select('*');
      if (error) throw error;
      return res.status(201).json(data[0]);
    } else {
      const expenditures = await readLocalFile('expenditures.json');
      const newExpenditure = {
        id: `exp-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
        ...expenditureData,
        created_at: new Date().toISOString()
      };
      expenditures.push(newExpenditure);
      await writeLocalFile('expenditures.json', expenditures);
      return res.status(201).json(newExpenditure);
    }
  } catch (err) {
    console.error('POST /api/expenditures error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 17b. DELETE OUTFLOW EXPENDITURE
app.delete('/api/expenditures/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (mode === 'supabase') {
      // Check if the record is verified
      const { data: existing, error: fetchErr } = await supabase
        .from('supervisor_expenditure')
        .select('verified')
        .eq('id', id)
        .maybeSingle();
      
      if (fetchErr) throw fetchErr;
      if (existing && existing.verified) {
        return res.status(400).json({ error: 'Cannot delete verified records.' });
      }

      const { error } = await supabase
        .from('supervisor_expenditure')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return res.json({ success: true });
    } else {
      const expenditures = await readLocalFile('expenditures.json');
      const idx = expenditures.findIndex(x => x.id === id);
      if (idx === -1) {
        return res.status(404).json({ error: 'Record not found.' });
      }
      if (expenditures[idx].verified) {
        return res.status(400).json({ error: 'Cannot delete verified records.' });
      }
      const filtered = expenditures.filter(x => x.id !== id);
      await writeLocalFile('expenditures.json', filtered);
      return res.json({ success: true });
    }
  } catch (err) {
    console.error('DELETE /api/expenditures error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 17c. GET MONTHLY SETTLEMENTS
app.get('/api/settlements', async (req, res) => {
  const { supervisor_id } = req.query;
  try {
    if (mode === 'supabase') {
      let query = supabase.from('monthly_settlements').select('*');
      if (supervisor_id) {
        query = query.eq('supervisor_id', supervisor_id);
      }
      const { data, error } = await query.order('created_at', { ascending: true });
      if (error) throw error;
      return res.json(data);
    } else {
      let settlements = await readLocalFile('settlements.json');
      if (supervisor_id) {
        settlements = settlements.filter(s => s.supervisor_id === supervisor_id);
      }
      return res.json(settlements);
    }
  } catch (err) {
    console.error('GET /api/settlements error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 17d. POST (UPSERT) MONTHLY SETTLEMENT
app.post('/api/settlements', authorizeAdmin, async (req, res) => {
  const { supervisor_id, supervisor_name, month, salary, inflow, outflow, cash_left, net_salary } = req.body;
  if (!supervisor_id || !supervisor_name || !month || salary === undefined) {
    return res.status(400).json({ error: 'Missing required settlement fields.' });
  }

  try {
    const settlementData = {
      supervisor_id,
      supervisor_name,
      month,
      salary: parseFloat(salary),
      inflow: parseFloat(inflow || 0),
      outflow: parseFloat(outflow || 0),
      cash_left: parseFloat(cash_left || 0),
      net_salary: parseFloat(net_salary || 0)
    };

    if (mode === 'supabase') {
      const { data, error } = await supabase
        .from('monthly_settlements')
        .upsert([settlementData], { onConflict: 'supervisor_id,month' })
        .select('*');
      if (error) throw error;
      return res.json({ success: true, settlement: data[0] });
    } else {
      const settlements = await readLocalFile('settlements.json');
      const idx = settlements.findIndex(s => s.supervisor_id === supervisor_id && s.month === month);
      
      const newSettlement = {
        id: idx !== -1 ? settlements[idx].id : `set-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
        ...settlementData,
        created_at: idx !== -1 ? settlements[idx].created_at : new Date().toISOString()
      };

      if (idx !== -1) {
        settlements[idx] = newSettlement;
      } else {
        settlements.push(newSettlement);
      }

      await writeLocalFile('settlements.json', settlements);
      return res.json({ success: true, settlement: newSettlement });
    }
  } catch (err) {
    console.error('POST /api/settlements error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 17e. UNSETTLE MONTHLY SETTLEMENT (POST to avoid body-on-DELETE issues)
app.post('/api/settlements/unsettle', authorizeAdmin, async (req, res) => {
  const { supervisor_id, month } = req.body;
  if (!supervisor_id || !month) {
    return res.status(400).json({ error: 'Missing supervisor_id or month.' });
  }

  try {
    if (mode === 'supabase') {
      const { error } = await supabase
        .from('monthly_settlements')
        .delete()
        .eq('supervisor_id', supervisor_id)
        .eq('month', month);
      if (error) throw error;
      return res.json({ success: true, message: 'Settlement deleted successfully.' });
    } else {
      const settlements = await readLocalFile('settlements.json');
      const filtered = settlements.filter(s => !(s.supervisor_id === supervisor_id && s.month === month));
      await writeLocalFile('settlements.json', filtered);
      return res.json({ success: true, message: 'Settlement deleted successfully.' });
    }
  } catch (err) {
    console.error('DELETE /api/settlements error:', err);
    res.status(500).json({ error: err.message });
  }
});


// Initialize storage bucket programmatically if in Supabase mode
async function initStorageBucket() {
  if (mode === 'supabase') {
    try {
      const { data: buckets, error: listError } = await supabase.storage.listBuckets();
      if (listError) throw listError;
      
      const exists = buckets.some(b => b.id === 'bill-photos');
      if (!exists) {
        console.log('📦 Creating public storage bucket "bill-photos" programmatically...');
        const { error: createError } = await supabase.storage.createBucket('bill-photos', {
          public: true,
          allowedMimeTypes: ['image/jpeg', 'image/png'],
          fileSizeLimit: 5242880 // 5MB limit
        });
        if (createError) throw createError;
        console.log('✓ Public storage bucket "bill-photos" created successfully!');
      } else {
        console.log('✓ Storage bucket "bill-photos" already exists.');
      }
    } catch (err) {
      console.warn('⚠️ Warning: Failed to initialize storage bucket programmatically:', err.message);
    }
  }
}

// Health check endpoint for cloud monitoring
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Catch-all fallback route to serve index.html for frontend single-page routing
app.get('*', (req, res) => {
  res.sendFile(path.join(clientBuildDir, 'index.html'));
});

// Start server
initLocalStorage().then(() => {
  return initStorageBucket();
}).then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Node server running on port http://localhost:${PORT} in [${mode}] mode.`);
  });
}).catch(err => {
  console.error('Failed to initialize local data folders:', err);
});

// Force restart nodemon to reload env variables 2026
