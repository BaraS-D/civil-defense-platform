# موقع رصد الأرض للدفاع المدني – العراق

موقع ثابت على GitHub Pages. سكربتات Python تشتغل كل 3 ساعات عبر GitHub Actions
وتحدّث ملفات `data/`، والواجهة تقرأها.

## خطوات التشغيل

1. أنشئ مستودعاً جديداً على GitHub وارفع كل محتويات هذا المجلد (بما فيها المجلد المخفي `.github`).
2. **Settings → Pages**: Source = `Deploy from a branch`، الفرع `main`، المجلد `/ (root)`.
3. **Settings → Secrets and variables → Actions → New repository secret**، أضف ثلاثة أسرار:
   - `FIRMS_MAP_KEY`: مفتاح NASA FIRMS (من https://firms.modaps.eosdis.nasa.gov/api/map_key/)
   - `CDSE_CLIENT_ID` و `CDSE_CLIENT_SECRET`: من لوحة Copernicus Data Space
     (https://shapps.dataspace.copernicus.eu/dashboard → User settings → OAuth clients → Create)
4. **Settings → Actions → General → Workflow permissions**: اختر `Read and write permissions`.
5. تبويب **Actions** → «تحديث بيانات الأقمار الصناعية» → **Run workflow** لأول تشغيل يدوي.
   بعد دقيقتين تقريباً تظهر البيانات بالموقع.

## تجربة محلية

```
pip install -r scripts/requirements.txt
export FIRMS_MAP_KEY=...  CDSE_CLIENT_ID=...  CDSE_CLIENT_SECRET=...
python scripts/fetch_fires.py
python scripts/fetch_s5p.py
python -m http.server 8000     # ثم افتح http://localhost:8000
```

## ملاحظات مهمة

- **العتبات** بأعلى `scripts/fetch_s5p.py` (قاموس `PRODUCTS`) تقديرية. راقب القيم الاعتيادية
  بالعراق أسبوعين ثم عدّلها، وإلا تحصل إنذارات كثيرة (خصوصاً NO2 فوق بغداد والغبار).
- **المشاعل النفطية** (البصرة، كركوك…) تظهر كنقاط حرارية دائمة. السكربت يعلّمها `persistent`
  وتنعرض بطبقة منفصلة مطفأة افتراضياً.
- النقاط الحرارية ضمن مربع العراق قد تشمل أطراف الدول المجاورة.
- إذا فشل منتج Sentinel-5P معيّن يطبع السكربت السبب بسجل Actions ويكمل الباقي.
- الرياح تُجلب مباشرة من Open-Meteo عند الضغط على أي نقطة بالخريطة.
