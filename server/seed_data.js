import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import pathLib from 'path';
import bcrypt from 'bcryptjs';
import ws from 'ws';

// Polyfill WebSocket for Supabase client on Node.js versions < 22
globalThis.WebSocket = ws;

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathLib.dirname(__filename);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

// Paths
const dataDir = pathLib.join(__dirname, 'data');
const publicUploadsDir = pathLib.join(__dirname, '../client/public/uploads');

// 1x1 transparent pixel PNG base64
const dummyImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const dummyImageBuffer = Buffer.from(dummyImageBase64, 'base64');

let mode = 'local';
let supabase = null;

if (supabaseUrl && supabaseUrl !== 'YOUR_SUPABASE_PROJECT_URL' && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  mode = 'supabase';
}

// Clear helper
async function clearAll() {
  console.log('🧹 Clearing existing data for fresh multi-month seed...');
  
  // Local files wipe
  try {
    const files = ['supervisors.json', 'expenses.json', 'labourers.json', 'income.json', 'expenditures.json', 'app_config.json', 'settlements.json'];
    for (const f of files) {
      await fs.writeFile(pathLib.join(dataDir, f), f === 'app_config.json' ? '{}' : '[]', 'utf8');
    }
    const uploadedFiles = await fs.readdir(publicUploadsDir);
    for (const file of uploadedFiles) {
      if (file !== '.gitkeep' && file !== '.' && file !== '..') {
        await fs.unlink(pathLib.join(publicUploadsDir, file)).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('Local wipe warning:', err.message);
  }

  // Supabase wipe
  if (mode === 'supabase') {
    const tables = ['expenses', 'supervisor_income', 'supervisor_expenditure', 'monthly_settlements', 'supervisors', 'labourers', 'app_config'];
    for (const table of tables) {
      try {
        await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
        await supabase.from(table).delete().neq('key', '');
      } catch {}
    }
    try {
      const { data: files } = await supabase.storage.from('bill-photos').list('', { limit: 1000 });
      if (files && files.length > 0) {
        await supabase.storage.from('bill-photos').remove(files.map(f => f.name));
      }
    } catch {}
  }
}

// Random helper
const randomChoice = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomRange = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomDate = (start, end) => {
  const date = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  return date.toISOString().split('T')[0];
};

async function seed() {
  await clearAll();

  console.log(`🌱 Seeding multi-month data (June, July, August) in mode: [${mode}]`);

  const adminHash = await bcrypt.hash('1234', 10);
  const pin1 = await bcrypt.hash('1111', 10);
  const pin2 = await bcrypt.hash('2222', 10);

  // Supervisors definition
  const supervisors = [
    { name: 'sup1', pin_hash: pin1 },
    { name: 'sup2', pin_hash: pin2 }
  ];

  // Labourers definition
  const labourersNames = [
    'Ramesh Kumar', 'Suresh Singh', 'Amit Patel', 
    'Vikram Rathore', 'Anil Sharma', 'Vijay Yadav'
  ];

  // Months config (up to today: July 21, 2026)
  const months = [
    { name: 'June', start: new Date('2026-06-01'), end: new Date('2026-06-30') },
    { name: 'July', start: new Date('2026-07-01'), end: new Date('2026-07-21') }
  ];

  const expenseItems = [
    { note: 'Cement bag purchase (10 bags)', min: 1200, max: 4500 },
    { note: 'Sand truck delivery', min: 4000, max: 8500 },
    { note: 'Steel rebars 12mm bundle', min: 8000, max: 15000 },
    { note: 'Red bricks (2000 units)', min: 5000, max: 9000 },
    { note: 'PVC drainage pipes', min: 800, max: 2500 },
    { note: 'Water tank 1000 Liters', min: 3500, max: 6000 },
    { note: 'Paint buckets & primers', min: 2000, max: 7000 },
    { note: 'Concrete mixer machine rental', min: 1500, max: 3000 },
    { note: 'Safety helmets & jackets pack', min: 1000, max: 2500 },
    { note: 'Door hinges and locks', min: 500, max: 1800 },
    { note: 'Wiring cables & sockets', min: 1200, max: 3800 },
    { note: 'Plywood sheets for scaffolding', min: 3000, max: 7500 },
    { note: 'Water tanker supply for curing', min: 600, max: 1200 },
    { note: 'Hammer, chisels, hand tools', min: 400, max: 1500 },
    { note: 'Site office LED tube lights', min: 300, max: 1000 },
    { note: 'First-aid box items & medicines', min: 200, max: 600 },
    { note: 'Drill machine accessory bits', min: 500, max: 1200 },
    { note: 'Tile adhesives & grout bags', min: 1500, max: 4000 },
    { note: 'Nails and binding wire roll', min: 400, max: 1000 },
    { note: 'Safety net and barrier tape', min: 800, max: 2200 }
  ];

  const generalExpenditures = [
    'Fuel for site diesel generator',
    'Chai & snacks for worker afternoon breaks',
    'Emergency tractor rent for site cleaning',
    'Local transport / auto fare for purchasing tools',
    'Drinking water cans purchase',
    'Tarpaulin sheets for rain protection',
    'Consumables (tapes, screws, thread rolls)',
    'Lunch expenses for client project review'
  ];

  if (mode === 'local') {
    // ---- LOCAL SEEDING ----
    const localConfig = { admin_pin_hash: adminHash };
    await fs.writeFile(pathLib.join(dataDir, 'app_config.json'), JSON.stringify(localConfig, null, 2), 'utf8');

    const localSups = supervisors.map((s, idx) => ({
      id: `sup-${idx + 1}`,
      name: s.name,
      pin_hash: s.pin_hash,
      created_at: new Date().toISOString()
    }));
    await fs.writeFile(pathLib.join(dataDir, 'supervisors.json'), JSON.stringify(localSups, null, 2), 'utf8');

    const localLabs = labourersNames.map((name, idx) => ({
      id: `lab-${idx + 1}`,
      name,
      created_at: new Date().toISOString()
    }));
    await fs.writeFile(pathLib.join(dataDir, 'labourers.json'), JSON.stringify(localLabs, null, 2), 'utf8');

    const localExpenses = [];
    const localIncome = [];
    const localExpenditures = [];
    
    let globalIndex = 0;

    for (const m of months) {
      console.log(`  Generating transactions for ${m.name}...`);
      
      // Expenses (6 per month)
      for (let i = 0; i < 6; i++) {
        const item = expenseItems[i % expenseItems.length];
        const sup = randomChoice(localSups);
        const filename = `bill-${Date.now()}-${globalIndex}.png`;
        await fs.writeFile(pathLib.join(publicUploadsDir, filename), dummyImageBuffer);

        localExpenses.push({
          id: `exp-${globalIndex + 1}`,
          supervisor_id: sup.id,
          supervisor_name: sup.name,
          amount: parseFloat(randomRange(item.min, item.max).toFixed(2)),
          note: `${m.name}: ${item.note}`,
          date: randomDate(m.start, m.end),
          photo_url: `/uploads/${filename}`,
          verified: Math.random() > 0.35,
          created_at: new Date(Date.now() - globalIndex * 60000).toISOString()
        });
        globalIndex++;
      }

      // Income (5 per month)
      for (let i = 0; i < 5; i++) {
        const sup = randomChoice(localSups);
        localIncome.push({
          id: `inc-${m.name}-${i + 1}`,
          supervisor_id: sup.id,
          supervisor_name: sup.name,
          amount: randomChoice([5000, 8000, 10000, 12000, 15000]),
          date: randomDate(m.start, m.end),
          note: `${m.name} cash allocation #${i + 1}`,
          created_at: new Date(Date.now() - (m.name.charCodeAt(0) * 10000 + i * 60000)).toISOString()
        });
      }

      // Expenditures (6 per month)
      for (let i = 0; i < 6; i++) {
        const sup = randomChoice(localSups);
        const isLabour = Math.random() > 0.5;
        let expType = 'general';
        let labId = null;
        let labName = null;
        let note = '';

        if (isLabour) {
          expType = 'labour';
          const lab = randomChoice(localLabs);
          labId = lab.id;
          labName = lab.name;
          note = `${m.name}: Daily wages payout for ${labName}`;
        } else {
          note = `${m.name}: ` + randomChoice(generalExpenditures);
        }

        localExpenditures.push({
          id: `expe-${m.name}-${i + 1}`,
          supervisor_id: sup.id,
          supervisor_name: sup.name,
          amount: parseFloat((isLabour ? randomRange(400, 800) : randomRange(200, 2500)).toFixed(2)),
          type: expType,
          labourer_id: labId,
          labourer_name: labName,
          note,
          date: randomDate(m.start, m.end),
          verified: Math.random() > 0.3,
          created_at: new Date(Date.now() - (m.name.charCodeAt(0) * 10000 + i * 60000)).toISOString()
        });
      }
    }

    await fs.writeFile(pathLib.join(dataDir, 'expenses.json'), JSON.stringify(localExpenses, null, 2), 'utf8');
    await fs.writeFile(pathLib.join(dataDir, 'income.json'), JSON.stringify(localIncome, null, 2), 'utf8');
    await fs.writeFile(pathLib.join(dataDir, 'expenditures.json'), JSON.stringify(localExpenditures, null, 2), 'utf8');

    // Generate June settlements for local mode
    const localSettlements = [];
    for (const sup of localSups) {
      const JuneInflow = localIncome
        .filter(i => i.supervisor_id === sup.id && i.date.startsWith('2026-06'))
        .reduce((sum, i) => sum + parseFloat(i.amount), 0);

      const JuneExpenditures = localExpenditures
        .filter(e => e.supervisor_id === sup.id && e.date.startsWith('2026-06'))
        .reduce((sum, e) => sum + parseFloat(e.amount), 0);

      const JuneBills = localExpenses
        .filter(b => b.supervisor_id === sup.id && b.date.startsWith('2026-06'))
        .reduce((sum, b) => sum + parseFloat(b.amount), 0);

      const cashLeft = JuneInflow - (JuneExpenditures + JuneBills);
      const salary = 30000;
      const netSalary = cashLeft - salary;

      localSettlements.push({
        id: `set-June-${sup.id}`,
        supervisor_id: sup.id,
        supervisor_name: sup.name,
        month: 'June 2026',
        salary,
        inflow: JuneInflow,
        outflow: JuneExpenditures + JuneBills,
        cash_left: cashLeft,
        net_salary: netSalary,
        created_at: new Date().toISOString()
      });
    }
    await fs.writeFile(pathLib.join(dataDir, 'settlements.json'), JSON.stringify(localSettlements, null, 2), 'utf8');

    console.log('✓ Local seeding finished successfully!');

  } else {
    // ---- SUPABASE CLOUD SEEDING ----
    // 1. App Config
    const { error: configErr } = await supabase.from('app_config').upsert([{ key: 'admin_pin_hash', value: adminHash }]);
    if (configErr) throw configErr;

    // 2. Supervisors
    const { data: sups, error: supErr } = await supabase.from('supervisors').insert(supervisors).select('*');
    if (supErr) throw supErr;

    // 3. Labourers
    const { data: labs, error: labErr } = await supabase.from('labourers').insert(labourersNames.map(name => ({ name }))).select('*');
    if (labErr) throw labErr;

    // Upload files and generate public URLs (12 files total for June, July)
    console.log('Uploading 12 bill photos to Supabase Storage...');
    const uploadedUrls = [];
    for (let i = 0; i < 12; i++) {
      const filename = `bill-${Date.now()}-${i}.png`;
      await supabase.storage.from('bill-photos').upload(filename, dummyImageBuffer, { contentType: 'image/png' });
      const { data } = supabase.storage.from('bill-photos').getPublicUrl(filename);
      uploadedUrls.push(data.publicUrl);
    }

    const dbExpenses = [];
    const dbIncome = [];
    const dbExpenditures = [];
    
    let globalIndex = 0;

    for (const m of months) {
      console.log(`  Preparing batch entries for ${m.name}...`);
      
      // Expenses (6 per month)
      for (let i = 0; i < 6; i++) {
        const item = expenseItems[i % expenseItems.length];
        const sup = randomChoice(sups);
        dbExpenses.push({
          supervisor_id: sup.id,
          supervisor_name: sup.name,
          amount: parseFloat(randomRange(item.min, item.max).toFixed(2)),
          note: `${m.name}: ${item.note}`,
          date: randomDate(m.start, m.end),
          photo_url: uploadedUrls[globalIndex],
          verified: Math.random() > 0.35
        });
        globalIndex++;
      }

      // Income (5 per month)
      for (let i = 0; i < 5; i++) {
        const sup = randomChoice(sups);
        dbIncome.push({
          supervisor_id: sup.id,
          supervisor_name: sup.name,
          amount: randomChoice([5000, 8000, 10000, 12000, 15000]),
          date: randomDate(m.start, m.end),
          note: `${m.name} cash allocation #${i + 1}`
        });
      }

      // Expenditures (6 per month)
      for (let i = 0; i < 6; i++) {
        const sup = randomChoice(sups);
        const isLabour = Math.random() > 0.5;
        let expType = 'general';
        let labId = null;
        let labName = null;
        let note = '';

        if (isLabour) {
          expType = 'labour';
          const lab = randomChoice(labs);
          labId = lab.id;
          labName = lab.name;
          note = `${m.name}: Daily wages payout for ${labName}`;
        } else {
          note = `${m.name}: ` + randomChoice(generalExpenditures);
        }

        dbExpenditures.push({
          supervisor_id: sup.id,
          supervisor_name: sup.name,
          amount: parseFloat((isLabour ? randomRange(400, 800) : randomRange(200, 2500)).toFixed(2)),
          type: expType,
          labourer_id: labId,
          labourer_name: labName,
          note,
          date: randomDate(m.start, m.end),
          verified: Math.random() > 0.3
        });
      }
    }

    console.log('Inserting data batches in Supabase...');
    const { error: expErr } = await supabase.from('expenses').insert(dbExpenses);
    if (expErr) throw expErr;
    console.log('  ✓ Seeded 18 Expenses');

    const { error: incErr } = await supabase.from('supervisor_income').insert(dbIncome);
    if (incErr) throw incErr;
    console.log('  ✓ Seeded 15 Income logs');

    const { error: expeErr } = await supabase.from('supervisor_expenditure').insert(dbExpenditures);
    if (expeErr) throw expeErr;
    console.log('  ✓ Seeded 18 Expenditures');

    console.log('Seeding June 2026 settlements as pre-settled in Supabase...');
    const JuneSettlements = [];
    for (const sup of sups) {
      const JuneInflow = dbIncome
        .filter(i => i.supervisor_id === sup.id && i.date.startsWith('2026-06'))
        .reduce((sum, i) => sum + parseFloat(i.amount), 0);

      const JuneExpenditures = dbExpenditures
        .filter(e => e.supervisor_id === sup.id && e.date.startsWith('2026-06'))
        .reduce((sum, e) => sum + parseFloat(e.amount), 0);

      const JuneBills = dbExpenses
        .filter(b => b.supervisor_id === sup.id && b.date.startsWith('2026-06'))
        .reduce((sum, b) => sum + parseFloat(b.amount), 0);

      const cashLeft = JuneInflow - (JuneExpenditures + JuneBills);
      const salary = 30000;
      const netSalary = cashLeft - salary;

      JuneSettlements.push({
        supervisor_id: sup.id,
        supervisor_name: sup.name,
        month: 'June 2026',
        salary,
        inflow: JuneInflow,
        outflow: JuneExpenditures + JuneBills,
        cash_left: cashLeft,
        net_salary: netSalary
      });
    }

    const { error: setErr } = await supabase.from('monthly_settlements').insert(JuneSettlements);
    if (setErr) throw setErr;
    console.log('  ✓ Seeded 2 June 2026 Monthly Settlements');
  }
}

async function run() {
  try {
    await seed();
    console.log('\n🎉 Multi-month bulk seeding successful! Clean 60 records loaded per table.');
  } catch (err) {
    console.error('Seed failed:', err);
  }
}

run();
