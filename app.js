// ===================== auth + cloud storage (Supabase) =====================
// יש להחליף בערכים האמיתיים מהפרויקט שלכם ב-supabase.com (Settings -> API)
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentUser = null;

const VEHICLE_FIELD_MAP = [
  ['plateNumber', 'plate_number'],
  ['manufacturer', 'manufacturer'],
  ['model', 'model'],
  ['year', 'year'],
  ['color', 'color'],
  ['fuelType', 'fuel_type'],
  ['currentKm', 'current_km'],
  ['vin', 'vin'],
  ['photo', 'photo'],
  ['serviceBookImages', 'service_book_images'],
  ['maintenanceIntervals', 'maintenance_intervals'],
];
const RECORD_FIELD_MAP = [
  ['date', 'date'], ['km', 'km'], ['part', 'part'], ['price', 'price'],
  ['provider', 'provider'], ['sku', 'sku'], ['receiptImage', 'receipt_image'],
];

function toRow(obj, fieldMap) {
  const row = {};
  for (const [camel, snake] of fieldMap) {
    if (obj[camel] !== undefined) row[snake] = obj[camel];
  }
  return row;
}
function fromRow(row, fieldMap) {
  if (!row) return null;
  const obj = { id: row.id };
  for (const [camel, snake] of fieldMap) {
    obj[camel] = row[snake];
  }
  return obj;
}

async function loadAppData() {
  const { data: vRow } = await supabaseClient.from('vehicles').select('*').eq('user_id', currentUser.id).maybeSingle();
  state.vehicle = fromRow(vRow, VEHICLE_FIELD_MAP);

  const { data: rRows } = await supabaseClient.from('maintenance_records').select('*').eq('user_id', currentUser.id).order('km', { ascending: false });
  state.records = (rRows || []).map(r => fromRow(r, RECORD_FIELD_MAP));
}

async function upsertVehicle(vehicle) {
  const row = toRow(vehicle, VEHICLE_FIELD_MAP);
  row.user_id = currentUser.id;
  const { data, error } = await supabaseClient.from('vehicles').upsert(row, { onConflict: 'user_id' }).select().single();
  if (!error) state.vehicle = fromRow(data, VEHICLE_FIELD_MAP);
  return error;
}

async function updateVehicleFields(patch) {
  const row = toRow(patch, VEHICLE_FIELD_MAP);
  const { data, error } = await supabaseClient.from('vehicles').update(row).eq('user_id', currentUser.id).select().single();
  if (!error) state.vehicle = fromRow(data, VEHICLE_FIELD_MAP);
  return error;
}

async function insertRecord(record) {
  const row = toRow(record, RECORD_FIELD_MAP);
  row.user_id = currentUser.id;
  const { data, error } = await supabaseClient.from('maintenance_records').insert(row).select().single();
  if (!error && data) state.records.unshift(fromRow(data, RECORD_FIELD_MAP));
  return error;
}

async function insertRecordsBulk(records) {
  const rows = records.map(r => ({ ...toRow(r, RECORD_FIELD_MAP), user_id: currentUser.id }));
  const { data, error } = await supabaseClient.from('maintenance_records').insert(rows).select();
  if (!error && data) {
    const mapped = data.map(r => fromRow(r, RECORD_FIELD_MAP));
    state.records = [...mapped, ...state.records];
  }
  return error;
}

async function sendMagicLink() {
  const email = document.getElementById('auth-email').value.trim();
  const statusEl = document.getElementById('auth-status');
  if (!email) return;
  statusEl.innerHTML = '<div class="hint">שולח קישור…</div>';
  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  statusEl.innerHTML = error
    ? `<div class="status-banner error">${escapeHtml(error.message)}</div>`
    : '<div class="status-banner success">נשלח! פתחו את תיבת המייל שלכם ולחצו על הקישור כדי להיכנס.</div>';
}

async function signOut() {
  await supabaseClient.auth.signOut();
}

function showAuthScreen() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-auth').classList.add('active');
}

