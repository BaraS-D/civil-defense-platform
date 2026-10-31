"""يسحب طبقات Sentinel-5P (SO2, NO2, CO, CH4, الغبار) من Copernicus Data Space
عبر Sentinel Hub Process API، ويكتب:
  data/s5p/<product>.png   صورة ملونة شفافة للعرض فوق الخريطة
  data/s5p/meta.json       معلومات الطبقات والألوان والحدود
  data/s5p/alerts.json     مواقع القيم التي تجاوزت العتبة

المتغيرات المطلوبة: CDSE_CLIENT_ID , CDSE_CLIENT_SECRET
(تنشئهما من https://shapps.dataspace.copernicus.eu/dashboard > OAuth clients)
"""
import io
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np
import requests
import tifffile
from PIL import Image

CLIENT_ID = os.environ.get("CDSE_CLIENT_ID")
CLIENT_SECRET = os.environ.get("CDSE_CLIENT_SECRET")
if not (CLIENT_ID and CLIENT_SECRET):
    sys.exit("CDSE_CLIENT_ID / CDSE_CLIENT_SECRET غير موجودين")

W, S, E, N = 38.7, 29.0, 48.8, 37.4
WIDTH, HEIGHT = 300, 250
WINDOW_DAYS = 3
OUT = "data/s5p"

# scale: تحويل من وحدة القمر إلى وحدة العرض | الحدود والعتبات بوحدة العرض
# العتبات تقديرية وتحتاج معايرة بعد مراقبة القيم الاعتيادية في العراق
PRODUCTS = {
    "SO2": dict(band="SO2", label="ثاني أكسيد الكبريت", unit="DU", scale=2241.15,
                vmin=0.0, vmax=5.0, threshold=3.0, minqa=50,
                colors=["#fff7bc", "#fec44f", "#d95f0e", "#7a0177"]),
    "NO2": dict(band="NO2", label="ثاني أكسيد النيتروجين", unit="µmol/m²", scale=1e6,
                vmin=0.0, vmax=250.0, threshold=250.0, minqa=75,
                colors=["#fff5eb", "#fdae6b", "#e6550d", "#7f2704"]),
    "CO": dict(band="CO", label="أول أكسيد الكربون", unit="mmol/m²", scale=1e3,
               vmin=25.0, vmax=60.0, threshold=55.0, minqa=50,
               colors=["#f7fcb9", "#addd8e", "#31a354", "#005a32"]),
    "CH4": dict(band="CH4", label="الميثان", unit="ppb", scale=1.0,
                vmin=1800.0, vmax=2000.0, threshold=1950.0, minqa=50,
                colors=["#eff3ff", "#9ecae1", "#3182bd", "#08306b"]),
    "DUST": dict(band="AER_AI_340_380", label="مؤشر الغبار والدخان", unit="AI", scale=1.0,
                 vmin=0.0, vmax=5.0, threshold=2.5, minqa=50,
                 colors=["#ffffe5", "#d9a441", "#a6611a", "#543005"]),
}


def hex_to_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=float)


def colorize(values, valid, vmin, vmax, colors):
    t = np.clip((values - vmin) / (vmax - vmin), 0, 1)
    stops = np.linspace(0, 1, len(colors))
    pal = np.array([hex_to_rgb(c) for c in colors])
    rgb = np.stack([np.interp(t, stops, pal[:, k]) for k in range(3)], axis=-1)
    alpha = np.where(valid & (t > 0.05), 185, 0).astype(np.uint8)
    img = np.dstack([rgb.astype(np.uint8), alpha])
    return Image.fromarray(img, "RGBA")


