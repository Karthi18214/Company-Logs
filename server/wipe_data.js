import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import ws from 'ws';

// Polyfill WebSocket for Supabase client on Node.js versions < 22
globalThis.WebSocket = ws;

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

// Paths
const dataDir = path.join(__dirname, 'data');
const publicUploadsDir = path.join(__dirname, '../client/public/uploads');

async function wipeLocalData() {
  console.log('🧹 Wiping local JSON data files...');
  
  const files = [
    { name: 'supervisors.json', content: '[]' },
    { name: 'expenses.json', content: '[]' },
    { name: 'labourers.json', content: '[]' },
    { name: 'income.json', content: '[]' },
    { name: 'expenditures.json', content: '[]' },
    { name: 'app_config.json', content: '{}' },
    { name: 'settlements.json', content: '[]' }
  ];

  for (const f of files) {
    const filepath = path.join(dataDir, f.name);
    await fs.writeFile(filepath, f.content, 'utf8');
    console.log(`  - Reset ${f.name}`);
  }

  // Clear uploads folder
  try {
    const uploadedFiles = await fs.readdir(publicUploadsDir);
    for (const file of uploadedFiles) {
      if (file !== '.gitkeep' && file !== '.' && file !== '..') {
        const filepath = path.join(publicUploadsDir, file);
        const stat = await fs.stat(filepath);
        if (stat.isFile()) {
          await fs.unlink(filepath);
          console.log(`  - Deleted local file: ${file}`);
        }
      }
    }
  } catch (err) {
    console.warn(`  ⚠️ Local uploads dir clear issue: ${err.message}`);
  }
}

async function wipeSupabaseData() {
  if (!supabaseUrl || supabaseUrl === 'YOUR_SUPABASE_PROJECT_URL' || !supabaseKey) {
    console.log('⚠️ Supabase credentials missing. Cloud wipe skipped.');
    return;
  }

  console.log('⚡ Connecting to Supabase Cloud...');
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. Delete rows from database tables (order matters due to foreign keys if they are not cascaded)
  const tables = [
    'expenses',
    'supervisor_income',
    'supervisor_expenditure',
    'monthly_settlements',
    'supervisors',
    'labourers',
    'app_config'
  ];

  console.log('🗑️ Deleting data from database tables...');
  for (const table of tables) {
    try {
      const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000'); // delete all
      // For app_config, key is the primary key
      if (error) {
        // Fallback for non-uuid primary keys (like app_config)
        const { error: configError } = await supabase.from(table).delete().neq('key', '');
        if (configError) throw configError;
      }
      console.log(`  ✓ Cleared table: ${table}`);
    } catch (err) {
      console.error(`  ❌ Failed to clear table ${table}:`, err.message);
    }
  }

  // 2. Remove files from Supabase Storage bucket 'bill-photos'
  console.log('🗑️ Emptying "bill-photos" storage bucket...');
  try {
    const { data: files, error: listError } = await supabase.storage
      .from('bill-photos')
      .list('', { limit: 1000 });
      
    if (listError) throw listError;

    if (files && files.length > 0) {
      const filesToDelete = files.map(f => f.name);
      console.log(`  Found ${filesToDelete.length} files in bucket. Deleting...`);
      const { error: deleteError } = await supabase.storage
        .from('bill-photos')
        .remove(filesToDelete);
      
      if (deleteError) throw deleteError;
      console.log('  ✓ Storage bucket cleared.');
    } else {
      console.log('  ✓ Storage bucket is already empty.');
    }
  } catch (err) {
    console.error('  ❌ Storage cleanup failed:', err.message);
  }
}

async function run() {
  try {
    await wipeLocalData();
    await wipeSupabaseData();
    console.log('\n🎉 Successfully wiped all dummy data! You now have a clean slate.');
  } catch (err) {
    console.error('Wipe failed:', err);
  }
}

run();