supabaseClient.auth.onAuthStateChange(async (event, session) => {
  if (session) {
    currentUser = session.user;
    await loadAppData();
    goTo('home');
  } else {
    currentUser = null;
    showAuthScreen();
  }
});

let state = { vehicle: null, records: [] };
let selectedProvider = 'garage';
let pendingReceiptImage = null;

// ===================== image helpers =====================

/** מקטין ודוחס תמונה כדי לא לפוצץ את מקום האחסון המקומי (localStorage) */
function compressImage(file, maxDim = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round(height * (maxDim / width));
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round(width * (maxDim / height));
          height = maxDim;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** מריץ הסרת רקע מלאה בדפדפן (ONNX/WASM, ללא שרת) ומחזיר PNG שקוף כ-base64 */
async function removeBackgroundFromFile(file) {
  const mod = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm');
  const removeBackground = mod.default || mod.removeBackground;
  const blob = await removeBackground(file);
  return await blobToDataURL(blob);
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

const DEFAULT_MAINTENANCE_INTERVALS = [
  { key: 'שמן', label: 'שמן ומסנן שמן', intervalKm: 10000 },
  { key: 'רפידות', label: 'רפידות בלמים', intervalKm: 50000 },
  { key: 'מסנן אוויר', label: 'מסנן אוויר', intervalKm: 15000 },
  { key: 'קירור', label: 'נוזל קירור', intervalKm: 60000 },
  { key: 'טיימינג', label: 'רצועת טיימינג', intervalKm: 100000 },
];

function getActiveIntervals() {
  const custom = state.vehicle && state.vehicle.maintenanceIntervals;
  return (custom && custom.length) ? custom : DEFAULT_MAINTENANCE_INTERVALS;
}

// ===================== navigation =====================
function goTo(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + screenId).classList.add('active');
  if (screenId === 'home') renderHome();
  if (screenId === 'add-record') {
    document.getElementById('f-date').value = new Date().toISOString().slice(0, 10);
    if (state.vehicle) document.getElementById('f-km').value = state.vehicle.currentKm;
    resetReceiptUpload();
  }
}

// ===================== vehicle lookup =====================
async function lookupVehicle() {
  const plateRaw = document.getElementById('plate-input').value;
  const plate = plateRaw.replace(/[^0-9]/g, '');
  const statusEl = document.getElementById('lookup-status');
  const resultEl = document.getElementById('lookup-result');
  resultEl.style.display = 'none';
  statusEl.innerHTML = '';

  if (!plate) return;

  statusEl.innerHTML = '<div class="hint">מחפש במאגר משרד התחבורה…</div>';

  try {
    const url = 'https://data.gov.il/api/3/action/datastore_search?resource_id=053cea08-09bc-40ec-8f7a-156f0677aff3&filters=' +
      encodeURIComponent(JSON.stringify({ mispar_rechev: plate }));
    const res = await fetch(url);
    const data = await res.json();
    const record = data?.result?.records?.[0];

    if (!record) {
      statusEl.innerHTML = '<div class="status-banner error">לא נמצא רכב עם מספר רישוי זה במאגר</div>';
      return;
    }

    statusEl.innerHTML = '';
    document.getElementById('r-model').textContent = `${record.tozeret_nm || ''} ${record.kinuy_mishari || ''}`.trim();
    document.getElementById('r-year').textContent = record.shnat_yitzur || '—';
    document.getElementById('r-color').textContent = record.tzeva_rechev || '—';
    document.getElementById('r-fuel').textContent = record.sug_delek_nm || '—';
    document.getElementById('r-km').value = record.km || '';
    resultEl.style.display = 'block';
    resultEl.dataset.plate = plate;
    resultEl.dataset.manufacturer = record.tozeret_nm || '';
    resultEl.dataset.model = record.kinuy_mishari || '';
    resultEl.dataset.year = record.shnat_yitzur || '';
    resultEl.dataset.color = record.tzeva_rechev || '';
    resultEl.dataset.fuel = record.sug_delek_nm || '';
  } catch (e) {
    statusEl.innerHTML = '<div class="status-banner error">שגיאה בחיבור למאגר. בדקו את החיבור לאינטרנט ונסו שוב.</div>';
  }
}

async function saveVehicle() {
  const resultEl = document.getElementById('lookup-result');
  const km = parseInt(document.getElementById('r-km').value) || 0;

  const vehicle = {
    plateNumber: resultEl.dataset.plate,
    manufacturer: resultEl.dataset.manufacturer,
    model: resultEl.dataset.model,
    year: resultEl.dataset.year,
    color: resultEl.dataset.color,
    fuelType: resultEl.dataset.fuel,
    currentKm: km,
  };
  const error = await upsertVehicle(vehicle);
  if (error) {
    alert('שגיאה בשמירת הרכב: ' + error.message);
    return;
  }

  document.getElementById('plate-input').value = '';
  document.getElementById('lookup-result').style.display = 'none';
  document.getElementById('lookup-status').innerHTML = '';

  goTo('home');
}

// ===================== record form =====================
function selectProvider(p) {
  selectedProvider = p;
  document.getElementById('seg-garage').classList.toggle('selected', p === 'garage');
  document.getElementById('seg-self').classList.toggle('selected', p === 'self');
}

async function saveRecord() {
  const date = document.getElementById('f-date').value;
  const km = parseInt(document.getElementById('f-km').value);
  const part = document.getElementById('f-part').value.trim();
  const price = parseFloat(document.getElementById('f-price').value);
  const sku = document.getElementById('f-sku').value.trim();

  if (!date || !km || !part || isNaN(price)) {
    alert('נא למלא את כל השדות החיוניים');
    return;
  }

  const error = await insertRecord({
    date, km, part, price,
    provider: selectedProvider,
    sku,
    receiptImage: pendingReceiptImage,
  });
  if (error) {
    alert('שגיאה בשמירת הרשומה: ' + error.message);
    return;
  }
  if (state.vehicle && km > state.vehicle.currentKm) {
    await updateVehicleFields({ currentKm: km });
  }

  document.getElementById('f-part').value = '';
  document.getElementById('f-price').value = '';
  document.getElementById('f-sku').value = '';
  resetReceiptUpload();

  goTo('home');
}

// ===================== vehicle photo (with background removal) =====================
function triggerVehiclePhoto() {
  document.getElementById('vehicle-photo-input').click();
}

async function onVehiclePhotoSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  const loadingEl = document.getElementById('vehicle-photo-loading');
  loadingEl.style.display = 'flex';

  try {
    const cleanImage = await removeBackgroundFromFile(file);
    await updateVehicleFields({ photo: cleanImage });
  } catch (e) {
    // אם הסרת הרקע נכשלה (למשל בעיית רשת בהורדת המודל) - נשמור
    // לפחות את התמונה המקורית הדחוסה, כדי שלא לאבד את התיעוד.
    console.error('background removal failed', e);
    const fallback = await compressImage(file, 900, 0.75);
    await updateVehicleFields({ photo: fallback });
  } finally {
    loadingEl.style.display = 'none';
    renderVehiclePhoto();
    event.target.value = '';
  }
}