def get_token():
    r = requests.post(
        "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token",
        data={"grant_type": "client_credentials", "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET},
        timeout=60,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def fetch_array(token, cfg, start, end):
    evalscript = f"""//VERSION=3
function setup() {{
  return {{ input: [{{ bands: ["{cfg['band']}", "dataMask"] }}],
           output: {{ bands: 2, sampleType: "FLOAT32" }} }};
}}
function evaluatePixel(s) {{ return [s.{cfg['band']}, s.dataMask]; }}"""
    body = {
        "input": {
            "bounds": {"bbox": [W, S, E, N],
                       "properties": {"crs": "http://www.opengis.net/def/crs/EPSG/0/4326"}},
            "data": [{
                "type": "sentinel-5p-l2",
                "dataFilter": {"timeRange": {"from": start, "to": end}, "mosaickingOrder": "mostRecent"},
                "processing": {"minQa": cfg["minqa"]},
            }],
        },
        "output": {"width": WIDTH, "height": HEIGHT,
                   "responses": [{"identifier": "default", "format": {"type": "image/tiff"}}]},
        "evalscript": evalscript,
    }
    r = requests.post("https://sh.dataspace.copernicus.eu/api/v1/process", json=body,
                      headers={"Authorization": f"Bearer {token}"}, timeout=180)
    r.raise_for_status()
    arr = tifffile.imread(io.BytesIO(r.content)).astype(float)
    if arr.ndim == 3 and arr.shape[0] == 2:
        arr = np.moveaxis(arr, 0, -1)
    return arr[..., 0], arr[..., 1] > 0


def pick_hotspots(values, valid, thr, limit=15, min_sep_deg=0.25):
    ys, xs = np.where(valid & (values >= thr))
    order = np.argsort(-values[ys, xs])
    picked = []
    for i in order:
        y, x = ys[i], xs[i]
        lon = W + (x + 0.5) * (E - W) / WIDTH
        lat = N - (y + 0.5) * (N - S) / HEIGHT
        if all(abs(lat - p[0]) > min_sep_deg or abs(lon - p[1]) > min_sep_deg for p in picked):
            picked.append((lat, lon, float(values[y, x])))
        if len(picked) >= limit:
            break
    return picked


def main():
    token = get_token()
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=WINDOW_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    end = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    os.makedirs(OUT, exist_ok=True)

    layers, alerts = {}, []
    for key, cfg in PRODUCTS.items():
        try:
            raw, valid = fetch_array(token, cfg, start, end)
        except Exception as e:  # منتج واحد فاشل لا يوقف الباقي
            print(f"فشل {key}: {e}", file=sys.stderr)
            continue
        valid &= np.isfinite(raw)
        values = np.where(valid, raw * cfg["scale"], np.nan)
        if not valid.any():
            print(f"{key}: لا توجد بيانات صالحة في الفترة")
            continue
        colorize(np.nan_to_num(values), valid, cfg["vmin"], cfg["vmax"], cfg["colors"]) \
            .save(f"{OUT}/{key}.png", optimize=True)
        layers[key] = {
            "label": cfg["label"], "unit": cfg["unit"], "file": f"{key}.png",
            "vmin": cfg["vmin"], "vmax": cfg["vmax"], "colors": cfg["colors"],
            "threshold": cfg["threshold"],
            "max": round(float(np.nanmax(values)), 2),
        }
        for lat, lon, v in pick_hotspots(np.nan_to_num(values, nan=-1e9), valid, cfg["threshold"]):
            alerts.append({"product": key, "label": cfg["label"], "unit": cfg["unit"],
                           "threshold": cfg["threshold"], "lat": round(lat, 4),
                           "lon": round(lon, 4), "value": round(v, 2)})
        print(f"{key}: تم")

    if not layers:
        sys.exit("لم تنجح أي طبقة")

    meta = {"updated": now.isoformat(), "window_days": WINDOW_DAYS,
            "bounds": [[S, W], [N, E]], "layers": layers}
    with open(f"{OUT}/meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)
    with open(f"{OUT}/alerts.json", "w", encoding="utf-8") as f:
        json.dump(alerts, f, ensure_ascii=False)


if __name__ == "__main__":
    main()
