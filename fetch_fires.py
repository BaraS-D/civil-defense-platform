"""يسحب النقاط الحرارية من NASA FIRMS (VIIRS) للعراق ويكتب data/fires.geojson

المتغير المطلوب: FIRMS_MAP_KEY
النقاط التي تتكرر في نفس الموقع 3 أيام أو أكثر من آخر 5 أيام تُعلَّم persistent
(غالباً مشاعل نفط وغاز أو منشآت صناعية) حتى لا تختلط بالحرائق الجديدة.
"""
import csv
import io
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone

import requests

KEY = os.environ.get("FIRMS_MAP_KEY")
if not KEY:
    sys.exit("FIRMS_MAP_KEY غير موجود")

BBOX = "38.7,29.0,48.8,37.4"  # غرب,جنوب,شرق,شمال (العراق)
SOURCES = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT"]
DAYS = 5
PERSIST_MIN_DAYS = 3
CELL = 0.02  # ~2 كم

rows = []
for src in SOURCES:
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/{src}/{BBOX}/{DAYS}"
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    text = r.text.strip()
    if not text.startswith("latitude"):
        sys.exit(f"رد غير متوقع من FIRMS ({src}): {text[:200]}")
    rows.extend(csv.DictReader(io.StringIO(text)))

# عدّ الأيام المختلفة لكل خلية مكانية
days_per_cell = defaultdict(set)
for r in rows:
    cell = (round(float(r["latitude"]) / CELL), round(float(r["longitude"]) / CELL))
    days_per_cell[cell].add(r["acq_date"])

features = []
seen = set()
for r in rows:
    conf = r["confidence"].strip().lower()
    if conf == "l":  # تجاهل الثقة المنخفضة لتقليل الإنذارات الكاذبة
        continue
    lat, lon = float(r["latitude"]), float(r["longitude"])
    hhmm = r["acq_time"].zfill(4)
    t = datetime.strptime(f"{r['acq_date']} {hhmm}", "%Y-%m-%d %H%M").replace(tzinfo=timezone.utc)
    key = (round(lat, 3), round(lon, 3), t.isoformat())
    if key in seen:
        continue
    seen.add(key)
    cell = (round(lat / CELL), round(lon / CELL))
    features.append({
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "time": t.isoformat(),
            "satellite": r.get("satellite", ""),
            "confidence": conf,
            "frp": round(float(r.get("frp") or 0), 1),
            "persistent": len(days_per_cell[cell]) >= PERSIST_MIN_DAYS,
        },
    })

out = {
    "type": "FeatureCollection",
    "updated": datetime.now(timezone.utc).isoformat(),
    "features": features,
}
os.makedirs("data", exist_ok=True)
with open("data/fires.geojson", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)
print(f"تمت كتابة {len(features)} نقطة")