function renderVehiclePhoto() {
  const img = document.getElementById('vehicle-photo-img');
  const placeholder = document.getElementById('vehicle-photo-placeholder');
  if (state.vehicle && state.vehicle.photo) {
    img.src = state.vehicle.photo;
    img.style.display = 'block';
    placeholder.style.display = 'none';
  } else {
    img.style.display = 'none';
    placeholder.style.display = 'flex';
  }
}

// ===================== service book pages =====================
function triggerServiceBook() {
  document.getElementById('service-book-input').click();
}

async function onServiceBookSelected(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  const images = (state.vehicle.serviceBookImages || []).slice();

  for (const file of files) {
    const compressed = await compressImage(file, 700, 0.65);
    images.push(compressed);
  }
  await updateVehicleFields({ serviceBookImages: images });
  renderServiceBook();
  event.target.value = '';
}

function renderServiceBook() {
  const list = document.getElementById('service-book-list');
  const hint = document.getElementById('service-book-hint');
  const analyzeWrap = document.getElementById('service-book-analyze-wrap');
  const images = (state.vehicle && state.vehicle.serviceBookImages) || [];
  if (!images.length) {
    list.innerHTML = '';
    hint.style.display = 'none';
    analyzeWrap.style.display = 'none';
    return;
  }
  hint.style.display = 'block';
  analyzeWrap.style.display = 'block';
  list.innerHTML = images.map((src, i) =>
    `<img src="${src}" alt="עמוד ספר רכב ${i + 1}">`
  ).join('');
}

