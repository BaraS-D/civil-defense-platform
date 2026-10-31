'use strict';

const $ = (s) => document.querySelector(s);
const TZ = 'Asia/Baghdad';
const fmtTime = (d) =>
  new Intl.DateTimeFormat('ar-IQ', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }).format(d);
const bust = () => '?_=' + Date.now();

// ---------- الخريطة ----------
const IRAQ_BOUNDS = [[29.0, 38.7], [37.4, 48.8]];
const map = L.map('map', { zoomControl: true }).fitBounds(IRAQ_BOUNDS);

function gibsDate() {
  const d = new Date(Date.now() - 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
const bases = {
  osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '© OpenStreetMap',
  }),
  esri: L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 18, attribution: 'Esri, Maxar, Earthstar Geographics' }),
  gibs: L.tileLayer(
    'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/' +
      gibsDate() + '/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg',
    { maxZoom: 9, attribution: 'NASA GIBS / VIIRS' }),
};
let currentBase = bases.osm.addTo(map);
document.querySelectorAll('input[name="base"]').forEach((r) =>
  r.addEventListener('change', () => {
    map.removeLayer(currentBase);
    currentBase = bases[r.value].addTo(map);
    currentBase.bringToBack();
  }));

// ---------- الرياح (Open-Meteo) ----------
const DIRS = ['الشمال', 'الشمال الشرقي', 'الشرق', 'الجنوب الشرقي', 'الجنوب', 'الجنوب الغربي', 'الغرب', 'الشمال الغربي'];
const dirName = (deg) => DIRS[Math.round(deg / 45) % 8];

async function windText(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      '&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh';
    const j = await (await fetch(url)).json();
    const { wind_speed_10m: sp, wind_direction_10m: dir } = j.current;
    const to = (dir + 180) % 360;
    return `الرياح: ${Math.round(sp)} كم/س تهب من ${dirName(dir)} باتجاه ${dirName(to)}`;
  } catch {
    return 'تعذر جلب بيانات الرياح';
  }
}

function openInfo(latlng, html) {
  const box = document.createElement('div');
  box.innerHTML = html +
    `<div><a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${latlng.lat},${latlng.lng}">فتح في خرائط Google</a></div>`;
  const wind = document.createElement('div');
  wind.className = 'wind';
  wind.textContent = 'جاري جلب الرياح…';
  box.appendChild(wind);
  L.popup().setLatLng(latlng).setContent(box).openOn(map);
  windText(latlng.lat, latlng.lng).then((t) => (wind.textContent = t));
}
map.on('click', (e) =>
  openInfo(e.latlng, `<b>الإحداثيات</b><br>${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`));

// ---------- الحرائق ----------
const fireLayer = L.layerGroup().addTo(map);
const flareLayer = L.layerGroup();
let fireRows = [];

function ageStyle(hours) {
  if (hours <= 6) return { color: '#d9381e', fill: '#d9381e', op: 0.85 };
  if (hours <= 24) return { color: '#e8982f', fill: '#e8982f', op: 0.75 };
  return { color: '#f0c36a', fill: '#f0c36a', op: 0.6 };
}

function fireInfo(p, ll) {
  const t = new Date(p.time);
  openInfo(ll,
    `<b>نقطة حرارية</b><br>وقت الرصد: ${fmtTime(t)}<br>` +
    `القمر: ${p.satellite} · الثقة: ${{ h: 'عالية', n: 'متوسطة', l: 'منخفضة' }[p.confidence] || p.confidence}<br>` +
    `القدرة الإشعاعية: ${p.frp} ميغاواط`);
}