async function analyzeServiceBook() {
  const images = (state.vehicle && state.vehicle.serviceBookImages) || [];
  if (!images.length) return;

  const statusEl = document.getElementById('service-book-analyze-status');
  statusEl.innerHTML = '<div class="hint">מנתח את ספר הרכב עם AI, מחפש טבלת מרווחי טיפול…</div>';

  try {
    const res = await fetch('/api/parse-service-book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: images.slice(0, 6) }),
    });
    const data = await res.json();

    if (!res.ok) {
      statusEl.innerHTML = `<div class="status-banner error">${escapeHtml(data.error || 'שגיאה בניתוח ספר הרכב')}</div>`;
      return;
    }

    if (!data.intervals || !data.intervals.length) {
      statusEl.innerHTML = `<div class="status-banner error">לא זוהתה טבלת מרווחי טיפול ברורה בתמונות שהועלו. ${escapeHtml(data.manufacturer || '')}</div>`;
      return;
    }

    const intervals = data.intervals.map(it => ({
      key: it.label.split(' ')[0],
      label: it.label,
      intervalKm: it.intervalKm,
    }));
    await updateVehicleFields({ maintenanceIntervals: intervals });

    const summary = data.intervals.map(it => `${it.label} (${it.intervalKm.toLocaleString()} ק״מ)`).join(' · ');
    statusEl.innerHTML = `<div class="status-banner success">זוהו ${data.intervals.length} מרווחי טיפול${data.manufacturer ? ' עבור ' + escapeHtml(data.manufacturer) : ''}: ${escapeHtml(summary)}</div>`;
    renderHome();
  } catch (e) {
    statusEl.innerHTML = '<div class="status-banner error">שגיאת רשת בניתוח ספר הרכב.</div>';
  }
}

// ===================== editable VIN =====================
async function editVin() {
  if (!state.vehicle) return;
  const current = state.vehicle.vin || '';
  const next = prompt('מספר שלדה (VIN) - מודפס על רישיון הרכב, 17 תווים בדרך כלל:', current);
  if (next === null) return;
  await updateVehicleFields({ vin: next.trim().toUpperCase() });
  renderHome();
}

function renderVin() {
  const el = document.getElementById('vin-display');
  const text = (state.vehicle && state.vehicle.vin) ? `VIN: ${state.vehicle.vin}` : '+ הוספת מספר שלדה (VIN)';
  el.innerHTML = `${escapeHtml(text)}<i class="ti ti-pencil" style="font-size:12px;"></i>`;
}

// ===================== editable km =====================
async function editCurrentKm() {
  if (!state.vehicle) return;
  const current = state.vehicle.currentKm || 0;
  const next = prompt('עדכון ק״מ נוכחי:', current);
  if (next === null) return;
  const parsed = parseInt(next.replace(/[^0-9]/g, ''));
  if (isNaN(parsed)) return;
  await updateVehicleFields({ currentKm: parsed });
  renderHome();
}

// ===================== receipt photo (on add-record screen) =====================
function triggerReceiptPhoto() {
  document.getElementById('receipt-input').click();
}

async function onReceiptSelected(event) {
  const file = event.target.files[0];
  if (!file) return;
  const compressed = await compressImage(file, 1100, 0.75);
  pendingReceiptImage = compressed;

  const img = document.getElementById('receipt-preview');
  const placeholder = document.getElementById('receipt-placeholder');
  img.src = compressed;
  img.style.display = 'block';
  placeholder.style.display = 'none';

  const statusEl = document.getElementById('receipt-process-status');
  statusEl.innerHTML = '<div class="hint" style="margin-top:8px;">קורא את הקבלה ומתעד אוטומטית…</div>';

  try {
    const res = await fetch('/api/parse-receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: compressed }),
    });
    const data = await res.json();

    if (!res.ok) {
      statusEl.innerHTML = `<div class="status-banner error" style="margin:8px 0 0;">${escapeHtml(data.error || 'שגיאה בעיבוד הקבלה')}. אפשר למלא ידנית.</div>`;
      return;
    }

    if (data.date) document.getElementById('f-date').value = data.date;
    if (data.km) document.getElementById('f-km').value = data.km;
    if (data.part) document.getElementById('f-part').value = data.part;
    if (data.price) document.getElementById('f-price').value = data.price;
    if (data.sku) document.getElementById('f-sku').value = data.sku;
    selectProvider(data.provider === 'self' ? 'self' : 'garage');

    statusEl.innerHTML = '<div class="status-banner success" style="margin:8px 0 0;">הטופס מולא אוטומטית מהקבלה - כדאי לבדוק ולתקן במידת הצורך</div>';
  } catch (e) {
    statusEl.innerHTML = '<div class="status-banner error" style="margin:8px 0 0;">שגיאת רשת בעיבוד הקבלה. אפשר למלא ידנית.</div>';
  }
}

function resetReceiptUpload() {
  pendingReceiptImage = null;
  const img = document.getElementById('receipt-preview');
  const placeholder = document.getElementById('receipt-placeholder');
  img.style.display = 'none';
  img.src = '';
  placeholder.style.display = 'flex';
  document.getElementById('receipt-process-status').innerHTML = '';
}

// ===================== excel import (AI-powered) =====================
function triggerExcelImport() {
  document.getElementById('excel-input').click();
}