function renderFires(geo) {
  fireLayer.clearLayers();
  flareLayer.clearLayers();
  fireRows = [];
  const now = Date.now();
  for (const f of geo.features) {
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    const ll = L.latLng(lat, lon);
    const radius = 4 + Math.min(p.frp || 0, 50) / 8;
    if (p.persistent) {
      L.circleMarker(ll, { radius: 4, color: '#7d8a94', weight: 2, fillOpacity: 0 })
        .on('click', (e) => { L.DomEvent.stopPropagation(e); fireInfo(p, ll); })
        .addTo(flareLayer);
      continue;
    }
    const hours = (now - new Date(p.time)) / 3600000;
    const s = ageStyle(hours);
    L.circleMarker(ll, { radius, color: s.color, fillColor: s.fill, fillOpacity: s.op, weight: 1 })
      .on('click', (e) => { L.DomEvent.stopPropagation(e); fireInfo(p, ll); })
      .addTo(fireLayer);
    fireRows.push({ p, ll, hours });
  }
  fireRows.sort((a, b) => a.hours - b.hours);
  const ul = $('#list-fires');
  ul.innerHTML = '';
  if (!fireRows.length) ul.innerHTML = '<li class="empty">لا توجد حرائق جديدة مرصودة في آخر 5 أيام.</li>';
  fireRows.slice(0, 100).forEach((r) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<span>حرارة ${r.p.frp} ميغاواط · ${fmtTime(new Date(r.p.time))}</span>` +
      `<small>${r.ll.lat.toFixed(4)}, ${r.ll.lng.toFixed(4)}</small>`;
    b.onclick = () => { map.flyTo(r.ll, 11); fireInfo(r.p, r.ll); };
    li.appendChild(b);
    ul.appendChild(li);
  });
}

$('#l-fires').onchange = (e) => (e.target.checked ? fireLayer.addTo(map) : map.removeLayer(fireLayer));
$('#l-flares').onchange = (e) => (e.target.checked ? flareLayer.addTo(map) : map.removeLayer(flareLayer));

$('#csv').onclick = () => {
  const head = 'lat,lon,time_utc,satellite,confidence,frp\n';
  const body = fireRows.map((r) =>
    [r.ll.lat, r.ll.lng, r.p.time, r.p.satellite, r.p.confidence, r.p.frp].join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + head + body], { type: 'text/csv' }));
  a.download = 'fires.csv';
  a.click();
};

// ---------- طبقات الغازات (Sentinel-5P) ----------
const gasOverlays = {};
let gasMeta = null;

function renderLegend() {
  const box = $('#legend');
  box.innerHTML = '';
  for (const [key, ov] of Object.entries(gasOverlays)) {
    if (!map.hasLayer(ov)) continue;
    const m = gasMeta.layers[key];
    const d = document.createElement('div');
    d.className = 'lg';
    d.innerHTML = `<b>${m.label} (${m.unit})</b>` +
      `<div class="bar" style="background:linear-gradient(to right,${m.colors.join(',')})"></div>` +
      `<div class="ends"><span>${m.vmin}</span><span>${m.vmax}</span></div>`;
    box.appendChild(d);
  }
}

function renderGas(meta, alerts) {
  gasMeta = meta;
  const wrap = $('#gas-layers');
  wrap.innerHTML = '';
  for (const [key, m] of Object.entries(meta.layers)) {
    const ov = L.imageOverlay(`data/s5p/${m.file}${bust()}`, meta.bounds, { opacity: +$('#opacity').value });
    gasOverlays[key] = ov;
    const lab = document.createElement('label');
    lab.innerHTML = `<span class="swatch" style="background:linear-gradient(to right,${m.colors.join(',')})"></span>` +
      `<input type="checkbox"> ${m.label}`;
    lab.querySelector('input').onchange = (e) => {
      e.target.checked ? ov.addTo(map) : map.removeLayer(ov);
      renderLegend();
    };
    wrap.appendChild(lab);
  }
  $('#opacity').oninput = (e) => Object.values(gasOverlays).forEach((o) => o.setOpacity(+e.target.value));

  const ul = $('#list-alerts');
  ul.innerHTML = '';
  if (!alerts.length) ul.innerHTML = '<li class="empty">لا توجد قراءات تجاوزت العتبات حالياً.</li>';
  alerts.forEach((a) => {
    const ll = L.latLng(a.lat, a.lon);
    L.circleMarker(ll, { radius: 9, color: '#6b3fa0', weight: 2, fillOpacity: 0.15 })
      .addTo(map)
      .on('click', (e) => { L.DomEvent.stopPropagation(e); gasInfo(a, ll); });
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<span>${a.label}: ${a.value} ${a.unit}</span><small>${a.lat.toFixed(3)}, ${a.lon.toFixed(3)}</small>`;
    b.onclick = () => { map.flyTo(ll, 8); gasInfo(a, ll); };
    li.appendChild(b);
    ul.appendChild(li);
  });
}

function gasInfo(a, ll) {
  openInfo(ll, `<b>${a.label}</b><br>القيمة: ${a.value} ${a.unit} (العتبة ${a.threshold})<br>` +
    '<small>قراءة بدقة ~5 كم، تحتاج تحققاً ميدانياً</small>');
}

// ---------- تبويبات + القائمة + البحث ----------
document.querySelectorAll('.tabs button').forEach((b) =>
  b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', x === b));
    $('#list-fires').hidden = b.dataset.tab !== 'fires';
    $('#list-alerts').hidden = b.dataset.tab !== 'alerts';
  });

$('#toggle').onclick = () => {
  const closed = $('#panel').classList.toggle('closed');
  $('#toggle').setAttribute('aria-expanded', !closed);
  setTimeout(() => map.invalidateSize(), 50);
};

$('#search').onsubmit = async (e) => {
  e.preventDefault();
  const q = $('#q').value.trim();
  if (!q) return;
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=iq&accept-language=ar&q=' +
      encodeURIComponent(q);
    const r = (await (await fetch(url)).json())[0];
    if (!r) return alert('لم يتم العثور على المكان');
    map.flyTo([+r.lat, +r.lon], 11);
  } catch { alert('تعذر البحث الآن'); }
};

// ---------- تحميل البيانات ----------
async function load() {
  let updated = [];
  try {
    const geo = await (await fetch('data/fires.geojson' + bust())).json();
    renderFires(geo);
    if (geo.updated) updated.push('الحرائق: ' + fmtTime(new Date(geo.updated)));
  } catch {
    $('#list-fires').innerHTML = '<li class="empty">لم تتوفر بيانات الحرائق بعد.</li>';
  }
  try {
    const meta = await (await fetch('data/s5p/meta.json' + bust())).json();
    const alerts = await (await fetch('data/s5p/alerts.json' + bust())).json();
    if (meta.layers && Object.keys(meta.layers).length) {
      renderGas(meta, alerts);
      updated.push('الغازات: ' + fmtTime(new Date(meta.updated)));
    }
  } catch {
    $('#gas-layers').innerHTML = '<div class="empty">لم تتوفر بيانات الغازات بعد.</div>';
  }
  $('#updated').textContent = updated.length ? 'آخر تحديث – ' + updated.join(' | ') : 'لا توجد بيانات بعد';
}
load();