function onExcelSelected(event) {
  const file = event.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById('excel-status');
  statusEl.innerHTML = '<div class="hint">קורא קובץ…</div>';

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const workbook = XLSX.read(e.target.result, { type: 'array', cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const csv = XLSX.utils.sheet_to_csv(sheet);

      if (!csv.trim()) {
        statusEl.innerHTML = '<div class="status-banner error">הקובץ ריק</div>';
        return;
      }

      statusEl.innerHTML = '<div class="hint">מנתח את הקובץ עם AI, כולל זיהוי עמודות אוטומטי…</div>';

      const res = await fetch('/api/parse-spreadsheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();

      if (!res.ok) {
        statusEl.innerHTML = `<div class="status-banner error">${escapeHtml(data.error || 'שגיאה בניתוח הקובץ')}</div>`;
        return;
      }

      if (!data.records || !data.records.length) {
        statusEl.innerHTML = '<div class="status-banner error">לא זוהו רשומות טיפול בקובץ</div>';
        return;
      }

      const bulkError = await insertRecordsBulk(data.records);
      if (bulkError) {
        statusEl.innerHTML = `<div class="status-banner error">שגיאה בשמירה: ${escapeHtml(bulkError.message)}</div>`;
        return;
      }

      const maxKm = Math.max(...state.records.map(r => r.km));
      if (state.vehicle && maxKm > state.vehicle.currentKm) {
        await updateVehicleFields({ currentKm: maxKm });
      }
      statusEl.innerHTML = `<div class="status-banner success">יובאו ${data.records.length} רשומות בהצלחה על ידי ה-AI</div>`;
      renderHome();
    } catch (err) {
      console.error(err);
      statusEl.innerHTML = '<div class="status-banner error">שגיאה בקריאת הקובץ. ודאו שזה קובץ xlsx/csv תקין.</div>';
    }
    event.target.value = '';
  };
  reader.readAsArrayBuffer(file);
}

// ===================== rendering: home =====================
function renderHome() {
  const empty = document.getElementById('home-empty');
  const content = document.getElementById('home-content');

  if (!state.vehicle) {
    empty.style.display = 'block';
    content.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  content.style.display = 'block';

  const v = state.vehicle;
  document.getElementById('plate-number').textContent = formatPlate(v.plateNumber);
  document.getElementById('vehicle-name').textContent = `${v.manufacturer} ${v.model}`.trim();
  document.getElementById('vehicle-sub').textContent = `${v.year} · ${v.fuelType} · ${v.color}`;

  const total = state.records.reduce((sum, r) => sum + r.price, 0);
  document.getElementById('metric-total').textContent = `${Math.round(total).toLocaleString()} ₪`;
  document.getElementById('metric-km').textContent = v.currentKm.toLocaleString();

  const events = buildEvents(v.currentKm);
  const nextEvent = events
    .filter(e => e.status !== 'done')
    .sort((a, b) => a.km - b.km)[0];
  document.getElementById('metric-next').textContent = nextEvent
    ? `${nextEvent.km.toLocaleString()} ק״מ`
    : '—';

  renderGauge(v.currentKm, events);
  renderRecords();
  renderVehiclePhoto();
  renderServiceBook();
  renderVin();
}

function formatPlate(p) {
  if (!p) return '';
  if (p.length === 8) return `${p.slice(0,3)}-${p.slice(3,5)}-${p.slice(5)}`;
  if (p.length === 7) return `${p.slice(0,2)}-${p.slice(2,5)}-${p.slice(5)}`;
  return p;
}

function buildEvents(currentKm) {
  const events = [];
  for (const interval of getActiveIntervals()) {
    const relevant = state.records
      .filter(r => r.part.includes(interval.key))
      .sort((a, b) => b.km - a.km);

    for (const r of relevant) {
      events.push({ km: r.km, label: interval.label, status: 'done' });
    }

    const lastKm = relevant.length ? relevant[0].km : 0;
    const nextKm = lastKm + interval.intervalKm;
    const status = nextKm <= currentKm ? 'overdue' : (nextKm - currentKm <= interval.intervalKm * 0.15 ? 'upcoming' : 'upcoming');
    events.push({ km: nextKm, label: interval.label, status });
  }
  return events;
}

function renderRecords() {
  const list = document.getElementById('records-list');
  if (!state.records.length) {
    list.innerHTML = '<p class="hint" style="padding-top:6px;">עדיין אין רשומות טיפול</p>';
    return;
  }
  list.innerHTML = state.records.map(r => `
    <div class="record-row">
      <div>
        <p class="record-name">${escapeHtml(r.part)}${r.receiptImage ? ' <span class="receipt-tag">קבלה מצורפת</span>' : ''}</p>
        <p class="record-meta">${r.date} · ${r.km.toLocaleString()} ק״מ · ${r.provider === 'garage' ? 'מוסך' : 'עצמי'}${r.sku ? ' · ' + escapeHtml(r.sku) : ''}</p>
      </div>
      <div class="record-price">${Math.round(r.price).toLocaleString()} ₪</div>
    </div>
  `).join('');
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// ===================== rendering: gauge timeline =====================
const PX_PER_1000 = 22;

function renderGauge(currentKm, events) {
  const gauge = document.getElementById('gauge');
  const minKm = 0;
  const maxKm = Math.max(500000, Math.ceil((currentKm + 20000) / 10000) * 10000);

  const xFor = km => (km - minKm) / 1000 * PX_PER_1000;
  const totalWidth = xFor(maxKm) + 80;
  gauge.style.width = totalWidth + 'px';

  let html = '<div class="gauge-baseline"></div>';

  for (let k = minKm; k <= maxKm; k += 10000) {
    const x = xFor(k);
    html += `<div class="gauge-tick" style="right:${x}px"></div>`;
    html += `<div class="gauge-tick-label" style="right:${x}px">${k / 1000}K</div>`;
  }

  const cx = xFor(currentKm);
  html += `<div class="gauge-current" style="right:${cx}px"></div>`;
  html += `<div class="gauge-current-label" style="right:${cx}px">${(currentKm/1000).toFixed(1)}K</div>`;

  events.forEach((e, i) => {
    const x = xFor(e.km);
    const top = i % 2 === 0 ? 8 : 98;
    const icon = e.status === 'done' ? '✓' : (e.status === 'overdue' ? '!' : '·');
    html += `
      <div class="gauge-event" style="right:${x}px; top:${top}px;" data-label="${escapeHtml(e.label)}" data-km="${e.km}" data-status="${e.status}">
        <div class="gauge-event-dot ${e.status}">${icon}</div>
        <div class="gauge-event-km">${(e.km/1000).toFixed(0)}K</div>
        <div class="gauge-event-label">${escapeHtml(e.label)}</div>
      </div>`;
  });

  gauge.innerHTML = html;

  gauge.querySelectorAll('.gauge-event').forEach(el => {
    el.addEventListener('click', () => {
      showPartDetail(el.dataset.label, parseInt(el.dataset.km), el.dataset.status);
    });
  });

  const scrollWrap = document.getElementById('gauge-scroll');
  requestAnimationFrame(() => {
    scrollWrap.scrollLeft = Math.max(0, xFor(currentKm) - 220);
  });
}

// ===================== part detail modal =====================
const CATEGORY_ICON_MAP = [
  ['שמן', 'ti-droplet'],
  ['רפידות', 'ti-disc'],
  ['בלמ', 'ti-disc'],
  ['מסנן אוויר', 'ti-wind'],
  ['אוויר', 'ti-wind'],
  ['קירור', 'ti-temperature'],
  ['טיימינג', 'ti-settings'],
  ['רצועה', 'ti-settings'],
  ['מצת', 'ti-bolt'],
  ['מצבר', 'ti-battery'],
  ['גיר', 'ti-manual-gearbox'],
  ['צמיג', 'ti-circle'],
];

function guessIcon(label) {
  const match = CATEGORY_ICON_MAP.find(([key]) => label.includes(key));
  return match ? match[1] : 'ti-tool';
}

function showPartDetail(label, km, status) {
  document.getElementById('part-modal-icon').innerHTML = `<i class="ti ${guessIcon(label)}"></i>`;
  document.getElementById('part-modal-title').textContent = label;

  const statusText = status === 'done'
    ? `בוצע ב-${km.toLocaleString()} ק״מ`
    : status === 'overdue'
      ? `באיחור - היה צפוי ב-${km.toLocaleString()} ק״מ`
      : `צפוי ב-${km.toLocaleString()} ק״מ`;
  document.getElementById('part-modal-sub').textContent = statusText;

  const v = state.vehicle;

  document.getElementById('part-modal-disclaimer').textContent = v.vin
    ? 'החיפוש ב-PartSouq מבוסס על מספר השילדה של הרכב שלכם - הכי מדויק שיש. עדיין מומלץ לוודא התאמה מול המוסך לפני הזמנה.'
    : 'אין עדיין VIN שמור לרכב הזה, אז PartSouq יחפש לפי טקסט חופשי. הוסיפו VIN למעלה (ליד שם הרכב) לחיפוש מדויק יותר. ב-Cars245 יש לבחור את הרכב ידנית.';

  const queryText = `${v.manufacturer} ${v.model} ${v.year} ${label}`.trim();
  const q = encodeURIComponent(queryText);

  const partsouqUrl = v.vin
    ? `https://partsouq.com/search/vin?vin=${encodeURIComponent(v.vin)}`
    : `https://partsouq.com/en/search/all?q=${q}`;
  const partsouqLabel = v.vin ? `PartSouq - חיפוש לפי VIN (${v.vin})` : 'חיפוש מק"ט ב-PartSouq';

  const links = [
    { name: partsouqLabel, icon: 'ti-search', url: partsouqUrl },
    { name: 'Cars245 - בחירת רכב וחלק', icon: 'ti-photo', url: `https://cars245.com/en/` },
  ];
  document.getElementById('part-modal-links').innerHTML = links.map(l =>
    `<a href="${l.url}" target="_blank" rel="noopener" class="btn-secondary part-modal-link"><i class="ti ${l.icon}" style="font-size:15px;vertical-align:-2px;margin-left:6px;"></i>${escapeHtml(l.name)}</a>`
  ).join('');

  document.getElementById('part-modal-overlay').classList.add('show');
}

function closePartModal() {
  document.getElementById('part-modal-overlay').classList.remove('show');
}

// ===================== export service log (xlsx) =====================
function exportServiceLog() {
  if (!state.vehicle || typeof XLSX === 'undefined') return;
  const v = state.vehicle;

  const infoRows = [
    ['ספר טיפולים - AutoLog', ''],
    ['', ''],
    ['יצרן ודגם', `${v.manufacturer} ${v.model}`.trim()],
    ['שנת ייצור', v.year],
    ['מספר רישוי', formatPlate(v.plateNumber)],
    ['צבע', v.color],
    ['סוג דלק', v.fuelType],
    ['ק״מ נוכחי', v.currentKm],
    ['תאריך הפקת הדוח', new Date().toLocaleDateString('he-IL')],
  ];
  const wsInfo = XLSX.utils.aoa_to_sheet(infoRows);
  wsInfo['!cols'] = [{ wch: 20 }, { wch: 30 }];

  const header = ['תאריך', 'ק״מ', 'מה בוצע', 'מחיר (₪)', 'בוצע על ידי', 'מק״ט'];
  const sortedRecords = [...state.records].sort((a, b) => a.km - b.km);
  const dataRows = sortedRecords.map(r => [
    r.date,
    r.km,
    r.part,
    r.price,
    r.provider === 'garage' ? 'מוסך' : 'עצמי',
    r.sku || '',
  ]);
  const total = state.records.reduce((sum, r) => sum + r.price, 0);

  const wsRecords = XLSX.utils.aoa_to_sheet([
    header,
    ...dataRows,
    [],
    ['', '', 'סה״כ הוצאות', total, '', ''],
  ]);
  wsRecords['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 36 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsInfo, 'פרטי רכב');
  XLSX.utils.book_append_sheet(wb, wsRecords, 'היסטוריית טיפולים');

  const safePlate = formatPlate(v.plateNumber).replace(/[^0-9-]/g, '');
  XLSX.writeFile(wb, `ספר_טיפולים_${safePlate}.xlsx`);
}

// ===================== startup sound =====================
let startupSoundPlayed = false;

function playStartupSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(55, now);
    osc.frequency.exponentialRampToValueAtTime(150, now + 0.3);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.85);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(40, now);
    sub.frequency.exponentialRampToValueAtTime(70, now + 0.3);
    sub.frequency.exponentialRampToValueAtTime(48, now + 0.85);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(350, now);
    filter.frequency.linearRampToValueAtTime(950, now + 0.3);
    filter.frequency.linearRampToValueAtTime(450, now + 0.9);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 0.12);
    gain.gain.linearRampToValueAtTime(0.11, now + 0.45);
    gain.gain.linearRampToValueAtTime(0, now + 1.05);

    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    sub.start(now);
    osc.stop(now + 1.1);
    sub.stop(now + 1.1);
    osc.onended = () => ctx.close();
  } catch (e) {
    // Web Audio לא זמין - פשוט בלי צליל, לא קריטי
  }
}

function tryPlayStartupSound() {
  if (startupSoundPlayed) return;
  startupSoundPlayed = true;
  playStartupSound();
}

window.addEventListener('load', tryPlayStartupSound);
document.addEventListener('pointerdown', tryPlayStartupSound, { once: true });
document.addEventListener('touchstart', tryPlayStartupSound, { once: true });

// ===================== install prompt =====================
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const hint = document.getElementById('install-hint');
  if (!localStorage.getItem('install_hint_dismissed')) {
    hint.classList.add('show');
  }
});

document.getElementById('install-hint')?.addEventListener('click', async (e) => {
  if (e.target.tagName === 'BUTTON' && deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    dismissInstallHint();
  }
});

function dismissInstallHint() {
  document.getElementById('install-hint').classList.remove('show');
  localStorage.setItem('install_hint_dismissed', '1');
}

// ===================== init =====================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
